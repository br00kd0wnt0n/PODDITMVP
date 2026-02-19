// ──────────────────────────────────────────────
// PRICING CONSTANTS & COST CALCULATION
// Centralised API pricing — update here when rates change
// ──────────────────────────────────────────────

// Claude claude-sonnet-4-5-20250929 (per token)
export const CLAUDE_INPUT_PRICE_PER_TOKEN = 3.0 / 1_000_000;    // $3.00 / MTok
export const CLAUDE_OUTPUT_PRICE_PER_TOKEN = 15.0 / 1_000_000;  // $15.00 / MTok
export const CLAUDE_WEB_SEARCH_PRICE = 0.01;                     // $0.01 per search

// ElevenLabs eleven_turbo_v2_5 — Creator tier (per character)
export const ELEVENLABS_PRICE_PER_CHAR = 0.30 / 1_000;          // $0.30 / 1K chars

export interface GenerationCosts {
  claude: number;
  webSearch: number;
  tts: number;
  total: number;
}

export function calculateGenerationCosts(meta: {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
  ttsCharacters: number;
}): GenerationCosts {
  const claude =
    meta.inputTokens * CLAUDE_INPUT_PRICE_PER_TOKEN +
    meta.outputTokens * CLAUDE_OUTPUT_PRICE_PER_TOKEN;
  const webSearch = meta.webSearches * CLAUDE_WEB_SEARCH_PRICE;
  const tts = meta.ttsCharacters * ELEVENLABS_PRICE_PER_CHAR;
  const total = claude + webSearch + tts;

  return {
    claude: Math.round(claude * 10000) / 10000,
    webSearch: Math.round(webSearch * 10000) / 10000,
    tts: Math.round(tts * 10000) / 10000,
    total: Math.round(total * 10000) / 10000,
  };
}

export function formatCost(amount: number): string {
  if (amount < 0.01) return '<$0.01';
  return `$${amount.toFixed(2)}`;
}
