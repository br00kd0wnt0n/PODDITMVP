import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/capture/extension
// Browser extension sends captured URLs/text
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    // Simple auth via shared secret
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.API_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { url, title, text, selectedText } = body;

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
      return NextResponse.json({ error: 'No content provided' }, { status: 400 });
    }

    const signals = await createSignal({
      rawContent,
      channel: 'EXTENSION',
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
    });

  } catch (error) {
    console.error('[Extension] Error:', error);
    return NextResponse.json({ error: 'Capture failed' }, { status: 500 });
  }
}
