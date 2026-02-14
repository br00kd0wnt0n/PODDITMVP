import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

const s3 = new S3Client({
  endpoint: process.env.S3_ENDPOINT,
  region: 'auto',
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY || '',
    secretAccessKey: process.env.S3_SECRET_KEY || '',
  },
});

// ──────────────────────────────────────────────
// VOICE OPTIONS
// ──────────────────────────────────────────────

export const VOICES: Record<string, { id: string; name: string; description: string }> = {
  gandalf:  { id: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', name: 'Gandalf', description: 'Deep, low, strong' },
  jon:      { id: 'PIGsltMj3gFMR34aFDI3', name: 'Jon',     description: 'Trustworthy, calm, confident' },
  ivy:      { id: 'yM93hbw8Qtvdma2wCnJG', name: 'Ivy',     description: 'Young, confident, dynamic' },
  marcus:   { id: 'Fxnja7VG3W3xXd40zllt', name: 'Marcus',  description: 'Confident, articulate, British' },
};

export const DEFAULT_VOICE = 'gandalf';

// ──────────────────────────────────────────────
// MUSIC PATHS
// ──────────────────────────────────────────────

const INTRO_MUSIC = join(process.cwd(), 'public/audio/Poddit_Intro.mp3');
const OUTRO_MUSIC = join(process.cwd(), 'public/audio/poddit_Outro.mp3');

// Music volume relative to narration (0.0–1.0)
const MUSIC_VOLUME = 0.14;

// Seconds of intro music that plays solo before voiceover begins
const INTRO_LEAD_IN = 4;

// ──────────────────────────────────────────────
// RETRY HELPER
// ──────────────────────────────────────────────

async function withRetry<T>(
  fn: () => Promise<T>,
  { attempts = 3, delayMs = 1000, label = 'operation' }: { attempts?: number; delayMs?: number; label?: string } = {}
): Promise<T> {
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLast = i === attempts - 1;
      const status = error?.status || error?.statusCode;
      const isRetryable = !status || status === 429 || status >= 500;

      if (isLast || !isRetryable) throw error;

      const wait = delayMs * Math.pow(2, i);
      console.log(`[TTS] ${label} failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms...`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts`);
}

// ──────────────────────────────────────────────
// AUDIO GENERATION VIA ELEVENLABS
// ──────────────────────────────────────────────

export async function generateAudio(
  script: string,
  episodeId: string,
  voiceKey?: string
): Promise<{ audioUrl: string; duration: number }> {
  const voice = VOICES[voiceKey || DEFAULT_VOICE] || VOICES[DEFAULT_VOICE];
  const voiceId = voice.id;

  console.log(`[TTS] Generating audio for episode ${episodeId} (${script.length} chars, voice: ${voice.name})`);

  // ElevenLabs has a per-request character limit (~5000 for standard).
  // For longer scripts, chunk and concatenate.
  const chunks = chunkScript(script, 4500);
  const audioBuffers: Buffer[] = [];

  for (let i = 0; i < chunks.length; i++) {
    console.log(`[TTS] Processing chunk ${i + 1}/${chunks.length}`);

    const audioBuffer = await withRetry(async () => {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
        {
          method: 'POST',
          headers: {
            'xi-api-key': process.env.ELEVENLABS_API_KEY || '',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            text: chunks[i],
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
        const errorText = await response.text();
        const err: any = new Error(`ElevenLabs API error: ${response.status} - ${errorText}`);
        err.status = response.status;
        throw err;
      }

      return Buffer.from(await response.arrayBuffer());
    }, { label: `TTS chunk ${i + 1}/${chunks.length}`, attempts: 3, delayMs: 2000 });

    audioBuffers.push(audioBuffer);
  }

  // Concatenate audio chunks (simple concatenation works for MP3)
  const rawAudio = Buffer.concat(audioBuffers);

  // Mix intro/outro music if available
  const { buffer: mixedAudio, duration: actualDuration } = await mixWithMusic(rawAudio);
  const fullAudio = mixedAudio;

  // Use actual duration if we got it from ffmpeg, otherwise estimate
  const estimatedWords = script.length / 5;
  const estimatedDuration = Math.round((estimatedWords / 150) * 60);
  const duration = actualDuration || estimatedDuration;

  // Upload to S3/R2 (with retry)
  const key = `episodes/${episodeId}.mp3`;

  await withRetry(
    () => s3.send(
      new PutObjectCommand({
        Bucket: process.env.S3_BUCKET || 'poddit-audio',
        Key: key,
        Body: fullAudio,
        ContentType: 'audio/mpeg',
      })
    ),
    { label: 'S3 upload', attempts: 3, delayMs: 2000 }
  );

  const audioUrl = `${process.env.S3_PUBLIC_URL}/${key}`;
  console.log(`[TTS] Audio uploaded: ${audioUrl} (~${duration}s)`);

  return { audioUrl, duration };
}

// ──────────────────────────────────────────────
// MUSIC MIXING — overlay intro/outro music
// ──────────────────────────────────────────────

async function mixWithMusic(narrationBuffer: Buffer): Promise<{ buffer: Buffer; duration: number }> {
  // Check if music files exist
  const hasIntro = await fileExists(INTRO_MUSIC);
  const hasOutro = await fileExists(OUTRO_MUSIC);

  if (!hasIntro && !hasOutro) {
    console.log('[TTS] No music files found, skipping mix');
    return { buffer: narrationBuffer, duration: 0 };
  }

  const id = randomUUID();
  const narrationPath = join(tmpdir(), `poddit-narration-${id}.mp3`);
  const outputPath = join(tmpdir(), `poddit-mixed-${id}.mp3`);

  try {
    await writeFile(narrationPath, narrationBuffer);

    // Get narration duration for outro positioning
    const narrationDuration = await getAudioDuration(narrationPath);
    console.log(`[TTS] Narration duration: ${narrationDuration}s`);

    // Build the ffmpeg filter graph
    // Strategy: intro music plays solo for INTRO_LEAD_IN seconds, then narration
    // starts with music underneath. Outro music overlays near the end.
    const inputs: string[] = ['-i', narrationPath];
    let inputCount = 1;
    const introIdx = hasIntro ? inputCount++ : -1;
    const outroIdx = hasOutro ? inputCount++ : -1;

    if (hasIntro) {
      inputs.push('-i', INTRO_MUSIC);
    }
    if (hasOutro) {
      inputs.push('-i', OUTRO_MUSIC);
    }

    // Build filter complex
    // [0] = narration, [1] = intro (if exists), [2 or 1] = outro (if exists)
    const filterParts: string[] = [];
    const mixInputs: string[] = [];

    // Narration: delay by INTRO_LEAD_IN seconds so intro music plays solo first
    const narrationDelayMs = hasIntro ? INTRO_LEAD_IN * 1000 : 0;
    if (narrationDelayMs > 0) {
      filterParts.push(
        `[0:a]adelay=${narrationDelayMs}|${narrationDelayMs}[narr_delayed]`
      );
      mixInputs.push('[narr_delayed]');
    } else {
      mixInputs.push('[0:a]');
    }

    // Total duration of the final mix (narration + lead-in offset)
    const totalDuration = narrationDuration + (hasIntro ? INTRO_LEAD_IN : 0);

    if (hasIntro) {
      // Intro: play from the very start, reduce volume
      filterParts.push(
        `[${introIdx}:a]volume=${MUSIC_VOLUME}[intro_vol]`
      );
      mixInputs.push('[intro_vol]');
    }

    if (hasOutro) {
      // Outro: delay to start near the end (account for narration offset)
      const outroDuration = await getAudioDuration(OUTRO_MUSIC);
      const outroDelay = Math.max(0, totalDuration - outroDuration);
      const outroDelayMs = Math.round(outroDelay * 1000);

      filterParts.push(
        `[${outroIdx}:a]volume=${MUSIC_VOLUME},adelay=${outroDelayMs}|${outroDelayMs}[outro_vol]`
      );
      mixInputs.push('[outro_vol]');
    }

    // Mix all inputs together — duration=longest so the intro lead-in is preserved
    // Use weights to prevent amix from dividing narration volume by input count:
    // narration gets weight 1, music tracks get lower weights
    const mixCount = mixInputs.length;
    const weights = ['1', ...Array(mixCount - 1).fill('0.3')].join(' ');
    const filterComplex = [
      ...filterParts,
      `${mixInputs.join('')}amix=inputs=${mixCount}:duration=longest:dropout_transition=2:weights=${weights},volume=${mixCount}[out]`
    ].join(';');

    const ffmpegArgs: string[] = [
      ...inputs,
      '-filter_complex', filterComplex,
      '-map', '[out]',
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      '-y',
      outputPath,
    ];

    console.log(`[TTS] Mixing audio: ${hasIntro ? 'intro' : ''} ${hasOutro ? 'outro' : ''}`);

    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', ffmpegArgs, { timeout: 60000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error(`[TTS] ffmpeg stderr: ${stderr}`);
          reject(new Error(`ffmpeg mix failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });

    const mixedBuffer = await readFile(outputPath);
    const mixedDuration = await getAudioDuration(outputPath).catch(() => 0);

    console.log(`[TTS] Mixed audio: ${mixedBuffer.length} bytes (~${Math.round(mixedDuration)}s)`);

    return { buffer: mixedBuffer, duration: Math.round(mixedDuration) };
  } catch (error) {
    console.error('[TTS] Music mixing failed, using narration only:', error);
    // Fallback: return original narration if mixing fails
    return { buffer: narrationBuffer, duration: 0 };
  } finally {
    // Cleanup temp files
    await unlink(narrationPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    execFile('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      filePath,
    ], { timeout: 10000 }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`ffprobe failed: ${error.message}`));
        return;
      }
      try {
        const info = JSON.parse(stdout);
        resolve(parseFloat(info.format?.duration || '0'));
      } catch {
        reject(new Error('Failed to parse ffprobe output'));
      }
    });
  });
}

function chunkScript(script: string, maxChars: number): string[] {
  const chunks: string[] = [];
  const paragraphs = script.split('\n\n');
  let current = '';

  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length > maxChars && current.length > 0) {
      chunks.push(current.trim());
      current = para;
    } else {
      current = current ? current + '\n\n' + para : para;
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks;
}
