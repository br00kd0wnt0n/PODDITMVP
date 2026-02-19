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
        select: { channel: true, topics: true },
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

    // Aggregate topic + channel data from ALL used signals for Highlights panel
    const allTopics: string[] = highlightSignals.flatMap(s => s.topics);
    const allChannels: string[] = highlightSignals.map(s => s.channel);

    return NextResponse.json({ episodes: result, highlights: { topics: allTopics, channels: allChannels } });
  } catch (error) {
    console.error('[Episodes] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch episodes' },
      { status: 500 }
    );
  }
}
