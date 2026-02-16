// ──────────────────────────────────────────────
// Shared retry helper with exponential backoff
// Used by synthesize.ts, tts.ts, and anywhere
// transient API failures need automatic recovery
// ──────────────────────────────────────────────

export async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 1000, label = 'operation' }: { attempts?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLast = i === attempts - 1;
      const status = error?.status || error?.statusCode;
      const isRetryable = !status || status === 429 || status >= 500;

      if (isLast || !isRetryable) throw error;

      const wait = delayMs * Math.pow(2, i);
      console.log(`[Retry] ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts`);
}
