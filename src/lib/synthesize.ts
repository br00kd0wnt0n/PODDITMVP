import Anthropic from '@anthropic-ai/sdk';
import prisma from './db';
import { SYSTEM_PROMPT, buildSynthesisPrompt } from './prompts';
import { generateAudio } from './tts';
import { withRetry } from './retry';
import { isSafeUrl } from './capture';

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// ──────────────────────────────────────────────
// EPISODE GENERATION
// ──────────────────────────────────────────────

export interface EpisodeData {
  title: string;
  intro: string;
  segments: {
    topic: string;
    content: string;
    sources: { name: string; url: string; attribution: string }[];
  }[];
  summary: string;
  connections: string;
  outro: string;
}

export async function generateEpisode(params: {
  userId: string;
  since?: Date;
  manual?: boolean;
  signalIds?: string[];
}): Promise<string> {
  const { userId } = params;

  if (!userId) {
    throw new Error('[Poddit] userId is required to generate an episode');
  }

  const since = params.since || getLastWeekStart();

  console.log(`[Poddit] Generating episode for ${userId}${params.signalIds ? ` (${params.signalIds.length} selected signals)` : ` since ${since.toISOString()}`}`);

  // Fetch user preferences for voice + name
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const preferences = (user?.preferences as Record<string, string>) || {};
  const voiceKey = preferences.voice || undefined;
  const userName = user?.name || undefined;
  const episodeLength = preferences.episodeLength || undefined;

  // 1. Gather signals and lock them atomically in a transaction
  //    This prevents duplicate episodes from concurrent generate requests.
  const statusFilter: ('QUEUED' | 'ENRICHED')[] = ['QUEUED', 'ENRICHED'];

  const { signals, episode } = await prisma.$transaction(async (tx) => {
    const foundSignals = params.signalIds && params.signalIds.length > 0
      ? await tx.signal.findMany({
          where: { id: { in: params.signalIds }, userId, status: { in: statusFilter } },
          orderBy: { createdAt: 'asc' },
        })
      : await tx.signal.findMany({
          where: { userId, status: { in: statusFilter }, createdAt: { gte: since } },
          orderBy: { createdAt: 'asc' },
        });

    if (foundSignals.length === 0) {
      throw new Error('No signals captured this period. Send some links or topics first!');
    }

    // Immediately mark signals as USED to prevent double-consumption
    const ep = await tx.episode.create({
      data: {
        userId,
        title: `Generating...`,
        script: '',
        periodStart: since,
        periodEnd: new Date(),
        signalCount: foundSignals.length,
        status: 'GENERATING',
      },
    });

    await tx.signal.updateMany({
      where: { id: { in: foundSignals.map(s => s.id) } },
      data: { status: 'USED', episodeId: ep.id },
    });

    return { signals: foundSignals, episode: ep };
  });

  console.log(`[Poddit] Processing ${signals.length} signals (locked to episode ${episode.id})`);

  try {
    // 3. Build the synthesis prompt (pass user prefs for personalization)
    const synthesisPrompt = buildSynthesisPrompt(
      signals.map(s => ({
        inputType: s.inputType,
        rawContent: s.rawContent,
        url: s.url,
        title: s.title,
        source: s.source,
        fetchedContent: s.fetchedContent,
        topics: s.topics,
      })),
      { manual: params.manual, userName, episodeLength }
    );

    // 4. Call Claude for synthesis (with retry for transient failures)
    console.log('[Poddit] Calling Claude for synthesis...');
    const response = await withRetry(
      () => anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 12000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: synthesisPrompt }],
      }),
      { label: 'Claude synthesis', attempts: 2, delayMs: 3000 }
    );

    // 5. Check for truncation
    if (response.stop_reason === 'max_tokens') {
      console.error('[Poddit] Claude response was truncated (hit max_tokens)');
      throw new Error('Synthesis was truncated — response exceeded token limit. Try fewer signals or shorter episode length.');
    }

    // 6. Parse the response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Extract JSON from response (handle potential markdown wrapping)
    let rawText = textContent.text.trim();
    // Strip markdown code fences (```json ... ``` or ``` ... ```)
    rawText = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[Poddit] No JSON object found. Raw text:', rawText.slice(0, 1000));
      throw new Error('Could not extract JSON from response');
    }

    let jsonStr = jsonMatch[0];

    let episodeData: EpisodeData;
    try {
      episodeData = JSON.parse(jsonStr);
    } catch (firstError) {
      // Attempt repair: fix common issues (unescaped control chars in string values)
      console.warn('[Poddit] First JSON parse failed, attempting repair...');
      try {
        // Replace unescaped control characters inside strings (newlines, tabs)
        jsonStr = jsonStr.replace(/[\x00-\x1f]/g, (ch) => {
          if (ch === '\n') return '\\n';
          if (ch === '\r') return '\\r';
          if (ch === '\t') return '\\t';
          return '';
        });
        episodeData = JSON.parse(jsonStr);
        console.log('[Poddit] JSON repair succeeded');
      } catch (repairError) {
        console.error('[Poddit] JSON parse failed after repair. Raw text (first 1500 chars):', rawText.slice(0, 1500));
        console.error('[Poddit] JSON parse failed around:', jsonStr.slice(0, 500));
        throw new Error('Failed to parse Claude response as JSON');
      }
    }

    // Basic schema validation
    if (!episodeData.title || !Array.isArray(episodeData.segments) || episodeData.segments.length === 0) {
      throw new Error('Claude response missing required fields (title, segments)');
    }

    // 5a. Validate segment + source structure before processing
    for (const seg of episodeData.segments) {
      if (!Array.isArray(seg.sources)) {
        seg.sources = [];
      }
      // Filter malformed sources (missing required fields)
      seg.sources = seg.sources.filter((src: Record<string, unknown>) =>
        typeof src.name === 'string' && (src.name as string).trim() &&
        typeof src.attribution === 'string'
      );
    }

    // 5b. Validate source URLs — strip hallucinated URLs that don't exist
    // Strategy: SSRF check → HEAD → GET fallback, real User-Agent, only strip 404/410/451
    // Concurrent batching (5 at a time) to stay within 300s route budget
    const validationStart = Date.now();
    const signalUrls = new Set(
      signals.filter(s => s.url).map(s => s.url!.toLowerCase())
    );

    const BROWSER_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
    const DEAD_STATUSES = new Set([404, 410, 451]);

    async function isUrlReachable(url: string): Promise<boolean> {
      const fetchOpts = {
        redirect: 'follow' as const,
        signal: AbortSignal.timeout(8000),
        headers: { 'User-Agent': BROWSER_UA },
      };
      try {
        const headRes = await fetch(url, { ...fetchOpts, method: 'HEAD' });
        if (!DEAD_STATUSES.has(headRes.status)) return true;
        // HEAD returned dead status — confirm with GET (some servers lie on HEAD)
        const getRes = await fetch(url, { ...fetchOpts, method: 'GET' });
        return !DEAD_STATUSES.has(getRes.status);
      } catch {
        try {
          const getRes = await fetch(url, { ...fetchOpts, method: 'GET' });
          return !DEAD_STATUSES.has(getRes.status);
        } catch {
          return false;
        }
      }
    }

    // Validation cache — dedup same URL across segments
    const validationCache = new Map<string, boolean>();

    // Collect all non-signal source URLs that need validation
    interface SourceToValidate { segIdx: number; srcIdx: number; url: string; }
    const toValidate: SourceToValidate[] = [];
    let strippedNoUrl = 0;
    let strippedUnsafe = 0;

    for (let segIdx = 0; segIdx < episodeData.segments.length; segIdx++) {
      const seg = episodeData.segments[segIdx];
      for (let srcIdx = 0; srcIdx < seg.sources.length; srcIdx++) {
        const src = seg.sources[srcIdx];
        if (!src.url || !src.url.trim()) {
          console.log(`[Poddit] Dropped source without URL: ${src.name}`);
          strippedNoUrl++;
          continue;
        }
        // Signal URLs are known-good — skip validation
        if (signalUrls.has(src.url.toLowerCase())) continue;
        toValidate.push({ segIdx, srcIdx, url: src.url });
      }
    }

    // SSRF check + validate in concurrent batches of 5
    const BATCH_SIZE = 5;
    let strippedUnreachable = 0;
    const failedUrls = new Set<string>();

    for (let i = 0; i < toValidate.length; i += BATCH_SIZE) {
      const batch = toValidate.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(async (item) => {
          const cacheKey = item.url.toLowerCase();
          if (validationCache.has(cacheKey)) {
            return { item, reachable: validationCache.get(cacheKey)! };
          }
          // SSRF check before fetching
          const safe = await isSafeUrl(item.url);
          if (!safe) {
            console.log(`[Poddit] Blocked unsafe URL: ${item.url}`);
            validationCache.set(cacheKey, false);
            return { item, reachable: false, unsafe: true };
          }
          const reachable = await isUrlReachable(item.url);
          validationCache.set(cacheKey, reachable);
          return { item, reachable };
        })
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (!result.value.reachable) {
            failedUrls.add(result.value.item.url.toLowerCase());
            if ((result.value as { unsafe?: boolean }).unsafe) {
              strippedUnsafe++;
            } else {
              strippedUnreachable++;
              console.log(`[Poddit] Stripped unreachable source: ${result.value.item.url}`);
            }
          }
        } else {
          // Promise rejected (unexpected error) — drop the source defensively
          const item = batch[results.indexOf(result)];
          if (item) {
            failedUrls.add(item.url.toLowerCase());
            strippedUnreachable++;
            console.warn(`[Poddit] Validation error for ${item.url}: ${result.reason}`);
          }
        }
      }
    }

    // Apply validation results — rebuild sources arrays
    for (const segment of episodeData.segments) {
      segment.sources = segment.sources.filter((src: { url?: string }) => {
        if (!src.url || !src.url.trim()) return false;
        if (signalUrls.has(src.url.toLowerCase())) return true;
        return !failedUrls.has(src.url.toLowerCase());
      });
    }

    const validationMs = Date.now() - validationStart;
    const totalSources = episodeData.segments.reduce((sum, s) => sum + s.sources.length, 0);
    console.log(`[Poddit] Source validation: ${validationMs}ms, ${totalSources} kept, ${strippedNoUrl} no-url, ${strippedUnreachable} unreachable, ${strippedUnsafe} unsafe`);

    // 6. Build the full script for TTS
    const fullScript = buildFullScript(episodeData);

    // 7. Create segment records (batch for efficiency)
    if (episodeData.segments.length > 0) {
      await prisma.segment.createMany({
        data: episodeData.segments.map((seg, i) => ({
          episodeId: episode.id,
          order: i,
          topic: seg.topic,
          content: seg.content,
          sources: seg.sources,
        })),
      });
    }

    // 8. Update episode with script
    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        title: episodeData.title,
        script: fullScript,
        summary: episodeData.summary,
        topicsCovered: episodeData.segments.map(s => s.topic),
        status: 'SYNTHESIZING',
      },
    });

    // 9. (signals already marked USED in the transaction above)

    // 10. Generate audio (pass user's voice preference)
    console.log(`[Poddit] Generating audio${voiceKey ? ` (voice: ${voiceKey})` : ''}...`);
    const { audioUrl, duration } = await generateAudio(fullScript, episode.id, voiceKey);

    // 11. Finalize episode (store voice used for attribution)
    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        audioUrl,
        audioDuration: duration,
        voiceKey: voiceKey || 'gandalf',
        status: 'READY',
        generatedAt: new Date(),
      },
    });

    console.log(`[Poddit] Episode ready: ${episodeData.title}`);
    return episode.id;

  } catch (error) {
    console.error('[Poddit] Generation failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    // Mark episode as failed and release signals back to QUEUED so user can retry
    await prisma.$transaction([
      prisma.episode.update({
        where: { id: episode.id },
        data: { status: 'FAILED', error: errorMessage },
      }),
      prisma.signal.updateMany({
        where: { episodeId: episode.id },
        data: { status: 'QUEUED', episodeId: null },
      }),
    ]);
    throw error;
  }
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

function buildFullScript(data: EpisodeData): string {
  const parts: string[] = [];

  // Intro
  if (data.intro) {
    parts.push(data.intro);
  }

  // Segments (transitions are woven into each segment's content)
  for (const segment of data.segments) {
    parts.push(segment.content);
  }

  // Connections
  if (data.connections) {
    parts.push(data.connections);
  }

  // Outro
  if (data.outro) {
    parts.push(data.outro);
  }

  return parts.join('\n\n');
}

export function getLastWeekStart(): Date {
  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  return lastWeek;
}
