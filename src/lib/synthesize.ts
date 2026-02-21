import Anthropic from '@anthropic-ai/sdk';
import prisma from './db';
import { SYSTEM_PROMPT, buildSynthesisPrompt } from './prompts';
import { generateAudio } from './tts';
import { withRetry } from './retry';
import { isSafeUrl } from './capture';
import { calculateGenerationCosts } from './pricing';

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

export interface TopicProfile {
  familiar: { topic: string; episodeCount: number; signalCount: number; lastEpisodeDate: Date }[];
  growing: { topic: string; previousWeek: number; currentWeek: number; change: number }[];
  new: string[];
}

// ──────────────────────────────────────────────
// TOPIC PROFILE (for depth calibration)
// ──────────────────────────────────────────────

/**
 * Build a topic profile from signal + episode history.
 * Classifies current signal topics as familiar, growing, or new.
 * Returns null if no history exists (new users) or nothing relevant.
 */
async function buildTopicProfile(
  userId: string,
  currentSignalTopics: string[]
): Promise<TopicProfile | null> {
  const currentTopicKeys = new Set(currentSignalTopics.map(t => t.trim().toLowerCase()));
  if (currentTopicKeys.size === 0) return null;

  // Two bounded indexed queries (~10-30ms total)
  const [usedSignals, allEpisodes] = await Promise.all([
    prisma.signal.findMany({
      where: { userId, status: 'USED' },
      select: { topics: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 500,
    }),
    prisma.episode.findMany({
      where: { userId, status: 'READY' },
      select: { topicsCovered: true, generatedAt: true },
      orderBy: { generatedAt: 'desc' },
      take: 50,
    }),
  ]);

  if (usedSignals.length === 0 && allEpisodes.length === 0) return null;

  // ── Topic → episode count + last episode date ──
  const topicEpisodeMap: Record<string, { episodeCount: number; lastEpisodeDate: Date }> = {};
  for (const ep of allEpisodes) {
    for (const t of ep.topicsCovered) {
      const key = t.trim().toLowerCase();
      if (!topicEpisodeMap[key]) {
        topicEpisodeMap[key] = { episodeCount: 0, lastEpisodeDate: ep.generatedAt || new Date(0) };
      }
      topicEpisodeMap[key].episodeCount++;
      if (ep.generatedAt && ep.generatedAt > topicEpisodeMap[key].lastEpisodeDate) {
        topicEpisodeMap[key].lastEpisodeDate = ep.generatedAt;
      }
    }
  }

  // ── Topic → signal count ──
  const topicSignalCount: Record<string, number> = {};
  for (const sig of usedSignals) {
    for (const t of sig.topics) {
      const key = t.trim().toLowerCase();
      topicSignalCount[key] = (topicSignalCount[key] || 0) + 1;
    }
  }

  // ── Weekly bucketing for growing interests ──
  const now = new Date();
  const startOfWeek = new Date(now);
  startOfWeek.setDate(now.getDate() - now.getDay());
  startOfWeek.setHours(0, 0, 0, 0);
  const startOfLastWeek = new Date(startOfWeek);
  startOfLastWeek.setDate(startOfLastWeek.getDate() - 7);

  const currentWeekTopics: Record<string, number> = {};
  const lastWeekTopics: Record<string, number> = {};

  for (const sig of usedSignals) {
    const ts = sig.createdAt.getTime();
    const bucket = ts >= startOfWeek.getTime() ? currentWeekTopics
      : ts >= startOfLastWeek.getTime() ? lastWeekTopics
      : null;
    if (bucket) {
      for (const t of sig.topics) {
        const key = t.trim().toLowerCase();
        bucket[key] = (bucket[key] || 0) + 1;
      }
    }
  }

  // ── Familiar: appeared in 3+ episodes, relevant to current signals ──
  const familiar = Object.entries(topicEpisodeMap)
    .filter(([key, data]) => data.episodeCount >= 3 && currentTopicKeys.has(key))
    .sort((a, b) => b[1].episodeCount - a[1].episodeCount)
    .slice(0, 5)
    .map(([topic, data]) => ({
      topic,
      episodeCount: data.episodeCount,
      signalCount: topicSignalCount[topic] || 0,
      lastEpisodeDate: data.lastEpisodeDate,
    }));

  // ── Growing: 2x+ week-over-week, relevant to current signals ──
  const growing: TopicProfile['growing'] = [];
  for (const [key, current] of Object.entries(currentWeekTopics)) {
    if (!currentTopicKeys.has(key)) continue;
    const previous = lastWeekTopics[key] || 0;
    if (previous > 0 && current / previous >= 2) {
      growing.push({ topic: key, previousWeek: previous, currentWeek: current, change: +(current / previous).toFixed(1) });
    }
  }
  growing.sort((a, b) => b.change - a.change);

  // ── New: in current signals but never in past episodes ──
  const allPastTopics = new Set(
    allEpisodes.flatMap(ep => ep.topicsCovered.map(t => t.trim().toLowerCase()))
  );
  const newTopics = [...currentTopicKeys].filter(t => !allPastTopics.has(t));

  if (familiar.length === 0 && growing.length === 0 && newTopics.length === 0) return null;

  return {
    familiar,
    growing: growing.slice(0, 3),
    new: newTopics.slice(0, 5),
  };
}

// ──────────────────────────────────────────────
// WEB SEARCH INTEGRATION
// ──────────────────────────────────────────────

interface WebSearchCitation {
  url: string;
  title: string;
  cited_text: string;
}

interface SynthesisResult {
  content: Anthropic.ContentBlock[];
  usage: Anthropic.Messages.Usage;
  stop_reason: string | null;
}

interface ParsedSynthesisResponse {
  episodeData: EpisodeData;
  citations: WebSearchCitation[];
  searchCount: number;
}

const MAX_CONTINUATIONS = 3;

/**
 * Call Claude with web search tool enabled.
 * Handles pause_turn continuations and graceful fallback
 * if web search is unavailable.
 */
async function callClaudeWithWebSearch(
  synthesisPrompt: string
): Promise<SynthesisResult> {
  try {
    let response = await withRetry(
      () => anthropic.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 12000,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: synthesisPrompt }],
        tools: [{
          type: 'web_search_20250305' as const,
          name: 'web_search' as const,
          max_uses: 10,
        }],
      }),
      { label: 'Claude synthesis', attempts: 2, delayMs: 3000 }
    );

    let allContent: Anthropic.ContentBlock[] = [...response.content];
    let totalInputTokens = response.usage.input_tokens;
    let totalOutputTokens = response.usage.output_tokens;
    let totalSearches = response.usage.server_tool_use?.web_search_requests || 0;

    // Handle pause_turn: Claude may pause during extensive web searching
    let continuations = 0;
    while (response.stop_reason === 'pause_turn' && continuations < MAX_CONTINUATIONS) {
      continuations++;
      console.log(`[Poddit] Claude paused (continuation ${continuations}/${MAX_CONTINUATIONS}), resuming...`);

      response = await withRetry(
        () => anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 12000,
          system: SYSTEM_PROMPT,
          messages: [
            { role: 'user', content: synthesisPrompt },
            { role: 'assistant', content: allContent as Anthropic.Messages.ContentBlockParam[] },
          ],
          tools: [{
            type: 'web_search_20250305' as const,
            name: 'web_search' as const,
            max_uses: 10,
          }],
        }),
        { label: `Claude synthesis (continuation ${continuations})`, attempts: 2, delayMs: 3000 }
      );

      allContent = [...allContent, ...response.content];
      totalInputTokens += response.usage.input_tokens;
      totalOutputTokens += response.usage.output_tokens;
      totalSearches += response.usage.server_tool_use?.web_search_requests || 0;
    }

    if (response.stop_reason === 'pause_turn') {
      console.warn(`[Poddit] Claude still paused after ${MAX_CONTINUATIONS} continuations, using partial response`);
    }

    return {
      content: allContent,
      usage: {
        ...response.usage,
        input_tokens: totalInputTokens,
        output_tokens: totalOutputTokens,
        server_tool_use: { web_search_requests: totalSearches, web_fetch_requests: 0 },
      },
      stop_reason: response.stop_reason,
    };
  } catch (error: any) {
    // If web search tool causes the call to fail, retry without it
    const isToolError = error?.status === 400 &&
      (error?.message?.includes('web_search') || error?.error?.message?.includes('web_search'));

    if (isToolError) {
      console.warn('[Poddit] Web search tool unavailable, falling back to parametric knowledge...');
      const fallbackResponse = await withRetry(
        () => anthropic.messages.create({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 12000,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: synthesisPrompt }],
        }),
        { label: 'Claude synthesis (no web search)', attempts: 2, delayMs: 3000 }
      );
      return {
        content: [...fallbackResponse.content],
        usage: fallbackResponse.usage,
        stop_reason: fallbackResponse.stop_reason,
      };
    }

    throw error;
  }
}

/**
 * Parse Claude's interleaved response (text + web search blocks).
 * Concatenates text blocks, extracts JSON, and harvests citations.
 */
function parseSynthesisResponse(
  content: Anthropic.ContentBlock[],
  stopReason: string | null
): ParsedSynthesisResponse {
  // Check for truncation
  if (stopReason === 'max_tokens') {
    console.error('[Poddit] Claude response was truncated (hit max_tokens)');
    throw new Error('Synthesis was truncated — response exceeded token limit. Try fewer signals or shorter episode length.');
  }

  // Concatenate all text blocks (ignore server_tool_use and web_search_tool_result)
  const textBlocks = content.filter(
    (block): block is Anthropic.TextBlock => block.type === 'text'
  );

  if (textBlocks.length === 0) {
    throw new Error('No text response from Claude');
  }

  // Log content block types for debugging
  const blockTypes = content.reduce((acc, b) => {
    acc[b.type] = (acc[b.type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log(`[Poddit] Response blocks: ${JSON.stringify(blockTypes)}`);

  // Harvest citation URLs from web_search_tool_result blocks.
  // These contain the actual search results with verified URLs and titles.
  // Note: TextBlock.citations requires `citations: { enabled: true }` in the API request,
  // which we don't set. WebSearchToolResultBlock is the reliable source.
  const citations: WebSearchCitation[] = [];
  const seenCitationUrls = new Set<string>();

  for (const block of content) {
    if (block.type === 'web_search_tool_result') {
      const resultBlock = block as Anthropic.Messages.WebSearchToolResultBlock;
      if (Array.isArray(resultBlock.content)) {
        for (const result of resultBlock.content) {
          if (result.type === 'web_search_result' && result.url) {
            const lower = result.url.toLowerCase();
            if (!seenCitationUrls.has(lower)) {
              seenCitationUrls.add(lower);
              citations.push({ url: result.url, title: result.title || '', cited_text: '' });
            }
          }
        }
      }
    }
  }

  // Secondary: also harvest from TextBlock.citations if present (future-proofing)
  for (const block of textBlocks) {
    if (block.citations) {
      for (const citation of block.citations) {
        if (citation.type === 'web_search_result_location' && citation.url) {
          const lower = citation.url.toLowerCase();
          if (!seenCitationUrls.has(lower)) {
            seenCitationUrls.add(lower);
            citations.push({ url: citation.url, title: citation.title || '', cited_text: citation.cited_text || '' });
          }
        }
      }
    }
  }

  console.log(`[Poddit] Citation harvest: ${citations.length} unique URLs from web search results`);

  // Count web searches performed
  const searchCount = content.filter(
    (block) => block.type === 'server_tool_use'
  ).length;

  // Concatenate text and extract JSON
  let rawText = textBlocks.map(b => b.text).join('').trim();
  // Strip markdown code fences (```json ... ``` or ``` ... ```)
  rawText = rawText.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '');

  // Strip <cite> tags that Claude's web search embeds inline.
  // These would otherwise leak into JSON string values (content, summary, etc.)
  // and appear in the player UI and TTS audio.
  rawText = stripCiteTags(rawText);

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
    // Attempt repair: fix common issues (unescaped control chars)
    console.warn('[Poddit] First JSON parse failed, attempting repair...');
    try {
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

  // Cap segment count to prevent runaway TTS costs
  const MAX_SEGMENTS = 8;
  if (episodeData.segments.length > MAX_SEGMENTS) {
    console.warn(`[Poddit] Claude returned ${episodeData.segments.length} segments, capping to ${MAX_SEGMENTS}`);
    episodeData.segments = episodeData.segments.slice(0, MAX_SEGMENTS);
  }

  return { episodeData, citations, searchCount };
}

export async function generateEpisode(params: {
  userId: string;
  since?: Date;
  manual?: boolean;
  signalIds?: string[];
  episodeLimit?: number; // max READY episodes allowed (Infinity = unlimited)
}): Promise<string> {
  const { userId } = params;

  if (!userId) {
    throw new Error('[Poddit] userId is required to generate an episode');
  }

  const since = params.since || getLastWeekStart();

  // Fetch user preferences for voice + name + briefing style
  const user = await prisma.user.findUnique({ where: { id: userId } });
  const preferences = (user?.preferences as Record<string, string>) || {};
  const voiceKey = preferences.voice || undefined;
  const userName = user?.name || undefined;
  const namePronunciation = preferences.namePronunciation || undefined;
  const episodeLength = preferences.episodeLength || undefined;
  const briefingStyle = preferences.briefingStyle || 'standard';
  const timezone = preferences.timezone || 'America/New_York';

  console.log(`[Poddit] Generating episode for ${userId}${params.signalIds ? ` (${params.signalIds.length} selected signals)` : ` since ${since.toISOString()}`} [style: ${briefingStyle}]`);

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

    // Derive date range from actual signal timestamps
    const signalDates = foundSignals.map(s => new Date(s.createdAt).getTime());
    const actualStart = new Date(Math.min(...signalDates));
    const actualEnd = new Date(Math.max(...signalDates));

    // Atomic episode cap check inside the transaction (prevents TOCTOU race)
    if (params.episodeLimit !== undefined && params.episodeLimit !== Infinity) {
      const readyCount = await tx.episode.count({ where: { userId, status: 'READY' } });
      if (readyCount >= params.episodeLimit) {
        throw new Error('early_access_limit');
      }
    }

    // Immediately mark signals as USED to prevent double-consumption
    const ep = await tx.episode.create({
      data: {
        userId,
        title: `Generating...`,
        script: '',
        periodStart: actualStart,
        periodEnd: actualEnd,
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
    // 3a. Query prior episodes for continuity callbacks
    const priorEpisodes = await prisma.episode.findMany({
      where: { userId, status: 'READY' },
      orderBy: { generatedAt: 'desc' },
      take: 3,
      select: { title: true, topicsCovered: true, summary: true, generatedAt: true },
    });
    if (priorEpisodes.length > 0) {
      console.log(`[Poddit] Found ${priorEpisodes.length} prior episode(s) for continuity context`);
    }

    // 3b. Build topic profile for depth calibration
    const currentSignalTopics = signals.flatMap(s => s.topics);
    const topicProfile = await buildTopicProfile(userId, currentSignalTopics);
    if (topicProfile) {
      console.log(`[Poddit] Topic profile: ${topicProfile.familiar.length} familiar, ${topicProfile.growing.length} growing, ${topicProfile.new.length} new`);
    }

    const researchDepth = preferences.researchDepth || 'auto';

    // 3c. Build the synthesis prompt (pass user prefs + prior episodes + topic profile)
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
      { manual: params.manual, userName, namePronunciation, episodeLength, briefingStyle, timezone, priorEpisodes, topicProfile, researchDepth }
    );

    // 4. Call Claude for synthesis with web search
    const synthesisStart = Date.now();
    console.log('[Poddit] Calling Claude for synthesis (with web search)...');
    const synthesisResult = await callClaudeWithWebSearch(synthesisPrompt);
    const synthesisMs = Date.now() - synthesisStart;

    // Log synthesis metrics
    const webSearchCount = synthesisResult.usage.server_tool_use?.web_search_requests || 0;
    console.log(
      `[Poddit] Synthesis: ${(synthesisMs / 1000).toFixed(1)}s, ${webSearchCount} web searches, ` +
      `${synthesisResult.usage.input_tokens} in / ${synthesisResult.usage.output_tokens} out tokens`
    );
    if (webSearchCount > 0) {
      console.log(`[Poddit] Web search cost: ~$${(webSearchCount * 0.01).toFixed(2)} (${webSearchCount} searches x $0.01)`);
    }
    if (synthesisMs > 120000) {
      console.warn(`[Poddit] Synthesis exceeded 120s (${(synthesisMs / 1000).toFixed(1)}s) — remaining budget tight`);
    }

    // 5. Parse response (extract JSON, harvest web search citations)
    const { episodeData, citations, searchCount } = parseSynthesisResponse(
      synthesisResult.content,
      synthesisResult.stop_reason
    );

    console.log(`[Poddit] Parsed: "${episodeData.title}", ${episodeData.segments.length} segments, ${citations.length} web citations`);

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

    // 5b. Enrich sources with web search citation URLs
    // If Claude referenced a source in JSON but used a guessed URL,
    // try to match by title to a web search citation with a verified URL
    const citationsByTitle = new Map<string, string>();
    for (const citation of citations) {
      if (citation.title) {
        citationsByTitle.set(citation.title.toLowerCase(), citation.url);
      }
    }
    let enrichedCount = 0;
    for (const segment of episodeData.segments) {
      for (const source of segment.sources) {
        if ((!source.url || !source.url.trim()) && citationsByTitle.has(source.name.toLowerCase())) {
          source.url = citationsByTitle.get(source.name.toLowerCase())!;
          enrichedCount++;
        }
      }
    }
    if (enrichedCount > 0) {
      console.log(`[Poddit] Enriched ${enrichedCount} source(s) with web search citation URLs`);
    }

    // 5c. Validate source URLs — strip hallucinated URLs that don't exist
    // Web search citation URLs are verified, signal URLs are known-good — both skip validation
    const validationStart = Date.now();
    const signalUrls = new Set(
      signals.filter(s => s.url).map(s => s.url!.toLowerCase())
    );
    const webSearchUrls = new Set(
      citations.map(c => c.url.toLowerCase())
    );
    if (webSearchUrls.size > 0) {
      console.log(`[Poddit] ${webSearchUrls.size} unique web search citation URLs (skip validation)`);
    }

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

    // Collect source URLs that need validation (not signal, not web-search-verified)
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
        // Web search citation URLs are verified — skip validation
        if (webSearchUrls.has(src.url.toLowerCase())) continue;
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
        if (webSearchUrls.has(src.url.toLowerCase())) return true;
        return !failedUrls.has(src.url.toLowerCase());
      });
    }

    const validationMs = Date.now() - validationStart;
    const totalSources = episodeData.segments.reduce((sum, s) => sum + s.sources.length, 0);
    console.log(`[Poddit] Source validation: ${validationMs}ms, ${totalSources} kept, ${strippedNoUrl} no-url, ${strippedUnreachable} unreachable, ${strippedUnsafe} unsafe`);

    // 6. Build the main script + epilogue for TTS (epilogue gets its own sound bed)
    const { main: mainScript, epilogue: epilogueScript } = buildFullScript(episodeData, { timezone });
    const fullScript = epilogueScript ? `${mainScript}\n\n${epilogueScript}` : mainScript;

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

    // 8. Update episode with script (stored script includes epilogue for reference)
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

    // 10. Generate audio (pass user's voice preference + epilogue as separate segment)
    const ttsScript = sanitizeForTTS(mainScript);
    const ttsEpilogue = epilogueScript ? sanitizeForTTS(epilogueScript) : undefined;
    console.log(`[Poddit] Generating audio${voiceKey ? ` (voice: ${voiceKey})` : ''}${ttsEpilogue ? ' + epilogue' : ''}...`);
    console.log(`[Poddit] TTS intro preview: ${ttsScript.split('\n\n')[0].substring(0, 200)}`);
    const { audioUrl, duration, ttsCharacters, ttsChunks, ttsMs } = await generateAudio(ttsScript, episode.id, voiceKey, ttsEpilogue);

    // 11. Build generation metadata for cost tracking
    const inputTokens = synthesisResult.usage.input_tokens;
    const outputTokens = synthesisResult.usage.output_tokens;
    const generationMeta = {
      inputTokens,
      outputTokens,
      webSearches: webSearchCount,
      synthesisMs,
      ttsCharacters,
      ttsChunks,
      ttsMs,
      briefingStyle,
      researchDepth,
      costs: calculateGenerationCosts({ inputTokens, outputTokens, webSearches: webSearchCount, ttsCharacters }),
    };
    console.log(`[Poddit] Generation cost: $${generationMeta.costs.total.toFixed(4)} (Claude: $${generationMeta.costs.claude.toFixed(4)}, Search: $${generationMeta.costs.webSearch.toFixed(4)}, TTS: $${generationMeta.costs.tts.toFixed(4)})`);

    // 12. Finalize episode (store voice used for attribution + cost metadata)
    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        audioUrl,
        audioDuration: duration,
        voiceKey: voiceKey || 'gandalf',
        status: 'READY',
        generatedAt: new Date(),
        generationMeta: JSON.parse(JSON.stringify(generationMeta)),
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

/**
 * Strip <cite> tags from text, preserving the inner content.
 * Claude's web search embeds inline <cite index="X-Y">...</cite> tags
 * that must be removed before JSON extraction and TTS.
 */
function stripCiteTags(text: string): string {
  return text.replace(/<cite[^>]*>/gi, '').replace(/<\/cite>/gi, '');
}

/**
 * Clean up text for TTS consumption. Em dashes (—) and en dashes (–) cause
 * ElevenLabs to garble or vocalize them. Replace with comma-space for a
 * natural pause, which is how dashes function in spoken English.
 */
function sanitizeForTTS(script: string): string {
  return script
    .replace(/\s*—\s*/g, ', ')   // em dash → comma pause
    .replace(/\s*–\s*/g, ', ')   // en dash → comma pause
    .replace(/,\s*,/g, ',');     // clean up double commas
}

function buildFullScript(data: EpisodeData, options?: { timezone?: string }): { main: string; epilogue: string } {
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

  // Epilogue — separate from main script for independent TTS + sound bed
  const epilogue = buildEpilogue(data, options?.timezone);

  return { main: parts.join('\n\n'), epilogue };
}

/**
 * Build the episode epilogue — a fixed-format spoken attribution.
 * Not LLM-generated: consistent tone, zero extra tokens.
 * Reinforces trust, differentiation, and source transparency.
 */
function buildEpilogue(data: EpisodeData, timezone?: string): string {
  const tz = timezone || 'America/New_York';
  const date = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: tz,
  });

  // Collect unique source publication names across all segments
  const sourceNames = new Set<string>();
  for (const segment of data.segments) {
    for (const source of segment.sources) {
      if (source.name && source.name.trim()) {
        sourceNames.add(source.name.trim());
      }
    }
  }

  // Pick up to 3 unique source names
  const topSources = Array.from(sourceNames).slice(0, 3);

  let epilogue = `This episode was created for you on ${date}. Poddit analyzed the signals you captured and conducted independent research across multiple perspectives.`;

  if (topSources.length > 0) {
    const sourceList = topSources.length === 1
      ? topSources[0]
      : topSources.length === 2
        ? `${topSources[0]} and ${topSources[1]}`
        : `${topSources.slice(0, -1).join(', ')}, and ${topSources[topSources.length - 1]}`;

    epilogue += ` Sources referenced in this briefing include reporting from ${sourceList}.`;
  }

  epilogue += ' You can explore the complete list of sources on your episode page.';

  return epilogue;
}

export function getLastWeekStart(): Date {
  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  return lastWeek;
}
