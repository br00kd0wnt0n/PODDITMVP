import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import prisma from '@/lib/db';

// POST /api/episodes/play — increment play count for an episode
export async function POST(request: NextRequest) {
  try {
    const sessionResult = await requireSession();
    if (sessionResult instanceof NextResponse) return sessionResult;
    const { userId } = sessionResult;

    // Rate limit: 30 per minute per user
    const { allowed } = rateLimit(`episode-play:${userId}`, 30, 60_000);
    if (!allowed) {
      return NextResponse.json({ error: 'Rate limited' }, { status: 429 });
    }

    const body = await request.json().catch(() => ({}));
    const { episodeId } = body;

    if (!episodeId || typeof episodeId !== 'string') {
      return NextResponse.json({ error: 'Missing episodeId' }, { status: 400 });
    }

    // Verify ownership
    const episode = await prisma.episode.findFirst({
      where: { id: episodeId, userId },
      select: { id: true },
    });

    if (!episode) {
      return NextResponse.json({ error: 'Episode not found' }, { status: 404 });
    }

    // Increment play count + update last activity (independent — don't let one block the other)
    const results = await Promise.allSettled([
      prisma.episode.update({
        where: { id: episodeId },
        data: { playCount: { increment: 1 } },
      }),
      prisma.user.update({
        where: { id: userId },
        data: { lastActiveAt: new Date() },
      }),
    ]);

    for (const r of results) {
      if (r.status === 'rejected') {
        console.error('[Play] Partial failure:', r.reason);
      }
    }

    return NextResponse.json({ status: 'counted' });
  } catch (error) {
    console.error('[Play] Error:', error);
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
