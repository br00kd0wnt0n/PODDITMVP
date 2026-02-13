import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import { confirmCapture } from '@/lib/deliver';
import { transcribeAudio } from '@/lib/transcribe';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/capture/sms
// Twilio webhook for incoming SMS/MMS messages
// Handles: text messages, links, and voice memos
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const body = (formData.get('Body') as string) || '';
    const from = formData.get('From') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');

    console.log(`[SMS] Received from ${from}: body="${body.slice(0, 100)}" media=${numMedia}`);

    // Optional: Validate sender is the authorized user
    const authorizedNumber = process.env.USER_PHONE_NUMBER;
    if (authorizedNumber && from !== authorizedNumber) {
      console.log(`[SMS] Unauthorized sender: ${from}`);
      return twimlResponse('Unauthorized.');
    }

    // Check for audio/voice attachments
    let transcribedText = '';
    if (numMedia > 0) {
      for (let i = 0; i < numMedia; i++) {
        const mediaUrl = formData.get(`MediaUrl${i}`) as string;
        const mediaType = formData.get(`MediaContentType${i}`) as string;

        console.log(`[SMS] Media ${i}: ${mediaType} → ${mediaUrl}`);

        if (mediaType && (mediaType.startsWith('audio/') || mediaType.startsWith('video/'))) {
          // Transcribe voice memo (voice memos can come as audio/* or video/mp4)
          try {
            const text = await transcribeAudio(mediaUrl);
            transcribedText += (transcribedText ? '\n' : '') + text;
          } catch (error) {
            console.error(`[SMS] Transcription failed for media ${i}:`, error);
          }
        }
      }
    }

    // Combine text body + transcribed audio
    const rawContent = [body.trim(), transcribedText.trim()]
      .filter(Boolean)
      .join('\n\n');

    if (!rawContent) {
      return twimlResponse('Empty message received.');
    }

    // Determine if this was a voice note
    const isVoice = transcribedText.length > 0 && body.trim().length === 0;

    // Create signal(s) from the message
    const signals = await createSignal({
      rawContent,
      channel: 'SMS',
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
