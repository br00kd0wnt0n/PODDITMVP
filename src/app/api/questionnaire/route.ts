import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import prisma from '@/lib/db';

const BONUS_EPISODES = 3;

// ──────────────────────────────────────────────
// GET /api/questionnaire
// Check if user needs to complete a questionnaire
// ──────────────────────────────────────────────

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      userType: true,
      episodeBonusGranted: true,
      _count: { select: { episodes: { where: { status: 'READY' } } } },
      questionnaireResponses: {
        select: { milestone: true },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  // Only EARLY_ACCESS users get questionnaires
  if (user.userType !== 'EARLY_ACCESS') {
    return NextResponse.json({ required: false });
  }

  const episodeCount = user._count.episodes;
  const baseLimit = 3;
  const currentLimit = baseLimit + user.episodeBonusGranted;
  const completedMilestones = user.questionnaireResponses.map(q => q.milestone);

  // Questionnaire triggers at each multiple of 3 (3, 6, 9, ...)
  // Required when: at limit AND haven't completed questionnaire for this milestone
  const atLimit = episodeCount >= currentLimit;
  const currentMilestone = currentLimit; // e.g. 3, 6, 9
  const alreadyCompleted = completedMilestones.includes(currentMilestone);

  return NextResponse.json({
    required: atLimit && !alreadyCompleted,
    milestone: currentMilestone,
    episodeCount,
    currentLimit,
  });
}

// ──────────────────────────────────────────────
// POST /api/questionnaire
// Submit questionnaire responses and unlock bonus episodes
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  try {
    const body = await request.json();
    const { responses, milestone } = body;

    if (!responses || typeof responses !== 'object') {
      return NextResponse.json({ error: 'Responses required' }, { status: 400 });
    }

    if (!milestone || typeof milestone !== 'number') {
      return NextResponse.json({ error: 'Milestone required' }, { status: 400 });
    }

    // Check user hasn't already completed this milestone
    const existing = await prisma.questionnaireResponse.findFirst({
      where: { userId, milestone },
    });

    if (existing) {
      return NextResponse.json({ error: 'Already completed this questionnaire' }, { status: 409 });
    }

    // Save responses and grant bonus in a transaction
    await prisma.$transaction([
      prisma.questionnaireResponse.create({
        data: {
          userId,
          responses,
          milestone,
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          episodeBonusGranted: { increment: BONUS_EPISODES },
        },
      }),
    ]);

    console.log(`[Questionnaire] User ${userId} completed milestone ${milestone}, granted +${BONUS_EPISODES} episodes`);

    return NextResponse.json({
      success: true,
      bonusGranted: BONUS_EPISODES,
      newLimit: milestone + BONUS_EPISODES,
    });
  } catch (error: any) {
    console.error('[Questionnaire] Error:', error);
    return NextResponse.json({ error: 'Failed to submit questionnaire' }, { status: 500 });
  }
}
