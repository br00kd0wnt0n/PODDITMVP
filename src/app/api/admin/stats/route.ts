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
    const stuckThreshold = new Date(now.getTime() - 15 * 60 * 1000); // 15 min

    // Auto-cleanup: mark episodes stuck in GENERATING/SYNTHESIZING for 15+ min as FAILED
    // and release their signals back to QUEUED so users can retry
    const zombieEpisodes = await prisma.episode.findMany({
      where: { status: { in: ['GENERATING', 'SYNTHESIZING'] }, createdAt: { lt: stuckThreshold } },
      select: { id: true },
    });
    if (zombieEpisodes.length > 0) {
      const zombieIds = zombieEpisodes.map(e => e.id);
      await prisma.$transaction([
        prisma.episode.updateMany({
          where: { id: { in: zombieIds } },
          data: { status: 'FAILED', error: 'Timed out — stuck in generation for 15+ minutes' },
        }),
        prisma.signal.updateMany({
          where: { episodeId: { in: zombieIds } },
          data: { status: 'QUEUED', episodeId: null },
        }),
      ]);
      console.log(`[Admin] Auto-cleaned ${zombieIds.length} stuck episode(s): ${zombieIds.join(', ')}`);
    }

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
      stuckEpisodes,
      activeEpisodes,
      lastSuccessfulEpisode,
      totalReadyEpisodes,
      totalFailedEpisodes,
      totalFeedback,
      newFeedbackCount,
      recentFeedback,
      totalEpisodeRatings,
      recentEpisodeRatings,
      ratingAverages,
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
          user: { select: { name: true, email: true } },
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
      // Failed signals (last 7 days only)
      prisma.signal.findMany({
        where: { status: 'FAILED', createdAt: { gte: weekAgo } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, rawContent: true, channel: true, createdAt: true },
      }),
      // Failed episodes (last 7 days only)
      prisma.episode.findMany({
        where: { status: 'FAILED', createdAt: { gte: weekAgo } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: { id: true, title: true, error: true, createdAt: true },
      }),
      // Stuck episodes (GENERATING/SYNTHESIZING for more than 10 min — zombies)
      prisma.episode.findMany({
        where: {
          status: { in: ['GENERATING', 'SYNTHESIZING'] },
          createdAt: { lt: new Date(now.getTime() - 10 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, status: true, createdAt: true, user: { select: { name: true, email: true } } },
      }),
      // Currently generating (active, not stuck)
      prisma.episode.findMany({
        where: {
          status: { in: ['GENERATING', 'SYNTHESIZING'] },
          createdAt: { gte: new Date(now.getTime() - 10 * 60 * 1000) },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, title: true, status: true, createdAt: true, user: { select: { name: true, email: true } } },
      }),
      // Last successful episode
      prisma.episode.findFirst({
        where: { status: 'READY' },
        orderBy: { generatedAt: 'desc' },
        select: { id: true, title: true, generatedAt: true, user: { select: { name: true, email: true } } },
      }),
      // Total ready episodes (all time)
      prisma.episode.count({ where: { status: 'READY' } }),
      // Total failed episodes (all time, for context)
      prisma.episode.count({ where: { status: 'FAILED' } }),
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
      // Episode ratings
      prisma.episodeRating.count(),
      prisma.episodeRating.findMany({
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: {
          id: true,
          enjoyment: true,
          resonance: true,
          connections: true,
          feedback: true,
          createdAt: true,
          user: { select: { name: true, email: true } },
          episode: { select: { id: true, title: true } },
        },
      }),
      prisma.episodeRating.aggregate({
        _avg: { enjoyment: true, resonance: true, connections: true },
      }),
      // Questionnaire responses
      prisma.questionnaireResponse.findMany({
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: {
          id: true,
          userId: true,
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
          invitedAt: true,
          revokedAt: true,
          _count: {
            select: { episodes: true, signals: true, feedback: true, episodeRatings: true, questionnaireResponses: true },
          },
        },
      }),
    ]);

    // Fetch access requests from PODDIT-CONCEPT server (server-side, no CORS issues)
    let accessRequests: any[] = [];
    const conceptUrl = process.env.CONCEPT_API_URL;
    if (conceptUrl) {
      try {
        const adminSecret = process.env.ADMIN_SECRET || process.env.API_SECRET;
        const conceptRes = await fetch(`${conceptUrl}/api/admin/access-requests`, {
          headers: { Authorization: `Bearer ${adminSecret}` },
          signal: AbortSignal.timeout(5000), // 5s timeout
        });
        if (conceptRes.ok) {
          const conceptData = await conceptRes.json();
          accessRequests = conceptData.requests || [];
        } else {
          console.warn(`[Admin] Concept server returned ${conceptRes.status}`);
        }
      } catch (err: any) {
        console.warn('[Admin] Failed to fetch concept access requests:', err.message);
      }
    }

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
        status: (() => {
          if (stuckEpisodes.length > 0) return 'stuck';
          if (activeEpisodes.length > 0) return 'generating';
          // Only show "issues" if failures are more recent than last success
          if (failedEpisodes.length > 0 || failedSignals.length > 0) {
            const lastFailureTime = Math.max(
              ...failedEpisodes.map(e => new Date(e.createdAt).getTime()),
              ...failedSignals.map(s => new Date(s.createdAt).getTime()),
            );
            const lastSuccessTime = lastSuccessfulEpisode?.generatedAt
              ? new Date(lastSuccessfulEpisode.generatedAt).getTime()
              : 0;
            // If last success is after last failure, system is healthy (recovered)
            if (lastSuccessTime > lastFailureTime) return 'healthy';
            return 'issues';
          }
          return 'healthy';
        })(),
        activeEpisodes,
        stuckEpisodes,
        lastSuccessfulEpisode,
        totalReadyEpisodes,
        totalFailedEpisodes,
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
        invitedAt: u.invitedAt,
        revokedAt: u.revokedAt,
        episodeCount: u._count.episodes,
        signalCount: u._count.signals,
        feedbackCount: u._count.feedback,
        ratingCount: u._count.episodeRatings,
        questionnaireCount: u._count.questionnaireResponses,
      })),
      episodeRatings: {
        total: totalEpisodeRatings,
        averages: {
          enjoyment: ratingAverages._avg.enjoyment,
          resonance: ratingAverages._avg.resonance,
          connections: ratingAverages._avg.connections,
        },
        recent: recentEpisodeRatings,
      },
      questionnaire: {
        total: questionnaireResponses.length,
        responses: questionnaireResponses,
      },
      accessRequests,
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
