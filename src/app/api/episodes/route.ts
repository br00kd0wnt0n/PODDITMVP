import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/episodes
// List episodes or get a specific one (filtered by user)
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sessionResult = await requireSession();
  if (sessionResult instanceof NextResponse) return sessionResult;
  const { userId } = sessionResult;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  try {
    if (id) {
      // Get specific episode with segments (verify ownership)
      const episode = await prisma.episode.findFirst({
        where: { id, userId },
        include: {
          segments: { orderBy: { order: 'asc' } },
          signals: {
            select: {
              id: true,
              inputType: true,
              title: true,
              url: true,
              source: true,
              channel: true,
            },
          },
        },
      });

      if (!episode) {
        return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
      }

      return NextResponse.json(episode);
    }

    // List recent episodes for this user (with rating status)
    // Include GENERATING/SYNTHESIZING episodes so frontend can show progress
    // Bounded to 50 most recent to prevent unbounded queries on heavy users
    const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 100);

    const [episodes, highlightSignals] = await Promise.all([
      prisma.episode.findMany({
        where: { userId, status: { in: ['READY', 'GENERATING', 'SYNTHESIZING'] } },
        orderBy: { createdAt: 'desc' },
        take: limit,
        select: {
          id: true,
          title: true,
          summary: true,
          audioUrl: true,
          audioDuration: true,
          signalCount: true,
          topicsCovered: true,
          generatedAt: true,
          periodStart: true,
          periodEnd: true,
          status: true,
          ratings: {
            where: { userId },
            select: { id: true },
            take: 1,
          },
          signals: {
            select: { channel: true, topics: true },
          },
        },
      }),
      // Lightweight query for Highlights: topics + channels from recent used signals
      // Bounded to 500 most recent to prevent unbounded queries for heavy users
      prisma.signal.findMany({
        where: { userId, status: 'USED' },
        select: { channel: true, topics: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
        take: 500,
      }),
    ]);

    // Flatten: add `rated` boolean + channels array, remove nested relations
    const result = episodes.map(({ ratings, signals, ...ep }) => ({
      ...ep,
      rated: ratings.length > 0,
      channels: signals.map(s => s.channel),
      signalTopics: signals.flatMap(s => s.topics),
    }));

    // ── Server-side highlights aggregation ──
    // Pre-compute topic/channel counts + temporal trends instead of shipping raw arrays
    const topicCounts: Record<string, { display: string; count: number }> = {};
    const channelCounts: Record<string, number> = {};

    // Temporal bucketing for Curiosity Patterns
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const currentMonthTopics: Record<string, number> = {};
    const lastMonthTopics: Record<string, number> = {};
    let currentMonthSignalCount = 0;

    highlightSignals.forEach(s => {
      // Channel counts
      channelCounts[s.channel] = (channelCounts[s.channel] || 0) + 1;

      // Monthly bucket
      const month = `${s.createdAt.getFullYear()}-${String(s.createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (month === currentMonth) currentMonthSignalCount++;
      const bucket = month === currentMonth ? currentMonthTopics : month === lastMonth ? lastMonthTopics : null;

      // Topic counts (all-time + monthly)
      s.topics.forEach(t => {
        const key = t.trim().toLowerCase();
        if (!topicCounts[key]) topicCounts[key] = { display: t, count: 0 };
        topicCounts[key].count++;
        if (bucket) bucket[key] = (bucket[key] || 0) + 1;
      });
    });

    // All-time top topics (pre-sorted, pre-sliced)
    const topics = Object.values(topicCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    // Channel breakdown
    const channels = Object.entries(channelCounts)
      .sort(([, a], [, b]) => b - a)
      .map(([name, count]) => ({ name, count }));

    // Curiosity Patterns: trends + new topics (only if enough data)
    const trends: { topic: string; previous: number; current: number; change: number }[] = [];
    const newTopics: string[] = [];

    if (currentMonthSignalCount >= 5) {
      for (const [key, current] of Object.entries(currentMonthTopics)) {
        const previous = lastMonthTopics[key] || 0;
        const display = topicCounts[key]?.display || key;
        if (previous === 0 && current >= 2) {
          newTopics.push(display);
        } else if (previous > 0 && current / previous >= 2) {
          trends.push({ topic: display, previous, current, change: +(current / previous).toFixed(1) });
        }
      }
      trends.sort((a, b) => b.change - a.change);
    }

    return NextResponse.json({
      episodes: result,
      highlights: {
        topics,
        channels,
        totalSignals: highlightSignals.length,
        trends: trends.slice(0, 3),
        newTopics: newTopics.slice(0, 3),
      },
    });
  } catch (error) {
    console.error('[Episodes] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch episodes' },
      { status: 500 }
    );
  }
}
