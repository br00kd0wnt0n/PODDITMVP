import { NextRequest, NextResponse } from 'next/server';
import { generateEpisode } from '@/lib/synthesize';
import { notifyEpisodeReady } from '@/lib/deliver';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/cron
// Weekly automated episode generation
// 
// Trigger via Railway cron job or external service:
// curl -H "Authorization: Bearer $CRON_SECRET" https://poddit.com/api/cron
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    // Verify cron secret (header only — no query params for security)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if there are any signals to process
    const signalCount = await prisma.signal.count({
      where: {
        status: { in: ['QUEUED', 'ENRICHED'] },
        createdAt: { gte: getLastWeekStart() },
      },
    });

    if (signalCount === 0) {
      console.log('[Cron] No signals to process this week');
      return NextResponse.json({ 
        status: 'skipped',
        reason: 'No signals captured this week' 
      });
    }

    // Generate the episode
    const episodeId = await generateEpisode();

    // Fetch and notify
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
    });

    if (episode && episode.status === 'READY') {
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
      signalCount: episode?.signalCount,
    });

  } catch (error: any) {
    console.error('[Cron] Error:', error);
    return NextResponse.json(
      { error: error.message || 'Cron generation failed' },
      { status: 500 }
    );
  }
}

function getLastWeekStart(): Date {
  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  return lastWeek;
}
