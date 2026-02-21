/**
 * Engagement helpers — utility functions for email sequences.
 *
 * - unusedChannels()         → channels the user hasn't tried yet
 * - topicHighlights()        → most frequent topics from episodes
 * - curiosityClusters()      → recurring topic clusters for reflection email
 * - featureRotation()        → next "Did You Know?" feature to highlight
 * - canSendEmail()           → checks preferences + cooldowns + weekly cap
 * - logEmailSend()           → creates EmailLog entry
 * - getOrCreatePreferences() → ensures EmailPreferences exists for a user
 */

import prisma from '../db';
import { Prisma } from '@prisma/client';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

interface UserWithPrefs {
  id: string;
  email: string | null;
  name: string | null;
  userType: string;
  consentedAt: Date | null;
  revokedAt: Date | null;
  invitedAt: Date | null;
  inviteCode: string | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  preferences: Record<string, unknown>;
}

export interface EmailCandidate {
  userId: string;
  emailType: string;
  category: 'transactional' | 'nudges' | 'discovery' | 'reengagement';
  priority: number; // lower = higher priority
}

// All known capture channels
const ALL_CHANNELS = ['SMS', 'EMAIL', 'EXTENSION', 'SHARE_SHEET', 'API'] as const;

// Did You Know feature definitions (outcome-led)
export const DID_YOU_KNOW_FEATURES = [
  {
    key: 'voice',
    outcomeTitle: 'Capture the thoughts you don\'t write down',
    description: 'Record a quick voice memo from the dashboard — just hit the mic button and talk. Poddit transcribes it and adds it to your queue.',
    detectUsage: (channels: string[]) => channels.includes('API'), // voice captured via API/quick endpoint
  },
  {
    key: 'extension',
    outcomeTitle: 'Save something the moment it sparks',
    description: 'The Poddit Chrome extension lets you capture any webpage with one click. No copying links, no switching tabs.',
    detectUsage: (channels: string[]) => channels.includes('EXTENSION'),
  },
  {
    key: 'sms',
    outcomeTitle: 'Drop in a signal from anywhere — no app needed',
    description: 'Text a link or topic to your Poddit number. Works from any phone, any time — perfect for when you\'re away from a browser.',
    detectUsage: (channels: string[]) => channels.includes('SMS'),
  },
  {
    key: 'briefing_styles',
    outcomeTitle: 'Tune how deep Poddit goes',
    description: 'Choose Essential (3-5 min), Standard (7-10 min), or Strategic (10-15 min) in Settings to control your episode depth and length.',
    detectUsage: (_channels: string[], prefs: Record<string, unknown>) => !!prefs.briefingStyle && prefs.briefingStyle !== 'standard',
  },
  {
    key: 'ratings',
    outcomeTitle: 'Help Poddit learn what resonates with you',
    description: 'Rate your episodes after listening — it takes 10 seconds and helps Poddit adapt to what you find most valuable.',
    detectUsage: async (userId: string) => {
      const count = await prisma.episodeRating.count({ where: { userId } });
      return count > 0;
    },
  },
  {
    key: 'email_forward',
    outcomeTitle: 'That newsletter you almost saved? Forward it.',
    description: 'Forward any interesting email to Poddit and it\'ll land in your queue. Great for newsletters, articles, and industry updates.',
    detectUsage: (channels: string[]) => channels.includes('EMAIL'),
  },
] as const;

// ──────────────────────────────────────────────
// Channel analysis
// ──────────────────────────────────────────────

/**
 * Get capture channels the user hasn't used yet.
 */
export async function unusedChannels(userId: string): Promise<string[]> {
  const usedRaw = await prisma.signal.findMany({
    where: { userId },
    select: { channel: true },
    distinct: ['channel'],
  });
  const used = new Set(usedRaw.map(s => s.channel));
  return ALL_CHANNELS.filter(c => !used.has(c));
}

/**
 * Get all channels a user has used (for feature detection).
 */
export async function usedChannels(userId: string): Promise<string[]> {
  const result = await prisma.signal.findMany({
    where: { userId },
    select: { channel: true },
    distinct: ['channel'],
  });
  return result.map(s => s.channel);
}

// ──────────────────────────────────────────────
// Topic analysis
// ──────────────────────────────────────────────

/**
 * Get the most frequent topics from a user's READY episodes.
 * Returns sorted by frequency descending.
 */
export async function topicHighlights(
  userId: string,
  limit: number = 5,
): Promise<{ topic: string; count: number }[]> {
  const episodes = await prisma.episode.findMany({
    where: { userId, status: 'READY' },
    select: { topicsCovered: true },
    orderBy: { generatedAt: 'desc' },
    take: 50,
  });

  const counts = new Map<string, number>();
  for (const ep of episodes) {
    for (const topic of ep.topicsCovered) {
      const normalised = topic.toLowerCase().trim();
      counts.set(normalised, (counts.get(normalised) || 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([topic, count]) => ({ topic, count }));
}

/**
 * Build curiosity clusters for the Curiosity Reflection email.
 * Returns top recurring topics with enough signal to be meaningful (≥2 occurrences).
 */
export async function curiosityClusters(userId: string): Promise<{
  topics: { topic: string; count: number }[];
  episodeCount: number;
} | null> {
  const episodes = await prisma.episode.findMany({
    where: { userId, status: 'READY' },
    select: { topicsCovered: true },
  });

  if (episodes.length < 3) return null; // Not enough data

  const counts = new Map<string, number>();
  for (const ep of episodes) {
    for (const topic of ep.topicsCovered) {
      const normalised = topic.toLowerCase().trim();
      counts.set(normalised, (counts.get(normalised) || 0) + 1);
    }
  }

  // Only include topics that appear in ≥2 episodes (recurring)
  const recurring = Array.from(counts.entries())
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([topic, count]) => ({ topic, count }));

  if (recurring.length < 2) return null; // Not enough recurring topics

  return { topics: recurring, episodeCount: episodes.length };
}

// ──────────────────────────────────────────────
// Feature rotation
// ──────────────────────────────────────────────

/**
 * Find the next "Did You Know?" feature to highlight for a user.
 * Skips features the user already uses. Returns null if all features are used.
 */
export async function nextFeatureToHighlight(userId: string): Promise<typeof DID_YOU_KNOW_FEATURES[number] | null> {
  // Get already-sent feature keys
  const sentLogs = await prisma.emailLog.findMany({
    where: { userId, emailType: 'did_you_know' },
    select: { metadata: true },
  });
  const sentKeys = new Set(
    sentLogs.map(l => (l.metadata as Record<string, string>)?.featureKey).filter(Boolean)
  );

  // Get user's channels and preferences for detection
  const channels = await usedChannels(userId);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { preferences: true },
  });
  const prefs = (user?.preferences as Record<string, unknown>) || {};

  for (const feature of DID_YOU_KNOW_FEATURES) {
    if (sentKeys.has(feature.key)) continue; // Already sent this one

    // Check if user already uses this feature
    let alreadyUses = false;
    if (feature.key === 'ratings') {
      // Special case: async check
      const ratingCount = await prisma.episodeRating.count({ where: { userId } });
      alreadyUses = ratingCount > 0;
    } else if (feature.key === 'briefing_styles') {
      alreadyUses = (feature.detectUsage as (c: string[], p: Record<string, unknown>) => boolean)(channels, prefs);
    } else {
      alreadyUses = (feature.detectUsage as (c: string[]) => boolean)(channels);
    }

    if (!alreadyUses) return feature;
  }

  return null; // All features already used or sent
}

// ──────────────────────────────────────────────
// Email send gating
// ──────────────────────────────────────────────

const MAX_NON_TRANSACTIONAL_PER_WEEK = 2;
const MIN_HOURS_BETWEEN_NON_TRANSACTIONAL = 24;

/**
 * Check if we can send a non-transactional email to this user.
 * Checks: weekly cap (2), minimum gap (24h), preferences, consent, revocation.
 */
export async function canSendNonTransactional(
  userId: string,
  category: 'nudges' | 'discovery' | 'reengagement',
): Promise<boolean> {
  // Check preferences
  const prefs = await getOrCreatePreferences(userId);
  if (prefs.unsubscribedAll) return false;
  if (!prefs[category]) return false;

  // Check user consent + revocation
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { consentedAt: true, revokedAt: true },
  });
  if (!user?.consentedAt || user.revokedAt) return false;

  // Weekly cap: count non-transactional emails sent in the last 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekCount = await prisma.emailLog.count({
    where: {
      userId,
      createdAt: { gte: weekAgo },
      emailType: {
        in: ['mid_week_nudge', 'quiet_week', 'did_you_know', 'curiosity_reflection', 're_engage_21', 're_engage_45'],
      },
    },
  });
  if (weekCount >= MAX_NON_TRANSACTIONAL_PER_WEEK) return false;

  // Min gap: check last non-transactional email
  const lastNonTransactional = await prisma.emailLog.findFirst({
    where: {
      userId,
      emailType: {
        in: ['mid_week_nudge', 'quiet_week', 'did_you_know', 'curiosity_reflection', 're_engage_21', 're_engage_45'],
      },
    },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });

  if (lastNonTransactional) {
    const hoursSince = (Date.now() - lastNonTransactional.createdAt.getTime()) / (1000 * 60 * 60);
    if (hoursSince < MIN_HOURS_BETWEEN_NON_TRANSACTIONAL) return false;
  }

  return true;
}

/**
 * Check if we can send a transactional email (episode ready, welcome, etc.).
 * Only checks: consent, revocation, unsubscribedAll, transactional pref.
 */
export async function canSendTransactional(userId: string): Promise<boolean> {
  const prefs = await getOrCreatePreferences(userId);
  if (prefs.unsubscribedAll) return false;
  if (!prefs.transactional) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { consentedAt: true, revokedAt: true },
  });
  if (!user?.consentedAt || user.revokedAt) return false;

  return true;
}

/**
 * Check cooldown for a specific email type.
 * Returns true if enough time has passed since the last send of this type.
 */
export async function checkCooldown(
  userId: string,
  emailType: string,
  cooldownDays: number,
): Promise<boolean> {
  const cutoff = new Date(Date.now() - cooldownDays * 24 * 60 * 60 * 1000);
  const recent = await prisma.emailLog.findFirst({
    where: {
      userId,
      emailType,
      createdAt: { gte: cutoff },
    },
    select: { id: true },
  });
  return !recent; // true if no recent send found
}

// ──────────────────────────────────────────────
// EmailLog + EmailPreferences management
// ──────────────────────────────────────────────

/**
 * Log an email send to the EmailLog table.
 */
export async function logEmailSend(params: {
  userId: string;
  emailType: string;
  subject: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.emailLog.create({
      data: {
        userId: params.userId,
        emailType: params.emailType,
        subject: params.subject,
        status: 'sent',
        metadata: params.metadata ? (params.metadata as Prisma.InputJsonValue) : undefined,
      },
    });
  } catch (error) {
    console.error(`[Engagement] Failed to log email send:`, error);
  }
}

/**
 * Get or create EmailPreferences for a user.
 * Creates with all defaults (everything enabled) if not found.
 */
export async function getOrCreatePreferences(userId: string) {
  let prefs = await prisma.emailPreferences.findUnique({ where: { userId } });
  if (!prefs) {
    prefs = await prisma.emailPreferences.create({
      data: { userId },
    });
    console.log(`[Engagement] Created default email preferences for user ${userId}`);
  }
  return prefs;
}

// ──────────────────────────────────────────────
// Lifetime stats
// ──────────────────────────────────────────────

/**
 * Get summary stats for a user (for re-engagement and quiet week emails).
 */
export async function userLifetimeStats(userId: string): Promise<{
  signalCount: number;
  episodeCount: number;
  channelsUsed: string[];
}> {
  const [signalCount, episodeCount, channels] = await Promise.all([
    prisma.signal.count({ where: { userId } }),
    prisma.episode.count({ where: { userId, status: 'READY' } }),
    usedChannels(userId),
  ]);

  return { signalCount, episodeCount, channelsUsed: channels };
}
