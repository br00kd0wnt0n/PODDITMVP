import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { VOICES } from '@/lib/tts';
import { requireSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';

// ──────────────────────────────────────────────
// Normalize audio loudness via ffmpeg loudnorm
// ──────────────────────────────────────────────
async function normalizeLoudness(buffer: Buffer): Promise<Buffer> {
  const id = randomUUID();
  const inputPath = join(tmpdir(), `poddit-sample-in-${id}.mp3`);
  const outputPath = join(tmpdir(), `poddit-sample-out-${id}.mp3`);
  try {
    await writeFile(inputPath, buffer);
    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', [
        '-i', inputPath,
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
        '-codec:a', 'libmp3lame', '-b:a', '192k',
        '-y', outputPath,
      ], { timeout: 15000 }, (error) => {
        if (error) reject(error); else resolve();
      });
    });
    return await readFile(outputPath);
  } finally {
    await unlink(inputPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

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
  // Require logged-in user (only settings page uses this)
  const sessionResult = await requireSession();
  if (sessionResult instanceof NextResponse) return sessionResult;
  const { userId } = sessionResult;

  // Rate limit: 10 per minute per user (each miss generates an ElevenLabs TTS call)
  const { allowed } = rateLimit(`voice-sample:${userId}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const voiceKey = request.nextUrl.searchParams.get('voice');

  if (!voiceKey || !VOICES[voiceKey]) {
    return NextResponse.json(
      { error: `Invalid voice. Options: ${Object.keys(VOICES).join(', ')}` },
      { status: 400 }
    );
  }

  const voice = VOICES[voiceKey];
  const s3Key = `voice-samples/v2/${voiceKey}.mp3`;
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

    // Normalize loudness so all voices have consistent volume
    let finalBuffer: Buffer;
    try {
      finalBuffer = await normalizeLoudness(Buffer.from(audioBuffer));
      console.log(`[VoiceSample] Normalized loudness for ${voiceKey}`);
    } catch (normError) {
      console.warn(`[VoiceSample] Loudness normalization failed, using raw audio:`, normError);
      finalBuffer = Buffer.from(audioBuffer);
    }

    // Upload to R2 for caching
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET || 'poddit-audio',
      Key: s3Key,
      Body: finalBuffer,
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
