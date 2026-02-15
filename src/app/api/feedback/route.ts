import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { transcribeAudioBuffer } from '@/lib/transcribe';
import { rateLimit } from '@/lib/rate-limit';
import prisma from '@/lib/db';

// Allow up to 30 seconds for voice transcription
export const maxDuration = 30;

// ──────────────────────────────────────────────
// POST /api/feedback
// Submit text or voice feedback from the dashboard
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await requireSession();
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { userId } = sessionResult;

    // Rate limit: 5 per minute per user
    const { allowed, retryAfterMs } = rateLimit(`feedback:${userId}`, 5, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const contentType = request.headers.get('content-type') || '';

    // Voice feedback (FormData with audio blob)
    if (contentType.includes('multipart/form-data')) {
      const formData = await request.formData();
      const audioFile = formData.get('audio') as File | null;

      if (!audioFile) {
        return NextResponse.json(
          { error: 'No audio file provided' },
          { status: 400 }
        );
      }

      console.log(`[Feedback] Voice: ${audioFile.type}, ${audioFile.size} bytes`);

      const arrayBuffer = await audioFile.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const transcript = await transcribeAudioBuffer(buffer, audioFile.type);

      if (!transcript.trim()) {
        return NextResponse.json(
          { error: 'No speech detected — try again' },
          { status: 422 }
        );
      }

      const feedback = await prisma.feedback.create({
        data: {
          userId,
          type: 'VOICE',
          content: transcript,
        },
      });

      console.log(`[Feedback] Voice submitted by ${userId}: "${transcript.slice(0, 80)}"`);

      return NextResponse.json({
        status: 'submitted',
        feedbackId: feedback.id,
        transcript,
      });
    }

    // Text feedback (JSON body)
    const body = await request.json().catch(() => ({}));
    const content = body.content?.trim();

    if (!content) {
      return NextResponse.json(
        { error: 'No feedback content provided' },
        { status: 400 }
      );
    }

    if (content.length > 5000) {
      return NextResponse.json(
        { error: 'Feedback is too long (max 5000 characters)' },
        { status: 400 }
      );
    }

    const feedbackType = body.type === 'REQUEST' ? 'REQUEST' : 'TEXT';

    const feedback = await prisma.feedback.create({
      data: {
        userId,
        type: feedbackType,
        content,
      },
    });

    console.log(`[Feedback] ${feedbackType} submitted by ${userId}: "${content.slice(0, 80)}"`);

    return NextResponse.json({
      status: 'submitted',
      feedbackId: feedback.id,
    });
  } catch (error: any) {
    console.error('[Feedback] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to submit feedback' },
      { status: 500 }
    );
  }
}
