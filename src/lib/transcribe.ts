import OpenAI from 'openai';

// ──────────────────────────────────────────────
// VOICE TRANSCRIPTION (OpenAI Whisper)
// ──────────────────────────────────────────────

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function transcribeAudio(audioUrl: string): Promise<string> {
  console.log(`[Transcribe] Fetching audio from: ${audioUrl}`);

  // Twilio media URLs require auth
  const response = await fetch(audioUrl, {
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(
          `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
        ).toString('base64'),
    },
    signal: AbortSignal.timeout(30000),
  });

  if (!response.ok) {
    throw new Error(`Failed to download audio: ${response.status}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'audio/ogg';

  // Determine file extension from content type
  const extMap: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/amr': 'amr',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'mp4',
    'audio/wav': 'wav',
    'audio/x-m4a': 'm4a',
    'audio/mp4a-latm': 'm4a',
    'video/mp4': 'mp4',
  };
  const ext = extMap[contentType] || 'ogg';

  console.log(`[Transcribe] Audio type: ${contentType}, size: ${audioBuffer.byteLength} bytes`);

  // Create a File object for the OpenAI API
  const audioFile = new File(
    [audioBuffer],
    `voice.${ext}`,
    { type: contentType }
  );

  const transcription = await openai.audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'en',
  });

  console.log(`[Transcribe] Result: "${transcription.text.slice(0, 100)}"`);

  return transcription.text;
}
