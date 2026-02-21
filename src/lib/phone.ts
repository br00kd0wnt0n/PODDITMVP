// ──────────────────────────────────────────────
// Shared phone number normalization & validation
// Used by: page.tsx, WelcomeOnboarding.tsx, settings
// ──────────────────────────────────────────────

/**
 * Normalize a phone number input to E.164 format.
 * Auto-prepends country codes for common US/UK patterns.
 * Returns `{ formatted }` on success, `{ error }` on invalid input.
 */
export function normalizePhone(input: string): { formatted: string } | { error: string } {
  let formatted = input.trim().replace(/[\s\-\(\)\.]/g, '');

  // Auto-prepend +1 for bare 10-digit US numbers
  if (/^\d{10}$/.test(formatted)) formatted = `+1${formatted}`;
  // Accept 1XXXXXXXXXX → +1XXXXXXXXXX
  if (/^1\d{10}$/.test(formatted)) formatted = `+${formatted}`;
  // Auto-prepend +44 for UK numbers starting with 0 (e.g. 07911123456)
  if (/^0\d{10}$/.test(formatted)) formatted = `+44${formatted.slice(1)}`;
  if (/^44\d{10}$/.test(formatted)) formatted = `+${formatted}`;

  // Must be E.164 at this point
  if (!/^\+[1-9]\d{1,14}$/.test(formatted)) {
    return { error: 'Include your country code (e.g. +1 for US, +44 for UK)' };
  }

  return { formatted };
}

/**
 * Validate a phone number for display purposes (settings page inline check).
 * Looser than normalizePhone — just checks the basic E.164 pattern.
 */
export function isValidPhone(phone: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(phone);
}
