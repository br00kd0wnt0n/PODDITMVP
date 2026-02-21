import { NextRequest, NextResponse } from 'next/server';
import { requireCronAuth } from '@/lib/auth';
import { processEngagementForAllUsers } from '@/lib/engagement/engine';

export const maxDuration = 300; // 5 minutes

/**
 * Daily engagement cron — evaluates all users and sends eligible emails.
 *
 * POST /api/cron/engagement
 * Authorization: Bearer {CRON_SECRET}
 *
 * Scheduled daily via Railway cron.
 */
export async function POST(request: NextRequest) {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  try {
    console.log('[Cron] Starting daily engagement processing...');
    const result = await processEngagementForAllUsers();

    return NextResponse.json({
      success: true,
      processed: result.processed,
      emailsSent: result.emailsSent,
      errors: result.errors,
      details: result.details,
    });
  } catch (error) {
    console.error('[Cron] Engagement processing failed:', error);
    return NextResponse.json(
      { error: 'Engagement processing failed' },
      { status: 500 },
    );
  }
}
