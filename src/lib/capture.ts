import prisma from './db';
import { InputType, Channel } from '@prisma/client';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { ENRICHMENT_PROMPT } from './prompts';
import { lookup } from 'dns/promises';

// Singleton Anthropic client for signal classification
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ──────────────────────────────────────────────
// URL DETECTION & EXTRACTION
// ──────────────────────────────────────────────

const URL_REGEX = /https?:\/\/[^\s<>"{}|\\^`\[\]]+/gi;

// Tracking query params to strip during normalization
const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'fbclid', 'gclid', 'gclsrc', 'dclid', 'msclkid',
  'mc_cid', 'mc_eid', '_ga', '_gl',
  'ref', 'ref_src', 'ref_url', 'source', 's',
]);

/**
 * Strip trailing punctuation that's sentence-level, not part of the URL.
 * Handles balanced brackets: only strips ) or ] if unbalanced.
 */
function cleanTrailingPunctuation(url: string): string {
  const trailingChars = new Set(['.', ',', ';', ':', '!', '?', "'", '"']);
  let cleaned = url;

  while (cleaned.length > 0) {
    const last = cleaned[cleaned.length - 1];

    if (trailingChars.has(last)) {
      cleaned = cleaned.slice(0, -1);
      continue;
    }

    // Only strip ) if there are more closing than opening parens in the URL
    if (last === ')') {
      const opens = (cleaned.match(/\(/g) || []).length;
      const closes = (cleaned.match(/\)/g) || []).length;
      if (closes > opens) {
        cleaned = cleaned.slice(0, -1);
        continue;
      }
    }

    // Only strip ] if there are more closing than opening brackets in the URL
    if (last === ']') {
      const opens = (cleaned.match(/\[/g) || []).length;
      const closes = (cleaned.match(/\]/g) || []).length;
      if (closes > opens) {
        cleaned = cleaned.slice(0, -1);
        continue;
      }
    }

    break;
  }

  return cleaned;
}

/**
 * Normalize a URL: strip tracking params, fragments, AMP paths, trailing slashes.
 * Returns original URL if parsing fails.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);

    // Strip tracking params
    for (const param of [...parsed.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(param)) {
        parsed.searchParams.delete(param);
      }
    }

    // Remove fragment
    parsed.hash = '';

    // AMP canonicalization: strip /amp/ or /amp from path
    parsed.pathname = parsed.pathname
      .replace(/\/amp\//, '/')
      .replace(/\/amp$/, '');

    // Remove trailing slash (except root)
    if (parsed.pathname.length > 1 && parsed.pathname.endsWith('/')) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Detect forwarded emails using line-boundary header matching.
 * Requires From: and Subject: at line starts (with optional > quoting).
 */
function isForwardedEmail(text: string): boolean {
  if (text.includes('---------- Forwarded message')) return true;
  if (text.includes('Begin forwarded message')) return true;

  // Require both From: and Subject: at start of lines (with optional > quoting)
  const hasFrom = /^[>\s]*From:\s+\S/m.test(text);
  const hasSubject = /^[>\s]*Subject:\s+\S/m.test(text);
  return hasFrom && hasSubject;
}

export function extractUrls(text: string): string[] {
  const rawMatches = text.match(URL_REGEX) || [];
  const cleaned = rawMatches
    .map(cleanTrailingPunctuation)
    .filter(url => url.length > 10)  // filter out degenerate matches
    .map(normalizeUrl);
  // Deduplicate (same URL after normalization)
  return [...new Set(cleaned)];
}

export function classifyInput(rawContent: string): { type: InputType; urls: string[] } {
  // Check for forwarded email FIRST — before URL extraction
  // Forwarded emails contain many embedded URLs (signatures, trackers, article links)
  // that shouldn't each become separate signals
  if (isForwardedEmail(rawContent)) {
    return { type: 'FORWARDED_EMAIL', urls: [] };
  }

  const urls = extractUrls(rawContent);

  if (urls.length > 0) {
    return { type: 'LINK', urls };
  }

  // Otherwise it's a topic/thought
  return { type: 'TOPIC', urls: [] };
}

// ──────────────────────────────────────────────
// CONTENT FETCHING (for links)
// ──────────────────────────────────────────────

// Private/internal IP ranges that should never be fetched
const BLOCKED_IP_PATTERNS = [
  /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
  /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^::1$/, /^fe80:/i, /^fc00:/i, /^fd00:/i,
];
const BLOCKED_HOSTNAMES = ['localhost', '127.0.0.1', '::1', '0.0.0.0'];
const BLOCKED_SUFFIXES = ['.internal', '.local', '.localhost'];
const MAX_RESPONSE_BYTES = 5_000_000; // 5MB
const ALLOWED_CONTENT_TYPES = ['text/html', 'text/plain', 'application/xhtml'];
const MAX_REDIRECTS = 5;

/**
 * Check if a URL is safe to fetch (not targeting private/internal networks).
 * Resolves DNS to verify the IP address is not in a blocked range.
 */
export async function isSafeUrl(url: string): Promise<boolean> {
  try {
    const parsed = new URL(url);

    // Protocol check
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return false;
    }

    const hostname = parsed.hostname.toLowerCase();

    // Direct hostname blocklist
    if (BLOCKED_HOSTNAMES.includes(hostname)) return false;

    // Suffix blocklist
    if (BLOCKED_SUFFIXES.some(s => hostname.endsWith(s))) return false;

    // DNS resolution — check resolved IP against blocked ranges
    try {
      const { address } = await lookup(hostname);
      if (BLOCKED_IP_PATTERNS.some(re => re.test(address))) {
        return false;
      }
    } catch {
      // DNS resolution failed — could be invalid hostname, allow fetch to fail naturally
      return true;
    }

    return true;
  } catch {
    return false;
  }
}

function titleFromPath(url: string): string | null {
  try {
    const pathname = new URL(url).pathname;
    // Extract the last meaningful path segment, e.g. "congress-jets-off-shutdown"
    const slug = pathname.split('/').filter(Boolean).pop();
    if (!slug || slug.length < 3) return null;
    // Remove file extension and query params
    const clean = slug.replace(/\.\w+$/, '').replace(/\?.*$/, '');
    // Convert slug to title: "congress-jets-off-shutdown" → "Congress jets off shutdown"
    const title = clean.replace(/[-_]/g, ' ').replace(/^\w/, c => c.toUpperCase());
    return title.length > 3 ? title : null;
  } catch {
    return null;
  }
}

/**
 * Pick the best title from existing (e.g. extension tab.title) and fetched (from page <title>).
 * Prefers whichever is more descriptive — longer title with more words wins.
 * Filters out generic site-name-only titles like "Perplexity", "Medium", "Reddit".
 */
function pickBestTitle(existing: string | null | undefined, fetched: string | null | undefined): string | null {
  const a = existing?.trim() || null;
  const b = fetched?.trim() || null;

  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;

  // A title with more words is likely more descriptive
  const aWords = a.split(/\s+/).length;
  const bWords = b.split(/\s+/).length;

  // If one is a single word (just a site name) and the other has multiple words, pick the longer one
  if (aWords === 1 && bWords > 1) return b;
  if (bWords === 1 && aWords > 1) return a;

  // Otherwise pick the longer one (more descriptive)
  return a.length >= b.length ? a : b;
}

/**
 * Read response body with size limit via streaming.
 * Returns null if response exceeds MAX_RESPONSE_BYTES.
 */
async function readResponseWithLimit(response: Response, maxBytes: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.length;
      if (totalBytes > maxBytes) {
        reader.cancel();
        console.warn(`[Capture] Response exceeded ${maxBytes} bytes, truncating`);
        break;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks).toString('utf-8');
}

export async function fetchAndExtract(url: string): Promise<{
  title: string | null;
  source: string | null;
  content: string | null;
}> {
  try {
    // SSRF protection — verify URL doesn't target private/internal networks
    if (!(await isSafeUrl(url))) {
      console.warn(`[Capture] Blocked unsafe URL: ${url}`);
      const source = safeHostname(url);
      return { title: titleFromPath(url), source, content: null };
    }

    // Manual redirect following with SSRF check on each hop
    let currentUrl = url;
    let response: Response | null = null;

    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      response = await fetch(currentUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; Poddit/1.0; +https://poddit.com)',
        },
        signal: AbortSignal.timeout(10000),
        redirect: 'manual',
      });

      // Handle redirects manually — check each redirect target for SSRF
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location');
        if (!location) break;

        // Resolve relative redirects
        const redirectUrl = new URL(location, currentUrl).toString();

        if (!(await isSafeUrl(redirectUrl))) {
          console.warn(`[Capture] Blocked redirect to unsafe URL: ${redirectUrl}`);
          const source = safeHostname(url);
          return { title: titleFromPath(url), source, content: null };
        }

        currentUrl = redirectUrl;
        continue;
      }

      break;
    }

    if (!response) {
      const source = safeHostname(url);
      return { title: titleFromPath(url), source, content: null };
    }

    const source = safeHostname(currentUrl) || safeHostname(url);

    if (!response.ok) {
      const titleFromUrl = titleFromPath(url);
      return { title: titleFromUrl, source, content: null };
    }

    // Content-Type validation — only process HTML/text
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.some(t => contentType.includes(t))) {
      console.log(`[Capture] Skipping non-HTML content (${contentType}): ${url}`);
      return { title: titleFromPath(url), source, content: null };
    }

    // Content-Length pre-check (header may not always be present)
    const contentLength = parseInt(response.headers.get('content-length') || '0');
    if (contentLength > MAX_RESPONSE_BYTES) {
      console.warn(`[Capture] Response too large (${contentLength} bytes): ${url}`);
      return { title: titleFromPath(url), source, content: null };
    }

    // Stream body with size limit
    const html = await readResponseWithLimit(response, MAX_RESPONSE_BYTES);
    if (!html) {
      return { title: titleFromPath(url), source, content: null };
    }

    const $ = cheerio.load(html);

    // Remove noise
    $('script, style, nav, footer, header, aside, .ad, .advertisement, .sidebar').remove();

    const title = $('meta[property="og:title"]').attr('content')
      || $('title').text().trim()
      || titleFromPath(url);

    const ogSource = $('meta[property="og:site_name"]').attr('content');

    // Get main content — prefer article tag, fall back to body
    const articleText = $('article').text().trim();
    const bodyText = $('main').text().trim() || $('body').text().trim();
    const content = articleText || bodyText;

    // Truncate to ~4000 words to stay within LLM context limits
    const truncated = content.split(/\s+/).slice(0, 4000).join(' ');

    return { title, source: ogSource || source, content: truncated || null };
  } catch (error) {
    console.error(`[Capture] Failed to fetch ${url}:`, error);
    const source = safeHostname(url);
    return { title: titleFromPath(url), source, content: null };
  }
}

/** Safely extract hostname from a URL, returning null on malformed input */
function safeHostname(url: string): string | null {
  try {
    return new URL(url).hostname.replace('www.', '') || null;
  } catch {
    return null;
  }
}

// ──────────────────────────────────────────────
// SIGNAL CREATION
// ──────────────────────────────────────────────

export async function createSignal(params: {
  rawContent: string;
  channel: Channel;
  userId: string;
}) {
  const { rawContent, channel, userId } = params;

  if (!userId) {
    throw new Error('[Capture] userId is required to create a signal');
  }

  // Update last activity timestamp (fire-and-forget, non-blocking)
  prisma.user.update({ where: { id: userId }, data: { lastActiveAt: new Date() } }).catch(() => {});

  const { type, urls } = classifyInput(rawContent);

  // Email channel → always one signal per email (never split on embedded URLs)
  if (channel === 'EMAIL') {
    const signal = await prisma.signal.create({
      data: {
        userId,
        inputType: type === 'LINK' ? 'FORWARDED_EMAIL' : type,
        channel,
        rawContent: rawContent.trim(),
        url: urls.length === 1 ? urls[0] : null,
        status: 'QUEUED',
      },
    });
    enrichSignal(signal.id).catch(console.error);
    return [signal];
  }

  // If it's a link, create one signal per URL
  if (type === 'LINK' && urls.length > 0) {
    const signals = [];
    for (const url of urls) {
      const signal = await prisma.signal.create({
        data: {
          userId,
          inputType: type,
          channel,
          rawContent: url,
          url,
          status: 'QUEUED',
        },
      });
      signals.push(signal);

      // Kick off async enrichment
      enrichSignal(signal.id).catch(console.error);
    }
    return signals;
  }

  // For topics and forwarded emails
  const signal = await prisma.signal.create({
    data: {
      userId,
      inputType: type,
      channel,
      rawContent: rawContent.trim(),
      status: 'QUEUED',
    },
  });

  // Kick off async enrichment + classification
  enrichSignal(signal.id).catch(console.error);

  return [signal];
}

// ──────────────────────────────────────────────
// SIGNAL ENRICHMENT
// ──────────────────────────────────────────────

export async function enrichSignal(signalId: string) {
  const signal = await prisma.signal.findUnique({ where: { id: signalId } });
  if (!signal) return;

  try {
    if (signal.inputType === 'LINK' && signal.url) {
      const { title: fetchedTitle, source, content } = await fetchAndExtract(signal.url);

      await prisma.signal.update({
        where: { id: signalId },
        data: {
          // Pick the best available title: prefer whichever is longer/more descriptive
          title: pickBestTitle(signal.title, fetchedTitle),
          source,
          fetchedContent: content,
          status: 'ENRICHED',
          processedAt: new Date(),
        },
      });
    } else {
      // For topics — just mark as enriched, synthesis will handle research
      await prisma.signal.update({
        where: { id: signalId },
        data: {
          title: signal.rawContent.slice(0, 100),
          status: 'ENRICHED',
          processedAt: new Date(),
        },
      });
    }

    // Auto-classify after enrichment (non-blocking)
    classifySignal(signalId).catch(err =>
      console.error(`[Classify] Failed for signal ${signalId}:`, err)
    );
  } catch (error) {
    console.error(`Failed to enrich signal ${signalId}:`, error);
    await prisma.signal.update({
      where: { id: signalId },
      data: { status: 'FAILED' },
    });
  }
}

// ──────────────────────────────────────────────
// SIGNAL CLASSIFICATION (auto-tagging)
// ──────────────────────────────────────────────

async function classifySignal(signalId: string) {
  const signal = await prisma.signal.findUnique({ where: { id: signalId } });
  if (!signal) return;

  // Build context for classification
  let context = signal.rawContent;
  if (signal.title) context = `Title: ${signal.title}\n${context}`;
  if (signal.source) context = `Source: ${signal.source}\n${context}`;
  if (signal.fetchedContent) {
    context += `\n\nContent preview: ${signal.fetchedContent.slice(0, 500)}`;
  }

  const response = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `${ENRICHMENT_PROMPT}\n\n---\n\n${context}`,
    }],
  });

  const textContent = response.content.find(c => c.type === 'text');
  if (!textContent || textContent.type !== 'text') return;

  try {
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;

    const result = JSON.parse(jsonMatch[0]);
    const topics = Array.isArray(result.topics) ? result.topics.slice(0, 5) : [];

    if (topics.length > 0) {
      await prisma.signal.update({
        where: { id: signalId },
        data: { topics },
      });
      console.log(`[Classify] Signal ${signalId} tagged: ${topics.join(', ')}`);
    }
  } catch {
    console.error(`[Classify] Failed to parse classification for signal ${signalId}`);
  }
}
