import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import { confirmCapture } from '@/lib/deliver';

// ──────────────────────────────────────────────
// POST /api/capture/sms
// Twilio webhook for incoming SMS messages
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const body = formData.get('Body') as string;
    const from = formData.get('From') as string;
    const numMedia = parseInt(formData.get('NumMedia') as string || '0');

    if (!body && numMedia === 0) {
      return twimlResponse('Empty message received.');
    }

    console.log(`[SMS] Received from ${from}: ${body?.slice(0, 100)}`);

    // Optional: Validate sender is the authorized user
    const authorizedNumber = process.env.USER_PHONE_NUMBER;
    if (authorizedNumber && from !== authorizedNumber) {
      console.log(`[SMS] Unauthorized sender: ${from}`);
      return twimlResponse('Unauthorized.');
    }

    // Create signal(s) from the message
    const signals = await createSignal({
      rawContent: body,
      channel: 'SMS',
    });

    // Send confirmation
    const preview = body.slice(0, 80);
    await confirmCapture({
      to: from,
      signalType: signals[0]?.inputType || 'TOPIC',
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
