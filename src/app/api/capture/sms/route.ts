import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import { confirmCapture } from '@/lib/deliver';
import { transcribeAudio } from '@/lib/transcribe';
import prisma from '@/lib/db';
import twilio from 'twilio';

// ──────────────────────────────────────────────
// POST /api/capture/sms
// Twilio webhook for incoming SMS/MMS messages
// Handles: text messages, links, and voice memos
// Routes to user by phone number lookup
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Validate Twilio signature to prevent spoofed requests
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (authToken) {
      const signature = request.headers.get('x-twilio-signature') || '';
      // Use the public app URL for validation — request.url returns the internal
      // Railway URL which won't match what Twilio signed against.
      // TWILIO_WEBHOOK_URL (server-side, runtime) takes priority over
      // NEXT_PUBLIC_APP_URL (build-time, may be stale).
      const appUrl = process.env.TWILIO_WEBHOOK_URL || process.env.NEXT_PUBLIC_APP_URL || '';
      const url = appUrl ? `${appUrl}/api/capture/sms` : request.url;
      // Clone the request to read body twice
      const clonedRequest = request.clone();
      const formDataForValidation = await clonedRequest.formData();
      const params: Record<string, string> = {};
      formDataForValidation.forEach((value, key) => {
        params[key] = value as string;
      });

      const isValid = twilio.validateRequest(authToken, signature, url, params);
      if (!isValid) {
        console.warn(`[SMS] Invalid Twilio signature — rejecting (validated against: ${url})`);
        return new NextResponse('Forbidden', { status: 403 });
      }
    } else {
      console.warn('[SMS] TWILIO_AUTH_TOKEN not set — skipping signature verification');
    }

    const formData = await request.formData();

    const body = (formData.get('Body') as string) || '';
    const from = formData.get('From') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');

    console.log(`[SMS] Received from ${from}: body="${body.slice(0, 100)}" media=${numMedia}`);

    // Look up user by phone number
    const user = await prisma.user.findUnique({ where: { phone: from } });
    if (!user) {
      console.log(`[SMS] Unknown sender: ${from} — no user with this phone`);
      return twimlResponse('This number isn\'t registered with Poddit. Sign up at poddit.com first.');
    }
    const userId = user.id;

    // Check for audio/voice attachments
    let transcribedText = '';
    let hasAudioAttachment = false;
    const transcriptionErrors: string[] = [];

    if (numMedia > 0) {
      for (let i = 0; i < numMedia; i++) {
        const mediaUrl = formData.get(`MediaUrl${i}`) as string;
        const mediaType = formData.get(`MediaContentType${i}`) as string;

        console.log(`[SMS] Media ${i}: type="${mediaType}" url="${mediaUrl}"`);

        if (mediaType && (mediaType.startsWith('audio/') || mediaType.startsWith('video/'))) {
          hasAudioAttachment = true;

          // Check if OpenAI key is configured
          if (!process.env.OPENAI_API_KEY) {
            console.error(`[SMS] OPENAI_API_KEY not set — cannot transcribe voice memo`);
            transcriptionErrors.push('OPENAI_API_KEY not configured');
            continue;
          }

          try {
            console.log(`[SMS] Starting transcription for media ${i}...`);
            const text = await transcribeAudio(mediaUrl);
            console.log(`[SMS] Transcription success: "${text.slice(0, 100)}"`);
            transcribedText += (transcribedText ? '\n' : '') + text;
          } catch (error: any) {
            const errMsg = error?.message || String(error);
            console.error(`[SMS] Transcription failed for media ${i}: ${errMsg}`);
            transcriptionErrors.push(errMsg);
          }
        } else {
          console.log(`[SMS] Skipping non-audio media ${i}: ${mediaType}`);
        }
      }
    }

    // Combine text body + transcribed audio
    const rawContent = [body.trim(), transcribedText.trim()]
      .filter(Boolean)
      .join('\n\n');

    // If we had audio but transcription failed, still create a signal with a note
    if (!rawContent && hasAudioAttachment) {
      console.log(`[SMS] Voice memo received but transcription failed, creating placeholder signal`);
      const fallbackContent = `[Voice memo — transcription failed: ${transcriptionErrors.join('; ')}]`;

      const signals = await createSignal({
        rawContent: fallbackContent,
        channel: 'SMS',
        userId,
      });

      if (signals[0]) {
        await prisma.signal.update({
          where: { id: signals[0].id },
          data: { inputType: 'VOICE', title: 'Voice memo (transcription failed)' },
        });
      }

      return twimlResponse('Voice memo received but transcription failed.');
    }

    if (!rawContent) {
      return twimlResponse('Empty message received.');
    }

    // Determine if this was a voice note
    const isVoice = transcribedText.length > 0 && body.trim().length === 0;

    // Create signal(s) from the message
    const signals = await createSignal({
      rawContent,
      channel: 'SMS',
      userId,
    });

    // If it was a voice note, update the signal's inputType to VOICE
    if (isVoice && signals[0]) {
      await prisma.signal.update({
        where: { id: signals[0].id },
        data: { inputType: 'VOICE' },
      });
    }

    // Send confirmation
    const preview = rawContent.slice(0, 80);
    await confirmCapture({
      to: from,
      signalType: isVoice ? 'VOICE' : (signals[0]?.inputType || 'TOPIC'),
      preview,
    });

    // Respond with TwiML (required by Twilio)
    return twimlResponse('');

  } catch (error) {
    console.error('[SMS] Error processing message:', error);
    return twimlResponse('Error processing your message. Try again.');
  }
}

function twimlResponse(message: string): NextResponse {
  const twiml = message
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response></Response>`;

  return new NextResponse(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
}
