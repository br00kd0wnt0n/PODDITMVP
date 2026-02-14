import { NextRequest, NextResponse } from 'next/server';
import { requireDashboard } from '@/lib/auth';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// GET /api/signals
// View captured signals (queue)
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Auth: dashboard-only endpoint
  const authError = requireDashboard(request);
  if (authError) return authError;

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
  // Auth: dashboard-only endpoint
  const authError = requireDashboard(request);
  if (authError) return authError;

  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');

  if (!id) {
    return NextResponse.json({ error: 'Signal ID required' }, { status: 400 });
  }

  try {
    await prisma.signal.delete({ where: { id } });
    return NextResponse.json({ status: 'deleted' });
  } catch (error: any) {
    if (error?.code === 'P2025') {
      return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
    }
    console.error('[Signals] Delete error:', error);
    return NextResponse.json({ error: 'Delete failed' }, { status: 500 });
  }
}
