import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import prisma from '@/lib/db';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

// ──────────────────────────────────────────────
// OPTIONS /api/capture/extension
// CORS preflight for browser extension
// ──────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ──────────────────────────────────────────────
// POST /api/capture/extension
// Browser extension sends captured URLs/text
// Auth: Bearer API_SECRET + optional userId in body
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Simple auth via shared secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.API_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
    }

    const body = await request.json();
    const { url, title, text, selectedText, userId } = body;

    // Resolve userId — if provided, validate it exists; otherwise fall back to 'default'
    let resolvedUserId = 'default';
    if (userId) {
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (user) {
        resolvedUserId = user.id;
      } else {
        return NextResponse.json({ error: 'User not found' }, { status: 404, headers: corsHeaders });
      }
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
      return NextResponse.json({ error: 'No content provided' }, { status: 400, headers: corsHeaders });
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
    }, { headers: corsHeaders });

  } catch (error) {
    console.error('[Extension] Error:', error);
    return NextResponse.json({ error: 'Capture failed' }, { status: 500, headers: corsHeaders });
  }
}
