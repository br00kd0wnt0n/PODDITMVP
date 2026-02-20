# Poddit Master Plan

## Current State (Feb 2026)

**Core product:** Capture signals → synthesize weekly audio episode → deliver. Stable, in early access with ~10 users.

**Architecture:** Next.js 15 + PostgreSQL/Prisma + Claude API + ElevenLabs TTS + Twilio SMS + SendGrid + Cloudflare R2. Hosted on Railway.

### Technical Health Summary

| Area | Status | Risk |
|------|--------|------|
| Prompt token budget | ~4,500 of 12,000 used (~60% headroom) | LOW — room for Episode Callbacks + Research Planning |
| page.tsx monolith | 1,762 lines, ~41 useState, ~70 hooks | HIGH — every Phase 1-3 feature touches this file |
| Episodes API | Highlights query unbounded (all USED signals, every 30s poll) | MEDIUM — bloats for power users |
| Rate limiter | In-memory, single-instance, bypassed during Railway deploys | MEDIUM — needs Redis before autoscaling |
| Database indexes | Good primary coverage, missing `Episode[userId, status]` composite | LOW — slow after 100k episodes |
| Polling load | 30s interval, 3 parallel requests, 8,640 calls/user/day | LOW — fine for <50 users |

### page.tsx Decomposition Status

**Extracted (3 of 4 HIGH priority):**

| Component | Lines removed | State hooks moved |
|-----------|--------------|-------------------|
| CaptureInput.tsx | ~270 lines | 10 + 5 refs (text input, recording, typewriter) |
| EpisodeList.tsx | ~130 lines | 1 (expandedEpisodeId) |
| HighlightsPanel.tsx | ~84 lines | 0 (presentational) |
| **Total** | **~484 lines** | **11 hooks, 5 refs** |

**Remaining HIGH priority:**
- **SignalQueue** — deferred. Too tightly coupled to parent state (generating, selectedIds, progress, signalsCollapsing, phone prompt, generate button). Needs 15+ props or Context provider. Better to extract when a feature touches the queue (Phase 1 or 2).

**Remaining MEDIUM priority (still inline):**
- QuestionnaireModal (~300 lines) — most isolated, minimal prop deps
- FeedbackModal (~110 lines) — standalone modal with recording flow
- Header (~50 lines) — account dropdown, navigation
- WelcomeBanner (~45 lines) — first-visit guidance
- SetupCard (~75 lines) — phone input, first-visit onboarding

---

## Dependency Graph

```
                    ┌─────────────────────────┐
                    │  11. Community (XL)      │
                    │  [DEFER - post PMF]      │
                    └────────┬────────────────┘
                             │ requires
                    ┌────────▼────────────────┐
                    │  10. Sharing (M)         │
                    │  public episodes + links │
                    └─────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │                   INTELLIGENCE LAYER                         │
  │                                                              │
  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐   │
  │  │ 5. Contradict│    │ 4. Adaptive  │    │ 3. Research  │   │
  │  │    (M/L)     │    │    Depth (M) │    │  Planning (M)│   │
  │  │  [DEFER]     │    │              │    │              │   │
  │  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘   │
  │         │ requires          │ requires          │            │
  │         ▼                   ▼                   │            │
  │  ┌──────────────┐    ┌──────────────┐           │            │
  │  │ 2. Interest  │    │ 1. Curiosity │◄──────────┘            │
  │  │  Graph (L)   │    │ Patterns (S) │   can use either       │
  │  │  [PHASE 4]   │    │ [PHASE 1]    │                        │
  │  └──────────────┘    └──────────────┘                        │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │                   CONTINUITY LAYER                           │
  │                                                              │
  │  ┌──────────────┐    ┌──────────────┐                        │
  │  │ 7. Mid-Week  │    │ 6. Episode   │                        │
  │  │  Nudge (M)   │    │ Callbacks (S)│                        │
  │  └──────┬───────┘    └──────────────┘                        │
  │         │ requires                     (independent)         │
  │         ▼                                                    │
  │  ┌──────────────┐                                            │
  │  │ 9. Email/SMS │                                            │
  │  │ Strategy (M) │                                            │
  │  └──────────────┘                                            │
  └──────────────────────────────────────────────────────────────┘

  ┌──────────────────────────────────────────────────────────────┐
  │                   ENGAGEMENT LAYER                           │
  │                                                              │
  │  ┌──────────────┐    ┌──────────────┐                        │
  │  │ 8. Signal    │    │ 9. Email/SMS │                        │
  │  │ Friction (S) │    │ Strategy (M) │                        │
  │  │ (indep.)     │    │              │                        │
  │  └──────────────┘    └──────────────┘                        │
  └──────────────────────────────────────────────────────────────┘
```

---

## Pre-Phase 1: Episode Epilogue — Size: S (~1 day) ✅

**What:** A fixed-format spoken epilogue appended after the outro, with its own sound bed. Reinforces trust, differentiation, and transparency without sounding like a disclaimer.

**Template:**
> "This episode was created for you on [DATE]. Poddit analyzed the signals you captured and conducted independent research across multiple perspectives. Sources referenced in this briefing include reporting from [Source A], [Source B], and [Source C]. You can explore the complete list of sources on your episode page."

**Key design decisions:**
- **Not LLM-generated** — fixed template assembled in code with dynamic data. Zero extra tokens, consistent tone, no risk of Claude making it sound like a compliance warning.
- **Dynamic elements:** date (from generation), top 3 source publications (deduplicated by name from validated segment sources)
- **Separate audio segment** — epilogue is TTS'd independently, mixed with its own sound bed (`Poddit_Epilogue.mp3`), then concatenated after the main episode with a 1.5s gap. The outro music completes fully before the epilogue begins.
- **Graceful fallback:** If epilogue TTS or mixing fails, episode plays without epilogue. If no named sources, omits the sources sentence.

**Audio pipeline:**
1. Main narration TTS'd → mixed with intro/outro music (unchanged)
2. Epilogue TTS'd separately → mixed with epilogue sound bed (volume 0.18)
3. Concatenated via ffmpeg: main + 1.5s silence + epilogue

**Files:** `src/lib/synthesize.ts` (buildFullScript returns `{ main, epilogue }`), `src/lib/tts.ts` (generateAudio, mixEpilogue, concatenateWithGap), `public/audio/Poddit_Epilogue.mp3`

**Status:** COMPLETE

---

## Pre-Phase 1: Briefing Style Preference — Size: S (~1 day) ✅

**What:** Three briefing styles — Essential (3-5 min), Standard (7-10 min), Strategic (10-15 min) — that change episode structure, depth, and length via prompt instructions. Replaces the old Episode Length setting.

**Key decisions:**
- **Prompt-driven, not schema-driven** — keeps existing JSON schema (title, intro, segments, summary, connections, outro) unchanged. No migration, no player rewrite, no pipeline changes.
- **Essential:** Fewer segments (2-4), bullet-heavy, skip connections, tight outro, fewer searches
- **Standard:** Current behavior (3-6 segments, moderate depth) — zero change for existing users
- **Strategic:** More segments (3-5), counterpoints + implications per theme, richer connections, decision prompts in outro, more searches
- **Backward compatible:** Missing `briefingStyle` defaults to `standard`. Old `episodeLength` values ignored when `briefingStyle` is set.

**Files:**
- `src/app/api/user/preferences/route.ts` — validation for `briefingStyle` enum
- `src/app/settings/page.tsx` — replaced Episode Length with Briefing Style cards
- `src/app/welcome/page.tsx` — updated customize description
- `src/lib/prompts.ts` — style-specific prompt sections per briefing style
- `src/lib/synthesize.ts` — reads + passes briefingStyle, stores in generationMeta

**Status:** COMPLETE

---

## Phase 1: "The Conversation" (Weeks 1-3)

**Goal:** Episodes feel like an ongoing conversation, not isolated briefings. Highest value-to-effort ratio.

### 1a. Episode Callbacks — Size: S (~2-3 days) ✅
**What:** If a user captures a signal about topic X and the last episode covered X, the next episode opens with a callback: "Last week we talked about the EU AI Act — well, there's been a development."

**Dependencies:** None — `Episode.topicsCovered[]` and `Episode.summary` already exist.

**Implementation:**
- Query last 3 episodes: `prisma.episode.findMany({ where: { userId, status: 'READY' }, take: 3, orderBy: { generatedAt: 'desc' }, select: { title, topicsCovered, summary } })`
- Added "PREVIOUS EPISODES" context section to `buildSynthesisPrompt` in `src/lib/prompts.ts` — formatted with episode title, date, topics, and summary
- Added "Continuity" guidance to `SYSTEM_PROMPT` — instructs Claude to weave callbacks naturally, keep to one sentence, frame as "Last week" / "Last time"
- Prompt guardrails: "reference only when genuinely relevant", "do NOT force callbacks or recap old content"
- Graceful degradation: section omitted entirely for new users with no prior episodes

**Token impact:** ~450 tokens (3 summaries × ~150 words). At $3/MTok = ~$0.0014 extra per episode. Negligible.

**Files:** `src/lib/prompts.ts`, `src/lib/synthesize.ts`

**Risk:** Claude might over-reference. Mitigated with clear prompt guardrails.

**Status:** COMPLETE

### 1b. Curiosity Patterns — Size: S/M (~1 week)
**What:** Server-side aggregation of signal topics over time. Surface temporal insights in the Highlights panel: "AI signals up 4x this month", "New interest: quantum computing."

**Dependencies:** None — builds on existing `Signal.topics[]` and `Signal.createdAt`.

**Implementation:**
- New endpoint: `GET /api/user/insights` — computes topic frequency by month, channel trends, volume changes
- Monthly buckets, top 3 trending topics, signal volume trend
- Update HighlightsPanel component (already extracted) with temporal insights
- Topic normalization: lowercase + alias mapping (existing client-side `t.trim().toLowerCase()` pattern needs to move server-side)

**Data layer options:**
- Start simple: computed queries, no new models needed
- Later: `UserInsight` model with monthly snapshots for performance

**Files:** New `src/app/api/user/insights/route.ts`, `src/app/components/HighlightsPanel.tsx`, `src/lib/prompts.ts` (feed insights into synthesis context)

**Risks:**
- Topic tags from Haiku not normalized ("AI" vs "artificial intelligence"). Need normalization step.
- Small signal counts make trends unreliable. Need minimum thresholds (5+ signals before showing trends).

### 1c. Signal Friction Reduction — Size: S (~3-5 days, parallel)
**What:** Make it easier to capture signals. Fix share sheet, create Apple Shortcuts.

**Dependencies:** None — fully independent.

**Implementation:**
- Test and fix PWA share sheet on iOS/Android (noted as untested in backlog)
- Create Apple Shortcuts (`.shortcut` files): "Poddit" (open app), "Poddit This" (share current page), "Poddit Now" (trigger generation)
- Add shortcuts download section to `/welcome` page
- Siri Shortcuts use extension auth model (email + invite code)

**Files:** `/welcome` page, shortcut files, potentially `/api/capture/share` fixes

**Risk:** iOS share sheet PWA targets are inconsistent. May need native app for reliable sharing long-term.

---

## Phase 2: "The Intelligence" (Weeks 3-7)

**Goal:** Synthesis gets smarter. Email infrastructure gets built. The product becomes proactive.

### 2a. Research Planning — Size: M (~1 week)
**What:** Claude examines interest history before synthesizing — knows what's new vs. background, merges related signals.

**Dependencies:** Feature 1a (Episode Callbacks context mechanism) + Feature 1b (topic history).

**Implementation:**
- Add user topic profile to synthesis prompt: "This user has been tracking AI for 3 months (47 signals). They're familiar with the basics — go deeper, focus on what's new."
- Signal deduplication: if two signals point to the same topic, merge into one richer segment
- Use `Episode.topicsCovered` history + signal topic frequency as context

**Files:** `src/lib/prompts.ts`, `src/lib/synthesize.ts`

**Risks:**
- Prompt bloat: system (~1,800) + synthesis (~750) + episode context (~450) + topic profile (~200) = ~3,200 tokens input. Still within budget but monitor.
- Regression risk: changing synthesis prompt affects every episode. Need rollback plan.
- Over-optimization: with 3-10 signals per episode, merging may reduce segment count below useful thresholds.

### 2b. Email/SMS Strategy — Size: M/L (~2 weeks)
**What:** Three sequences: onboarding (5 emails), weekly rhythm (episode notification, mid-week preview, quiet encouragement), re-engagement (7/21/45 day).

**Dependencies:** SendGrid already integrated for transactional email.

**Implementation:**
- **Sequence 1:** Onboarding (signup → first signal → first episode → 3d quiet → 7d quiet)
- **Sequence 2:** Weekly rhythm (episode ready, mid-week queue preview, quiet week nudge)
- New module: `src/lib/email-sequences.ts` with sequence definitions, trigger logic, deduplication
- New daily cron job (current cron is weekly)
- Add `lastActiveAt DateTime?` to User (updated on signal capture or episode play)
- Add `emailPreferences Json?` to User for per-sequence opt-out

**Data model:**
```prisma
model EmailEvent {
  id        String   @id @default(uuid())
  userId    String
  user      User     @relation(...)
  type      String   // "onboarding_1", "weekly_nudge", "reengagement_7d"
  channel   String   // "email", "sms"
  sentAt    DateTime @default(now())
  opened    Boolean  @default(false)
  clicked   Boolean  @default(false)
  @@index([userId, type])
}
```

**Files:** New `src/lib/email-sequences.ts`, new daily cron route, schema changes, `src/lib/email.ts` expansion

**Risks:**
- Deliverability: warm up volume gradually. noreply@poddit.com already verified.
- CAN-SPAM: one-click unsubscribe required. SendGrid provides this.
- Over-communication: SMS = capture + episode ready only. Email = everything else.
- SendGrid free tier = 100 emails/day. Fine for 10 users, need paid plan at scale.

### 2c. Adaptive Depth — Size: S/M (~3-5 days)
**What:** Adjust episode complexity based on user expertise. New users get broader explanations; experienced users get deeper analysis.

**Dependencies:** Feature 2a (Research Planning context mechanism).

**Implementation:**
- Heuristic: `totalSignals / monthsActive` = engagement level; per-topic signal count = topic expertise
- Prompt adjustment: expertise context per topic in synthesis prompt
- Optional: add "depth preference" to settings (explain more / go deeper / auto)

**Files:** `src/lib/prompts.ts`, optionally `src/app/settings/page.tsx`

**Risk:** Inferring expertise from capture frequency is imprecise. Consider episode ratings as a signal.

---

## Phase 3: "The Loop" (Weeks 7-12)

**Goal:** The flywheel spins — nudges bring users back, sharing brings new users in.

### 3a. Mid-Week Nudge — Size: M (~1 week)
**What:** Not "you haven't captured anything" but "you captured 4 signals — here's a thread forming between them."

**Dependencies:** Feature 1b (Curiosity Patterns) + Feature 2b (Email infrastructure).

**Implementation:**
- Wednesday cron: for each user with 3+ signals since last episode, compute topic clusters, generate 2-sentence teaser
- Start email-only (less intrusive than SMS)
- Teaser: lightweight Claude Haiku call with signal topics, OR deterministic template
- New `NudgeLog` model for dedup + tracking

**Data model:**
```prisma
model NudgeLog {
  id        String   @id @default(uuid())
  userId    String
  type      String   // "mid_week", "quiet_week", "re_engagement"
  channel   String   // "email", "sms"
  sentAt    DateTime @default(now())
  @@index([userId, type])
}
```

**Risk:** Nudges that miss the mark erode trust fast. Start with deterministic templates, graduate to LLM-generated teasers.

### 3b. Sharing — Size: M (~1.5 weeks)
**What:** Users set episodes public/unlisted. Share link to player with Poddit branding + signup CTA.

**Dependencies:** None for implementation, but core experience should be solid first.

**Implementation:**
- Add to Episode schema: `visibility String @default("private")`, `shareToken String? @unique`, `sharedAt DateTime?`
- New public route: `/share/[token]` (add to middleware public routes)
- Public player: simplified `/player/[id]` without auth, with Poddit branding + CTA
- Share button on player page + dashboard episode cards
- Dynamic OG meta tags (og:title, og:description, og:audio)
- Unlisted by default (share via link), not publicly discoverable

**Risks:**
- Copyright: synthesized content is topic-based (not reproduction), but public episodes are more visible.
- Audio hotlinking: consider signed URLs with expiry for public episodes.
- Privacy: clear UI warning before making episode public.

### 3c. Subscription Tier Comparison — Size: S (~3-5 days)
**What:** Frontend tier comparison table (Curious / Informed / Focused).

**Implementation:**
- Pricing: Free / $9/mo / $19/mo with annual -20%
- Feature differentiation: episode limits, on-demand generation, voice options, platform sync
- See `documents/Poddit Monetization Model.docx` §2.1

---

## Phase 4: "The Foundation" (Post-validation)

**Goal:** Build deeper intelligence once there is enough signal data across enough users.

### 4a. Interest Graph — Size: L (~3 weeks)
Start with tag-based co-occurrence clustering (no pgvector). Topics that frequently appear together form implicit clusters. 80% of the value, no new infra. Gate pgvector embeddings behind user volume threshold.

### 4b. Contradiction Surfacing — Size: M/L (~2 weeks)
Defer until vector embeddings exist and enough data to validate. False positives would feel annoying.

### 4c. Community — Size: XL (months)
Strongly defer. Post-PMF feature. Building now risks diluting Poddit's identity as a personal tool.

---

## Summary Table

| # | Feature | Size | Phase | Dependencies | Status |
|---|---------|------|-------|--------------|--------|
| 6 | Episode Callbacks | S | 1 | None | ✅ Complete |
| 1 | Curiosity Patterns | S/M | 1 | None | Ready to build |
| 8 | Signal Friction | S | 1 | None | Ready (parallel) |
| 3 | Research Planning | M | 2 | 1, 6 | After Phase 1 |
| 9 | Email/SMS Strategy | M/L | 2 | None | After Phase 1 |
| 4 | Adaptive Depth | S/M | 2 | 3 | After Research Planning |
| 7 | Mid-Week Nudge | M | 3 | 1, 9 | After email infra |
| 10 | Sharing | M | 3 | None | After core is solid |
| — | Subscription Tiers | S | 3 | None | Marketing component |
| 2 | Interest Graph | L | 4 | None | Tag-based first, vectors later |
| 5 | Contradiction | M/L | 4 | 2 | Defer |
| 11 | Community | XL | 4+ | 10 | Strongly defer |

---

## Infrastructure Fixes (Before/During Phase 1)

### P0 — Immediate
- [ ] **Highlights query limit** — re-add bounded query to `/api/episodes` highlights aggregation, or create lightweight `/api/episodes/highlights` endpoint
- [ ] **Clipboard writeText error handling** — add `.catch()` with fallback message (dashboard page.tsx)

### P1 — Before 100 users
- [ ] **Redis rate limiter** — replace in-memory `Map` with Redis-backed limiter
- [ ] **SignalQueue extraction** — deferred from initial refactor. Needs Context provider or 15+ props
- [ ] **Episode `[userId, status]` composite index** — episode count query does full scan
- [ ] **QuestionnaireModal extraction** (~300 lines) — most isolated remaining component

### P2 — Scale beyond 100 users
- [ ] **Server-sent events** — replace 30s polling with SSE for real-time updates
- [ ] **Cursor-based episode pagination** — frontend currently loads up to 50 episodes

---

## Completed Work

### Refactor: page.tsx Decomposition
- [x] CaptureInput.tsx extracted (318 lines, 10 hooks + 5 refs)
- [x] EpisodeList.tsx extracted (177 lines, 1 hook)
- [x] HighlightsPanel.tsx extracted (104 lines, presentational)
- page.tsx reduced from ~2,230 → ~1,762 lines (22% reduction)

### Auth Stability
- [x] Sign-in: `window.location.replace('/')` (prevents soft→hard reload cycle)
- [x] Dashboard auth guard: `wasAuthenticated` ref prevents BroadcastChannel echo redirect
- [x] SessionProvider excluded from `/auth/*` routes

### Previously Completed (from CLAUDE.md)
- [x] Cost tracker in Mission Control (revenue tracking deferred)
- [x] Player page design pass
- [x] Settings page design pass
- [x] URL parser hardening
- [x] Chrome Extension v1.2.0
- [x] Access management (per-user invite codes, SendGrid emails)
- [x] Security hardening (SSRF, revocation cache, TTS chunk overflow)

---

## Critical Files for Implementation

| File | Relevance |
|------|-----------|
| `src/lib/prompts.ts` | Central to Features 1, 3, 4, 5, 6. Every intelligence layer change flows through here. |
| `src/lib/synthesize.ts` | Episode generation orchestrator. Cross-episode context (6), signal dedup (3). |
| `src/app/page.tsx` | Dashboard. Highlights, generation UX, queue management. Still 1,762 lines. |
| `src/app/components/HighlightsPanel.tsx` | Curiosity Patterns UI (Feature 1). Already extracted. |
| `src/lib/email.ts` | Currently invite/revoke only. Expansion for sequences (Feature 9). |
| `prisma/schema.prisma` | Data model changes for EmailEvent, NudgeLog, Episode sharing. |
| `middleware.ts` | Public route additions for sharing (Feature 10). |

---

## Deployment Workflow

- **Always push to `staging` first**, verify, then promote to `main` (production)
- `main` = production (app.poddit.com)
- `staging` = staging (poddit-staging)
- Both deployed on Railway
