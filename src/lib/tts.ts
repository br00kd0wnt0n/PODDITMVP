import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

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
  gandalf:   { id: process.env.ELEVENLABS_VOICE_ID || 'pNInz6obpgDQGcFmaJgB', name: 'Gandalf',   description: 'Deep, authoritative, warm' },
  jonathon:  { id: 'PIGsltMj3gFMR34aFDI3', name: 'Jonathon',  description: 'Clear, confident, conversational' },
  ivanna:    { id: 'yM93hbw8Qtvdma2wCnJG', name: 'Ivanna',    description: 'Smooth, articulate, engaging' },
  marcus:    { id: '85o4S4rAEvTIDGtpFNUq', name: 'Marcus',    description: 'Calm, analytical, grounded' },
};

export const DEFAULT_VOICE = 'gandalf';

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
      const error = await response.text();
      throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    audioBuffers.push(Buffer.from(arrayBuffer));
  }

  // Concatenate audio chunks (simple concatenation works for MP3)
  const fullAudio = Buffer.concat(audioBuffers);

  // Estimate duration (~150 words per minute, ~5 chars per word)
  const estimatedWords = script.length / 5;
  const estimatedDuration = Math.round((estimatedWords / 150) * 60);

  // Upload to S3/R2
  const key = `episodes/${episodeId}.mp3`;
  
  await s3.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET || 'poddit-audio',
      Key: key,
      Body: fullAudio,
      ContentType: 'audio/mpeg',
    })
  );

  const audioUrl = `${process.env.S3_PUBLIC_URL}/${key}`;
  console.log(`[TTS] Audio uploaded: ${audioUrl} (~${estimatedDuration}s)`);

  return { audioUrl, duration: estimatedDuration };
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

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
