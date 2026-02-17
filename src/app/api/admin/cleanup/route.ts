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

      case 'delete-user': {
        if (!targetUserId) {
          return NextResponse.json({ error: 'email or userId required' }, { status: 400 });
        }

        const userToDelete = await prisma.user.findUnique({
          where: { id: targetUserId },
          select: {
            id: true, email: true, name: true,
            _count: { select: { episodes: true, signals: true, feedback: true, episodeRatings: true, questionnaireResponses: true } },
          },
        });

        if (!userToDelete) {
          return NextResponse.json({ error: 'User not found' }, { status: 404 });
        }

        // Cascade deletes everything (all relations have onDelete: Cascade)
        await prisma.user.delete({ where: { id: targetUserId } });

        console.log(`[Admin] Deleted user ${userToDelete.email}: ${userToDelete._count.episodes} episodes, ${userToDelete._count.signals} signals, ${userToDelete._count.feedback} feedback, ${userToDelete._count.episodeRatings} ratings, ${userToDelete._count.questionnaireResponses} questionnaire responses`);

        return NextResponse.json({
          message: `Deleted user ${userToDelete.email} and all associated data`,
          deleted: true,
          email: userToDelete.email,
          episodesRemoved: userToDelete._count.episodes,
          signalsRemoved: userToDelete._count.signals,
          feedbackRemoved: userToDelete._count.feedback,
          ratingsRemoved: userToDelete._count.episodeRatings,
          questionnaireResponsesRemoved: userToDelete._count.questionnaireResponses,
        });
      }

      case 'delete-feedback': {
        const { feedbackId } = body;
        if (!feedbackId) {
          return NextResponse.json({ error: 'feedbackId required' }, { status: 400 });
        }

        await prisma.feedback.delete({ where: { id: feedbackId } });
        console.log(`[Admin] Deleted feedback ${feedbackId}`);
        return NextResponse.json({ message: 'Feedback deleted', deleted: true });
      }

      case 'delete-access-request': {
        const { accessRequestId } = body;
        if (!accessRequestId) {
          return NextResponse.json({ error: 'accessRequestId required' }, { status: 400 });
        }

        const conceptUrl = process.env.CONCEPT_API_URL;
        if (!conceptUrl) {
          return NextResponse.json({ error: 'CONCEPT_API_URL not configured' }, { status: 500 });
        }

        const adminSecret = process.env.ADMIN_SECRET || process.env.API_SECRET;

        // Try DELETE first, fall back to POST with _method override for compatibility
        let conceptRes: Response;
        try {
          conceptRes = await fetch(`${conceptUrl}/api/admin/access-requests/${accessRequestId}`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${adminSecret}` },
            signal: AbortSignal.timeout(5000),
          });
        } catch (fetchErr: any) {
          console.error(`[Admin] Failed to reach concept server for delete: ${fetchErr.message}`);
          return NextResponse.json(
            { error: 'Could not reach concept server. The access request was not deleted.' },
            { status: 502 }
          );
        }

        // If concept server doesn't support DELETE (404/405), explain clearly
        if (conceptRes.status === 404 || conceptRes.status === 405) {
          console.warn(`[Admin] Concept server returned ${conceptRes.status} for DELETE access-request — endpoint not available`);
          return NextResponse.json(
            { error: 'Delete endpoint not available on concept server. Access request must be removed from concept DB directly.' },
            { status: 501 }
          );
        }

        if (!conceptRes.ok) {
          const errData = await conceptRes.json().catch(() => ({}));
          return NextResponse.json(
            { error: errData.error || `Concept server error (${conceptRes.status})` },
            { status: conceptRes.status }
          );
        }

        const data = await conceptRes.json();
        console.log(`[Admin] Deleted access request ${accessRequestId} from concept server`);
        return NextResponse.json({ message: 'Access request deleted', deleted: true, email: data.deleted });
      }

      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[Admin] Cleanup error:', error);
    return NextResponse.json({ error: error.message || 'Cleanup failed' }, { status: 500 });
  }
}
