import { NextRequest, NextResponse } from 'next/server';
import { generateEpisode, getLastWeekStart } from '@/lib/synthesize';
import { notifyEpisodeReady } from '@/lib/deliver';
import prisma from '@/lib/db';

// Allow up to 10 minutes for multi-user generation
export const maxDuration = 600;

// ──────────────────────────────────────────────
// GET /api/cron
// Weekly automated episode generation — multi-user
//
// Finds all users with queued/enriched signals,
// generates a separate episode for each, and notifies.
//
// Trigger via Railway cron job or external service:
// curl -H "Authorization: Bearer $CRON_SECRET" https://poddit.com/api/cron
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (header only — no query params for security)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const since = getLastWeekStart();

    // Find all users who have signals to process this week
    const usersWithSignals = await prisma.signal.groupBy({
      by: ['userId'],
      where: {
        status: { in: ['QUEUED', 'ENRICHED'] },
        createdAt: { gte: since },
      },
      _count: { id: true },
    });

    if (usersWithSignals.length === 0) {
      console.log('[Cron] No signals to process this week for any user');
      return NextResponse.json({
        status: 'skipped',
        reason: 'No signals captured this week',
      });
    }

    console.log(`[Cron] Found ${usersWithSignals.length} user(s) with signals to process`);

    const results: { userId: string; episodeId?: string; title?: string; signalCount?: number; error?: string }[] = [];

    // Generate episode for each user (sequential to avoid overloading APIs)
    for (const group of usersWithSignals) {
      const userId = group.userId;
      const signalCount = group._count.id;

      console.log(`[Cron] Generating for user ${userId} (${signalCount} signals)`);

      try {
        // Episode cap based on user type
        const cronUser = await prisma.user.findUnique({
          where: { id: userId },
          select: { userType: true, episodeBonusGranted: true },
        });
        const BASE_LIMITS: Record<string, number> = { MASTER: Infinity, EARLY_ACCESS: 3, TESTER: 10 };
        const baseLimit = BASE_LIMITS[cronUser?.userType || 'EARLY_ACCESS'] ?? 3;
        const limit = baseLimit === Infinity ? Infinity : baseLimit + (cronUser?.episodeBonusGranted || 0);

        if (limit !== Infinity) {
          const readyCount = await prisma.episode.count({
            where: { userId, status: 'READY' },
          });
          if (readyCount >= limit) {
            console.log(`[Cron] Skipping user ${userId} — at ${limit}-episode limit (${cronUser?.userType})`);
            results.push({ userId, error: 'episode_limit' });
            continue;
          }
        }

        const episodeId = await generateEpisode({ userId, since });

        // Fetch episode and notify
        const episode = await prisma.episode.findUnique({
          where: { id: episodeId },
        });

        if (episode && episode.status === 'READY') {
          // Look up user's phone for notification
          const user = await prisma.user.findUnique({ where: { id: userId } });
          await notifyEpisodeReady({
            episodeId: episode.id,
            title: episode.title || 'Your Poddit Episode',
            signalCount: episode.signalCount,
            duration: episode.audioDuration || undefined,
            userPhone: user?.phone || undefined,
          });
        }

        results.push({
          userId,
          episodeId,
          title: episode?.title || undefined,
          signalCount: episode?.signalCount,
        });
      } catch (error: any) {
        console.error(`[Cron] Failed for user ${userId}:`, error);
        results.push({ userId, error: error.message || 'Generation failed' });
      }
    }

    return NextResponse.json({
      status: 'completed',
      usersProcessed: results.length,
      results,
    });

  } catch (error: any) {
    console.error('[Cron] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Cron generation failed' },
      { status: 500 }
    );
  }
}
