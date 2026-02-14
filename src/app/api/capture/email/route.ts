import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';
import prisma from '@/lib/db';

// ──────────────────────────────────────────────
// POST /api/capture/email
// SendGrid Inbound Parse webhook
// Looks up user by sender email address
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const from = formData.get('from') as string;
    const subject = formData.get('subject') as string;
    const text = formData.get('text') as string;
    const html = formData.get('html') as string;

    console.log(`[Email] Received from ${from}: ${subject}`);

    // Extract email address from "Name <email@example.com>" format
    const emailMatch = from?.match(/<([^>]+)>/) || [null, from?.trim()];
    const senderEmail = emailMatch[1]?.toLowerCase();

    // Look up user by email
    let userId = 'default';
    if (senderEmail) {
      const user = await prisma.user.findFirst({ where: { email: senderEmail } });
      if (user) {
        userId = user.id;
      } else {
        console.log(`[Email] Unknown sender: ${senderEmail} — using default user`);
      }
    }

    // Combine subject and body for signal content
    const rawContent = [
      subject ? `Subject: ${subject}` : '',
      text || stripHtml(html) || '',
    ].filter(Boolean).join('\n\n');

    if (!rawContent.trim()) {
      return NextResponse.json({ status: 'empty' }, { status: 200 });
    }

    const signals = await createSignal({
      rawContent,
      channel: 'EMAIL',
      userId,
    });

    console.log(`[Email] Created ${signals.length} signal(s) for user ${userId}`);

    return NextResponse.json({
      status: 'captured',
      signals: signals.length
    });

  } catch (error) {
    console.error('[Email] Error:', error);
    // Return 200 so SendGrid doesn't retry
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}

function stripHtml(html: string | null): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
