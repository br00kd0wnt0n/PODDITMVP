import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/admin/stats
// Aggregated metrics for admin mission control
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Auth: requires API_SECRET (stronger than dashboard auth)
  const authError = requireAuth(request);
  if (authError) return authError;

  try {
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [
      totalSignals,
      totalEpisodes,
      totalUsers,
      signalsThisWeek,
      episodesThisWeek,
      signalsByStatus,
      signalsByChannel,
      signalsByInputType,
      recentEpisodes,
      episodesByStatus,
      recentSignals,
      failedSignals,
      failedEpisodes,
    ] = await Promise.all([
      prisma.signal.count(),
      prisma.episode.count(),
      prisma.user.count(),
      prisma.signal.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.episode.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.signal.groupBy({ by: ['status'], _count: true }),
      prisma.signal.groupBy({ by: ['channel'], _count: true }),
      prisma.signal.groupBy({ by: ['inputType'], _count: true }),
      prisma.episode.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          title: true,
          status: true,
          audioDuration: true,
          signalCount: true,
          generatedAt: true,
          error: true,
        },
      }),
      prisma.episode.groupBy({ by: ['status'], _count: true }),
      prisma.signal.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          inputType: true,
          channel: true,
          rawContent: true,
          url: true,
          title: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.signal.findMany({
        where: { status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, rawContent: true, channel: true, createdAt: true },
      }),
      prisma.episode.findMany({
        where: { status: 'FAILED' },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, title: true, error: true, createdAt: true },
      }),
    ]);

    return NextResponse.json({
      totals: {
        signals: totalSignals,
        episodes: totalEpisodes,
        users: totalUsers,
        signalsThisWeek,
        episodesThisWeek,
      },
      signals: {
        byStatus: signalsByStatus.map(s => ({ status: s.status, count: s._count })),
        byChannel: signalsByChannel.map(s => ({ channel: s.channel, count: s._count })),
        byInputType: signalsByInputType.map(s => ({ inputType: s.inputType, count: s._count })),
      },
      episodes: {
        recent: recentEpisodes,
        byStatus: episodesByStatus.map(s => ({ status: s.status, count: s._count })),
      },
      recentSignals,
      health: {
        failedSignals,
        failedEpisodes,
      },
      generatedAt: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[Admin] Stats error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
