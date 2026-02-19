# Poddit Security Audit Report

**Date:** February 2026
**Scope:** Full codebase sweep — auth, API routes, data handling, config, infrastructure
**Methodology:** Manual code review targeting patterns common in rapid/"vibe coding" development

---

## Executive Summary

Poddit's security posture is **solid for an early-access product**. The codebase already has session auth, admin bearer tokens, rate limiting, SSRF protection, input validation, and Twilio signature verification. However, there are several findings that should be addressed before scaling beyond early access.

**Critical:** 2 | **High:** 5 | **Medium:** 4 | **Low:** 5

---

## CRITICAL

### 1. Voice Sample Endpoint Has No Rate Limit or Auth

**File:** `src/app/api/voices/sample/route.ts`
**Risk:** Financial — each request generates an ElevenLabs TTS call (~$0.005 per sample). The endpoint has zero auth and zero rate limiting. An attacker can enumerate all voice keys and spam requests to burn through ElevenLabs quota/credits.

**Mitigation:** The endpoint does check R2 for cached samples first, so repeat requests for the same voice are cheap. But first-time requests (or requests with cache misses) hit ElevenLabs directly.

**Fix:**
```typescript
// Add at top of GET handler:
const { allowed } = rateLimit('voice-sample', 20, 60_000); // 20/min global
if (!allowed) {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}
```

Also consider requiring session auth since only logged-in users visit the settings page.

---

### 2. Episodes API Has No Pagination (Unbounded Query)

**File:** `src/app/api/episodes/route.ts` (line 47)
**Risk:** Performance / DoS — the episodes list query has no `take` limit. MASTER users with many episodes return all episodes with joined signals data, polled every 30 seconds from the dashboard. This will degrade as the product grows.

**Note:** Pagination was previously removed so Highlights could aggregate all episodes. The Highlights panel needs topic/channel data from all episodes.

**Fix:** Create a separate lightweight `/api/episodes/highlights` endpoint that returns only aggregated topic counts and channel stats (no full episode objects). Then re-add `take: 30` to the main episodes list with cursor-based pagination.

---

## HIGH

### 3. Error Messages Leak Internal Details

**Files:**
- `src/app/api/episodes/rate/route.ts` lines 90-91: `error.message || 'Failed to submit rating'`
- `src/app/api/feedback/route.ts` lines 111-112: `error.message || 'Failed to submit feedback'`
- `src/app/api/capture/quick/route.ts` lines 103-104: `error.message || 'Capture failed'`

**Risk:** Information disclosure — Prisma errors, network errors, and system errors can contain database schema details, connection strings, or internal paths. These leak to the client via `error.message`.

**Fix:** Replace all instances of `error.message || 'fallback'` with just the static fallback string. The real error is already logged server-side with `console.error`.

```typescript
// BAD:
{ error: error.message || 'Failed to submit rating' }

// GOOD:
{ error: 'Failed to submit rating' }
```

---

### 4. Episode Cap Has TOCTOU Race Condition

**File:** `src/app/api/generate-now/route.ts` (lines 32-46)
**Risk:** Integrity — the episode count check and episode creation are not atomic. Two simultaneous requests could both pass the count check and create episodes, exceeding the cap. The 5-minute rate limit makes this unlikely but not impossible (e.g., if rate limit resets between requests or during a deploy when in-memory state is lost).

**Fix:** Add a unique constraint or use a database-level check. Alternatively, wrap the count check + episode creation in a Prisma `$transaction` with serializable isolation, or use an advisory lock.

---

### 5. Admin Secret Stored in sessionStorage

**File:** `src/app/admin/page.tsx`
**Risk:** XSS amplification — the admin page prompts for the ADMIN_SECRET and stores it in `sessionStorage`. If any XSS vulnerability exists anywhere in the app, the attacker can read `sessionStorage` and gain full admin access (user management, access granting/revoking, cost data, all user PII).

**Note:** `sessionStorage` is better than `localStorage` (cleared on tab close), but still readable by any JS on the page.

**Fix (short-term):** Accept this risk for now since the admin page is a single-user tool and XSS attack surface is minimal (no user-generated HTML rendering).

**Fix (long-term):** Move admin auth to a server-side session (httpOnly cookie) so the secret is never exposed to client-side JS.

---

### 6. Admin Page HTML Served Without Auth

**File:** `middleware.ts` (line 12)
**Risk:** Information disclosure — the middleware explicitly skips auth for `/admin` routes (`if (pathname.startsWith('/admin')) return`). This means the full admin page JS bundle (including API endpoint paths, data structures, UI logic) is served to anyone. The API endpoints themselves are protected, but the page structure reveals the attack surface.

**Fix:** Add admin middleware check or move admin behind a server-side auth gate. At minimum, the middleware should require a valid session before serving admin pages.

---

### 7. In-Memory Rate Limiter Resets on Deploy

**File:** `src/lib/rate-limit.ts`
**Risk:** Bypass — the sliding-window rate limiter is in-memory. It resets on every deploy, and if Railway autoscales or does zero-downtime deploys, each instance has its own independent rate limit state.

**Impact:** An attacker timing requests around deploys bypasses all rate limits. The 5-minute generation cooldown is particularly important since each generation costs ~$3-5.

**Fix (short-term):** Acceptable for early access with single-instance Railway deployment.

**Fix (long-term):** Move rate limiting to Redis (Upstash Redis is ~$0/mo for low volume, integrates with Railway).

---

## MEDIUM

### 8. Timing-Unsafe Secret Comparison

**File:** `src/lib/auth.ts` (lines 74, 88, 100)
**Risk:** Theoretical timing attack — all secret comparisons use `===` which can leak secret length/prefix through timing differences. Practical exploitation is extremely unlikely over network (latency noise dwarfs timing differences).

**Fix:**
```typescript
import crypto from 'crypto';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
```

---

### 9. No Security Headers in Next.js Config

**File:** `next.config.js`
**Risk:** Missing defense-in-depth headers. The config has no custom headers, so the app is missing:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Strict-Transport-Security` (HSTS)
- `Content-Security-Policy` (CSP)
- `Referrer-Policy: strict-origin-when-cross-origin`

**Fix:**
```javascript
const nextConfig = {
  images: { remotePatterns: [] },
  async headers() {
    return [{
      source: '/(.*)',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        { key: 'X-DNS-Prefetch-Control', value: 'on' },
        { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
      ],
    }];
  },
};
```

---

### 10. Signals Delete is Non-Atomic (Find-Then-Delete)

**File:** `src/app/api/signals/route.ts` (lines 88-98)
**Risk:** Race condition — `findFirst` then `delete` on separate queries. Two concurrent delete requests for the same signal could both find it, then one succeeds and the other throws a Prisma error (caught by try/catch, returns generic 500 instead of a clean 404).

**Fix:** Use `prisma.signal.deleteMany({ where: { id, userId } })` which returns a count. If count is 0, return 404.

```typescript
const result = await prisma.signal.deleteMany({ where: { id, userId } });
if (result.count === 0) {
  return NextResponse.json({ error: 'Signal not found' }, { status: 404 });
}
return NextResponse.json({ status: 'deleted' });
```

---

### 11. Clipboard writeText Has No Error Handling

**File:** `src/app/page.tsx`
**Risk:** UX failure — `navigator.clipboard.writeText()` is called without `.catch()`. Fails silently on non-HTTPS contexts or when clipboard permission is denied. Users think they copied the phone number but didn't.

**Fix:** Add `.catch()` with a fallback notification:
```typescript
navigator.clipboard.writeText(number).catch(() => {
  // Fallback: show the number in an alert or toast
});
```

---

## LOW

### 12. PII in Console Logs

**Files:** Multiple routes log user IDs, emails, and phone numbers:
- `src/app/api/feedback/route.ts` line 66: logs userId
- `src/app/api/admin/stats/route.ts` line 40: logs user email
- `src/app/api/episodes/rate/route.ts` line 81: logs userId + ratings
- `src/lib/capture.ts`: logs signal content

**Risk:** PII in logs could be problematic for GDPR/privacy compliance if logs are stored long-term or in third-party log services.

**Recommendation:** For early access this is fine (helps debugging). Before scaling, consider structured logging with PII redaction.

---

### 13. No Request Body Size Limits on JSON Endpoints

**Files:** Most API routes parse `request.json()` without checking body size.
**Risk:** A large JSON payload could consume memory. Next.js has a default body size limit (typically 1MB), but this is not explicitly configured.

**Recommendation:** Low risk since Next.js enforces defaults. Consider explicit `bodyParser: { sizeLimit: '100kb' }` for routes that expect small payloads (feedback, ratings, signals).

---

### 14. S3 Bucket Name Hardcoded as Fallback

**File:** `src/app/api/voices/sample/route.ts` (lines 36, 86)
**Risk:** If `S3_BUCKET` env var is missing, falls back to `'poddit-audio'`. This could cause writes to an unintended bucket if someone else registers that name.

**Recommendation:** Fail explicitly if `S3_BUCKET` is not set rather than using a fallback.

---

### 15. Feedback Voice Upload Has No File Size Check

**File:** `src/app/api/feedback/route.ts` (lines 44-48)
**Risk:** Voice recordings are read entirely into memory (`arrayBuffer()`) before processing. No file size validation. A large file could consume server memory.

**Fix:** Check `audioFile.size` before processing:
```typescript
if (audioFile.size > 10 * 1024 * 1024) { // 10MB max
  return NextResponse.json({ error: 'File too large (max 10MB)' }, { status: 413 });
}
```

---

### 16. No CSRF Protection on State-Changing Routes

**Risk:** Session-authed POST/DELETE routes (feedback, signals delete, generate, rate) rely on session cookies. Without CSRF tokens, a malicious site could trigger these actions if a user is logged in.

**Mitigating factors:**
- NextAuth.js sets `SameSite=Lax` on session cookies by default, which blocks cross-origin POST requests from most attack vectors
- All state-changing routes require JSON body parsing (`Content-Type: application/json`), which cannot be sent from a plain HTML form cross-origin

**Recommendation:** Low practical risk due to SameSite cookies + JSON content type requirement. No action needed for early access.

---

## Already Handled Well

These areas were reviewed and found to be properly secured:

- **SSRF Protection:** `isSafeUrl()` with DNS resolution + private IP blocklist, redirect following with re-validation
- **SQL Injection:** Prisma ORM used exclusively — no raw SQL anywhere
- **XSS:** React's default escaping + no `dangerouslySetInnerHTML` usage found
- **Auth on API Routes:** All user-facing routes use `requireSession()`, admin routes use `requireAdminAuth()`
- **Twilio Signature Verification:** SMS webhook validates `x-twilio-signature` with proper URL construction
- **Content Extraction:** URL fetching has content-type validation, 5MB size limit, streaming reader
- **Extension CORS:** Restricted to `chrome-extension://` origins only
- **Revocation Checks:** `revokedAt` checked on every session with 60s cache + admin cache invalidation
- **Enum Validation:** Signal status filter validated against whitelist before DB query
- **Error Sanitization:** Admin stats and generate-now routes return generic error messages

---

## Priority Remediation Order

| # | Finding | Effort | Impact |
|---|---------|--------|--------|
| 1 | Add rate limit + auth to voice sample endpoint | 5 min | Prevents cost abuse |
| 3 | Remove `error.message` leaks (3 files) | 5 min | Stops info disclosure |
| 10 | Atomic signal delete | 5 min | Cleaner error handling |
| 11 | Clipboard error handling | 2 min | Better UX |
| 15 | Voice upload file size check | 2 min | Memory protection |
| 9 | Add security headers to next.config.js | 10 min | Defense in depth |
| 14 | Remove S3 bucket fallback | 2 min | Explicit failure |
| 2 | Episodes pagination + highlights endpoint | 1 hr | Scalability |
| 6 | Admin page auth in middleware | 15 min | Reduces attack surface |
| 4 | Episode cap atomic check | 30 min | Integrity |
| 5 | Admin auth via httpOnly cookie | 2 hr | Long-term |
| 7 | Redis-based rate limiting | 1 hr | Scaling prep |
| 8 | Timing-safe secret comparison | 10 min | Theoretical |

---

*Quick wins (items 1, 3, 10, 11, 15, 14): ~20 minutes total, addresses 1 Critical + 1 High + 2 Medium + 2 Low.*
