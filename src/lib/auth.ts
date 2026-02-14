import { NextRequest, NextResponse } from 'next/server';

// ──────────────────────────────────────────────
// SIMPLE AUTH HELPER
// Shared secret auth for single-user MVP
// ──────────────────────────────────────────────

/**
 * Verify API_SECRET from Authorization header.
 * Returns null if authorized, or a 401 NextResponse if not.
 *
 * Usage:
 *   const authError = requireAuth(request);
 *   if (authError) return authError;
 */
export function requireAuth(request: NextRequest): NextResponse | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${process.env.API_SECRET}`) {
    return null; // authorized
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
    return null; // authorized
  }
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}

/**
 * Check if the request is from the same origin (dashboard).
 * For dashboard-only endpoints that don't need external access.
 * Checks Referer/Origin headers + a custom header the dashboard sets.
 */
export function requireDashboard(request: NextRequest): NextResponse | null {
  // In development, allow all requests
  if (process.env.NODE_ENV === 'development') {
    return null;
  }

  // Check for custom header set by dashboard fetch calls
  const dashboardHeader = request.headers.get('x-poddit-dashboard');
  if (dashboardHeader === 'true') {
    return null;
  }

  // Check Origin/Referer as fallback
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.RAILWAY_PUBLIC_DOMAIN;

  if (origin || referer) {
    const requestOrigin = origin || (referer ? new URL(referer).origin : '');
    if (appUrl && requestOrigin.includes(appUrl)) {
      return null;
    }
    // Also allow localhost in development
    if (requestOrigin.includes('localhost') || requestOrigin.includes('127.0.0.1')) {
      return null;
    }
  }

  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
}
