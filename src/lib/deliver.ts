import twilio from 'twilio';
import prisma from './db';
import { withRetry } from './retry';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Pick the right Twilio sender number based on the recipient's country
function senderFor(to: string): string {
  if (to.startsWith('+44') && process.env.TWILIO_PHONE_NUMBER_UK) {
    return process.env.TWILIO_PHONE_NUMBER_UK;
  }
  return process.env.TWILIO_PHONE_NUMBER || '';
}

// ──────────────────────────────────────────────
// NOTIFY USER THAT EPISODE IS READY
// ──────────────────────────────────────────────

export async function notifyEpisodeReady(params: {
  episodeId: string;
  title: string;
  signalCount: number;
  duration?: number;
  userPhone?: string;
  userId?: string;
}) {
  const { episodeId, title, signalCount, duration } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://poddit.com';
  const playerUrl = `${appUrl}/player/${episodeId}`;

  // Resolve phone number: explicit param > look up by userId > env fallback
  let phone = params.userPhone;
  if (!phone && params.userId) {
    const user = await prisma.user.findUnique({ where: { id: params.userId } });
    phone = user?.phone || undefined;
  }
  if (!phone) {
    phone = process.env.USER_PHONE_NUMBER;
  }

  if (!phone) {
    console.log(`[Deliver] No phone number for episode ${episodeId} — skipping SMS`);
    return;
  }

  const durationStr = duration
    ? `${Math.round(duration / 60)} min`
    : '';

  const message = `🎧 Your Poddit is ready!\n\n"${title}"\n${signalCount} signals → ${durationStr}\n\n${playerUrl}`;

  try {
    await withRetry(
      () => client.messages.create({ body: message, from: senderFor(phone), to: phone }),
      { attempts: 3, delayMs: 2000, label: `SMS notify ${episodeId}` }
    );
    console.log(`[Deliver] SMS sent for episode ${episodeId} to ${phone}`);
  } catch (error) {
    console.error('[Deliver] SMS failed after retries:', error);
  }
}

// ──────────────────────────────────────────────
// SEND CONFIRMATION WHEN SIGNAL IS CAPTURED
// ──────────────────────────────────────────────

export async function confirmCapture(params: {
  to: string;
  signalType: string;
  preview: string;
}) {
  try {
    await withRetry(
      () => client.messages.create({
        body: `✓ Poddit captured: "${params.preview.slice(0, 60)}${params.preview.length > 60 ? '...' : ''}"`,
        from: senderFor(params.to),
        to: params.to,
      }),
      { attempts: 3, delayMs: 1000, label: 'SMS confirm' }
    );
  } catch (error) {
    console.error('[Deliver] Confirmation SMS failed after retries:', error);
  }
}
