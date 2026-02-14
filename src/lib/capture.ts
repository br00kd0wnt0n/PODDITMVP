import prisma from './db';
import { InputType, Channel } from '@prisma/client';
import * as cheerio from 'cheerio';
import Anthropic from '@anthropic-ai/sdk';
import { ENRICHMENT_PROMPT } from './prompts';

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
  const urls = extractUrls(rawContent);

  if (urls.length > 0) {
    return { type: 'LINK', urls };
  }

  // Check if it looks like a forwarded email (has common forward indicators)
  if (rawContent.includes('---------- Forwarded message') ||
      rawContent.includes('Begin forwarded message') ||
      (rawContent.includes('From:') && rawContent.includes('Subject:'))) {
    return { type: 'FORWARDED_EMAIL', urls: [] };
  }

  // Otherwise it's a topic/thought
  return { type: 'TOPIC', urls: [] };
}

// ──────────────────────────────────────────────
// CONTENT FETCHING (for links)
// ──────────────────────────────────────────────

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

export async function fetchAndExtract(url: string): Promise<{
  title: string | null;
  source: string | null;
  content: string | null;
}> {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Poddit/1.0; +https://poddit.com)',
      },
      signal: AbortSignal.timeout(10000),
    });

    const source = new URL(url).hostname.replace('www.', '') || null;

    if (!response.ok) {
      // Even if blocked, extract title from URL path as fallback
      const titleFromUrl = titleFromPath(url);
      return { title: titleFromUrl, source, content: null };
    }

    const html = await response.text();
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
    // Safe URL parsing — catch malformed URLs in catch block
    let source: string | null = null;
    try {
      source = new URL(url).hostname.replace('www.', '') || null;
    } catch {
      // URL is malformed — leave source as null
    }
    return { title: titleFromPath(url), source, content: null };
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
