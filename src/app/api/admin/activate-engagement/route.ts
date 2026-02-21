import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import prisma from '@/lib/db';
import { getOrCreatePreferences } from '@/lib/engagement/helpers';
import {
  sendWelcomeEmail,
  sendFirstSignalEmail,
  sendFirstEpisodeEmail,
} from '@/lib/engagement/sequences';

/**
 * POST /api/admin/activate-engagement
 *
 * One-time catchup for existing users when engagement emails are first enabled.
 * Evaluates each user's state and sends the most appropriate email:
 *
 * - Has episodes → first episode email (if never sent)
 * - Has signals but no episodes → first signal email
 * - Has consented but no signals → welcome email
 * - Invited but not activated → skip (invite reminders handled by daily cron)
 *
 * Each user gets at most 1 email. Does not re-send if already logged.
 * Creates EmailPreferences for all users who don't have them yet.
 *
 * Body: { dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;

    // Get all active consented users
    const users = await prisma.user.findMany({
      where: {
        consentedAt: { not: null },
        revokedAt: null,
        email: { not: null },
      },
      select: {
        id: true,
        email: true,
        name: true,
        _count: {
          select: { episodes: true, signals: true },
        },
      },
    });

    const results: { userId: string; email: string | null; action: string; sent: boolean }[] = [];

    for (const user of users) {
      // Ensure EmailPreferences exist
      await getOrCreatePreferences(user.id);

      const hasEpisodes = user._count.episodes > 0;
      const hasSignals = user._count.signals > 0;

      // Check if first ready episode exists
      let firstReadyEpisode: { id: string } | null = null;
      if (hasEpisodes) {
        firstReadyEpisode = await prisma.episode.findFirst({
          where: { userId: user.id, status: 'READY' },
          orderBy: { generatedAt: 'asc' },
          select: { id: true },
        });
      }

      // Check what's already been sent to this user
      const sentTypes = await prisma.emailLog.findMany({
        where: { userId: user.id },
        select: { emailType: true },
      });
      const alreadySent = new Set(sentTypes.map(s => s.emailType));

      let action = 'skip (no applicable catchup)';
      let sent = false;

      if (firstReadyEpisode && !alreadySent.has('first_episode') && !alreadySent.has('episode_ready')) {
        action = 'first_episode';
        if (!dryRun) {
          sent = await sendFirstEpisodeEmail(user.id, firstReadyEpisode.id);
        }
      } else if (hasSignals && !hasEpisodes && !alreadySent.has('first_signal')) {
        action = 'first_signal';
        if (!dryRun) {
          sent = await sendFirstSignalEmail(user.id);
        }
      } else if (!hasSignals && !alreadySent.has('welcome')) {
        action = 'welcome';
        if (!dryRun) {
          sent = await sendWelcomeEmail(user.id);
        }
      } else {
        // User already has appropriate emails logged, or has episodes + episode_ready logged
        action = alreadySent.size > 0 ? `skip (already has: ${[...alreadySent].join(', ')})` : 'skip (has episodes, emails already logged)';
      }

      results.push({ userId: user.id, email: user.email, action, sent });
    }

    const emailsSent = results.filter(r => r.sent).length;
    const skipped = results.filter(r => r.action.startsWith('skip')).length;

    console.log(`[Admin] Engagement activation ${dryRun ? '(DRY RUN)' : ''}: ${users.length} users, ${emailsSent} emails sent, ${skipped} skipped`);

    return NextResponse.json({
      success: true,
      dryRun,
      totalUsers: users.length,
      emailsSent,
      skipped,
      results,
    });
  } catch (error) {
    console.error('[Admin] Activate engagement error:', error);
    return NextResponse.json({ error: 'Failed to activate engagement' }, { status: 500 });
  }
}
