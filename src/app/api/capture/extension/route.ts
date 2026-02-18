import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import prisma from '@/lib/db';

// Build CORS headers dynamically — only allow chrome-extension:// origins
function getCorsHeaders(request: NextRequest) {
  const origin = request.headers.get('origin') || '';
  const allowed = origin.startsWith('chrome-extension://');
  return {
    'Access-Control-Allow-Origin': allowed ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

// ──────────────────────────────────────────────
// OPTIONS /api/capture/extension
// CORS preflight for browser extension
// ──────────────────────────────────────────────

export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, { status: 204, headers: getCorsHeaders(request) });
}

// ──────────────────────────────────────────────
// POST /api/capture/extension
// Browser extension sends captured URLs/text
// Auth: email + inviteCode (primary) or Bearer API_SECRET + userId (legacy)
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url, title, text, selectedText, email, inviteCode, userId } = body;

    // ── Auth: email + inviteCode (primary) or legacy Bearer + userId ──
    let resolvedUserId: string;

    if (email && inviteCode) {
      // New auth: look up user by email, validate invite code
      const normalizedEmail = email.trim().toLowerCase();
      const user = await prisma.user.findUnique({
        where: { email: normalizedEmail },
        select: { id: true, inviteCode: true, revokedAt: true },
      });

      if (!user) {
        return NextResponse.json(
          { error: 'No Poddit account found for this email' },
          { status: 404, headers: getCorsHeaders(request) }
        );
      }

      if (user.revokedAt) {
        return NextResponse.json(
          { error: 'Access has been revoked' },
          { status: 403, headers: getCorsHeaders(request) }
        );
      }

      // Validate: per-user invite code OR global access code
      const codeMatch = (user.inviteCode && user.inviteCode === inviteCode)
        || (process.env.ACCESS_CODE && inviteCode === process.env.ACCESS_CODE);

      if (!codeMatch) {
        return NextResponse.json(
          { error: 'Invalid invite code' },
          { status: 401, headers: getCorsHeaders(request) }
        );
      }

      resolvedUserId = user.id;
    } else {
      // Legacy auth: Bearer API_SECRET + userId in body
      const authHeader = request.headers.get('authorization');
      if (authHeader !== `Bearer ${process.env.API_SECRET}`) {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 401, headers: getCorsHeaders(request) }
        );
      }

      if (!userId) {
        return NextResponse.json(
          { error: 'userId is required' },
          { status: 400, headers: getCorsHeaders(request) }
        );
      }

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        return NextResponse.json(
          { error: 'User not found' },
          { status: 404, headers: getCorsHeaders(request) }
        );
      }

      resolvedUserId = user.id;
    }

    // Build raw content from what the extension sends
    let rawContent = '';
    if (url) {
      rawContent = url;
      if (selectedText) {
        rawContent += `\n\nSelected: ${selectedText}`;
      }
    } else if (text) {
      rawContent = text;
    } else {
      return NextResponse.json({ error: 'No content provided' }, { status: 400, headers: getCorsHeaders(request) });
    }

    const signals = await createSignal({
      rawContent,
      channel: 'EXTENSION',
      userId: resolvedUserId,
    });

    // If title was provided by the extension, update the signal
    if (title && signals[0]) {
      await prisma.signal.update({
        where: { id: signals[0].id },
        data: { title },
      });
    }

    return NextResponse.json({
      status: 'captured',
      signals: signals.length,
    }, { headers: getCorsHeaders(request) });

  } catch (error) {
    console.error('[Extension] Error:', error);
    return NextResponse.json({ error: 'Capture failed' }, { status: 500, headers: getCorsHeaders(request) });
  }
}
