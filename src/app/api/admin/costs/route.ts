import { NextRequest, NextResponse } from 'next/server';
import { requireAdminAuth } from '@/lib/auth';
import prisma from '@/lib/db';

const VALID_CATEGORIES = ['infra', 'api', 'comms', 'storage', 'other'];

// GET /api/admin/costs — list all fixed costs
export async function GET(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const costs = await prisma.fixedCost.findMany({
      orderBy: [{ active: 'desc' }, { name: 'asc' }],
    });
    return NextResponse.json({ costs });
  } catch (error) {
    console.error('[Admin] Failed to fetch fixed costs:', error);
    return NextResponse.json({ error: 'Failed to fetch costs' }, { status: 500 });
  }
}

// POST /api/admin/costs — create a new fixed cost
export async function POST(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { name, amount, category, notes } = body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (amount === undefined || typeof amount !== 'number' || amount < 0) {
      return NextResponse.json({ error: 'Valid amount is required' }, { status: 400 });
    }
    if (category && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
    }

    const cost = await prisma.fixedCost.create({
      data: {
        name: name.trim(),
        amount,
        category: category || 'infra',
        notes: notes?.trim() || null,
      },
    });

    return NextResponse.json({ cost }, { status: 201 });
  } catch (error) {
    console.error('[Admin] Failed to create fixed cost:', error);
    return NextResponse.json({ error: 'Failed to create cost' }, { status: 500 });
  }
}

// PATCH /api/admin/costs — update an existing fixed cost
export async function PATCH(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id, name, amount, category, notes, active } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Cost id is required' }, { status: 400 });
    }
    if (category !== undefined && !VALID_CATEGORIES.includes(category)) {
      return NextResponse.json({ error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(', ')}` }, { status: 400 });
    }

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim();
    if (amount !== undefined) data.amount = amount;
    if (category !== undefined) data.category = category;
    if (notes !== undefined) data.notes = notes?.trim() || null;
    if (active !== undefined) data.active = Boolean(active);

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
    }

    const cost = await prisma.fixedCost.update({
      where: { id },
      data,
    });

    return NextResponse.json({ cost });
  } catch (error) {
    console.error('[Admin] Failed to update fixed cost:', error);
    return NextResponse.json({ error: 'Failed to update cost' }, { status: 500 });
  }
}

// DELETE /api/admin/costs — delete a fixed cost
export async function DELETE(request: NextRequest) {
  const authError = requireAdminAuth(request);
  if (authError) return authError;

  try {
    const body = await request.json();
    const { id } = body;

    if (!id || typeof id !== 'string') {
      return NextResponse.json({ error: 'Cost id is required' }, { status: 400 });
    }

    await prisma.fixedCost.delete({ where: { id } });

    return NextResponse.json({ status: 'deleted' });
  } catch (error) {
    console.error('[Admin] Failed to delete fixed cost:', error);
    return NextResponse.json({ error: 'Failed to delete cost' }, { status: 500 });
  }
}
