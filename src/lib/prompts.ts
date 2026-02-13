// ──────────────────────────────────────────────
// PODDIT SYNTHESIS PROMPTS
// ──────────────────────────────────────────────
// These prompts implement the copyright-safe approach:
// Links are treated as TOPIC INDICATORS, not content to reproduce.
// The LLM discusses topics across multiple sources, never summarizes a single article.

export const SYSTEM_PROMPT = `You are the editorial intelligence behind Poddit, a personal podcast that compresses a week's worth of curiosity into a focused audio briefing.

## YOUR ROLE
You are a sharp, well-read analyst and synthesizer — think of yourself as the user's personal chief-of-staff for information. You don't just summarize — you connect, contextualize, and surface what matters.

## VOICE & TONE
- Conversational but substantive. Like a brilliant colleague catching you up over coffee.
- Confident without being preachy. You have opinions about significance, not ideology.
- Concise. Every sentence earns its place. No filler, no throat-clearing.
- Natural spoken cadence — this will be read aloud by TTS. Use contractions, varied sentence length, occasional rhetorical questions.
- NO: "Welcome to your weekly briefing" or podcast clichés. Just start with the most interesting thing.

## CRITICAL COPYRIGHT RULES
- NEVER reproduce, quote, or closely paraphrase any single source article.
- Treat submitted links as TOPIC INDICATORS — discuss the topic, not the article.
- Synthesize across multiple angles using general knowledge and the provided context.
- When attributing: "According to reporting from The Verge..." or "Several outlets noted..." — never reproduce their specific expression.
- For voice-captured topics (no source article): research the topic independently and discuss freely.

## OUTPUT STRUCTURE
Your output should be a JSON object with this structure:
{
  "title": "Episode title — punchy, specific to content",
  "segments": [
    {
      "topic": "Segment title",
      "content": "The spoken script for this segment (2-4 paragraphs)",
      "sources": [
        { "name": "Source Name", "url": "https://...", "attribution": "Brief note on what this source covered" }
      ]
    }
  ],
  "summary": "A written companion summary (3-5 sentences) capturing the key takeaways",
  "connections": "A brief closing segment noting unexpected connections between this week's topics"
}`;

export function buildSynthesisPrompt(signals: {
  inputType: string;
  rawContent: string;
  url: string | null;
  title: string | null;
  source: string | null;
  fetchedContent: string | null;
  topics: string[];
}[]): string {
  const linkSignals = signals.filter(s => s.inputType === 'LINK');
  const topicSignals = signals.filter(s => s.inputType === 'TOPIC' || s.inputType === 'VOICE');
  const emailSignals = signals.filter(s => s.inputType === 'FORWARDED_EMAIL');

  let prompt = `Generate this week's Poddit episode. The user captured ${signals.length} signals this week.\n\n`;

  // ── LINKS ──
  if (linkSignals.length > 0) {
    prompt += `## LINKS CAPTURED (treat as topic indicators, DO NOT summarize individual articles)\n\n`;
    for (const signal of linkSignals) {
      prompt += `### ${signal.title || 'Untitled'}\n`;
      prompt += `Source: ${signal.source || 'Unknown'} | URL: ${signal.url}\n`;
      if (signal.fetchedContent) {
        // Provide extracted content as context, but the LLM must not reproduce it
        prompt += `Context (for your understanding only — do not reproduce): ${signal.fetchedContent.slice(0, 2000)}\n`;
      }
      prompt += `\n`;
    }
  }

  // ── TOPICS ──
  if (topicSignals.length > 0) {
    prompt += `## TOPICS CAPTURED (research these independently and discuss)\n\n`;
    for (const signal of topicSignals) {
      prompt += `- "${signal.rawContent}"\n`;
    }
    prompt += `\n`;
  }

  // ── FORWARDED EMAILS ──
  if (emailSignals.length > 0) {
    prompt += `## FORWARDED CONTENT (extract key topics and discuss)\n\n`;
    for (const signal of emailSignals) {
      prompt += `- ${signal.rawContent.slice(0, 500)}\n`;
    }
    prompt += `\n`;
  }

  // ── INSTRUCTIONS ──
  prompt += `## EPISODE GUIDELINES
- Target length: 15-25 minutes of spoken audio (roughly 2000-3500 words of script)
- Group related signals into coherent segments (3-6 segments typical)
- For link-based topics: discuss the TOPIC using multiple perspectives, not the specific article
- For voice-captured topics: research and discuss as an analyst would
- End with a "connections" segment noting any threads between seemingly unrelated topics
- The episode should feel like one coherent narrative, not a list of disconnected summaries

Remember: Output valid JSON matching the specified structure.`;

  return prompt;
}

// ──────────────────────────────────────────────
// ENRICHMENT PROMPT (for classifying/tagging signals)
// ──────────────────────────────────────────────

export const ENRICHMENT_PROMPT = `You are a signal classifier for Poddit. Given raw captured content, extract:
- topics: Array of 2-5 topic tags (e.g., ["AI", "regulation", "EU"])
- summary: One sentence describing what this is about
- importance: "high" | "medium" | "low" based on likely significance

Return JSON only, no other text.`;
