/**
 * Reusable HTML email template builder for engagement emails.
 * Extends the existing dark theme from email.ts.
 *
 * All emails follow the same branded shell:
 *   - Dark background (#0a0a0a)
 *   - Card-based content (#171717)
 *   - Teal accent (#2dd4bf)
 *   - Poddit header + tagline
 *   - Unsubscribe footer with category + global links
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.poddit.com';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface EmailTemplateOptions {
  /** Recipient's name (falls back to 'there') */
  name?: string | null;
  /** Email subject (used for text version header) */
  subject: string;
  /** Main HTML body content (inserted inside the card) */
  bodyHtml: string;
  /** Plain text version of the email body */
  bodyText: string;
  /** Unsubscribe token for this user */
  unsubscribeToken?: string;
  /** Category for targeted unsubscribe (e.g., 'nudges', 'discovery') */
  unsubscribeCategory?: string;
  /** Human-readable category name for footer (e.g., 'weekly nudges') */
  unsubscribeCategoryLabel?: string;
  /** Whether to show the CAN-SPAM footer (default: true) */
  showFooter?: boolean;
}

// ──────────────────────────────────────────────
// Shared style constants
// ──────────────────────────────────────────────

const STYLES = {
  bg: '#0a0a0a',
  card: '#171717',
  cardBorder: '#262626',
  text: '#d4d4d4',
  textMuted: '#737373',
  textDim: '#525252',
  accent: '#2dd4bf',
  accentBg: '#2dd4bf33',
  fontStack: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif",
} as const;

// ──────────────────────────────────────────────
// Template builder
// ──────────────────────────────────────────────

/**
 * Build a complete branded HTML email with unsubscribe footer.
 */
export function buildEmailHtml(options: EmailTemplateOptions): string {
  const {
    bodyHtml,
    unsubscribeToken,
    unsubscribeCategory,
    unsubscribeCategoryLabel,
    showFooter = true,
  } = options;

  const unsubFooter = showFooter && unsubscribeToken
    ? buildUnsubscribeFooterHtml(unsubscribeToken, unsubscribeCategory, unsubscribeCategoryLabel)
    : '';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Syne:wght@700;800&display=swap');
  </style>
</head>
<body style="margin:0;padding:0;background-color:${STYLES.bg};font-family:${STYLES.fontStack};">
  <div style="max-width:480px;margin:0 auto;padding:40px 24px;">

    <!-- Logo -->
    <div style="text-align:center;margin-bottom:32px;">
      <img src="${APP_URL}/logo.png" alt="Poddit" width="48" height="48" style="display:block;margin:0 auto 12px;border-radius:12px;" />
      <h1 style="color:#ffffff;font-size:28px;font-weight:800;letter-spacing:-0.5px;margin:0;font-family:'Syne',${STYLES.fontStack};">PODDIT</h1>
      <p style="color:${STYLES.textMuted};font-size:12px;letter-spacing:3px;text-transform:uppercase;margin:4px 0 0;">Your world, explained</p>
    </div>

    <!-- Card -->
    <div style="background-color:${STYLES.card};border:1px solid ${STYLES.cardBorder};border-radius:12px;padding:32px 24px;">
      ${bodyHtml}
    </div>

    <!-- Footer -->
    <div style="text-align:center;margin-top:24px;">
      <p style="color:${STYLES.textDim};font-size:11px;margin:0 0 8px;">
        Questions? Reply to this email or reach us at
        <a href="mailto:hello@poddit.com" style="color:${STYLES.textDim};">hello@poddit.com</a>
      </p>
      ${unsubFooter}
      <p style="color:${STYLES.textDim};font-size:10px;margin:8px 0 0;">
        Heathen Digital LLC
      </p>
    </div>

  </div>
</body>
</html>`;
}

/**
 * Build the plain text version of an email.
 */
export function buildEmailText(options: EmailTemplateOptions): string {
  const {
    bodyText,
    unsubscribeToken,
    unsubscribeCategory,
    unsubscribeCategoryLabel,
    showFooter = true,
  } = options;

  const lines = [bodyText, '', '---', 'Questions? hello@poddit.com'];

  if (showFooter && unsubscribeToken) {
    lines.push('');
    if (unsubscribeCategory && unsubscribeCategoryLabel) {
      lines.push(`Unsubscribe from ${unsubscribeCategoryLabel}: ${buildUnsubscribeUrl(unsubscribeToken, unsubscribeCategory)}`);
    }
    lines.push(`Unsubscribe from all: ${buildUnsubscribeUrl(unsubscribeToken, 'all')}`);
    lines.push(`Manage preferences: ${APP_URL}/settings`);
  }

  lines.push('', 'Heathen Digital LLC');

  return lines.join('\n');
}

// ──────────────────────────────────────────────
// Content helpers
// ──────────────────────────────────────────────

/** Paragraph */
export function p(text: string, style?: string): string {
  return `<p style="color:${STYLES.text};font-size:15px;line-height:1.6;margin:0 0 16px;${style || ''}">${text}</p>`;
}

/** Last paragraph (no bottom margin) */
export function pLast(text: string, style?: string): string {
  return `<p style="color:${STYLES.text};font-size:15px;line-height:1.6;margin:0;${style || ''}">${text}</p>`;
}

/** Muted paragraph */
export function pMuted(text: string): string {
  return `<p style="color:${STYLES.textMuted};font-size:13px;line-height:1.6;margin:0 0 16px;">${text}</p>`;
}

/** Primary CTA button */
export function ctaButton(text: string, url: string): string {
  return `<div style="text-align:center;margin:24px 0;">
  <a href="${url}"
     style="display:inline-block;background-color:${STYLES.accent};color:${STYLES.bg};font-size:14px;font-weight:700;
            text-decoration:none;padding:12px 32px;border-radius:10px;">
    ${text}
  </a>
</div>`;
}

/** Code box (for invite codes, etc.) */
export function codeBox(label: string, code: string): string {
  return `<div style="background-color:${STYLES.bg};border:1px solid ${STYLES.accentBg};border-radius:8px;padding:16px;text-align:center;margin:16px 0;">
  <p style="color:${STYLES.textMuted};font-size:11px;text-transform:uppercase;letter-spacing:2px;margin:0 0 8px;">${label}</p>
  <p style="color:${STYLES.accent};font-size:28px;font-weight:700;font-family:monospace;letter-spacing:2px;margin:0;">${code}</p>
</div>`;
}

/** Stat line (e.g., "12 signals captured") */
export function statLine(value: string | number, label: string): string {
  return `<span style="color:${STYLES.accent};font-weight:700;">${value}</span> <span style="color:${STYLES.textMuted};">${label}</span>`;
}

/** Topic pill list */
export function topicPills(topics: string[]): string {
  if (!topics.length) return '';
  const pills = topics.map(t =>
    `<span style="display:inline-block;background-color:#2dd4bf15;color:${STYLES.accent};font-size:12px;padding:4px 10px;border-radius:12px;margin:2px 4px 2px 0;">${t}</span>`
  ).join('');
  return `<div style="margin:12px 0;">${pills}</div>`;
}

/** Episode card (title, duration, topics, play link) */
export function episodeCard(episode: {
  title: string;
  duration?: number | null;
  topics?: string[];
  id: string;
}): string {
  const durationStr = episode.duration ? `${Math.round(episode.duration / 60)} min` : '';
  const meta = [durationStr, episode.topics?.slice(0, 3).join(', ')].filter(Boolean).join(' \u00b7 ');
  return `<div style="background-color:${STYLES.bg};border:1px solid ${STYLES.cardBorder};border-radius:8px;padding:16px;margin:16px 0;">
  <p style="color:#ffffff;font-size:16px;font-weight:700;margin:0 0 4px;">${episode.title}</p>
  ${meta ? `<p style="color:${STYLES.textMuted};font-size:12px;margin:0 0 12px;">${meta}</p>` : ''}
  ${ctaButton('Listen now', `${APP_URL}/player/${episode.id}`)}
</div>`;
}

/** Greeting line */
export function greeting(name?: string | null): string {
  return p(`${name ? `Hi ${name}` : 'Hi there'},`);
}

/** Link styled with accent color */
export function link(text: string, url: string): string {
  return `<a href="${url}" style="color:${STYLES.accent};text-decoration:none;">${text}</a>`;
}

// ──────────────────────────────────────────────
// Unsubscribe helpers
// ──────────────────────────────────────────────

export function buildUnsubscribeUrl(token: string, category: string): string {
  return `${APP_URL}/api/unsubscribe?token=${token}&category=${category}`;
}

function buildUnsubscribeFooterHtml(
  token: string,
  category?: string,
  categoryLabel?: string,
): string {
  const parts: string[] = [];

  if (category && categoryLabel) {
    parts.push(
      `<a href="${buildUnsubscribeUrl(token, category)}" style="color:${STYLES.textDim};text-decoration:underline;">Unsubscribe from ${categoryLabel}</a>`
    );
  }

  parts.push(
    `<a href="${buildUnsubscribeUrl(token, 'all')}" style="color:${STYLES.textDim};text-decoration:underline;">Unsubscribe from all</a>`
  );

  parts.push(
    `<a href="${APP_URL}/settings" style="color:${STYLES.textDim};text-decoration:underline;">Manage preferences</a>`
  );

  return `<p style="color:${STYLES.textDim};font-size:10px;margin:4px 0 0;">${parts.join(' &middot; ')}</p>`;
}
