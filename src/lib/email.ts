import sgMail from '@sendgrid/mail';
import { withRetry } from './retry';

if (process.env.SENDGRID_API_KEY) {
  sgMail.setApiKey(process.env.SENDGRID_API_KEY);
}

const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || 'noreply@poddit.com';
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poddit.com';

// ──────────────────────────────────────────────
// SEND INVITE EMAIL
// ──────────────────────────────────────────────

export async function sendInviteEmail(params: {
  to: string;
  name?: string;
  inviteCode: string;
}) {
  const { to, name, inviteCode } = params;
  const greeting = name ? `Hi ${name}` : 'Hi there';
  const signInUrl = `${APP_URL}/auth/signin`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.5px;margin:0;">PODDIT</h1>
      <p style="color:#737373;font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:4px 0 0;">Your world, explained</p>
    </div>

    <!-- Card -->
    <div style="background-color:#171717;border:1px solid #262626;border-radius:12px;padding:32px 24px;">
      <p style="color:#d4d4d4;font-size:15px;line-height:1.6;margin:0 0 16px;">
        ${greeting},
      </p>
      <p style="color:#d4d4d4;font-size:15px;line-height:1.6;margin:0 0 24px;">
        You've been granted early access to Poddit. Use the code below to sign in and start turning your curiosity into personalised audio briefings.
      </p>

      <!-- Code box -->
      <div style="background-color:#0a0a0a;border:1px solid #2dd4bf33;border-radius:8px;padding:16px;text-align:center;margin-bottom:24px;">
        <p style="color:#737373;font-size:11px;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">Your access code</p>
        <p style="color:#2dd4bf;font-size:28px;font-weight:700;font-family:monospace;letter-spacing:2px;margin:0;">${inviteCode}</p>
      </div>

      <!-- CTA -->
      <div style="text-align:center;margin-bottom:24px;">
        <a href="${signInUrl}"
           style="display:inline-block;background-color:#2dd4bf;color:#0a0a0a;font-size:14px;font-weight:700;
                  text-decoration:none;padding:12px 32px;border-radius:10px;">
          Sign in to Poddit
        </a>
      </div>

      <p style="color:#737373;font-size:13px;line-height:1.6;margin:0;">
        Enter your email and the access code above to get started. Once signed in, check out the
        <a href="${APP_URL}/welcome" style="color:#2dd4bf;text-decoration:none;">Welcome Guide</a>
        for tips on capturing signals and getting the most out of your episodes.
      </p>
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px;">
      <p style="color:#525252;font-size:11px;margin:0;">
        Questions? Reply to this email or reach us at
        <a href="mailto:hello@poddit.com" style="color:#525252;">hello@poddit.com</a>
      </p>
    </div>

  </div>
</body>
</html>`;

  const text = `${greeting},

You've been granted early access to Poddit!

Your access code: ${inviteCode}

Sign in at: ${signInUrl}

Enter your email and the access code above to get started.

Questions? Reply to this email or reach us at hello@poddit.com`;

  try {
    await withRetry(
      () => sgMail.send({
        to,
        from: { email: FROM_EMAIL, name: 'Poddit' },
        subject: 'Your Poddit early access code',
        html,
        text,
      }),
      { attempts: 3, delayMs: 2000, label: `Email invite to ${to}` }
    );
    console.log(`[Email] Invite sent to ${to}`);
    return { success: true };
  } catch (error: any) {
    console.error('[Email] Failed to send invite after retries:', error?.response?.body || error);
    return { success: false, error: error?.message || 'Failed to send email' };
  }
}

// ──────────────────────────────────────────────
// SEND REVOKE EMAIL
// ──────────────────────────────────────────────

export async function sendRevokeEmail(params: {
  to: string;
  name?: string;
}) {
  const { to, name } = params;
  const greeting = name ? `Hi ${name}` : 'Hi there';

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">
    <div style="text-align:center;margin-bottom:32px;">
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.5px;margin:0;">PODDIT</h1>
    </div>
    <div style="background-color:#171717;border:1px solid #262626;border-radius:12px;padding:32px 24px;">
      <p style="color:#d4d4d4;font-size:15px;line-height:1.6;margin:0 0 16px;">${greeting},</p>
      <p style="color:#d4d4d4;font-size:15px;line-height:1.6;margin:0;">
        Your early access to Poddit has been paused. If you believe this is a mistake, please reach out to us at
        <a href="mailto:hello@poddit.com" style="color:#2dd4bf;text-decoration:none;">hello@poddit.com</a>.
      </p>
    </div>
  </div>
</body>
</html>`;

  const text = `${greeting},\n\nYour early access to Poddit has been paused. If you believe this is a mistake, please reach out to us at hello@poddit.com.`;

  try {
    await withRetry(
      () => sgMail.send({
        to,
        from: { email: FROM_EMAIL, name: 'Poddit' },
        subject: 'Poddit access update',
        html,
        text,
      }),
      { attempts: 3, delayMs: 2000, label: `Email revoke to ${to}` }
    );
    console.log(`[Email] Revoke notice sent to ${to}`);
    return { success: true };
  } catch (error: any) {
    console.error('[Email] Failed to send revoke notice after retries:', error?.response?.body || error);
    return { success: false, error: error?.message || 'Failed to send email' };
  }
}

// ──────────────────────────────────────────────
// GENERATE UNIQUE INVITE CODE
// ──────────────────────────────────────────────

export function generateInviteCode(): string {
  // 8-char alphanumeric code, easy to type
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1 to avoid confusion
  let code = '';
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 8; i++) {
    code += chars[bytes[i] % chars.length];
  }
  return code;
}
