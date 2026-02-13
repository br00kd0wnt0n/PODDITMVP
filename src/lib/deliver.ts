import twilio from 'twilio';

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// ──────────────────────────────────────────────
// NOTIFY USER THAT EPISODE IS READY
// ──────────────────────────────────────────────

export async function notifyEpisodeReady(params: {
  episodeId: string;
  title: string;
  signalCount: number;
  duration?: number;
}) {
  const { episodeId, title, signalCount, duration } = params;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://poddit.com';
  const playerUrl = `${appUrl}/player/${episodeId}`;

  const durationStr = duration 
    ? `${Math.round(duration / 60)} min` 
    : '';

  const message = `🎧 Your Poddit is ready!\n\n"${title}"\n${signalCount} signals → ${durationStr}\n\n${playerUrl}`;

  try {
    await client.messages.create({
      body: message,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: process.env.USER_PHONE_NUMBER || '',
    });
    console.log(`[Deliver] SMS sent for episode ${episodeId}`);
  } catch (error) {
    console.error('[Deliver] SMS failed:', error);
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
    await client.messages.create({
      body: `✓ Poddit captured: "${params.preview.slice(0, 60)}${params.preview.length > 60 ? '...' : ''}"`,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: params.to,
    });
  } catch (error) {
    console.error('[Deliver] Confirmation SMS failed:', error);
  }
}
