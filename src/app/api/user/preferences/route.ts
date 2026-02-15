import { NextRequest, NextResponse } from 'next/server';
import { requireSession } from '@/lib/auth';
import prisma from '@/lib/db';
import { VOICES } from '@/lib/tts';

const VALID_LENGTHS = ['short', 'medium', 'long'];

// E.164 phone format: +1XXXXXXXXXX
const E164_REGEX = /^\+[1-9]\d{1,14}$/;

// ──────────────────────────────────────────────
// GET /api/user/preferences
// Returns current user's profile + preferences
// ──────────────────────────────────────────────

export async function GET() {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      preferences: true,
      consentedAt: true,
      userType: true,
      episodeBonusGranted: true,
    },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const BASE_LIMITS: Record<string, number> = { MASTER: -1, EARLY_ACCESS: 3, TESTER: 10 };
  const baseLimit = BASE_LIMITS[user.userType] ?? 3;
  const episodeLimit = baseLimit === -1 ? -1 : baseLimit + (user.episodeBonusGranted || 0);

  return NextResponse.json({
    name: user.name || '',
    email: user.email || '',
    phone: user.phone || '',
    preferences: user.preferences || {},
    consentedAt: user.consentedAt,
    userType: user.userType,
    episodeLimit,
  });
}

// ──────────────────────────────────────────────
// PATCH /api/user/preferences
// Updates user's name, phone, and preferences
// ──────────────────────────────────────────────

export async function PATCH(request: NextRequest) {
  const session = await requireSession();
  if (session instanceof NextResponse) return session;
  const { userId } = session;

  try {
    const body = await request.json();
    const { name, phone, preferences, consent } = body;

    // Build update data
    const updateData: Record<string, unknown> = {};

    // Name
    if (name !== undefined) {
      updateData.name = name.trim() || null;
    }

    // Phone — validate E.164 format and uniqueness
    if (phone !== undefined) {
      if (phone === '' || phone === null) {
        updateData.phone = null;
      } else {
        if (!E164_REGEX.test(phone)) {
          return NextResponse.json(
            { error: 'Phone must be in E.164 format (e.g., +15551234567)' },
            { status: 400 }
          );
        }

        // Check uniqueness (allow the current user's own number)
        const existing = await prisma.user.findFirst({
          where: { phone, id: { not: userId } },
        });
        if (existing) {
          return NextResponse.json(
            { error: 'This phone number is already registered to another account' },
            { status: 409 }
          );
        }

        updateData.phone = phone;
      }
    }

    // Preferences — validate voice and episodeLength
    if (preferences !== undefined) {
      const currentUser = await prisma.user.findUnique({ where: { id: userId } });
      const currentPrefs = (currentUser?.preferences as Record<string, string>) || {};
      const newPrefs = { ...currentPrefs };

      if (preferences.voice !== undefined) {
        if (preferences.voice && !VOICES[preferences.voice]) {
          return NextResponse.json(
            { error: `Invalid voice. Options: ${Object.keys(VOICES).join(', ')}` },
            { status: 400 }
          );
        }
        newPrefs.voice = preferences.voice || 'gandalf';
      }

      if (preferences.episodeLength !== undefined) {
        if (preferences.episodeLength && !VALID_LENGTHS.includes(preferences.episodeLength)) {
          return NextResponse.json(
            { error: `Invalid episode length. Options: ${VALID_LENGTHS.join(', ')}` },
            { status: 400 }
          );
        }
        newPrefs.episodeLength = preferences.episodeLength || 'medium';
      }

      updateData.preferences = newPrefs;
    }

    // Consent toggle
    if (consent !== undefined) {
      if (consent) {
        updateData.consentedAt = new Date();
        updateData.consentChannel = 'settings';
      } else {
        updateData.consentedAt = null;
        updateData.consentChannel = null;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
    }

    const updated = await prisma.user.update({
      where: { id: userId },
      data: updateData,
      select: {
        name: true,
        email: true,
        phone: true,
        preferences: true,
        consentedAt: true,
      },
    });

    return NextResponse.json({
      name: updated.name || '',
      email: updated.email || '',
      phone: updated.phone || '',
      preferences: updated.preferences || {},
      consentedAt: updated.consentedAt,
    });

  } catch (error) {
    console.error('[Preferences] Update failed:', error);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }
}
