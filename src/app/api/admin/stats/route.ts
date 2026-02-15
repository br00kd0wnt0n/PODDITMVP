import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/admin/stats
// Aggregated metrics for admin mission control
// ──────────────────────────────────────────────

// ──────────────────────────────────────────────
// PATCH /api/admin/stats
// Update user type
// ──────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { userId, userType } = body;

    if (!userId || !userType) {
      return NextResponse.json({ error: 'userId and userType required' }, { status: 400 });
    }

    const validTypes = ['MASTER', 'EARLY_ACCESS', 'TESTER'];
    if (!validTypes.includes(userType)) {
      return NextResponse.json({ error: `Invalid userType. Options: ${validTypes.join(', ')}` }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: { userType },
      select: { id: true, email: true, userType: true },
    });

    console.log(`[Admin] User ${updated.email} type changed to ${userType}`);

    return NextResponse.json(updated);
  } catch (error: any) {
    console.error('[Admin] Update user type error:', error);
    return NextResponse.json({ error: 'Failed to update user type' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  // Auth: requires ADMIN_SECRET (falls back to API_SECRET if not set)
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  // Rate limit: 10 requests per minute (prevent expensive query spam)
  const { allowed, retryAfterMs } = rateLimit('admin:stats', 10, 60_000);
  if (!allowed) {
    return NextResponse.json(
      { error: 'Too many requests. Please wait.' },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
    );
  }

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
      totalFeedback,
      newFeedbackCount,
      recentFeedback,
      questionnaireResponses,
      users,
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
      // Feedback queries
      prisma.feedback.count(),
      prisma.feedback.count({ where: { status: 'NEW' } }),
      prisma.feedback.findMany({
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          type: true,
          content: true,
          status: true,
          createdAt: true,
          user: {
            select: { name: true, email: true },
          },
        },
      }),
      // Questionnaire responses
      prisma.questionnaireResponse.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          responses: true,
          milestone: true,
          createdAt: true,
          user: {
            select: { name: true, email: true },
          },
        },
      }),
      // Users list
      prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          userType: true,
          createdAt: true,
          consentedAt: true,
          _count: {
            select: { episodes: true, signals: true },
          },
        },
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
      feedback: {
        total: totalFeedback,
        new: newFeedbackCount,
        recent: recentFeedback,
      },
      health: {
        failedSignals,
        failedEpisodes,
      },
      users: users.map(u => ({
        id: u.id,
        name: u.name,
        email: u.email,
        userType: u.userType,
        createdAt: u.createdAt,
        consentedAt: u.consentedAt,
        episodeCount: u._count.episodes,
        signalCount: u._count.signals,
      })),
      questionnaire: {
        total: questionnaireResponses.length,
        responses: questionnaireResponses,
      },
      generatedAt: now.toISOString(),
    });
  } catch (error: any) {
    console.error('[Admin] Stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}
