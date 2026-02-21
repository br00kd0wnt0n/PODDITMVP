/**
 * Email sequence definitions — content builders for each engagement email.
 *
 * Each function builds the HTML/text content and sends via the shared sendEmail() helper.
 * All non-transactional emails check canSendNonTransactional() before sending.
 * Every send is logged to EmailLog for admin visibility and deduplication.
 */

import prisma from '../db';
import { sendEmail } from '../email';
import {
  buildEmailHtml,
  buildEmailText,
  greeting,
  p,
  pLast,
  pMuted,
  ctaButton,
  codeBox,
  episodeCard,
  topicPills,
  statLine,
  link,
} from './templates';
import {
  logEmailSend,
  getOrCreatePreferences,
  canSendTransactional,
  canSendNonTransactional,
  checkCooldown,
  unusedChannels,
  topicHighlights,
  curiosityClusters,
  nextFeatureToHighlight,
  userLifetimeStats,
} from './helpers';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poddit.com';

// ──────────────────────────────────────────────
// 0. INVITE REMINDER (3d + 7d for unactivated users)
// ──────────────────────────────────────────────

export async function sendInviteReminder(userId: string, daysSinceInvite: 3 | 7): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, inviteCode: true, invitedAt: true, consentedAt: true, revokedAt: true },
  });

  if (!user?.email || !user.inviteCode || user.consentedAt || user.revokedAt) return false;

  // Check if already sent this reminder variant
  const alreadySent = await prisma.emailLog.findFirst({
    where: {
      userId,
      emailType: 'invite_reminder',
      metadata: { path: ['daysSinceInvite'], equals: daysSinceInvite },
    },
  });
  if (alreadySent) return false;

  // Max 2 invite reminders total
  const totalSent = await prisma.emailLog.count({
    where: { userId, emailType: 'invite_reminder' },
  });
  if (totalSent >= 2) return false;

  const subject = daysSinceInvite === 3
    ? 'Your Poddit access is ready'
    : 'Just making sure you saw this';

  const bodyHtml = daysSinceInvite === 3
    ? [
        greeting(user.name),
        p('Your Poddit access is ready whenever you are.'),
        codeBox('Your access code', user.inviteCode),
        ctaButton('Sign in to Poddit', `${APP_URL}/auth/signin`),
        pLast(`Poddit turns the things you're curious about into a personal audio briefing. Drop in links, topics, or voice notes throughout your week \u2014 then listen.`),
      ].join('')
    : [
        greeting(user.name),
        p('Just a quick note \u2014 your Poddit invite code is still active.'),
        codeBox('Your access code', user.inviteCode),
        ctaButton('Sign in to Poddit', `${APP_URL}/auth/signin`),
        pLast('No rush. It\u2019s here when you\u2019re ready.'),
      ].join('');

  const bodyText = daysSinceInvite === 3
    ? `${user.name ? `Hi ${user.name}` : 'Hi there'},\n\nYour Poddit access is ready whenever you are.\n\nYour code: ${user.inviteCode}\nSign in: ${APP_URL}/auth/signin\n\nPoddit turns the things you're curious about into a personal audio briefing.\nDrop in links, topics, or voice notes throughout your week — then listen.`
    : `${user.name ? `Hi ${user.name}` : 'Hi there'},\n\nJust a quick note — your Poddit invite code is still active.\n\nYour code: ${user.inviteCode}\nSign in: ${APP_URL}/auth/signin\n\nNo rush. It's here when you're ready.`;

  // No unsubscribe for invite reminders (they haven't consented yet)
  const html = buildEmailHtml({ name: user.name, subject, bodyHtml, bodyText, showFooter: false });
  const text = buildEmailText({ name: user.name, subject, bodyHtml, bodyText, showFooter: false });

  const result = await sendEmail({
    to: user.email,
    subject,
    html,
    text,
    label: `Invite reminder (${daysSinceInvite}d) to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({
      userId,
      emailType: 'invite_reminder',
      subject,
      metadata: { daysSinceInvite },
    });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 1. WELCOME (first sign-in)
// ──────────────────────────────────────────────

export async function sendWelcomeEmail(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true, consentedAt: true },
  });

  if (!user?.email || !user.consentedAt) return false;

  // Check if already sent
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 'welcome' },
  });
  if (alreadySent) return false;

  const prefs = await getOrCreatePreferences(userId);

  const subject = 'Welcome to Poddit \u2014 here\u2019s how to start';

  const bodyHtml = [
    greeting(user.name),
    p('Welcome to Poddit. Three steps to get started:'),
    p(`<strong>1. Capture</strong> \u2014 Drop in a link, topic, or voice note. Anything you\u2019re curious about. ${link('Try it now', APP_URL)}.`),
    p(`<strong>2. Generate</strong> \u2014 When you\u2019re ready, tap Generate My Episode. Poddit synthesizes your signals into a personal audio briefing.`),
    p(`<strong>3. Listen</strong> \u2014 Play your episode anywhere. Rate it after to help Poddit learn what resonates.`),
    pLast(`Make this a daily habit \u2014 drop in anything you\u2019re curious about throughout the day. Even 2\u20133 signals make a great episode.`),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

Welcome to Poddit. Three steps to get started:

1. Capture — Drop in a link, topic, or voice note. Anything you're curious about.
2. Generate — When you're ready, tap Generate My Episode.
3. Listen — Play your episode anywhere. Rate it after to help Poddit learn.

Make this a daily habit — drop in anything you're curious about throughout the day. Even 2-3 signals make a great episode.

${APP_URL}`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'transactional emails',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'transactional emails',
  });

  const result = await sendEmail({
    to: user.email,
    subject,
    html,
    text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    label: `Welcome email to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'welcome', subject });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 2. FIRST SIGNAL
// ──────────────────────────────────────────────

export async function sendFirstSignalEmail(userId: string): Promise<boolean> {
  if (!(await canSendTransactional(userId))) return false;

  // Check if already sent
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 'first_signal' },
  });
  if (alreadySent) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  // Get the first signal
  const firstSignal = await prisma.signal.findFirst({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { rawContent: true, title: true, channel: true, topics: true },
  });
  if (!firstSignal) return false;

  const unused = await unusedChannels(userId);
  const prefs = await getOrCreatePreferences(userId);

  const signalPreview = firstSignal.title || firstSignal.rawContent.slice(0, 80);
  const channelName = firstSignal.channel.toLowerCase();
  const unusedSuggestion = unused.length > 0
    ? `You captured this via ${channelName}. You can also try ${unused.slice(0, 2).map(c => c.toLowerCase()).join(' or ')}.`
    : '';

  const subject = 'Your first signal is queued';

  const bodyHtml = [
    greeting(user.name),
    p(`Your first signal is in the queue: <strong>${signalPreview}</strong>`),
    firstSignal.topics.length > 0 ? topicPills(firstSignal.topics) : '',
    p('Drop in 2\u20133 more and you\u2019ll have enough for your first episode.'),
    unusedSuggestion ? pMuted(unusedSuggestion) : '',
    pLast('Most people find a rhythm: one signal at morning coffee, one at lunch, one before end of day.'),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

Your first signal is in the queue: ${signalPreview}

Drop in 2-3 more and you'll have enough for your first episode.${unusedSuggestion ? '\n\n' + unusedSuggestion : ''}

Most people find a rhythm: one signal at morning coffee, one at lunch, one before end of day.`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'transactional emails',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'transactional emails',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    label: `First signal email to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'first_signal', subject });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 3. FIRST EPISODE
// ──────────────────────────────────────────────

export async function sendFirstEpisodeEmail(userId: string, episodeId: string): Promise<boolean> {
  if (!(await canSendTransactional(userId))) return false;

  // Check if already sent
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 'first_episode' },
  });
  if (alreadySent) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { title: true, audioDuration: true, signalCount: true, signals: { select: { topics: true } } },
  });
  if (!episode?.title) return false;

  // Use actual signal topics (not episode segment titles)
  const episodeTopics = Array.from(new Set(episode.signals.flatMap(s => s.topics))).slice(0, 5);

  const prefs = await getOrCreatePreferences(userId);

  const subject = 'Your first Poddit episode is ready';

  const bodyHtml = [
    greeting(user.name),
    p('Your first episode is ready to listen.'),
    episodeCard({
      title: episode.title,
      duration: episode.audioDuration,
      topics: episodeTopics,
      id: episodeId,
    }),
    pLast('Rate it after listening \u2014 it takes 10 seconds and helps Poddit learn what resonates with you.'),
  ].join('');

  const durationStr = episode.audioDuration ? `${Math.round(episode.audioDuration / 60)} min` : '';
  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

Your first episode is ready: ${episode.title}${durationStr ? ` (${durationStr})` : ''}

Listen: ${APP_URL}/player/${episodeId}

Rate it after listening — it helps Poddit learn what resonates with you.`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'episode notifications',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'episode notifications',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    label: `First episode email to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'first_episode', subject, metadata: { episodeId } });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 4. EPISODE READY (recurring)
// ──────────────────────────────────────────────

export async function sendEpisodeReadyEmail(userId: string, episodeId: string): Promise<boolean> {
  if (!(await canSendTransactional(userId))) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const episode = await prisma.episode.findUnique({
    where: { id: episodeId },
    select: { title: true, audioDuration: true, signalCount: true, signals: { select: { topics: true } } },
  });
  if (!episode?.title) return false;

  // Check if this is the first episode — use first_episode template instead
  const episodeCount = await prisma.episode.count({
    where: { userId, status: 'READY' },
  });
  if (episodeCount <= 1) {
    return sendFirstEpisodeEmail(userId, episodeId);
  }

  // Use actual signal topics (not episode segment titles)
  const episodeTopics = Array.from(new Set(episode.signals.flatMap(s => s.topics))).slice(0, 5);

  const prefs = await getOrCreatePreferences(userId);
  const subject = `New episode: ${episode.title}`;

  const bodyHtml = [
    greeting(user.name),
    p('Your new episode is ready.'),
    episodeCard({
      title: episode.title,
      duration: episode.audioDuration,
      topics: episodeTopics,
      id: episodeId,
    }),
  ].join('');

  const durationStr = episode.audioDuration ? `${Math.round(episode.audioDuration / 60)} min` : '';
  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

New episode: ${episode.title}${durationStr ? ` (${durationStr})` : ''}
${episode.signalCount} signal${episode.signalCount !== 1 ? 's' : ''}

Listen: ${APP_URL}/player/${episodeId}`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'episode notifications',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    unsubscribeCategoryLabel: 'episode notifications',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'transactional',
    label: `Episode ready email to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'episode_ready', subject, metadata: { episodeId } });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 5. MID-WEEK NUDGE
// ──────────────────────────────────────────────

const MID_WEEK_SUBJECTS = [
  'What are you circling this week?',
  'Anything on your mind?',
  'What caught your attention today?',
];

export async function sendMidWeekNudge(userId: string): Promise<boolean> {
  if (!(await canSendNonTransactional(userId, 'nudges'))) return false;
  if (!(await checkCooldown(userId, 'mid_week_nudge', 7))) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  // Get recent signal topics for context (not episode titles)
  const recentSignals = await prisma.signal.findMany({
    where: { userId, status: 'USED' },
    orderBy: { createdAt: 'desc' },
    take: 10,
    select: { topics: true },
  });
  const recentTopics = Array.from(new Set(recentSignals.flatMap(s => s.topics))).slice(0, 3);

  const prefs = await getOrCreatePreferences(userId);

  // Rotate subject
  const sentCount = await prisma.emailLog.count({
    where: { userId, emailType: 'mid_week_nudge' },
  });
  const subject = MID_WEEK_SUBJECTS[sentCount % MID_WEEK_SUBJECTS.length];

  const topicsRef = recentTopics.length
    ? `Last time, you were exploring ${recentTopics.join(', ')}. `
    : '';

  const bodyHtml = [
    greeting(user.name),
    p(`${topicsRef}You notice things other people scroll past. Drop one in.`),
    ctaButton('Open Poddit', APP_URL),
    pLast('A link from the morning read, a topic from a conversation, a thought you want to come back to \u2014 that\u2019s all it takes.'),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

${topicsRef}You notice things other people scroll past. Drop one in.

${APP_URL}

A link from the morning read, a topic from a conversation, a thought you want to come back to — that's all it takes.`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'nudges',
    unsubscribeCategoryLabel: 'weekly nudges',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'nudges',
    unsubscribeCategoryLabel: 'weekly nudges',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'nudges',
    label: `Mid-week nudge to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'mid_week_nudge', subject });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 6. QUIET WEEK
// ──────────────────────────────────────────────

export async function sendQuietWeekEmail(userId: string): Promise<boolean> {
  if (!(await canSendNonTransactional(userId, 'nudges'))) return false;
  if (!(await checkCooldown(userId, 'quiet_week', 14))) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const stats = await userLifetimeStats(userId);
  const prefs = await getOrCreatePreferences(userId);

  const subject = 'Your Poddit is ready when you are';

  const bodyHtml = [
    greeting(user.name),
    p(`So far you\u2019ve captured ${statLine(stats.signalCount, 'signals')} and generated ${statLine(stats.episodeCount, 'episodes')}.`),
    p('No pressure \u2014 even 2\u20133 signals make a great episode.'),
    ctaButton('Open Poddit', APP_URL),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

So far you've captured ${stats.signalCount} signals and generated ${stats.episodeCount} episodes.

No pressure — even 2-3 signals make a great episode.

${APP_URL}`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'nudges',
    unsubscribeCategoryLabel: 'weekly nudges',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'nudges',
    unsubscribeCategoryLabel: 'weekly nudges',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'nudges',
    label: `Quiet week email to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'quiet_week', subject });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 7. DID YOU KNOW? (Feature Discovery)
// ──────────────────────────────────────────────

export async function sendDidYouKnowEmail(userId: string): Promise<boolean> {
  if (!(await canSendNonTransactional(userId, 'discovery'))) return false;
  if (!(await checkCooldown(userId, 'did_you_know', 14))) return false;

  const feature = await nextFeatureToHighlight(userId);
  if (!feature) return false; // All features already used or sent

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const prefs = await getOrCreatePreferences(userId);
  const subject = `Did you know? ${feature.outcomeTitle}`;

  const bodyHtml = [
    greeting(user.name),
    p(`<strong>${feature.outcomeTitle}</strong>`),
    p(feature.description),
    ctaButton('Try it', APP_URL),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

${feature.outcomeTitle}

${feature.description}

${APP_URL}`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'discovery',
    unsubscribeCategoryLabel: 'feature discovery tips',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'discovery',
    unsubscribeCategoryLabel: 'feature discovery tips',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'discovery',
    label: `Did you know (${feature.key}) to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({
      userId,
      emailType: 'did_you_know',
      subject,
      metadata: { featureKey: feature.key },
    });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 8. CURIOSITY REFLECTION
// ──────────────────────────────────────────────

export async function sendCuriosityReflectionEmail(userId: string): Promise<boolean> {
  if (!(await canSendNonTransactional(userId, 'discovery'))) return false;

  // One-time send — check if already sent
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 'curiosity_reflection' },
  });
  if (alreadySent) return false;

  const clusters = await curiosityClusters(userId);
  if (!clusters) return false; // Not enough data for meaningful reflection

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const prefs = await getOrCreatePreferences(userId);
  const subject = 'What patterns are you noticing?';

  const topicList = clusters.topics.map(t => t.topic).slice(0, 5);
  const topicStr = topicList.length > 2
    ? `${topicList.slice(0, -1).join(', ')}, and ${topicList[topicList.length - 1]}`
    : topicList.join(' and ');

  const bodyHtml = [
    greeting(user.name),
    p(`Over your last ${clusters.episodeCount} episodes, you keep coming back to <strong>${topicStr}</strong>.`),
    topicPills(topicList),
    p('What patterns are you noticing in what you\u2019re drawn to?'),
    pLast('Reply if you want \u2014 we read every one.'),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

Over your last ${clusters.episodeCount} episodes, you keep coming back to ${topicStr}.

What patterns are you noticing in what you're drawn to?

Reply if you want — we read every one.`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'discovery',
    unsubscribeCategoryLabel: 'feature discovery tips',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'discovery',
    unsubscribeCategoryLabel: 'feature discovery tips',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'discovery',
    label: `Curiosity reflection to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 'curiosity_reflection', subject });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 9. RE-ENGAGE 21 DAYS
// ──────────────────────────────────────────────

export async function sendReEngage21Email(userId: string): Promise<boolean> {
  if (!(await canSendNonTransactional(userId, 'reengagement'))) return false;

  // One-time send
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 're_engage_21' },
  });
  if (alreadySent) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const stats = await userLifetimeStats(userId);
  const prefs = await getOrCreatePreferences(userId);

  const subject = 'Still finding it useful?';

  const bodyHtml = [
    greeting(user.name),
    p(`Since you joined, you\u2019ve captured ${statLine(stats.signalCount, 'signals')} and generated ${statLine(stats.episodeCount, 'episodes')}.`),
    p('If Poddit isn\u2019t fitting into your week, we\u2019d genuinely like to know why.'),
    pLast('Reply to this email \u2014 we read every one.'),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

Since you joined, you've captured ${stats.signalCount} signals and generated ${stats.episodeCount} episodes.

If Poddit isn't fitting into your week, we'd genuinely like to know why.

Reply to this email — we read every one.`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'reengagement',
    unsubscribeCategoryLabel: 're-engagement emails',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'reengagement',
    unsubscribeCategoryLabel: 're-engagement emails',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'reengagement',
    label: `Re-engage 21d to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 're_engage_21', subject });
  }

  return result.success;
}

// ──────────────────────────────────────────────
// 10. RE-ENGAGE 45 DAYS
// ──────────────────────────────────────────────

export async function sendReEngage45Email(userId: string): Promise<boolean> {
  if (!(await canSendNonTransactional(userId, 'reengagement'))) return false;

  // One-time send
  const alreadySent = await prisma.emailLog.findFirst({
    where: { userId, emailType: 're_engage_45' },
  });
  if (alreadySent) return false;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, name: true },
  });
  if (!user?.email) return false;

  const prefs = await getOrCreatePreferences(userId);

  const subject = 'Still curious?';

  const bodyHtml = [
    greeting(user.name),
    p('It\u2019s been a while since you last used Poddit.'),
    p('If something isn\u2019t clicking, reply and tell us \u2014 we read every one.'),
    pLast(`Your account is still here whenever you\u2019re ready. ${link('Unsubscribe from these emails', `${APP_URL}/api/unsubscribe?token=${prefs.unsubscribeToken}&category=reengagement`)} if you\u2019d prefer.`),
  ].join('');

  const bodyText = `${user.name ? `Hi ${user.name}` : 'Hi there'},

It's been a while since you last used Poddit.

If something isn't clicking, reply and tell us — we read every one.

Your account is still here whenever you're ready.`;

  const html = buildEmailHtml({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'reengagement',
    unsubscribeCategoryLabel: 're-engagement emails',
  });
  const text = buildEmailText({
    name: user.name, subject, bodyHtml, bodyText,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'reengagement',
    unsubscribeCategoryLabel: 're-engagement emails',
  });

  const result = await sendEmail({
    to: user.email,
    subject, html, text,
    unsubscribeToken: prefs.unsubscribeToken,
    unsubscribeCategory: 'reengagement',
    label: `Re-engage 45d to ${user.email}`,
  });

  if (result.success) {
    await logEmailSend({ userId, emailType: 're_engage_45', subject });
  }

  return result.success;
}
