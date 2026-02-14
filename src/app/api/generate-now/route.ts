import { NextRequest, NextResponse } from 'next/server';
import { generateEpisode } from '@/lib/synthesize';
import { requireSession } from '@/lib/auth';
import prisma from '@/lib/db';

// Allow up to 2 minutes for generation (Claude + TTS + upload)
export const maxDuration = 120;

// ──────────────────────────────────────────────
// POST /api/generate-now
// Dashboard-triggered episode generation with selected signals
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await requireSession();
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { userId } = sessionResult;

    const body = await request.json();
    const { signalIds } = body;

    if (!signalIds || !Array.isArray(signalIds) || signalIds.length === 0) {
      return NextResponse.json(
        { error: 'No signals selected' },
        { status: 400 }
      );
    }

    console.log(`[GenerateNow] Starting with ${signalIds.length} signals for user ${userId}`);

    const episodeId = await generateEpisode({
      userId,
      signalIds,
      manual: true,
    });

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
    });

    console.log(`[GenerateNow] Complete: ${episode?.title}`);

    return NextResponse.json({
      status: 'generated',
      episodeId,
      title: episode?.title || 'Your Poddit Episode',
    });
  } catch (error: any) {
    console.error('[GenerateNow] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Generation failed' },
      { status: 500 }
    );
  }
}
