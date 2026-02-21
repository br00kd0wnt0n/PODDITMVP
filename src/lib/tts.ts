import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { withRetry } from './retry';

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
  jon:      { id: 'Cz0K1kOv9tD8l0b5Qu53', name: 'Jon',     description: 'Trustworthy, calm, confident' },
  ivy:      { id: 'i4CzbCVWoqvD0P1QJCUL', name: 'Ivy',     description: 'Young, confident, dynamic' },
  harper:   { id: 'Fihx1nL7DQV0DEuFJSG1', name: 'Harper',  description: 'Clear, factual, strong' },
  gandalf:  { id: process.env.ELEVENLABS_VOICE_ID || 'goT3UYdM9bhm0n2lmKQx', name: 'Gandalf', description: 'Deep, low, strong' },
};

export const DEFAULT_VOICE = 'jon';

// ──────────────────────────────────────────────
// MUSIC PATHS
// ──────────────────────────────────────────────

const INTRO_MUSIC = join(process.cwd(), 'public/audio/Poddit_Intro.mp3');
const OUTRO_MUSIC = join(process.cwd(), 'public/audio/poddit_Outro.mp3');
const EPILOGUE_MUSIC = join(process.cwd(), 'public/audio/Poddit_Epilogue.mp3');

// Music volume relative to narration (0.0–1.0)
const MUSIC_VOLUME = 0.14;

// Epilogue sound bed volume (slightly higher — it's a quieter bed)
const EPILOGUE_MUSIC_VOLUME = 0.18;

// Seconds of intro music that plays solo before voiceover begins
const INTRO_LEAD_IN = 4;

// Seconds of silence between main episode end and epilogue start
const EPILOGUE_GAP = 1.5;

// The midpoint of the outro music should align with the end of narration.
// This means half the outro plays under the final dialogue, half lingers after.

// ──────────────────────────────────────────────
// AUDIO GENERATION VIA ELEVENLABS
// ──────────────────────────────────────────────

export async function generateAudio(
  script: string,
  episodeId: string,
  voiceKey?: string,
  epilogueScript?: string
): Promise<{ audioUrl: string; duration: number; ttsCharacters: number; ttsChunks: number; ttsMs: number }> {
  const ttsStart = Date.now();
  const voice = VOICES[voiceKey || DEFAULT_VOICE] || VOICES[DEFAULT_VOICE];
  const voiceId = voice.id;

  const totalChars = script.length + (epilogueScript?.length || 0);
  console.log(`[TTS] Generating audio for episode ${episodeId} (${totalChars} chars, voice: ${voice.name}${epilogueScript ? ', +epilogue' : ''})`);

  // ── Main narration TTS ──
  const mainAudio = await ttsToBuffer(script, voiceId);

  // ── Mix main narration with intro/outro music ──
  const { buffer: mixedMain, duration: mainDuration } = await withRetry(
    () => mixWithMusic(mainAudio),
    { label: 'Music mixing', attempts: 2, delayMs: 3000 }
  ).catch((error) => {
    console.error('[TTS] Music mixing failed after retries, using narration only:', error);
    return { buffer: mainAudio, duration: 0 };
  });

  // ── Epilogue (separate TTS + sound bed) ──
  let fullAudio = mixedMain;
  let epilogueChars = 0;
  let epilogueChunks = 0;

  if (epilogueScript) {
    try {
      const epilogueAudio = await ttsToBuffer(epilogueScript, voiceId);
      epilogueChars = epilogueScript.length;
      epilogueChunks = chunkScript(epilogueScript, 4500).length;

      // Mix epilogue narration with epilogue sound bed, then concatenate after main
      const { buffer: mixedEpilogue } = await withRetry(
        () => mixEpilogue(epilogueAudio),
        { label: 'Epilogue mixing', attempts: 2, delayMs: 3000 }
      ).catch((error) => {
        console.error('[TTS] Epilogue mixing failed, using narration only:', error);
        return { buffer: epilogueAudio };
      });

      // Concatenate: main episode + gap + epilogue via ffmpeg
      fullAudio = await concatenateWithGap(mixedMain, mixedEpilogue, EPILOGUE_GAP);
      console.log(`[TTS] Epilogue appended (${epilogueChars} chars)`);
    } catch (error) {
      console.error('[TTS] Epilogue TTS failed, episode will play without epilogue:', error);
      // fullAudio remains mixedMain — episode works fine without epilogue
    }
  }

  // Get final duration
  const finalDuration = await getDurationFromBuffer(fullAudio).catch(() => {
    const estimatedWords = totalChars / 5;
    return Math.round((estimatedWords / 150) * 60);
  });

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
  console.log(`[TTS] Audio uploaded: ${audioUrl} (~${finalDuration}s)`);

  const mainChunks = chunkScript(script, 4500).length;
  const ttsMs = Date.now() - ttsStart;
  return {
    audioUrl,
    duration: finalDuration,
    ttsCharacters: totalChars,
    ttsChunks: mainChunks + epilogueChunks,
    ttsMs,
  };
}

// ──────────────────────────────────────────────
// TTS HELPER — convert text to audio buffer via ElevenLabs
// ──────────────────────────────────────────────

async function ttsToBuffer(text: string, voiceId: string): Promise<Buffer> {
  const chunks = chunkScript(text, 4500);
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

  return Buffer.concat(audioBuffers);
}

// ──────────────────────────────────────────────
// GET DURATION FROM BUFFER — write to temp, probe, cleanup
// ──────────────────────────────────────────────

async function getDurationFromBuffer(buffer: Buffer): Promise<number> {
  const id = randomUUID();
  const tmpPath = join(tmpdir(), `poddit-probe-${id}.mp3`);
  try {
    await writeFile(tmpPath, buffer);
    return await getAudioDuration(tmpPath);
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
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
      // Position outro so its midpoint aligns with end of narration:
      // half plays under closing dialogue, half lingers after speech ends
      const outroDelay = Math.max(0, totalDuration - (outroDuration / 2));
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
      `${mixInputs.join('')}amix=inputs=${mixCount}:duration=longest:dropout_transition=2:weights=${weights},loudnorm=I=-16:TP=-1.5:LRA=11[out]`
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
    console.error('[TTS] Music mixing attempt failed:', error);
    throw error; // Let caller handle retry + fallback
  } finally {
    // Cleanup temp files
    await unlink(narrationPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ──────────────────────────────────────────────
// EPILOGUE MIXING — overlay epilogue sound bed
// ──────────────────────────────────────────────

async function mixEpilogue(narrationBuffer: Buffer): Promise<{ buffer: Buffer }> {
  const hasEpilogueMusic = await fileExists(EPILOGUE_MUSIC);

  if (!hasEpilogueMusic) {
    console.log('[TTS] No epilogue music file found, using narration only');
    return { buffer: narrationBuffer };
  }

  const id = randomUUID();
  const narrationPath = join(tmpdir(), `poddit-epilogue-narr-${id}.mp3`);
  const outputPath = join(tmpdir(), `poddit-epilogue-mixed-${id}.mp3`);

  try {
    await writeFile(narrationPath, narrationBuffer);

    const narrationDuration = await getAudioDuration(narrationPath);
    console.log(`[TTS] Epilogue narration duration: ${narrationDuration}s`);

    // Simple mix: narration + sound bed underneath, trim to narration length + 2s tail
    const totalDuration = narrationDuration + 2;

    const ffmpegArgs: string[] = [
      '-i', narrationPath,
      '-i', EPILOGUE_MUSIC,
      '-filter_complex',
      `[1:a]volume=${EPILOGUE_MUSIC_VOLUME}[music];[0:a][music]amix=inputs=2:duration=first:dropout_transition=2:weights=1 0.3,loudnorm=I=-16:TP=-1.5:LRA=11[out]`,
      '-map', '[out]',
      '-t', String(totalDuration),
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      '-y',
      outputPath,
    ];

    console.log('[TTS] Mixing epilogue with sound bed');

    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', ffmpegArgs, { timeout: 30000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error(`[TTS] ffmpeg epilogue stderr: ${stderr}`);
          reject(new Error(`ffmpeg epilogue mix failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });

    const mixedBuffer = await readFile(outputPath);
    console.log(`[TTS] Epilogue mixed: ${mixedBuffer.length} bytes`);

    return { buffer: mixedBuffer };
  } finally {
    await unlink(narrationPath).catch(() => {});
    await unlink(outputPath).catch(() => {});
  }
}

// ──────────────────────────────────────────────
// CONCATENATION — join main episode + epilogue with gap
// ──────────────────────────────────────────────

async function concatenateWithGap(mainBuffer: Buffer, epilogueBuffer: Buffer, gapSeconds: number): Promise<Buffer> {
  const id = randomUUID();
  const mainPath = join(tmpdir(), `poddit-main-${id}.mp3`);
  const epiloguePath = join(tmpdir(), `poddit-epi-${id}.mp3`);
  const outputPath = join(tmpdir(), `poddit-final-${id}.mp3`);

  try {
    await writeFile(mainPath, mainBuffer);
    await writeFile(epiloguePath, epilogueBuffer);

    const mainDuration = await getAudioDuration(mainPath);
    const epilogueDelayMs = Math.round((mainDuration + gapSeconds) * 1000);

    // Use adelay to position epilogue after main + gap, then amix
    const ffmpegArgs: string[] = [
      '-i', mainPath,
      '-i', epiloguePath,
      '-filter_complex',
      `[1:a]adelay=${epilogueDelayMs}|${epilogueDelayMs}[epi_delayed];[0:a][epi_delayed]amix=inputs=2:duration=longest:dropout_transition=0:weights=1 1,volume=2[out]`,
      '-map', '[out]',
      '-codec:a', 'libmp3lame',
      '-b:a', '192k',
      '-y',
      outputPath,
    ];

    console.log(`[TTS] Concatenating main (${Math.round(mainDuration)}s) + ${gapSeconds}s gap + epilogue`);

    await new Promise<void>((resolve, reject) => {
      execFile('ffmpeg', ffmpegArgs, { timeout: 60000 }, (error, _stdout, stderr) => {
        if (error) {
          console.error(`[TTS] ffmpeg concat stderr: ${stderr}`);
          reject(new Error(`ffmpeg concat failed: ${error.message}`));
        } else {
          resolve();
        }
      });
    });

    const finalBuffer = await readFile(outputPath);
    const finalDuration = await getAudioDuration(outputPath).catch(() => 0);
    console.log(`[TTS] Final audio: ${finalBuffer.length} bytes (~${Math.round(finalDuration)}s)`);

    return finalBuffer;
  } finally {
    await unlink(mainPath).catch(() => {});
    await unlink(epiloguePath).catch(() => {});
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
    ], { timeout: 30000 }, (error, stdout, stderr) => {
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
    // Handle oversized paragraphs by splitting on sentence boundaries
    if (para.length > maxChars) {
      // Flush current buffer first
      if (current.trim()) {
        chunks.push(current.trim());
        current = '';
      }

      // Split the oversized paragraph on sentence endings
      const sentences = para.match(/[^.!?]+[.!?]+\s*/g) || [para];
      for (const sentence of sentences) {
        // If even a single sentence exceeds maxChars, hard-split it
        if (sentence.length > maxChars) {
          if (current.trim()) {
            chunks.push(current.trim());
            current = '';
          }
          // Hard-split at maxChars boundary as last resort
          for (let i = 0; i < sentence.length; i += maxChars) {
            chunks.push(sentence.slice(i, i + maxChars).trim());
          }
          continue;
        }

        if ((current + ' ' + sentence).length > maxChars && current.length > 0) {
          chunks.push(current.trim());
          current = sentence;
        } else {
          current = current ? current + ' ' + sentence : sentence;
        }
      }
      continue;
    }

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
