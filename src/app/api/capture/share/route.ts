import { NextRequest, NextResponse } from 'next/server';
import { createSignal } from '@/lib/capture';

// ──────────────────────────────────────────────
// POST /api/capture/share
// PWA Web Share Target API handler
// Receives shares from mobile OS share sheet
// ──────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const contentType = request.headers.get('content-type') || '';
    
    let rawContent = '';
    let title = '';

    if (contentType.includes('application/x-www-form-urlencoded') || contentType.includes('multipart/form-data')) {
      // Share Target sends form data
      const formData = await request.formData();
      title = (formData.get('title') as string) || '';
      const text = (formData.get('text') as string) || '';
      const url = (formData.get('url') as string) || '';
      
      // Mobile share sheets often put the URL in the 'text' field
      rawContent = url || text || title;
    } else {
      // JSON fallback
      const body = await request.json();
      title = body.title || '';
      rawContent = body.url || body.text || '';
    }

    if (!rawContent.trim()) {
      // Redirect to home with error
      return NextResponse.redirect(new URL('/?shared=empty', request.url));
    }

    const signals = await createSignal({
      rawContent,
      channel: 'SHARE_SHEET',
    });

    console.log(`[Share] Captured: ${rawContent.slice(0, 80)}`);

    // Redirect to confirmation page
    return NextResponse.redirect(
      new URL(`/?shared=success&count=${signals.length}`, request.url)
    );

  } catch (error) {
    console.error('[Share] Error:', error);
    return NextResponse.redirect(new URL('/?shared=error', request.url));
  }
}

// Also handle GET for share targets that use GET method
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const text = searchParams.get('text') || '';
  const url = searchParams.get('url') || '';
  const title = searchParams.get('title') || '';

  const rawContent = url || text;

  if (!rawContent.trim()) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  await createSignal({
    rawContent,
    channel: 'SHARE_SHEET',
  });

  return NextResponse.redirect(
    new URL(`/?shared=success`, request.url)
  );
}
