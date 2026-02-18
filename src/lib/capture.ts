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

export function extractUrls(text: string): string[] {
  return text.match(URL_REGEX) || [];
}

export function classifyInput(rawContent: string): { type: InputType; urls: string[] } {
  // Check for forwarded email FIRST — before URL extraction
  // Forwarded emails contain many embedded URLs (signatures, trackers, article links)
  // that shouldn't each become separate signals
  if (rawContent.includes('---------- Forwarded message') ||
      rawContent.includes('Begin forwarded message') ||
      (rawContent.includes('From:') && rawContent.includes('Subject:'))) {
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
  /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[0-2]\d)\./,
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
async function isSafeUrl(url: string): Promise<boolean> {
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
      const { title, source, content } = await fetchAndExtract(signal.url);

      await prisma.signal.update({
        where: { id: signalId },
        data: {
          title,
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
    model: 'claude-3-5-haiku-20241022',
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
