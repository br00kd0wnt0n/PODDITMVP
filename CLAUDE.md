# CLAUDE.md — Poddit Development Guide

## What is Poddit?

Poddit is an AI-powered personal podcast app that captures curiosity signals (links, topics, voice notes) throughout the week and compresses them into a weekly audio episode. It's a cognitive compression tool for leaders, strategists, and multi-interest professionals who need synthesis, not more content.

**Core loop:** Capture → Queue → Synthesize → Speak → Deliver

## Architecture

```
/poddit
├── prisma/schema.prisma     # Data model (Signal, Episode, Segment)
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── capture/     # Ingest endpoints (SMS, email, extension, share)
│   │   │   ├── generate/    # Manual episode generation trigger
│   │   │   ├── episodes/    # Episode listing and retrieval
│   │   │   ├── signals/     # Signal queue management
│   │   │   └── cron/        # Weekly automated generation
│   │   ├── page.tsx         # Dashboard (queue + episode list)
│   │   └── player/[id]/     # Episode player with segments + sources
│   └── lib/
│       ├── capture.ts       # Signal ingestion, URL detection, content extraction
│       ├── synthesize.ts    # Episode generation orchestrator (Claude API)
│       ├── prompts.ts       # LLM system prompt and synthesis prompt builder
│       ├── tts.ts           # ElevenLabs TTS + S3 upload
│       ├── deliver.ts       # Twilio SMS notifications
│       └── db.ts            # Prisma client singleton
├── extension/               # Chrome extension (capture from browser)
├── SETUP.md                 # Full deployment and service setup guide
└── .env.example             # All required environment variables
```

## Stack

- **Framework:** Next.js 15 (App Router, API Routes)
- **Database:** PostgreSQL via Prisma ORM (hosted on Railway)
- **AI:** Anthropic Claude API (claude-sonnet-4-5-20250929) for synthesis
- **TTS:** ElevenLabs (eleven_turbo_v2_5)
- **SMS:** Twilio (capture + delivery)
- **Email:** SendGrid Inbound Parse
- **Storage:** Cloudflare R2 (S3-compatible, for audio files)
- **Hosting:** Railway
- **Styling:** Tailwind CSS

## Key Design Decisions

### Copyright Safety (CRITICAL)
Poddit treats captured links as **topic indicators**, NOT content to reproduce. The synthesis prompt instructs Claude to discuss topics across multiple sources and general knowledge, never to summarize or closely paraphrase any single article. This is a deliberate legal architecture — see the one-pager for full rationale. **Never change the prompts to summarize individual articles.**

### Multi-User Auth
NextAuth.js v5 with Credentials provider (access code login). JWT strategy — Session/Account/VerificationToken Prisma models exist but are unused. Middleware protects `/`, `/player/*`, `/settings`. All API endpoints use `requireSession()` for session-based auth with userId filtering. Capture routes (SMS, email) look up users by phone/email. Extension requires explicit `userId` in body.

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

## Development Commands

```bash
npm run dev          # Start dev server
npm run build        # Production build
npx prisma studio    # Visual database browser
npx prisma db push   # Sync schema to database
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
- [x] maxDuration on generate (300s) and cron (600s) routes
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

### Upcoming
- [ ] **Chrome extension update** — update extension with new glass P branding, publish to Web Store
- [ ] **Signal archive** — used signals move to an archive view where users can review or re-queue them
- [ ] **Presets / always-include segments** — e.g., "Latest news roundup", "3 talking points", "Quote of the week"
- [ ] **Interest emphasis** — weight certain topics higher in synthesis
- [ ] **Player page design pass** — bring same brand polish (bokeh, transitions, glow) to episode player
- [ ] **Settings page design pass** — visual refresh for settings/preferences page

### Backlog
- [ ] Add error handling for TTS failures (fallback to text-only episode)
- [ ] Test PWA share sheet on iOS and Android
- [ ] Add Twilio webhook signature validation for security
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
- [ ] Monolithic page.tsx refactor (870+ lines → extract components)
- [ ] Native iOS app (React Native or Swift)

## Environment Variables

See `.env.example` for all required variables. Critical ones:
- `DATABASE_URL` — Railway provides this automatically
- `AUTH_SECRET` — NextAuth.js session signing (generate with `openssl rand -base64 32`)
- `ACCESS_CODE` — Login access code for Credentials provider
- `ANTHROPIC_API_KEY` — For synthesis
- `ELEVENLABS_API_KEY` + `ELEVENLABS_VOICE_ID` — For TTS
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER` — For SMS
- `S3_*` variables — For audio file storage
- `API_SECRET` — Shared secret for extension + generate endpoints
- `CRON_SECRET` — Secret for automated weekly generation

## Code Style

- TypeScript throughout (strict mode)
- Async/await, no callbacks
- Prisma for all database access (no raw SQL)
- Error handling: try/catch with meaningful error messages logged
- Console.log with `[Module]` prefix (e.g., `[SMS]`, `[TTS]`, `[Poddit]`)
