import Anthropic from '@anthropic-ai/sdk';
import prisma from './db';
import { SYSTEM_PROMPT, buildSynthesisPrompt } from './prompts';
import { generateAudio } from './tts';

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

export async function generateEpisode(params?: {
  userId?: string;
  since?: Date;
  manual?: boolean;
  signalIds?: string[];
}): Promise<string> {
  const userId = params?.userId || 'default';
  const since = params?.since || getLastWeekStart();

  console.log(`[Poddit] Generating episode for ${userId}${params?.signalIds ? ` (${params.signalIds.length} selected signals)` : ` since ${since.toISOString()}`}`);

  // 1. Gather signals — by IDs if provided, otherwise by date range
  const signals = params?.signalIds && params.signalIds.length > 0
    ? await prisma.signal.findMany({
        where: {
          id: { in: params.signalIds },
          userId,
          status: { in: ['QUEUED', 'ENRICHED'] },
        },
        orderBy: { createdAt: 'asc' },
      })
    : await prisma.signal.findMany({
        where: {
          userId,
          status: { in: ['QUEUED', 'ENRICHED'] },
          createdAt: { gte: since },
        },
        orderBy: { createdAt: 'asc' },
      });

  if (signals.length === 0) {
    console.log('[Poddit] No signals to process');
    throw new Error('No signals captured this period. Send some links or topics first!');
  }

  console.log(`[Poddit] Processing ${signals.length} signals`);

  // 2. Create the episode record
  const episode = await prisma.episode.create({
    data: {
      userId,
      title: `Generating...`,
      script: '',
      periodStart: since,
      periodEnd: new Date(),
      signalCount: signals.length,
      status: 'GENERATING',
    },
  });

  try {
    // 3. Build the synthesis prompt
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
      { manual: params?.manual }
    );

    // 4. Call Claude for synthesis
    console.log('[Poddit] Calling Claude for synthesis...');
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: synthesisPrompt }],
    });

    // 5. Parse the response
    const textContent = response.content.find(c => c.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Extract JSON from response (handle potential markdown wrapping)
    const jsonMatch = textContent.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('Could not extract JSON from response');
    }

    const episodeData: EpisodeData = JSON.parse(jsonMatch[0]);

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

    // 9. Mark signals as included
    await prisma.signal.updateMany({
      where: { id: { in: signals.map(s => s.id) } },
      data: { status: 'USED', episodeId: episode.id },
    });

    // 10. Generate audio
    console.log('[Poddit] Generating audio...');
    const { audioUrl, duration } = await generateAudio(fullScript, episode.id);

    // 11. Finalize episode
    await prisma.episode.update({
      where: { id: episode.id },
      data: {
        audioUrl,
        audioDuration: duration,
        status: 'READY',
      },
    });

    console.log(`[Poddit] Episode ready: ${episodeData.title}`);
    return episode.id;

  } catch (error) {
    console.error('[Poddit] Generation failed:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await prisma.episode.update({
      where: { id: episode.id },
      data: { status: 'FAILED', error: errorMessage },
    });
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

function getLastWeekStart(): Date {
  const now = new Date();
  const lastWeek = new Date(now);
  lastWeek.setDate(lastWeek.getDate() - 7);
  return lastWeek;
}
