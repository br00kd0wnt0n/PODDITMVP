// ──────────────────────────────────────────────
// In-memory sliding-window rate limiter
// Suitable for single-instance deployments (≤50 users)
// ──────────────────────────────────────────────

interface RateLimitEntry {
  timestamps: number[];
}

const store = new Map<string, RateLimitEntry>();

// Periodic cleanup — prevent memory growth from stale keys
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store) {
      entry.timestamps = entry.timestamps.filter(t => now - t < 600_000);
      if (entry.timestamps.length === 0) store.delete(key);
    }
  }, 60_000);
}

/**
 * Check if a request is allowed under the rate limit.
 *
 * @param key - Unique identifier (e.g., "capture:userId")
 * @param maxRequests - Max requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { allowed, retryAfterMs }
 */
export function rateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterMs: number } {
  const now = Date.now();
  const entry = store.get(key) || { timestamps: [] };

  // Remove timestamps outside the window
  entry.timestamps = entry.timestamps.filter(t => now - t < windowMs);

  if (entry.timestamps.length >= maxRequests) {
    const oldestInWindow = entry.timestamps[0];
    const retryAfterMs = windowMs - (now - oldestInWindow);
    return { allowed: false, retryAfterMs };
  }

  entry.timestamps.push(now);
  store.set(key, entry);
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Clear all rate limit entries for a key.
 * Useful for resetting after a failed attempt so the user can retry.
 */
export function clearRateLimit(key: string): void {
  store.delete(key);
}
