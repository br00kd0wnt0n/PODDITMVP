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

### Single-User MVP
The current architecture defaults `userId` to `"default"` everywhere. The schema supports multi-user (userId fields exist on all models), but auth is not implemented yet. The API_SECRET env var provides basic protection for the extension and generate endpoints.

### Signal Processing Flow
1. Signal arrives via any channel → `createSignal()` in capture.ts
2. Links get async enrichment (fetch page, extract title/source/content)
3. Topics are marked as enriched immediately (synthesis handles research)
4. `generateEpisode()` pulls all QUEUED/ENRICHED signals for the period
5. Builds a structured prompt with copyright-safe instructions
6. Claude returns JSON with segments, sources, and summary
7. Script goes to ElevenLabs for TTS → uploaded to R2
8. User notified via SMS with player link

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

### Immediate (get to usable MVP)
- [ ] Test full capture → generate → play loop end-to-end
- [ ] Add error handling for TTS failures (fallback to text-only episode)
- [x] Add basic loading/generating states to the web UI
- [x] Generate PWA icons from brand logo (icon-192.png, icon-512.png, apple-touch-icon)
- [ ] Test PWA share sheet on iOS and Android
- [ ] Add Twilio webhook signature validation for security

### Near-term improvements
- [x] Add "Generate Now" button to the web dashboard
- [x] Add ability to remove/edit signals in the queue from the UI
- [ ] Implement signal deduplication (same URL submitted twice)
- [ ] Add episode regeneration (re-run synthesis on same signals)
- [ ] Improve content extraction with readability libraries (like Mozilla's Readability)
- [x] Add topic extraction/tagging via Claude (use ENRICHMENT_PROMPT in prompts.ts)
- [x] Dashboard text input + voice recording capture (via /api/capture/quick)

### Future phases (requires user accounts)
- [ ] Multi-user auth (NextAuth.js or Clerk)
- [ ] Voice selection — let users pick from a few ElevenLabs voice options in their settings
- [ ] User profile/preference learning across episodes
- [ ] Proactive scouting tier (research topics without user signal)
- [ ] Cross-topic connection detection
- [ ] Episode analytics (which segments get replayed)
- [ ] Native iOS app (React Native or Swift)

## Environment Variables

See `.env.example` for all required variables. Critical ones:
- `DATABASE_URL` — Railway provides this automatically
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
