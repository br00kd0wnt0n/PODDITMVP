# CLAUDE.md — Poddit Development Guide

## What is Poddit?

Poddit is an AI-powered personal podcast app that captures curiosity signals (links, topics, voice notes) throughout the week and compresses them into a weekly audio episode. It's a cognitive compression tool for leaders, strategists, and multi-interest professionals who need synthesis, not more content.

**Core loop:** Capture → Queue → Synthesize → Speak → Deliver

**Domains:** `app.poddit.com` (app), `www.poddit.com` (concept/landing page)

## Architecture

```
/poddit
├── prisma/schema.prisma     # Data model (User, Signal, Episode, Segment, Feedback, QuestionnaireResponse)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── capture/      # Ingest endpoints (SMS, email, extension, share, quick)
│   │   │   ├── generate/     # Manual episode generation trigger
│   │   │   ├── generate-now/ # Dashboard-triggered generation with signal selection
│   │   │   ├── episodes/     # Episode listing and retrieval
│   │   │   ├── signals/      # Signal queue management
│   │   │   ├── feedback/     # User feedback (text + voice + request) submission
│   │   │   ├── admin/
│   │   │   │   ├── stats/    # Admin dashboard API (metrics, user management, PATCH user type)
│   │   │   │   └── invite/   # Grant/revoke access (POST invite, DELETE revoke)
│   │   │   ├── questionnaire/# Early access questionnaire (GET check, POST submit)
│   │   │   ├── user/preferences/ # User prefs, consent toggle, episode limit info
│   │   │   ├── cron/         # Weekly automated generation
│   │   │   └── voices/       # Voice listing and samples
│   │   ├── page.tsx          # Dashboard (queue + episodes + feedback + questionnaire modal)
│   │   ├── admin/            # Mission Control (admin dashboard)
│   │   ├── player/[id]/      # Episode player with segments + sources
│   │   ├── settings/         # User preferences (voice, length, name, phone, notifications)
│   │   ├── welcome/          # Capture channel guide + PWA install instructions
│   │   ├── usage/            # Episode usage progress + request more episodes
│   │   ├── auth/signin/      # Sign-in page with consent checkbox
│   │   ├── terms/            # Terms of Service (Heathen Digital LLC)
│   │   └── privacy/          # Privacy Policy (Heathen Digital LLC)
│   └── lib/
│       ├── capture.ts        # Signal ingestion, URL detection, content extraction
│       ├── synthesize.ts     # Episode generation orchestrator (Claude API)
│       ├── prompts.ts        # LLM system prompt and synthesis prompt builder
│       ├── tts.ts            # ElevenLabs TTS + S3 upload
│       ├── deliver.ts        # Twilio SMS notifications
│       ├── email.ts          # SendGrid outbound email (invite + revoke)
│       ├── auth.ts           # Auth helpers (requireSession, requireAuth, requireAdminAuth, requireCronAuth)
│       ├── auth-config.ts    # NextAuth config (Credentials provider, per-user invite codes + global fallback)
│       ├── rate-limit.ts     # In-memory sliding-window rate limiter (+ clearRateLimit helper)
│       ├── transcribe.ts     # OpenAI Whisper transcription
│       └── db.ts             # Prisma client singleton
├── extension/                # Chrome extension (capture from browser)
├── middleware.ts              # NextAuth route protection (root level, not in src/)
├── SETUP.md                  # Full deployment and service setup guide
└── .env.example              # All required environment variables
```

## Stack

- **Framework:** Next.js 14 (App Router, API Routes)
- **Database:** PostgreSQL via Prisma ORM (hosted on Railway)
- **AI:** Anthropic Claude API (claude-sonnet-4-5-20250929) for synthesis
- **TTS:** ElevenLabs (eleven_turbo_v2_5)
- **SMS:** Twilio (capture + delivery)
- **Email Inbound:** SendGrid Inbound Parse (signal capture via email)
- **Email Outbound:** SendGrid (@sendgrid/mail) for invite/revoke emails
- **Storage:** Cloudflare R2 (S3-compatible, for audio files)
- **Hosting:** Railway
- **Styling:** Tailwind CSS

## Data Model (Key Entities)

### User
- `userType`: MASTER (unlimited), EARLY_ACCESS (3 ep cap), TESTER (10 ep cap)
- `inviteCode`: unique per-user code for sign-in (generated on admin invite)
- `invitedAt` / `revokedAt`: invite lifecycle tracking
- `consentedAt` / `consentChannel`: timestamped consent record
- `episodeBonusGranted`: incremented by +3 on questionnaire completion
- Dynamic episode limit: `baseLimit + episodeBonusGranted` (MASTER = Infinity)

### Signal
- States: PENDING → QUEUED → ENRICHED → USED/SKIPPED/FAILED
- Channels: SMS, EMAIL, EXTENSION, SHARE_SHEET, API
- Types: LINK, TOPIC, VOICE, FORWARDED_EMAIL, CLIPBOARD
- Locked atomically via `$transaction` before generation (released on failure)

### Episode
- States: PENDING → SYNTHESIZING → GENERATING → READY/FAILED/ARCHIVED
- Contains Segments (per-topic sections with source attribution)

### Feedback
- Types: TEXT, VOICE, REQUEST (request = episode increase request from /usage)

### QuestionnaireResponse
- Milestone-based triggers (3, 6, 9...) with duplicate prevention per milestone
- Grants +3 bonus episodes on completion via `$transaction`

## Key Design Decisions

### Copyright Safety (CRITICAL)
Poddit treats captured links as **topic indicators**, NOT content to reproduce. The synthesis prompt instructs Claude to discuss topics across multiple sources and general knowledge, never to summarize or closely paraphrase any single article. This is a deliberate legal architecture — see the one-pager for full rationale. **Never change the prompts to summarize individual articles.**

### Auth System
- **NextAuth.js v5** with Credentials provider, JWT strategy
- **Per-user invite codes**: Admin grants access → unique 8-char code generated → sent via SendGrid email
- **Global access code fallback**: `ACCESS_CODE` env var still works for direct invites
- **Revoked users blocked**: `revokedAt` field checked on every sign-in attempt
- **Consent tracking**: `consentedAt` + `consentChannel` set on first sign-in
- Session/Account/VerificationToken Prisma models exist but are unused (JWT, not DB sessions)
- Middleware protects `/`, `/player/*`, `/settings`, `/welcome`, `/usage`

### Admin Access Management Flow
1. User signs up on `www.poddit.com` (PODDIT-CONCEPT) → stored in concept DB
2. Admin sees request in `/admin` Access Requests section (fetched cross-service)
3. Admin clicks **"Grant Access"** → unique invite code generated, branded email sent via SendGrid
4. User receives email → signs in at `app.poddit.com` with email + their unique code
5. Admin can **Revoke** from Users table → user blocked, notification email sent
6. Admin can **Restore** revoked users → new code generated, new invite sent
7. Admin can change user types (MASTER/EARLY_ACCESS/TESTER) via dropdown

### Episode Limits
- Per user type: MASTER=Infinity, EARLY_ACCESS=3, TESTER=10
- Dynamic: `baseLimit + episodeBonusGranted` (questionnaire unlocks +3)
- Preferences API returns -1 for unlimited, frontend checks `episodeLimit > 0`
- Enforced in both `/api/generate-now` and `/api/cron`

### Signal Processing Flow
1. Signal arrives via any channel → `createSignal()` in capture.ts
2. Links get async enrichment (fetch page, extract title/source/content)
3. Topics are marked as enriched immediately (synthesis handles research)
4. `generateEpisode()` locks signals atomically in a `$transaction` to prevent race conditions
5. Builds a structured prompt with copyright-safe instructions
6. Claude returns JSON with segments, sources, and summary (with truncation detection + validation)
7. Script goes to ElevenLabs for TTS → uploaded to R2 (both with retry + exponential backoff)
8. User notified via SMS with player link
9. On failure, signals are released back to QUEUED for retry

### Episode Structure
Episodes contain Segments (per-topic sections), each with source attribution. The player shows segment tabs, written content, and source cards linking back to original publishers. This drives traffic to sources rather than replacing them.

### Cross-Service Architecture
- **PODDIT** (app.poddit.com): Main app, Railway, PostgreSQL
- **PODDIT-CONCEPT** (www.poddit.com): Landing/concept page, separate Express server + PostgreSQL
- Admin stats route fetches access requests from PODDIT-CONCEPT **server-side** via `CONCEPT_API_URL` (runtime env var, no CORS issues)
- Both share the same `ADMIN_SECRET` for bearer token auth
- Concept page (www.poddit.com) is publicly accessible (no password gate)

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npx prisma studio    # Visual database browser
npx prisma db push   # Sync schema to database
npx prisma generate  # Regenerate Prisma client (needed after schema changes)
npx prisma migrate dev --name <description>  # Create migration
```

## Testing Capture Locally

```bash
# Capture a link via extension endpoint
curl -X POST http://localhost:3000/api/capture/extension \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.theverge.com/some-article", "title": "Test"}'

# Capture a topic
curl -X POST http://localhost:3000/api/capture/extension \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"text": "latest developments in AI agents"}'

# Check the queue
curl http://localhost:3000/api/signals

# Trigger generation
curl -X POST http://localhost:3000/api/generate \
  -H "Authorization: Bearer $API_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"daysBack": 7}'
```

## Priority Development Tasks

### Completed
- [x] Add basic loading/generating states to the web UI
- [x] Generate PWA icons from brand logo (icon-192.png, icon-512.png, apple-touch-icon)
- [x] Add "Generate Now" button to the web dashboard
- [x] Add ability to remove/edit signals in the queue from the UI
- [x] Add topic extraction/tagging via Claude (use ENRICHMENT_PROMPT in prompts.ts)
- [x] Dashboard text input + voice recording capture (via /api/capture/quick)
- [x] Test full capture → generate → play loop end-to-end
- [x] Chrome extension submitted to Web Store (unlisted)
- [x] SMS voice memo transcription (AMR → WAV → Whisper)
- [x] **Multi-user auth** — NextAuth.js v5 with access code login, per-user signals/episodes
- [x] **Settings / preferences page** — voice selection (4 voices), episode length, display name, phone
- [x] **Custom audio player** — styled controls, seek/volume bars with touch support
- [x] **Intro music** — 4s lead-in before narration, outro music overlay
- [x] **Voice attribution** — "Read by Gandalf" on episode page

### Sprint: Episode Polish (prompt + UX) ✅
- [x] **Personalized intro** — varied welcome line with date + signal count, user name when set, Poddit Now vs weekly framing
- [x] **Informal segment transitions** — natural bridging phrases woven into segment content, varied per episode
- [x] **Provocative outro** — subtle lingering thought, implied not stated, no explicit takeaway list
- [x] **Multi-source segments** — Claude instructed to synthesize 2-3+ sources per segment, sources array reflects all inputs
- [x] **Pronunciation hints** — inline phonetic cues for TTS-confusing proper nouns

### Sprint: Stability + Consistency ✅
- [x] Remove all hardcoded 'default' userId (schema + API routes)
- [x] Atomic signal locking in $transaction (prevent duplicate episodes)
- [x] Rollback signals to QUEUED on generation failure
- [x] Retry with exponential backoff (Claude API, ElevenLabs, S3)
- [x] maxDuration on generate-now (300s), generate (300s) and cron (600s) routes
- [x] Claude response truncation detection (stop_reason check)
- [x] JSON schema validation on Claude synthesis response
- [x] Bumped max_tokens 8000→12000
- [x] onDelete cascades (Signal→User, Episode→User, Signal→Episode)
- [x] Fixed amix volume normalization (weights parameter)
- [x] Converted all `<a>` to Next.js `<Link>` (7 instances, 5 pages)
- [x] Touch event support on player seek/volume bars
- [x] DB indexes (Signal.episodeId, Episode.generatedAt, Episode.status)
- [x] Fixed generatedAt to set on READY not creation
- [x] Fixed generate route to pass userId to notifyEpisodeReady
- [x] Fixed findFirst→findUnique on SMS + email capture routes
- [x] Exported getLastWeekStart from synthesize.ts, removed duplicate from cron
- [x] Added AUTH_SECRET + ACCESS_CODE to .env.example

### Sprint: Generation UX ("theatre") ✅
- [x] **Rotating status phrases** — cycle through phrases during generation
- [x] **Progress bar in button** — loading bar within Poddit Now button
- [x] **Signal roll-up animation** — per-signal staggered collapse with shrink/fade/translate
- [x] **Episode entrance animation** — blur-in + scale reveal for new episodes
- [x] **Glow pulse on generate button** — subtle breathing teal glow during generation

### Sprint: Brand & Design Polish ✅
- [x] **Glass P logo** — replaced across app, PWA icons, extension icons from logo2.png source
- [x] **Animated logo loop** — logo_loop.mp4 in dashboard header (curved square mask)
- [x] **Ambient background glow** — drifting bokeh orbs (5 unique CSS keyframes, 45-65s cycles, GPU-composited)
- [x] **Sign-in page hero** — large centered logo loop + title lockup, prominent bokeh + lens flare streaks
- [x] **Segment header glow** — warm teal/amber box-shadow on active segment tab in player
- [x] **Direct input card** — updated to "Type or speak below" with pencil + mic icons
- [x] **Chrome extension card** — "Coming soon" toast instead of GitHub link

### Sprint: Dashboard Animation & Transitions ✅
- [x] **Send Signals panel** — inner glow orbs (teal/amber) + fade-in-up entrance animation
- [x] **How It Works** — staggered entrances (teal→violet→amber), hover gradients, glowing number badges
- [x] **Sign-in → Dashboard transition** — page fade-out with blur on auth success, page-enter fade-in on dashboard
- [x] **Client-side auth guard** — useSession status check + redirect + skeleton loader (prevents dashboard flash)

### Sprint: Visual Hierarchy Rebalance ✅
- [x] **Dimmed info panels** — Send Signals + How It Works pushed to recessed layer (darker bg, softer borders, muted text)
- [x] **Elevated input field** — brighter border, taller padding, teal ambient glow, stronger focus ring
- [x] **Separate admin auth** — ADMIN_SECRET env var with API_SECRET fallback for Mission Control (/admin)

### Sprint: Early Access Readiness ✅
- [x] **Feedback model** — Prisma schema: Feedback table (TEXT/VOICE/REQUEST type, NEW/REVIEWED/RESOLVED status), User relation, cascade delete
- [x] **Rate limiter** — in-memory sliding-window (src/lib/rate-limit.ts) with periodic cleanup
- [x] **Feedback API** — POST /api/feedback for text (JSON) + voice (FormData → Whisper transcription), session-authed, rate-limited (5/min)
- [x] **Dashboard feedback module** — amber-accented "Early Access Feedback" section at bottom of dashboard (textarea + voice recording)
- [x] **Welcome overlay** — first-load modal with Poddit walkthrough (Capture→Generate→Listen) + feedback callout, localStorage persistence
- [x] **Welcome banner** — inline dismissible card for new users with empty queue/episodes
- [x] **Admin feedback section** — MetricCard + full feedback list in Mission Control (replaces placeholder)
- [x] **Rate limiting on routes** — capture/quick (10/min), generate-now (1/5min), feedback (5/min) per user
- [x] **Auto schema push** — `prisma db push` in build command for Railway deploys

### Sprint: Legal & Footer ✅
- [x] **Terms of Service** — /terms with 14 sections: IP ownership (Heathen Digital LLC), user content ownership, license grant, personal-use episodes, no redistribution, early access disclaimers, acceptable use, limitation of liability
- [x] **Privacy Policy rewrite** — /privacy updated for Heathen Digital LLC with expanded data collection, third-party services, voice handling, user rights
- [x] **Global footer** — root layout footer: © 2026 Heathen Digital LLC, Poddit™, Terms/Privacy/Contact links
- [x] **Contact email** — Hello@poddit.com across all legal pages and footer

### Sprint: UX Polish ✅
- [x] **Sign-in page** — replaced hardcoded "ask Brook" with generic invite message + Hello@poddit.com support link, added htmlFor/id label associations, autoComplete on email, role="alert" on error
- [x] **Chrome extension button** — converted from fake-click toast to visually disabled "Coming soon" state
- [x] **SMS desktop fallback** — detects mobile vs desktop, opens sms: or copies number to clipboard
- [x] **Player audio error** — onError handler with user-friendly message when audio fails to load
- [x] **Phone validation** — real-time E.164 regex check with red border + inline error text in settings
- [x] **Terms public access** — /terms added to middleware public routes alongside /privacy
- [x] **Settings mobile grids** — voice cards 1-col → sm:2-col, episode length 1-col → sm:3-col
- [x] **Welcome overlay** — removed gradient bar, font-display only on "PODDIT", my-auto centering

### Sprint: Security Hardening ✅
- [x] **Extension CORS** — restricted from `*` to only `chrome-extension://` origins, dynamic per-request
- [x] **Twilio signature verification** — SMS endpoint validates x-twilio-signature against TWILIO_AUTH_TOKEN, rejects spoofed requests
- [x] **Dashboard resilience** — Promise.all → Promise.allSettled so episodes and signals load independently
- [x] **Admin rate limiting** — 10 requests/min on /api/admin/stats to prevent expensive query spam
- [x] **Admin error sanitization** — removed error.message leak from admin stats response

### Sprint: Empty State Visual Overhaul ✅
- [x] **Ghost signals** — 3 animated placeholder cards in empty queue (topic with tags, URL with source, voice waveform bars). Active ghost cycles every 4s with breathing animation. Container fades out on first real signal (0.6s exit).
- [x] **Active step indicators** — How It Works cards are now a progress tracker: step 1 (Capture) glows teal when queue empty, step 2 (Generate) glows violet when signals exist, step 3 (Listen) glows amber when episode ready. Future steps dimmed to 40% opacity. Color-specific glow-pulse keyframes.
- [x] **Capture hero emphasis** — input bar floats higher in empty state with teal ambient glow, 5 cycling placeholder texts (3.5s interval) via animated overlay span, mic button pulses violet. All revert when first signal arrives.
- [x] **Ambient background boost** — 3 dashboard-local bokeh overlay orbs (teal/violet/amber) at higher opacity than layout.tsx base orbs. Fades out over 1s when content exists via transition-opacity.

### Sprint: P0 Pre-Launch ✅
- [x] **Consent tracking** — consentedAt + consentChannel on User, checkbox on sign-in, toggle in settings, stored on new user creation
- [x] **Episode caps by user type** — MASTER=unlimited, EARLY_ACCESS=3, TESTER=10. Dynamic limit with questionnaire bonus. Enforced in generate-now + cron
- [x] **User type management** — Admin can set MASTER/EARLY_ACCESS/TESTER via dropdown in /admin Users table
- [x] **Welcome/guidance page** — /welcome with capture channel instructions, PWA install guide, platform detection
- [x] **Usage page** — /usage with episode usage progress bar, signal count, "Request More Episodes" button (submits REQUEST feedback)
- [x] **Chrome extension update** — version 1.1.0, new branding
- [x] **Step card flash fix** — removed fade-in animation from step cards to prevent flash on load
- [x] **Welcome overlay centering** — fixed backdrop, overflow-y-auto with py-6, my-auto on modal

### Sprint: Early Access Questionnaire ✅
- [x] **QuestionnaireResponse model** — Prisma: userId, responses (JSON), milestone, createdAt
- [x] **Questionnaire API** — GET check (milestone-based trigger at 3, 6, 9...) + POST submit with +3 bonus in $transaction
- [x] **4-step questionnaire modal** — progress dots, validation, success animation, EARLY_ACCESS only
- [x] **Admin questionnaire section** — view all responses with full answer breakdown in Mission Control
- [x] **Duplicate prevention** — 409 if milestone already completed

### Sprint: Access Management ✅
- [x] **Per-user invite codes** — 8-char unique codes (no ambiguous chars), generated on admin invite
- [x] **SendGrid email integration** — @sendgrid/mail for branded invite + revoke emails from noreply@poddit.com
- [x] **Admin invite API** — POST /api/admin/invite (create user + send code), handles new/existing/revoked users
- [x] **Admin revoke API** — DELETE /api/admin/invite (set revokedAt, clear code, send notification)
- [x] **Auth accepts per-user codes** — invite code OR global ACCESS_CODE, revoked users blocked
- [x] **Grant Access button** — on Access Requests (from PODDIT-CONCEPT), sends branded invite email
- [x] **Revoke/Restore/Resend** — buttons in Users table with status column (Active/Invited/Revoked/Pending)
- [x] **Action toast** — success/error messages for invite and revoke operations
- [x] **Cross-service access requests** — admin sees PODDIT-CONCEPT signups with NDA status (server-side fetch, no CORS)
- [x] **BETA badge** — amber pill next to "PODDIT" in page header and welcome overlay
- [x] **Domain migration** — fallback URLs updated to app.poddit.com

### Sprint: Live Ops Fixes ✅
- [x] **Server-side concept fetch** — moved access request fetching from client-side (NEXT_PUBLIC_CONCEPT_API_URL) to server-side in /api/admin/stats (CONCEPT_API_URL, runtime env var, no CORS/rebuild issues)
- [x] **Twilio signature validation** — fixed for custom domain: uses TWILIO_WEBHOOK_URL (runtime) to construct validation URL instead of request.url (internal Railway URL)
- [x] **Phone number prompt** — users without a phone number see an inline prompt when tapping Text/Voice, with flexible input (auto-prepends +1 for 10-digit numbers), saves via preferences API then opens SMS
- [x] **Welcome overlay centering** — min-h-full flex wrapper with items-center + justify-center, outer container handles scroll overflow
- [x] **Dashboard polling** — refreshData runs every 10 seconds so SMS/extension signals appear without page refresh
- [x] **Generation timeout** — bumped generate-now maxDuration from 120s to 300s to prevent timeouts on slow connections
- [x] **Rate limit reset on failure** — added clearRateLimit() helper; generation failures now reset the 5-min cooldown so users can retry immediately
- [x] **Concept page password gate removed** — visitors can view landing page and submit access request form without entering a password

### Upcoming — P1 (Early Access → Pre-Launch)
- [ ] **Email / SMS strategy + sequence** — implement full engagement system: onboarding sequence (5 emails), weekly episode notification, mid-week queue nudge, queue-empty nudge, re-engagement (7/21/45 day). SendGrid now integrated for transactional email.
- [ ] **Subscription tier comparison component** — build frontend tier comparison table (Curious / Informed / Focused) for marketing site or in-app settings. Pricing: Free / $9/mo / $19/mo with annual −20%. Feature differentiation: episode limits, on-demand, voice options, platform sync. See `documents/Poddit Monetization Model.docx` §2.1
- [ ] **Cost & revenue tracker in Mission Control** — admin dashboard showing per-episode cost breakdown (TTS, Claude API, infra), episodes generated per user, blended cost per episode, projected revenue vs actual by tier. This is the operational heartbeat. See `documents/Poddit Monetization Model.docx` §1.1 for unit economics
- [ ] **Player page design pass** — bring same brand polish (bokeh, transitions, glow) to episode player
- [ ] **Settings page design pass** — visual refresh for settings/preferences page

### Upcoming — P2 (Post-Validation)
- [ ] **Contextual inline ad slots** — build infrastructure for inserting contextual ad segments into episodes and companion emails for free/Informed tiers. Needs: ad slot markers in the synthesis pipeline, topic-matching logic, audio or text ad injection. See `documents/Poddit Monetization Model.docx` §4 for ad formats and tier strategy
- [ ] **Signal archive** — used signals move to an archive view where users can review or re-queue them
- [ ] **Presets / always-include segments** — e.g., "Latest news roundup", "3 talking points", "Quote of the week"
- [ ] **Interest emphasis** — weight certain topics higher in synthesis

### Backlog
- [ ] Add error handling for TTS failures (fallback to text-only episode)
- [ ] Test PWA share sheet on iOS and Android
- [ ] Episode delete and share actions (player page + dashboard)
- [ ] Implement signal deduplication (same URL submitted twice)
- [ ] Add episode regeneration (re-run synthesis on same signals)
- [ ] Improve content extraction with readability libraries (like Mozilla's Readability)
- [ ] User profile/preference learning across episodes
- [ ] Proactive scouting tier (research topics without user signal)
- [ ] Cross-topic connection detection
- [ ] Episode analytics (which segments get replayed)
- [ ] Service worker for PWA offline support
- [ ] Audio player ARIA attributes for accessibility
- [ ] Monolithic page.tsx refactor (1250+ lines, 31 useState → extract components + hooks)
- [ ] Native iOS app (React Native or Swift)
- [ ] Apple Shortcuts integration (Poddit, Poddit This, Poddit Now) — see `documents/Poddit Pre-Launch Roadmap.docx` §3
- [ ] Platform API sync integrations (Reddit saved, Pocket/Instapaper, YouTube Watch Later) — see `documents/Poddit Pre-Launch Roadmap.docx` §2.2
- [ ] URL parser hardening (shortener resolution, platform-specific metadata) — see `documents/Poddit Pre-Launch Roadmap.docx` §2.4
- [ ] Enterprise / Team tier (shared signal pools, team synthesis) — see `documents/Poddit Monetization Model.docx` §6.2

### Known Issues
- `SignalStatus.PENDING` enum value is never written (orphaned but harmless)
- No service worker for PWA
- Audio player ARIA attributes still needed
- Monolithic page.tsx (1250+ lines)
- `Episode.signalCount` denormalization has no sync mechanism

### Reference Documents
Detailed strategy documents are in `/documents/` (git-ignored, not committed):
- `Poddit Pre-Launch Roadmap.docx` — IP protection, platform integrations, Siri shortcuts, email/SMS sequences, priority matrix
- `Poddit Monetization Model.docx` — unit economics ($2.75–4.50/episode), tier pricing, CAC/LTV targets, ad strategy, revenue projections

## Environment Variables

See `.env.example` for all required variables. Critical ones:
- `DATABASE_URL` — Railway provides this automatically
- `AUTH_SECRET` — NextAuth.js session signing (generate with `openssl rand -base64 32`)
- `ACCESS_CODE` — Global login access code (fallback for per-user invite codes)
- `ANTHROPIC_API_KEY` — For synthesis
- `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` — For TTS
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` — For SMS
- `S3_*` variables — For audio file storage
- `API_SECRET` — Shared secret for extension + generate endpoints
- `ADMIN_SECRET` — Admin dashboard auth (falls back to API_SECRET)
- `CRON_SECRET` — Secret for automated weekly generation
- `SENDGRID_API_KEY` — For outbound invite/revoke emails
- `SENDGRID_FROM_EMAIL` — Verified sender (default: noreply@poddit.com)
- `NEXT_PUBLIC_APP_URL` — App URL (build-time, default: https://app.poddit.com)
- `CONCEPT_API_URL` — PODDIT-CONCEPT server URL (server-side, runtime, for cross-service admin)
- `TWILIO_WEBHOOK_URL` — Public app URL for Twilio signature validation (server-side, runtime, e.g. https://app.poddit.com)

## Code Style

- TypeScript throughout (strict mode)
- Async/await, no callbacks
- Prisma for all database access (no raw SQL)
- Error handling: try/catch with meaningful error messages logged
- Console.log with `[Module]` prefix (e.g., `[SMS]`, `[TTS]`, `[Poddit]`, `[Auth]`, `[Admin]`, `[Email]`)
