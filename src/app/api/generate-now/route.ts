import { NextRequest, NextResponse } from 'next/server';
import { generateEpisode } from '@/lib/synthesize';
import { requireSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
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

    // Episode cap based on user type
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userType: true },
    });
    const EPISODE_LIMITS: Record<string, number> = { MASTER: Infinity, EARLY_ACCESS: 3, TESTER: 10 };
    const limit = EPISODE_LIMITS[user?.userType || 'EARLY_ACCESS'] ?? 3;

    if (limit !== Infinity) {
      const episodeCount = await prisma.episode.count({
        where: { userId, status: 'READY' },
      });
      if (episodeCount >= limit) {
        return NextResponse.json(
          {
            error: 'early_access_limit',
            message: `You've reached your ${limit}-episode limit. Share your feedback to request more!`,
            episodeCount,
            limit,
          },
          { status: 403 }
        );
      }
    }

    // Rate limit: 1 generation per 5 minutes per user
    const { allowed, retryAfterMs } = rateLimit(`generate:${userId}`, 1, 300_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Please wait a few minutes before generating another episode.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

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
