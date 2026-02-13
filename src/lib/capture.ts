import prisma from './db';
import { InputType, Channel } from '@prisma/client';
import * as cheerio from 'cheerio';

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

    if (!response.ok) return { title: null, source: null, content: null };

    const html = await response.text();
    const $ = cheerio.load(html);

    // Remove noise
    $('script, style, nav, footer, header, aside, .ad, .advertisement, .sidebar').remove();

    const title = $('meta[property="og:title"]').attr('content') 
      || $('title').text().trim() 
      || null;

    const source = $('meta[property="og:site_name"]').attr('content')
      || new URL(url).hostname.replace('www.', '')
      || null;

    // Get main content — prefer article tag, fall back to body
    const articleText = $('article').text().trim();
    const bodyText = $('main').text().trim() || $('body').text().trim();
    const content = articleText || bodyText;

    // Truncate to ~4000 words to stay within LLM context limits
    const truncated = content.split(/\s+/).slice(0, 4000).join(' ');

    return { title, source, content: truncated || null };
  } catch (error) {
    console.error(`Failed to fetch ${url}:`, error);
    return { title: null, source: null, content: null };
  }
}

// ──────────────────────────────────────────────
// SIGNAL CREATION
// ──────────────────────────────────────────────

export async function createSignal(params: {
  rawContent: string;
  channel: Channel;
  userId?: string;
}) {
  const { rawContent, channel, userId = 'default' } = params;
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
  } catch (error) {
    console.error(`Failed to enrich signal ${signalId}:`, error);
    await prisma.signal.update({
      where: { id: signalId },
      data: { status: 'FAILED' },
    });
  }
}
