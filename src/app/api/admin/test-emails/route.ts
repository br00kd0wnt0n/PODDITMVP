import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import { sendEmail } from '@/lib/email';
import prisma from '@/lib/db';
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
} from '@/lib/engagement/templates';
import { logEmailSend, getOrCreatePreferences } from '@/lib/engagement/helpers';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poddit.com';

/**
 * POST /api/admin/test-emails
 *
 * Sends one of each email type to a specific address for visual testing.
 * Bypasses ENGAGEMENT_ENABLED flag. Uses real user data where available.
 *
 * Body: { email: string, userId?: string }
 * - email: recipient address (e.g., brookdownton@me.com)
 * - userId: optional user to pull real data from (defaults to first MASTER user)
 */
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const targetEmail = body.email;

    if (!targetEmail || typeof targetEmail !== 'string') {
      return NextResponse.json({ error: 'email is required' }, { status: 400 });
    }

    // Clear previous test email logs if requested
    if (body.clearPrevious) {
      const deleted = await prisma.emailLog.deleteMany({
        where: { emailType: { startsWith: 'test_' } },
      });
      console.log(`[Admin] Cleared ${deleted.count} test email logs`);
    }

    // Find a user to pull data from (prefer provided userId, then match by email, then first MASTER)
    let user = body.userId
      ? await prisma.user.findUnique({ where: { id: body.userId } })
      : await prisma.user.findFirst({ where: { email: targetEmail } })
        ?? await prisma.user.findFirst({ where: { userType: 'MASTER' } });

    if (!user) {
      user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' } });
    }
    if (!user) {
      return NextResponse.json({ error: 'No users found in database' }, { status: 404 });
    }

    // Get real data for the test user
    const [episodes, allSignals, prefs] = await Promise.all([
      prisma.episode.findMany({
        where: { userId: user.id, status: 'READY' },
        orderBy: { generatedAt: 'desc' },
        take: 5,
        select: { id: true, title: true, audioDuration: true, signalCount: true, signals: { select: { topics: true } } },
      }),
      prisma.signal.findMany({
        where: { userId: user.id },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { rawContent: true, title: true, channel: true, topics: true },
      }),
      getOrCreatePreferences(user.id),
    ]);

    const latestEpisode = episodes[0];
    const signals = allSignals.slice(0, 5);
    // Pick most recent signal with a clean single-item title for the "first signal" email
    const firstSignal = signals.find(s => s.title && !s.title.includes(',')) || signals[0] || { rawContent: 'AI agents in enterprise', title: 'AI agents in enterprise', channel: 'API', topics: ['artificial intelligence', 'enterprise'] };
    // Use actual signal topics, not episode segment titles
    const topTopics = Array.from(new Set(allSignals.flatMap(s => s.topics))).slice(0, 5);
    const stats = { signalCount: allSignals.length || 12, episodeCount: episodes.length || 6 };

    const results: { emailType: string; success: boolean; error?: string }[] = [];

    // Helper to send a test email and log it
    const sendTest = async (
      emailType: string,
      subject: string,
      bodyHtml: string,
      bodyText: string,
      category?: string,
      categoryLabel?: string,
      replyTo?: string,
    ) => {
      const html = buildEmailHtml({
        name: user!.name, subject, bodyHtml, bodyText,
        unsubscribeToken: prefs.unsubscribeToken,
        unsubscribeCategory: category,
        unsubscribeCategoryLabel: categoryLabel,
      });
      const text = buildEmailText({
        name: user!.name, subject, bodyHtml, bodyText,
        unsubscribeToken: prefs.unsubscribeToken,
        unsubscribeCategory: category,
        unsubscribeCategoryLabel: categoryLabel,
      });

      const result = await sendEmail({
        to: targetEmail,
        subject: `[TEST] ${subject}`,
        html,
        text,
        replyTo,
        unsubscribeToken: prefs.unsubscribeToken,
        unsubscribeCategory: category || 'all',
        label: `Test ${emailType} to ${targetEmail}`,
      });

      if (result.success) {
        await logEmailSend({ userId: user!.id, emailType: `test_${emailType}`, subject: `[TEST] ${subject}`, metadata: { testSend: true, targetEmail } });
      }

      results.push({ emailType, success: result.success, error: result.error });
    };

    // ── 0. Invite Reminder (3d) ──
    await sendTest(
      'invite_reminder_3d',
      'Your Poddit access is ready',
      [
        greeting(user.name),
        p('Your Poddit access is ready whenever you are.'),
        codeBox('Your access code', user.inviteCode || 'TESTC0DE'),
        ctaButton('Sign in to Poddit', `${APP_URL}/auth/signin`),
        pLast('Poddit turns the things you\'re curious about into a personal audio briefing. Drop in links, topics, or voice notes throughout your week \u2014 then listen.'),
      ].join(''),
      `Your Poddit access is ready whenever you are.\n\nYour code: ${user.inviteCode || 'TESTC0DE'}\nSign in: ${APP_URL}/auth/signin`,
    );

    // ── 0b. Invite Reminder (7d) ──
    await sendTest(
      'invite_reminder_7d',
      'Just making sure you saw this',
      [
        greeting(user.name),
        p('Just a quick note \u2014 your Poddit invite code is still active.'),
        codeBox('Your access code', user.inviteCode || 'TESTC0DE'),
        ctaButton('Sign in to Poddit', `${APP_URL}/auth/signin`),
        pLast('No rush. It\u2019s here when you\u2019re ready.'),
      ].join(''),
      `Just a quick note — your Poddit invite code is still active.\n\nYour code: ${user.inviteCode || 'TESTC0DE'}\nSign in: ${APP_URL}/auth/signin\n\nNo rush. It's here when you're ready.`,
    );

    // ── 1. Welcome ──
    await sendTest(
      'welcome',
      'Welcome to Poddit \u2014 here\u2019s how to start',
      [
        greeting(user.name),
        p('Welcome to Poddit. Three steps to get started:'),
        p(`<strong>1. Capture</strong> \u2014 Drop in a link, topic, or voice note. Anything you\u2019re curious about. ${link('Try it now', APP_URL)}.`),
        p('<strong>2. Generate</strong> \u2014 When you\u2019re ready, tap Generate My Episode. Poddit synthesizes your signals into a personal audio briefing.'),
        p('<strong>3. Listen</strong> \u2014 Play your episode anywhere. Rate it after to help Poddit learn what resonates.'),
        pLast('Make this a daily habit \u2014 drop in anything you\u2019re curious about throughout the day. Even 2\u20133 signals make a great episode.'),
      ].join(''),
      'Welcome to Poddit. Three steps: 1. Capture a link, topic, or voice note. 2. Generate an episode. 3. Listen and rate.',
      'transactional', 'transactional emails',
    );

    // ── 2. First Signal ──
    const signalPreview = firstSignal.title || firstSignal.rawContent.slice(0, 80);
    await sendTest(
      'first_signal',
      'Your first signal is queued',
      [
        greeting(user.name),
        p(`Your first signal is in the queue: <strong>${signalPreview}</strong>`),
        firstSignal.topics.length > 0 ? topicPills(firstSignal.topics) : '',
        p('Drop in 2\u20133 more and you\u2019ll have enough for your first episode.'),
        pMuted(`You captured this via ${firstSignal.channel.toLowerCase()}. You can also try sms or extension.`),
        pLast('Most people find a rhythm: one signal at morning coffee, one at lunch, one before end of day.'),
      ].join(''),
      `Your first signal is in the queue: ${signalPreview}\n\nDrop in 2-3 more for your first episode.`,
      'transactional', 'transactional emails',
    );

    // ── 3. First Episode ──
    if (latestEpisode) {
      await sendTest(
        'first_episode',
        'Your first Poddit episode is ready',
        [
          greeting(user.name),
          p('Your first episode is ready to listen.'),
          episodeCard({ title: latestEpisode.title || 'Your Poddit Episode', duration: latestEpisode.audioDuration, topics: Array.from(new Set(latestEpisode.signals.flatMap(s => s.topics))).slice(0, 5), id: latestEpisode.id }),
          pLast('Rate it after listening \u2014 it takes 10 seconds and helps Poddit learn what resonates with you.'),
        ].join(''),
        `Your first episode is ready: ${latestEpisode.title}\n\nListen: ${APP_URL}/player/${latestEpisode.id}`,
        'transactional', 'episode notifications',
      );
    }

    // ── 4. Episode Ready ──
    if (latestEpisode) {
      await sendTest(
        'episode_ready',
        `New episode: ${latestEpisode.title || 'Your Poddit Episode'}`,
        [
          greeting(user.name),
          p('Your new episode is ready.'),
          episodeCard({ title: latestEpisode.title || 'Your Poddit Episode', duration: latestEpisode.audioDuration, topics: Array.from(new Set(latestEpisode.signals.flatMap(s => s.topics))).slice(0, 5), id: latestEpisode.id }),
        ].join(''),
        `New episode: ${latestEpisode.title}\n\nListen: ${APP_URL}/player/${latestEpisode.id}`,
        'transactional', 'episode notifications',
      );
    }

    // ── 5. Mid-Week Nudge ──
    const topicsRef = topTopics.length > 0 ? `Last time, you were exploring ${topTopics.slice(0, 3).join(', ')}. ` : '';
    await sendTest(
      'mid_week_nudge',
      'What are you circling this week?',
      [
        greeting(user.name),
        p(`${topicsRef}You notice things other people scroll past. Drop one in.`),
        ctaButton('Open Poddit', APP_URL),
        pLast('A link from the morning read, a topic from a conversation, a thought you want to come back to \u2014 that\u2019s all it takes.'),
      ].join(''),
      `${topicsRef}You notice things other people scroll past. Drop one in.\n\n${APP_URL}`,
      'nudges', 'weekly nudges',
    );

    // ── 6. Quiet Week ──
    const isActive = stats.episodeCount >= 3;
    const quietNudge = isActive
      ? 'It\u2019s been a quiet week. Drop in whatever\u2019s on your mind \u2014 Poddit\u2019s ready when you are.'
      : 'No pressure \u2014 even 2\u20133 signals make a great episode.';
    await sendTest(
      'quiet_week',
      'Your Poddit is ready when you are',
      [
        greeting(user.name),
        p(`So far you\u2019ve captured ${statLine(stats.signalCount, 'signals')} and generated ${statLine(stats.episodeCount, 'episodes')}.`),
        p(quietNudge),
        ctaButton('Open Poddit', APP_URL),
      ].join(''),
      `So far you've captured ${stats.signalCount} signals and generated ${stats.episodeCount} episodes.\n\n${quietNudge}`,
      'nudges', 'weekly nudges',
    );

    // ── 7. Did You Know? (voice capture example) ──
    await sendTest(
      'did_you_know',
      'Did you know? Capture the thoughts you don\'t write down',
      [
        greeting(user.name),
        p('<strong>Capture the thoughts you don\'t write down</strong>'),
        p('Record a quick voice memo from the dashboard \u2014 just hit the mic button and talk. Poddit transcribes it and adds it to your queue.'),
        ctaButton('Try it', APP_URL),
      ].join(''),
      'Capture the thoughts you don\'t write down\n\nRecord a quick voice memo from the dashboard — just hit the mic button and talk.',
      'discovery', 'feature discovery tips',
    );

    // ── 8. Curiosity Reflection ──
    const reflectionTopics = topTopics.length >= 3 ? topTopics : ['artificial intelligence', 'leadership', 'product strategy', 'future of work'];
    const topicStr = reflectionTopics.length > 2
      ? `${reflectionTopics.slice(0, -1).join(', ')}, and ${reflectionTopics[reflectionTopics.length - 1]}`
      : reflectionTopics.join(' and ');
    await sendTest(
      'curiosity_reflection',
      'What patterns are you noticing?',
      [
        greeting(user.name),
        p(`Over your last ${stats.episodeCount} episodes, you keep coming back to <strong>${topicStr}</strong>.`),
        topicPills(reflectionTopics),
        p('What patterns are you noticing in what you\u2019re drawn to?'),
        pLast('Reply if you want \u2014 we read every one.'),
      ].join(''),
      `Over your last ${stats.episodeCount} episodes, you keep coming back to ${topicStr}.\n\nWhat patterns are you noticing in what you're drawn to?\n\nReply if you want — we read every one.`,
      'discovery', 'feature discovery tips',
      'hello@poddit.com',
    );

    // ── 9. Re-engage 21d ──
    const reengagePrompt = isActive
      ? 'It\u2019s been a few weeks since your last episode. Anything we could do better?'
      : 'If Poddit isn\u2019t fitting into your week, we\u2019d genuinely like to know why.';
    await sendTest(
      're_engage_21',
      'Still finding it useful?',
      [
        greeting(user.name),
        p(`Since you joined, you\u2019ve captured ${statLine(stats.signalCount, 'signals')} and generated ${statLine(stats.episodeCount, 'episodes')}.`),
        p(reengagePrompt),
        pLast('Reply to this email \u2014 we read every one.'),
      ].join(''),
      `Since you joined, you've captured ${stats.signalCount} signals and generated ${stats.episodeCount} episodes.\n\n${reengagePrompt}\n\nReply to this email — we read every one.`,
      'reengagement', 're-engagement emails',
      'hello@poddit.com',
    );

    // ── 10. Re-engage 45d ──
    await sendTest(
      're_engage_45',
      'Still curious?',
      [
        greeting(user.name),
        p('It\u2019s been a while since you last used Poddit.'),
        p('If something isn\u2019t clicking, reply and tell us \u2014 we read every one.'),
        pLast(`Your account is still here whenever you\u2019re ready. ${link('Unsubscribe from these emails', `${APP_URL}/api/unsubscribe?token=${prefs.unsubscribeToken}&category=reengagement`)} if you\u2019d prefer.`),
      ].join(''),
      'It\'s been a while since you last used Poddit.\n\nIf something isn\'t clicking, reply and tell us — we read every one.\n\nYour account is still here whenever you\'re ready.',
      'reengagement', 're-engagement emails',
      'hello@poddit.com',
    );

    const sent = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`[Admin] Test emails sent to ${targetEmail}: ${sent} sent, ${failed} failed`);

    return NextResponse.json({
      success: true,
      targetEmail,
      userId: user.id,
      sent,
      failed,
      results,
    });
  } catch (error) {
    console.error('[Admin] Test emails error:', error);
    return NextResponse.json({ error: 'Failed to send test emails' }, { status: 500 });
  }
}
