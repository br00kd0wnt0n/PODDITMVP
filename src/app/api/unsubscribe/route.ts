import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/db';

/**
 * Public unsubscribe endpoint — no auth required.
 * Uses the user's unsubscribeToken from EmailPreferences for identification.
 *
 * GET /api/unsubscribe?token={token}&category={category}
 *
 * Categories: nudges, discovery, reengagement, transactional, all
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const token = searchParams.get('token');
  const category = searchParams.get('category');

  if (!token || !category) {
    return new NextResponse(buildErrorPage('Missing parameters'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const validCategories = ['nudges', 'discovery', 'reengagement', 'transactional', 'all'];
  if (!validCategories.includes(category)) {
    return new NextResponse(buildErrorPage('Invalid category'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    // Look up preferences by token
    const prefs = await prisma.emailPreferences.findUnique({
      where: { unsubscribeToken: token },
    });

    if (!prefs) {
      return new NextResponse(buildErrorPage('Invalid or expired link'), {
        status: 404,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }

    // Update preferences based on category
    if (category === 'all') {
      await prisma.emailPreferences.update({
        where: { id: prefs.id },
        data: { unsubscribedAll: true },
      });
    } else {
      await prisma.emailPreferences.update({
        where: { id: prefs.id },
        data: { [category]: false },
      });
    }

    const categoryLabels: Record<string, string> = {
      nudges: 'weekly nudges',
      discovery: 'feature discovery tips',
      reengagement: 're-engagement emails',
      transactional: 'episode notifications',
      all: 'all Poddit emails',
    };

    console.log(`[Engagement] Unsubscribed user ${prefs.userId} from ${category}`);

    return new NextResponse(
      buildConfirmationPage(categoryLabels[category] || category),
      {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      },
    );
  } catch (error) {
    console.error('[Engagement] Unsubscribe error:', error);
    return new NextResponse(buildErrorPage('Something went wrong'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
}

// ──────────────────────────────────────────────
// HTML pages
// ──────────────────────────────────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poddit.com';

function buildConfirmationPage(categoryLabel: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed — Poddit</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:420px;margin:0 auto;padding:40px 24px;text-align:center;">
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.5px;margin:0 0 8px;">PODDIT</h1>
    <p style="color:#737373;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:0 0 32px;">Your world, explained</p>

    <div style="background-color:#171717;border:1px solid #262626;border-radius:12px;padding:32px 24px;">
      <div style="width:48px;height:48px;border-radius:12px;background-color:#2dd4bf15;display:flex;align-items:center;justify-content:center;margin:0 auto 16px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      </div>
      <p style="color:#d4d4d4;font-size:15px;line-height:1.6;margin:0 0 8px;">
        You've been unsubscribed from <strong>${categoryLabel}</strong>.
      </p>
      <p style="color:#737373;font-size:13px;line-height:1.6;margin:0 0 20px;">
        You can update your email preferences any time from Settings.
      </p>
      <a href="${APP_URL}/settings"
         style="display:inline-block;background-color:#2dd4bf;color:#0a0a0a;font-size:13px;font-weight:700;
                text-decoration:none;padding:10px 24px;border-radius:8px;">
        Manage preferences
      </a>
    </div>

    <p style="color:#525252;font-size:11px;margin:24px 0 0;">Heathen Digital LLC</p>
  </div>
</body>
</html>`;
}

function buildErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Error — Poddit</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;">
  <div style="max-width:420px;margin:0 auto;padding:40px 24px;text-align:center;">
    <h1 style="color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.5px;margin:0 0 32px;">PODDIT</h1>
    <div style="background-color:#171717;border:1px solid #262626;border-radius:12px;padding:32px 24px;">
      <p style="color:#d4d4d4;font-size:15px;margin:0 0 16px;">${message}</p>
      <p style="color:#737373;font-size:13px;margin:0;">
        If you need help, contact us at <a href="mailto:hello@poddit.com" style="color:#2dd4bf;text-decoration:none;">hello@poddit.com</a>
      </p>
    </div>
  </div>
</body>
</html>`;
}
