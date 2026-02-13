import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/signals
// View captured signals (queue)
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const limit = parseInt(searchParams.get('limit') || '50');

  const where: any = {};
  if (status) {
    // Support comma-separated statuses: ?status=queued,enriched
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
    _count: true,
  });

  return NextResponse.json({ signals, counts });
}

// ──────────────────────────────────────────────
// DELETE /api/signals
// Remove a signal from the queue
// ──────────────────────────────────────────────

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Signal ID required' }, { status: 400 });
  }

  await prisma.signal.delete({ where: { id } });
  return NextResponse.json({ status: 'deleted' });
}
