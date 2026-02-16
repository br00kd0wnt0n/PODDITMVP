import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/episodes/rate
// Submit or update an episode rating (1–5 on 3 questions + optional feedback)
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const sessionResult = await requireSession();
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { userId } = sessionResult;

    // Rate limit: 10 per minute per user
    const { allowed, retryAfterMs } = rateLimit(`episode-rate:${userId}`, 10, 60_000);
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many submissions. Please wait a moment.' },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { episodeId, enjoyment, resonance, connections, feedback } = body;

    // Validate required fields
    if (!episodeId || typeof episodeId !== 'string') {
      return NextResponse.json({ error: 'Missing episodeId' }, { status: 400 });
    }

    // Validate ratings are 1–5
    for (const [name, value] of Object.entries({ enjoyment, resonance, connections })) {
      if (typeof value !== 'number' || value < 1 || value > 5 || !Number.isInteger(value)) {
        return NextResponse.json(
          { error: `${name} must be an integer between 1 and 5` },
          { status: 400 }
        );
      }
    }

    // Validate feedback length
    if (feedback && typeof feedback === 'string' && feedback.length > 5000) {
      return NextResponse.json(
        { error: 'Feedback is too long (max 5000 characters)' },
        { status: 400 }
      );
    }

    // Verify the episode belongs to this user
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, userId },
      select: { id: true },
    });

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // Upsert: one rating per user per episode
    const rating = await prisma.episodeRating.upsert({
      where: { userId_episodeId: { userId, episodeId } },
      create: {
        userId,
        episodeId,
        enjoyment,
        resonance,
        connections,
        feedback: feedback?.trim() || null,
      },
      update: {
        enjoyment,
        resonance,
        connections,
        feedback: feedback?.trim() || null,
      },
    });

    console.log(`[Rating] Episode ${episodeId} rated by ${userId}: ${enjoyment}/${resonance}/${connections}`);

    return NextResponse.json({
      status: 'submitted',
      ratingId: rating.id,
    });
  } catch (error: any) {
    console.error('[Rating] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to submit rating' },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// GET /api/episodes/rate?episodeId=xxx
// Check if user has rated a specific episode
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const sessionResult = await requireSession();
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { userId } = sessionResult;

    const episodeId = request.nextUrl.searchParams.get('episodeId');

    if (!episodeId) {
      return NextResponse.json({ error: 'Missing episodeId parameter' }, { status: 400 });
    }

    const rating = await prisma.episodeRating.findUnique({
      where: { userId_episodeId: { userId, episodeId } },
      select: {
        enjoyment: true,
        resonance: true,
        connections: true,
        feedback: true,
      },
    });

    if (!rating) {
      return NextResponse.json({ rated: false });
    }

    return NextResponse.json({ rated: true, rating });
  } catch (error: any) {
    console.error('[Rating] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to check rating' },
      { status: 500 }
    );
  }
}
