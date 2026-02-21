import { NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import { getOrCreatePreferences } from '@/lib/engagement/helpers';
import prisma from '@/lib/db';

/**
 * GET /api/user/email-preferences
 * Returns the user's email notification preferences.
 */
export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  try {
    const prefs = await getOrCreatePreferences(userId);
    return NextResponse.json({
      transactional: prefs.transactional,
      nudges: prefs.nudges,
      discovery: prefs.discovery,
      reengagement: prefs.reengagement,
      unsubscribedAll: prefs.unsubscribedAll,
    });
  } catch (error) {
    console.error('[EmailPrefs] GET error:', error);
    return NextResponse.json({ error: 'Failed to fetch preferences' }, { status: 500 });
  }
}

/**
 * PATCH /api/user/email-preferences
 * Update email notification preferences.
 *
 * Body: { transactional?: boolean, nudges?: boolean, discovery?: boolean, reengagement?: boolean, unsubscribedAll?: boolean }
 */
export async function PATCH(request: Request) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  try {
    const body = await request.json();

    // Validate fields
    const validFields = ['transactional', 'nudges', 'discovery', 'reengagement', 'unsubscribedAll'];
    const updates: Record<string, boolean> = {};

    for (const field of validFields) {
      if (field in body && typeof body[field] === 'boolean') {
        updates[field] = body[field];
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    // If unsubscribing from all, set all categories to false
    if (updates.unsubscribedAll === true) {
      updates.transactional = false;
      updates.nudges = false;
      updates.discovery = false;
      updates.reengagement = false;
    }

    // If re-subscribing to all, re-enable everything
    if (updates.unsubscribedAll === false) {
      // Only re-enable unsubscribedAll flag, don't force categories back on
    }

    const prefs = await prisma.emailPreferences.upsert({
      where: { userId },
      create: { userId, ...updates },
      update: updates,
    });

    console.log(`[EmailPrefs] Updated for user ${userId}:`, updates);

    return NextResponse.json({
      transactional: prefs.transactional,
      nudges: prefs.nudges,
      discovery: prefs.discovery,
      reengagement: prefs.reengagement,
      unsubscribedAll: prefs.unsubscribedAll,
    });
  } catch (error) {
    console.error('[EmailPrefs] PATCH error:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
