import { NextRequest, NextResponse } from 'next/server';
import { auth } from './auth-config';
import prisma from './db';

// ──────────────────────────────────────────────
// SESSION AUTH (NextAuth.js)
// For dashboard endpoints — extracts userId from session
// ──────────────────────────────────────────────

// In-memory cache for revocation checks (60s TTL)
// Prevents per-request DB queries while ensuring revoked users are blocked within ~60s
const revocationCache = new Map<string, { revokedAt: Date | null; fetchedAt: number }>();
const REVOCATION_CACHE_TTL = 60_000; // 60 seconds

/**
 * Extract userId from NextAuth session.
 * Returns { userId } if authenticated and not revoked, or a 401/403 NextResponse.
 * Checks revokedAt with a 60s in-memory cache to avoid per-request DB load.
 */
export async function requireSession(): Promise<{ userId: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const userId = session.user.id;

  // Check revocation status (cached for 60s)
  const cached = revocationCache.get(userId);
  const now = Date.now();

  if (cached && now - cached.fetchedAt < REVOCATION_CACHE_TTL) {
    if (cached.revokedAt) {
      return NextResponse.json({ error: 'Access revoked' }, { status: 403 });
    }
  } else {
    // Cache miss or expired — query DB
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { revokedAt: true },
    });

    revocationCache.set(userId, {
      revokedAt: user?.revokedAt ?? null,
      fetchedAt: now,
    });

    if (user?.revokedAt) {
      return NextResponse.json({ error: 'Access revoked' }, { status: 403 });
    }
  }

  return { userId };
}

/**
 * Clear revocation cache for a user (call after admin revoke/restore actions).
 */
export function clearRevocationCache(userId: string): void {
  revocationCache.delete(userId);
}

// ──────────────────────────────────────────────
// BEARER TOKEN AUTH
// For external endpoints (extension, cron, admin)
// ──────────────────────────────────────────────

/**
 * Verify API_SECRET from Authorization header.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.API_SECRET}`) {
    return null;
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Verify ADMIN_SECRET from Authorization header.
 * Falls back to API_SECRET if ADMIN_SECRET is not set.
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function requireAdminAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  const adminSecret = process.env.ADMIN_SECRET || process.env.API_SECRET;
  if (adminSecret && authHeader === `Bearer ${adminSecret}`) {
    return null;
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Verify CRON_SECRET from Authorization header ONLY (no query params).
 * Returns null if authorized, or a 401 NextResponse if not.
 */
export function requireCronAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.CRON_SECRET}`) {
    return null;
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
