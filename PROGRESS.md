# Poddit Progress Log

Session continuity document. Captures decisions, implementation details, and gotchas that would be lost if a Claude session expires. The master plan lives in `plan.md`.

---

## Session: Feb 20, 2026

### Auth Guard Fix (pushed to both main + staging)
**Commit:** `170116c` — Fix post-login hard reload: auth guard race condition + hard navigation

**What was fixed:**
1. **Sign-in page** — changed `router.replace('/')` → `window.location.replace('/')`. The sign-in page has no SessionProvider (excluded in `providers.tsx`), so a client-side navigation caused Next.js to detect a React tree structure change and fall back to hard navigation anyway (double-load).
2. **Dashboard auth guard** — added `wasAuthenticated` ref in `page.tsx`. SessionProvider's BroadcastChannel triggers a second `_getSession()` after login, briefly flipping status to `'unauthenticated'`. Without the ref guard, this fired `router.replace('/auth/signin')`, middleware saw valid JWT, bounced back to `/` = full hard reload.

**Root cause diagnosis method:** Preserve Logs in Chrome DevTools revealed the exact sequence: login succeeds → dashboard mounts → BroadcastChannel echo → status blip → auth guard redirect → middleware bounce.

**Arc browser note:** Field-click reload on sign-in page observed in Arc browser but not confirmed on Chrome. Likely Arc-specific (tab management / boost features). Not pursuing.

**Deployment note:** Was accidentally pushed to `main` (production) instead of `staging`. Both branches synced via fast-forward. **Workflow rule: always push to staging first.**

---

### Episode Epilogue (pushed to staging)
**Feature:** Fixed-format spoken epilogue appended after episode outro.

**Template:**
> "This episode was created for you on [DATE]. Poddit analyzed the signals you captured and conducted independent research across multiple perspectives. Sources referenced in this briefing include reporting from [Source A], [Source B], and [Source C]. You can explore the complete list of sources on your episode page."

**Implementation details:**
- `buildEpilogue()` function in `src/lib/synthesize.ts` — not LLM-generated, zero token cost
- Collects unique source publication names from `episodeData.segments[].sources[].name`
- Picks first 3 unique names, formats with Oxford comma ("A, B, and C")
- Graceful fallback: if no named sources, omits the sources sentence entirely
- Date formatted with user's timezone preference (falls back to America/New_York)
- `buildFullScript()` updated to accept `{ timezone }` options and append epilogue after outro

**Audio architecture (updated):** Epilogue is now a fully separate audio segment:
1. Main narration TTS'd → mixed with intro/outro music as before (outro music completes fully)
2. Epilogue TTS'd separately via `ttsToBuffer()` → mixed with `Poddit_Epilogue.mp3` sound bed via `mixEpilogue()`
3. Concatenated via `concatenateWithGap()`: main episode + 1.5s silence + epilogue
4. Epilogue sound bed volume: 0.18 (slightly higher than main music at 0.14 — it's a quieter bed)

**Key functions added to `tts.ts`:**
- `ttsToBuffer(text, voiceId)` — extracted common TTS logic (was inline in generateAudio)
- `mixEpilogue(narrationBuffer)` — mixes epilogue narration with `Poddit_Epilogue.mp3`, trims to narration + 2s tail
- `concatenateWithGap(mainBuffer, epilogueBuffer, gapSeconds)` — ffmpeg adelay + amix for clean concatenation
- `getDurationFromBuffer(buffer)` — temp file probe helper

**`buildFullScript` return type changed:** Now returns `{ main: string, epilogue: string }` instead of a single string. The full script is still stored in the Episode record for reference (concatenated with `\n\n`).

**Graceful degradation:** If epilogue TTS or mixing fails at any point, the episode plays normally without it. Three fallback levels: (1) epilogue music missing → narration only, (2) epilogue mix fails → narration only, (3) epilogue TTS fails → no epilogue at all.

**Audio asset:** `Epilogue_ending.mp3` moved from `/public/` to `/public/audio/Poddit_Epilogue.mp3` for consistent naming.

**Decision:** Epilogue uses a fixed template (not LLM-generated) because:
- Consistent tone across all episodes
- Zero additional LLM tokens
- No risk of Claude making it sound like a disclaimer or apology
- Dynamic elements (date, sources) are available at generation time without LLM involvement

---

### page.tsx Decomposition Status
**3 of 4 HIGH priority components extracted.** page.tsx: 2,230 → 1,762 lines (22% reduction).

| Component | Status | Notes |
|-----------|--------|-------|
| CaptureInput.tsx | DONE | 318 lines, 10 hooks + 5 refs |
| EpisodeList.tsx | DONE | 177 lines, 1 hook |
| HighlightsPanel.tsx | DONE | 104 lines, presentational |
| SignalQueue | DEFERRED | Too coupled: generating, selectedIds, progress, signalsCollapsing, phone prompt, generate button. Needs 15+ props or Context. Extract when a Phase 1-2 feature touches the queue. |

**Remaining MEDIUM extractions (not started):** QuestionnaireModal (~300 lines), FeedbackModal (~110), Header (~50), WelcomeBanner (~45), SetupCard (~75).

---

### Master Plan Status
**Written to:** `plan.md`
**Current position:** Pre-Phase 1 epilogue complete. Next: Phase 1a Episode Callbacks.

**Phase summary:**
- Pre-Phase 1: Episode Epilogue — COMPLETE
- Phase 1a: Episode Callbacks (highest ROI, ~2-3 days) — NEXT
- Phase 1b: Curiosity Patterns (~1 week)
- Phase 1c: Signal Friction Reduction (~3-5 days, parallel)
- Phase 2: Research Planning + Email/SMS + Adaptive Depth
- Phase 3: Mid-Week Nudge + Sharing + Subscription Tiers
- Phase 4: Interest Graph + Contradiction + Community (post-validation)

**Infrastructure fixes needed before/during Phase 1:**
- Highlights query unbounded (P0)
- Clipboard writeText error handling (P0)
- Redis rate limiter (P1, before 100 users)
