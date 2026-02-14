import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import { requireDashboard } from '@/lib/auth';
import { transcribeAudioBuffer } from '@/lib/transcribe';
import prisma from '@/lib/db';

// Allow up to 30 seconds for voice transcription
export const maxDuration = 30;

// ──────────────────────────────────────────────
// POST /api/capture/quick
// Dashboard capture — handles both text and voice
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth: dashboard-only endpoint
    const authError = requireDashboard(request);
    if (authError) return authError;

    const contentType = request.headers.get('content-type') || '';

    // Voice recording (FormData with audio blob)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const audioFile = formData.get('audio') as File | null;
      const textField = formData.get('text') as string | null;

      // Text submitted via FormData
      if (textField && !audioFile) {
        return await handleText(textField.trim());
      }

      // Audio submitted
      if (!audioFile) {
        return NextResponse.json(
          { error: 'No audio file or text provided' },
          { status: 400 }
        );
      }

      console.log(`[Quick] Voice: ${audioFile.type}, ${audioFile.size} bytes`);

      const arrayBuffer = await audioFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const transcript = await transcribeAudioBuffer(buffer, audioFile.type);

      if (!transcript.trim()) {
        return NextResponse.json(
          { error: 'No speech detected — try again' },
          { status: 422 }
        );
      }

      // Create signal with transcribed text
      const signals = await createSignal({
        rawContent: transcript,
        channel: 'API',
      });

      // Mark as VOICE input type
      if (signals[0]) {
        await prisma.signal.update({
          where: { id: signals[0].id },
          data: { inputType: 'VOICE' },
        });
      }

      return NextResponse.json({
        status: 'captured',
        type: 'voice',
        transcript,
        signalId: signals[0]?.id,
      });
    }

    // Text submission (JSON body)
    const body = await request.json().catch(() => ({}));
    const text = body.text?.trim();

    if (!text) {
      return NextResponse.json(
        { error: 'No text provided' },
        { status: 400 }
      );
    }

    return await handleText(text);
  } catch (error: any) {
    console.error('[Quick] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Capture failed' },
      { status: 500 }
    );
  }
}

async function handleText(text: string) {
  console.log(`[Quick] Text: "${text.slice(0, 100)}"`);

  const signals = await createSignal({
    rawContent: text,
    channel: 'API',
  });

  return NextResponse.json({
    status: 'captured',
    type: signals[0]?.inputType === 'LINK' ? 'link' : 'topic',
    signalId: signals[0]?.id,
  });
}
