import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { VOICES } from '@/lib/tts';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
});

// ──────────────────────────────────────────────
// GET /api/voices/sample?voice=gandalf
// Returns a voice sample audio URL (generates + caches in R2)
// ──────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const voiceKey = request.nextUrl.searchParams.get('voice');

  if (!voiceKey || !VOICES[voiceKey]) {
    return NextResponse.json(
      { error: `Invalid voice. Options: ${Object.keys(VOICES).join(', ')}` },
      { status: 400 }
    );
  }

  const voice = VOICES[voiceKey];
  const s3Key = `voice-samples/${voiceKey}.mp3`;
  const publicUrl = `${process.env.S3_PUBLIC_URL}/${s3Key}`;

  // Check if sample already exists in R2
  try {
    await s3.send(new HeadObjectCommand({
      Bucket: process.env.S3_BUCKET || 'poddit-audio',
      Key: s3Key,
    }));

    // Already cached
    return NextResponse.json({ url: publicUrl, cached: true });
  } catch {
    // Not cached yet — generate it
  }

  // Generate sample via ElevenLabs
  const sampleText = `Hi, I'm ${voice.name}. Welcome to Poddit. Your world, explained.`;

  try {
    console.log(`[VoiceSample] Generating sample for ${voiceKey} (${voice.name})`);

    const response = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voice.id}`,
      {
        method: 'POST',
        headers: {
          'xi-api-key': process.env.ELEVENLABS_API_KEY || '',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          text: sampleText,
          model_id: 'eleven_turbo_v2_5',
          voice_settings: {
            stability: 0.5,
            similarity_boost: 0.75,
            style: 0.3,
            use_speaker_boost: true,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[VoiceSample] ElevenLabs error: ${response.status} - ${error}`);
      return NextResponse.json(
        { error: 'Failed to generate voice sample' },
        { status: 502 }
      );
    }

    const audioBuffer = await response.arrayBuffer();

    // Upload to R2 for caching
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET || 'poddit-audio',
      Key: s3Key,
      Body: Buffer.from(audioBuffer),
      ContentType: 'audio/mpeg',
      CacheControl: 'public, max-age=31536000', // Cache for 1 year
    }));

    console.log(`[VoiceSample] Cached sample for ${voiceKey}: ${publicUrl}`);

    return NextResponse.json({ url: publicUrl, cached: false });
  } catch (error) {
    console.error('[VoiceSample] Generation failed:', error);
    return NextResponse.json(
      { error: 'Voice sample generation failed' },
      { status: 500 }
    );
  }
}
