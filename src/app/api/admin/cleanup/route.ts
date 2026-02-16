import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/admin/cleanup
// Admin data cleanup operations
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { action, email, userId } = body;

    // Resolve user by email if provided
    let targetUserId = userId;
    if (email && !targetUserId) {
      const user = await prisma.user.findUnique({
        where: { email },
        select: { id: true, email: true },
      });
      if (!user) {
        return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 });
      }
      targetUserId = user.id;
    }

    switch (action) {
      case 'delete-questionnaire': {
        if (!targetUserId) {
          return NextResponse.json({ error: 'email or userId required' }, { status: 400 });
        }

        // Find responses to know how much bonus to remove
        const responses = await prisma.questionnaireResponse.findMany({
          where: { userId: targetUserId },
        });

        if (responses.length === 0) {
          return NextResponse.json({ message: 'No questionnaire responses found', deleted: 0 });
        }

        // Each response grants +3 bonus episodes
        const bonusToRemove = responses.length * 3;

        await prisma.$transaction([
          prisma.questionnaireResponse.deleteMany({
            where: { userId: targetUserId },
          }),
          prisma.user.update({
            where: { id: targetUserId },
            data: { episodeBonusGranted: { decrement: bonusToRemove } },
          }),
        ]);

        console.log(`[Admin] Deleted ${responses.length} questionnaire response(s) for ${email || targetUserId}, removed ${bonusToRemove} bonus episodes`);

        return NextResponse.json({
          message: `Deleted ${responses.length} questionnaire response(s)`,
          deleted: responses.length,
          bonusRemoved: bonusToRemove,
        });
      }

      case 'delete-episode': {
        const { episodeId } = body;
        if (!episodeId) {
          return NextResponse.json({ error: 'episodeId required' }, { status: 400 });
        }

        // Release signals and delete episode
        await prisma.$transaction([
          prisma.signal.updateMany({
            where: { episodeId },
            data: { status: 'QUEUED', episodeId: null },
          }),
          prisma.segment.deleteMany({ where: { episodeId } }),
          prisma.episodeRating.deleteMany({ where: { episodeId } }),
          prisma.episode.delete({ where: { id: episodeId } }),
        ]);

        console.log(`[Admin] Deleted episode ${episodeId}, released signals`);
        return NextResponse.json({ message: `Episode ${episodeId} deleted, signals released` });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[Admin] Cleanup error:', error);
    return NextResponse.json({ error: error.message || 'Cleanup failed' }, { status: 500 });
  }
}
