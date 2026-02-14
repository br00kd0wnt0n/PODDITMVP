import { NextRequest, NextResponse } from 'next/server';
import { auth } from './auth-config';

// ──────────────────────────────────────────────
// SESSION AUTH (NextAuth.js)
// For dashboard endpoints — extracts userId from session
// ──────────────────────────────────────────────

/**
 * Extract userId from NextAuth session.
 * Returns { userId } if authenticated, or a 401 NextResponse if not.
 */
export async function requireSession(): Promise<{ userId: string } | NextResponse> {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  return { userId: session.user.id };
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
