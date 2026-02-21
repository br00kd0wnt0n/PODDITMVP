/**
 * Engagement feature flags.
 *
 * ENGAGEMENT_ENABLED (env var, default: "false")
 * When "false", all engagement emails are suppressed for real users.
 * Admin test sends bypass this flag.
 */

/**
 * Check if engagement emails are enabled for real users.
 * Set ENGAGEMENT_ENABLED=true in Railway env vars to activate.
 */
export function isEngagementEnabled(): boolean {
  return process.env.ENGAGEMENT_ENABLED === 'true';
}
