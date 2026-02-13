import OpenAI from 'openai';

// ──────────────────────────────────────────────
// VOICE TRANSCRIPTION (OpenAI Whisper)
// ──────────────────────────────────────────────

// Lazy-init so the build doesn't fail when OPENAI_API_KEY is missing
let _openai: OpenAI | null = null;
function getOpenAI(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

const EXT_MAP: Record<string, string> = {
  'audio/ogg': 'ogg',
  'audio/amr': 'amr',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'mp4',
  'audio/wav': 'wav',
  'audio/x-m4a': 'm4a',
  'audio/mp4a-latm': 'm4a',
  'audio/webm': 'webm',
  'audio/webm;codecs=opus': 'webm',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

export async function transcribeAudio(audioUrl: string): Promise<string> {
  console.log(`[Transcribe] Fetching audio from: ${audioUrl}`);

  // Twilio media URLs require Basic auth.
  // Note: Twilio URLs may redirect — we first try with auth, then follow redirects without.
  const twilioAuth =
    'Basic ' +
    Buffer.from(
      `${process.env.TWILIO_ACCOUNT_SID}:${process.env.TWILIO_AUTH_TOKEN}`
    ).toString('base64');

  let response = await fetch(audioUrl, {
    headers: { Authorization: twilioAuth },
    redirect: 'manual',  // Handle redirects manually to avoid dropping auth
    signal: AbortSignal.timeout(30000),
  });

  // Follow redirect without auth (Twilio redirects to a signed URL that doesn't need auth)
  if (response.status >= 300 && response.status < 400) {
    const redirectUrl = response.headers.get('location');
    console.log(`[Transcribe] Following redirect to: ${redirectUrl?.slice(0, 80)}`);
    if (redirectUrl) {
      response = await fetch(redirectUrl, {
        signal: AbortSignal.timeout(30000),
      });
    }
  }

  if (!response.ok) {
    throw new Error(`Failed to download audio: HTTP ${response.status} ${response.statusText}`);
  }

  const audioBuffer = await response.arrayBuffer();
  const contentType = response.headers.get('content-type') || 'audio/ogg';

  const ext = EXT_MAP[contentType] || 'ogg';

  console.log(`[Transcribe] Audio type: ${contentType}, size: ${audioBuffer.byteLength} bytes`);

  if (audioBuffer.byteLength === 0) {
    throw new Error('Downloaded audio file is empty (0 bytes)');
  }

  // Create a File object for the OpenAI API
  const audioFile = new File(
    [audioBuffer],
    `voice.${ext}`,
    { type: contentType }
  );

  const transcription = await getOpenAI().audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'en',
  });

  console.log(`[Transcribe] Result: "${transcription.text.slice(0, 100)}"`);

  return transcription.text;
}

// ──────────────────────────────────────────────
// BUFFER-BASED TRANSCRIPTION (for browser recordings)
// ──────────────────────────────────────────────

export async function transcribeAudioBuffer(
  buffer: Buffer,
  contentType: string
): Promise<string> {
  console.log(`[Transcribe] Processing buffer: ${contentType}, size: ${buffer.length} bytes`);

  const ext = EXT_MAP[contentType] || 'webm';

  const audioFile = new File(
    [new Uint8Array(buffer)],
    `voice.${ext}`,
    { type: contentType }
  );

  const transcription = await getOpenAI().audio.transcriptions.create({
    file: audioFile,
    model: 'whisper-1',
    language: 'en',
  });

  console.log(`[Transcribe] Result: "${transcription.text.slice(0, 100)}"`);
  return transcription.text;
}
