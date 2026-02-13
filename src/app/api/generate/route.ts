import { NextRequest, NextResponse } from 'next/server';
import { generateEpisode } from '@/lib/synthesize';
import { notifyEpisodeReady } from '@/lib/deliver';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/generate
// Manual episode generation trigger
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.API_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    
    // Optional: specify how far back to look (default: 7 days)
    const daysBack = body.daysBack || 7;
    const since = new Date();
    since.setDate(since.getDate() - daysBack);

    // Generate the episode
    const episodeId = await generateEpisode({
      since,
      manual: true,
    });

    // Fetch the completed episode for notification
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
    });

    if (episode && episode.status === 'READY') {
      // Send SMS notification
      await notifyEpisodeReady({
        episodeId: episode.id,
        title: episode.title || 'Your Poddit Episode',
        signalCount: episode.signalCount,
        duration: episode.audioDuration || undefined,
      });
    }

    return NextResponse.json({
      status: 'generated',
      episodeId,
      title: episode?.title,
    });

  } catch (error: any) {
    console.error('[Generate] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Generation failed' },
      { status: 500 }
    );
  }
}
