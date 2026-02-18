import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/signals
// View captured signals for the current user
// ──────────────────────────────────────────────

const VALID_STATUSES = ['PENDING', 'QUEUED', 'ENRICHED', 'USED', 'SKIPPED', 'FAILED'];

export async function GET(request: NextRequest) {
  const sessionResult = await requireSession();
  if (sessionResult instanceof NextResponse) return sessionResult;
  const { userId } = sessionResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 100);

  const where: any = { userId };
  if (status) {
    const statuses = status.split(',').map(s => s.trim().toUpperCase())
      .filter(s => VALID_STATUSES.includes(s));

    if (statuses.length === 0) {
      return NextResponse.json(
        { error: `Invalid status. Valid values: ${VALID_STATUSES.join(', ')}` },
        { status: 400 }
      );
    }

    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

  try {
    const signals = await prisma.signal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        inputType: true,
        channel: true,
        rawContent: true,
        url: true,
        title: true,
        source: true,
        topics: true,
        status: true,
        createdAt: true,
      },
    });

    const counts = await prisma.signal.groupBy({
      by: ['status'],
      where: { userId },
      _count: true,
    });

    return NextResponse.json({ signals, counts });
  } catch (error) {
    console.error('[Signals] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch signals' },
      { status: 500 }
    );
  }
}

// ──────────────────────────────────────────────
// DELETE /api/signals
// Remove a signal from the queue (verify ownership)
// ──────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const sessionResult = await requireSession();
  if (sessionResult instanceof NextResponse) return sessionResult;
  const { userId } = sessionResult;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Signal ID required' }, { status: 400 });
  }

  try {
    // Verify ownership before deleting
    const signal = await prisma.signal.findFirst({
      where: { id, userId },
    });
    if (!signal) {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }

    await prisma.signal.delete({ where: { id } });
    return NextResponse.json({ status: 'deleted' });
  } catch (error: any) {
    console.error('[Signals] Delete error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
