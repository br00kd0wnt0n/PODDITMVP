import { NextResponse } from 'next/server';
import { VOICES, DEFAULT_VOICE } from '@/lib/tts';

// ──────────────────────────────────────────────
// GET /api/voices
// Returns available voice options
// ──────────────────────────────────────────────

export async function GET() {
  const voices = Object.entries(VOICES).map(([key, voice]) => ({
    key,
    name: voice.name,
    description: voice.description,
    isDefault: key === DEFAULT_VOICE,
  }));

  return NextResponse.json({ voices, default: DEFAULT_VOICE });
}
