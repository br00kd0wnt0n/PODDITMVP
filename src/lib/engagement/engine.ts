/**
 * Engagement engine — evaluates all users and fires eligible emails.
 *
 * Called by the daily cron at /api/cron/engagement.
 * Processes each user sequentially, evaluates trigger conditions in priority order,
 * respects weekly caps and cooldowns.
 *
 * Gated by ENGAGEMENT_ENABLED env var. When false, only admin test sends work.
 */

import prisma from '../db';
import { isEngagementEnabled } from './flags';
import {
  sendInviteReminder,
  sendFirstSignalEmail,
  sendMidWeekNudge,
  sendQuietWeekEmail,
  sendDidYouKnowEmail,
  sendCuriosityReflectionEmail,
  sendReEngage21Email,
  sendReEngage45Email,
} from './sequences';

// ──────────────────────────────────────────────
// Main engine
// ──────────────────────────────────────────────

interface EngagementResult {
  processed: number;
  emailsSent: number;
  errors: number;
  details: { userId: string; emailType: string; success: boolean }[];
}

/**
 * Process engagement emails for all eligible users.
 * Called once daily by cron.
 */
export async function processEngagementForAllUsers(): Promise<EngagementResult> {
  const result: EngagementResult = {
    processed: 0,
    emailsSent: 0,
    errors: 0,
    details: [],
  };

  if (!isEngagementEnabled()) {
    console.log('[Engagement] Skipped — ENGAGEMENT_ENABLED is not true');
    return result;
  }

  try {
    // ── Phase A: Invite reminders (users who haven't activated) ──
    await processInviteReminders(result);

    // ── Phase B: Active user sequences (requires consentedAt) ──
    const activeUsers = await prisma.user.findMany({
      where: {
        consentedAt: { not: null },
        revokedAt: null,
        email: { not: null },
      },
      select: {
        id: true,
        email: true,
        createdAt: true,
        lastActiveAt: true,
        consentedAt: true,
      },
    });

    for (const user of activeUsers) {
      try {
        await processUserEngagement(user, result);
        result.processed++;
      } catch (error) {
        console.error(`[Engagement] Error processing user ${user.id}:`, error);
        result.errors++;
      }
    }
  } catch (error) {
    console.error('[Engagement] Engine error:', error);
    result.errors++;
  }

  console.log(`[Engagement] Complete: ${result.processed} users, ${result.emailsSent} emails sent, ${result.errors} errors`);
  return result;
}

// ──────────────────────────────────────────────
// Invite reminders (unactivated users)
// ──────────────────────────────────────────────

async function processInviteReminders(result: EngagementResult): Promise<void> {
  const now = Date.now();
  const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  // Users who have been invited but haven't activated
  const invited = await prisma.user.findMany({
    where: {
      invitedAt: { not: null },
      consentedAt: null,
      revokedAt: null,
      inviteCode: { not: null },
      email: { not: null },
    },
    select: { id: true, invitedAt: true },
  });

  for (const user of invited) {
    if (!user.invitedAt) continue;
    const daysSinceInvite = now - user.invitedAt.getTime();

    // 7-day reminder (check first — if eligible for 7d, don't also send 3d)
    if (daysSinceInvite >= sevenDaysMs) {
      try {
        const sent = await sendInviteReminder(user.id, 7);
        result.details.push({ userId: user.id, emailType: 'invite_reminder_7d', success: sent });
        if (sent) result.emailsSent++;
      } catch (error) {
        console.error(`[Engagement] Invite reminder 7d error for ${user.id}:`, error);
        result.errors++;
      }
    } else if (daysSinceInvite >= threeDaysMs) {
      // 3-day reminder
      try {
        const sent = await sendInviteReminder(user.id, 3);
        result.details.push({ userId: user.id, emailType: 'invite_reminder_3d', success: sent });
        if (sent) result.emailsSent++;
      } catch (error) {
        console.error(`[Engagement] Invite reminder 3d error for ${user.id}:`, error);
        result.errors++;
      }
    }
  }
}

// ──────────────────────────────────────────────
// Per-user engagement evaluation
// ──────────────────────────────────────────────

async function processUserEngagement(
  user: {
    id: string;
    email: string | null;
    createdAt: Date;
    lastActiveAt: Date | null;
    consentedAt: Date | null;
  },
  result: EngagementResult,
): Promise<void> {
  const now = Date.now();
  const daysSinceSignup = user.consentedAt
    ? (now - user.consentedAt.getTime()) / (1000 * 60 * 60 * 24)
    : 0;
  const daysSinceActive = user.lastActiveAt
    ? (now - user.lastActiveAt.getTime()) / (1000 * 60 * 60 * 24)
    : Infinity;

  // Priority order (highest first): each user gets at most 1 email per engine run
  // This prevents email stacking on a single day

  // 1. First Signal email (transactional, one-time)
  if (await shouldSendFirstSignal(user.id)) {
    const sent = await sendFirstSignalEmail(user.id);
    result.details.push({ userId: user.id, emailType: 'first_signal', success: sent });
    if (sent) { result.emailsSent++; return; }
  }

  // 2. Re-engage 45d (one-time, highest urgency re-engagement)
  if (daysSinceActive >= 45) {
    const sent = await sendReEngage45Email(user.id);
    result.details.push({ userId: user.id, emailType: 're_engage_45', success: sent });
    if (sent) { result.emailsSent++; return; }
  }

  // 3. Re-engage 21d
  if (daysSinceActive >= 21 && daysSinceActive < 45) {
    const sent = await sendReEngage21Email(user.id);
    result.details.push({ userId: user.id, emailType: 're_engage_21', success: sent });
    if (sent) { result.emailsSent++; return; }
  }

  // 4. Mid-week nudge (Wednesday only)
  const isWednesday = new Date().getUTCDay() === 3;
  if (isWednesday && daysSinceActive < 21) {
    if (await shouldSendMidWeekNudge(user.id)) {
      const sent = await sendMidWeekNudge(user.id);
      result.details.push({ userId: user.id, emailType: 'mid_week_nudge', success: sent });
      if (sent) { result.emailsSent++; return; }
    }
  }

  // 5. Quiet week (7+ days inactive, has episodes)
  if (daysSinceActive >= 7 && daysSinceActive < 21) {
    if (await hasAnyEpisodes(user.id)) {
      const sent = await sendQuietWeekEmail(user.id);
      result.details.push({ userId: user.id, emailType: 'quiet_week', success: sent });
      if (sent) { result.emailsSent++; return; }
    }
  }

  // 6. Curiosity Reflection (Day 30-45, active users only)
  if (daysSinceSignup >= 30 && daysSinceSignup <= 45 && daysSinceActive < 14) {
    const sent = await sendCuriosityReflectionEmail(user.id);
    result.details.push({ userId: user.id, emailType: 'curiosity_reflection', success: sent });
    if (sent) { result.emailsSent++; return; }
  }

  // 7. Did You Know? (Day 10+, every 14 days)
  if (daysSinceSignup >= 10 && daysSinceActive < 21) {
    const sent = await sendDidYouKnowEmail(user.id);
    result.details.push({ userId: user.id, emailType: 'did_you_know', success: sent });
    if (sent) { result.emailsSent++; return; }
  }
}

// ──────────────────────────────────────────────
// Trigger condition helpers
// ──────────────────────────────────────────────

/**
 * Should we send the "first signal" email?
 * True if: user has exactly 1 signal, it was created in the last 24h, and we haven't sent this email yet.
 */
async function shouldSendFirstSignal(userId: string): Promise<boolean> {
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 'first_signal' },
  });
  if (alreadySent) return false;

  const signalCount = await prisma.signal.count({ where: { userId } });
  if (signalCount === 0) return false;

  // Check if the first signal was created in the last 24 hours
  const firstSignal = await prisma.signal.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true },
  });
  if (!firstSignal) return false;

  const hoursSinceFirst = (Date.now() - firstSignal.createdAt.getTime()) / (1000 * 60 * 60);
  return hoursSinceFirst <= 24;
}

/**
 * Should we send the mid-week nudge?
 * True if: no signals this week, has sent signals before.
 */
async function shouldSendMidWeekNudge(userId: string): Promise<boolean> {
  // Has sent signals before?
  const totalSignals = await prisma.signal.count({ where: { userId } });
  if (totalSignals === 0) return false;

  // No signals this week?
  const startOfWeek = getStartOfWeek();
  const thisWeekSignals = await prisma.signal.count({
    where: {
      userId,
      createdAt: { gte: startOfWeek },
    },
  });

  return thisWeekSignals === 0;
}

/**
 * Does the user have at least 1 READY episode?
 */
async function hasAnyEpisodes(userId: string): Promise<boolean> {
  const count = await prisma.episode.count({
    where: { userId, status: 'READY' },
  });
  return count > 0;
}

/**
 * Get the start of the current week (Monday 00:00 UTC).
 */
function getStartOfWeek(): Date {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  monday.setUTCHours(0, 0, 0, 0);
  return monday;
}
