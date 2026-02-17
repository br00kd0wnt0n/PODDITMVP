import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/signals
// View captured signals for the current user
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const sessionResult = await requireSession();
  if (sessionResult instanceof NextResponse) return sessionResult;
  const { userId } = sessionResult;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const limit = Math.min(parseInt(searchParams.get('limit') || '50') || 50, 100);

  const where: any = { userId };
  if (status) {
    const statuses = status.split(',').map(s => s.trim().toUpperCase());
    where.status = statuses.length === 1 ? statuses[0] : { in: statuses };
  }

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
