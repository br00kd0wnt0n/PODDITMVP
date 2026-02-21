import { NextRequest, NextResponse } from 'next/server';
import { generateEpisode } from '@/lib/synthesize';
import { requireSession } from '@/lib/auth';
import { rateLimit, clearRateLimit } from '@/lib/rate-limit';
import { sendEpisodeReadyEmail } from '@/lib/engagement/sequences';
import { isEngagementEnabled } from '@/lib/engagement/flags';
import prisma from '@/lib/db';

// Allow up to 5 minutes for generation (Claude + TTS + ffmpeg + upload)
export const maxDuration = 300;

// ──────────────────────────────────────────────
// POST /api/generate-now
// Dashboard-triggered episode generation with selected signals
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Extract session outside try/catch so userId is available in catch
  const sessionResult = await requireSession();
  if (sessionResult instanceof NextResponse) return sessionResult;
  const { userId } = sessionResult;
  const rateLimitKey = `generate:${userId}`;

  try {
    // Episode cap based on user type + questionnaire bonuses
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { userType: true, episodeBonusGranted: true },
    });
    const BASE_LIMITS: Record<string, number> = { MASTER: Infinity, EARLY_ACCESS: 3, TESTER: 10 };
    const baseLimit = BASE_LIMITS[user?.userType || 'EARLY_ACCESS'] ?? 3;
    const limit = baseLimit === Infinity ? Infinity : baseLimit + (user?.episodeBonusGranted || 0);

    if (limit !== Infinity) {
      const episodeCount = await prisma.episode.count({
        where: { userId, status: 'READY' },
      });
      if (episodeCount >= limit) {
        return NextResponse.json(
          {
            error: 'early_access_limit',
            message: `You've reached your ${limit}-episode limit. Complete the feedback questionnaire to unlock more!`,
            episodeCount,
            limit,
          },
          { status: 403 }
        );
      }
    }

    // Rate limit: 1 generation per 5 minutes per user
    const { allowed, retryAfterMs } = rateLimit(rateLimitKey, 1, 300_000);
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
      episodeLimit: limit, // Atomic cap check inside transaction
    });

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
    });

    console.log(`[GenerateNow] Complete: ${episode?.title}`);

    // Send episode ready email (fire-and-forget, gated by ENGAGEMENT_ENABLED)
    if (episode?.status === 'READY' && isEngagementEnabled()) {
      sendEpisodeReadyEmail(userId, episodeId).catch(err =>
        console.error(`[GenerateNow] Episode ready email failed:`, err)
      );
    }

    return NextResponse.json({
      status: 'generated',
      episodeId,
      title: episode?.title || 'Your Poddit Episode',
    });
  } catch (error: any) {
    console.error('[GenerateNow] Error:', error);
    // Clear rate limit on failure so user can retry immediately
    clearRateLimit(rateLimitKey);

    // Atomic cap check from transaction may throw this
    if (error.message === 'early_access_limit') {
      return NextResponse.json(
        { error: 'early_access_limit', message: 'Episode limit reached. Complete the feedback questionnaire to unlock more!' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      { error: 'Generation failed. Please try again.' },
      { status: 500 }
    );
  }
}
