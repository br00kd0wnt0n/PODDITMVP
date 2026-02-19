'use client';

import React, { useState, useRef, useEffect } from 'react';

const DEFAULT_PLACEHOLDERS = [
  'Paste a link you\'ve been meaning to read...',
  'Type in a topic you\'re curious about...',
  'Drop a podcast episode URL...',
  'Record a voice note with something on your mind...',
  '"Why is everyone talking about X?"',
];
const VOICE_PLACEHOLDER_IDX = DEFAULT_PLACEHOLDERS.findIndex(p => p.startsWith('Record a voice'));

interface CaptureInputProps {
  refreshData: () => void;
  isEmptyState: boolean;
  generating: boolean;
}

function formatTime(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function CaptureInput({
  refreshData,
  isEmptyState,
  generating,
}: CaptureInputProps) {
  // Input state
  const [textInput, setTextInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [inputSuccess, setInputSuccess] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [inputFocused, setInputFocused] = useState(false);

  // Refs for recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Typewriter state
  const [typedText, setTypedText] = useState('');
  const [twFading, setTwFading] = useState(false);
  const [twPhraseIdx, setTwPhraseIdx] = useState(0);
  const typewriterRef = useRef<NodeJS.Timeout | null>(null);
  const twStateRef = useRef({ phraseIdx: 0, charIdx: 0, phase: 'typing' as 'typing' | 'holding' | 'fading' | 'pause' });

  // Typewriter effect
  useEffect(() => {
    const tick = () => {
      const s = twStateRef.current;
      const phrase = DEFAULT_PLACEHOLDERS[s.phraseIdx];
      if (s.phase === 'typing') {
        s.charIdx++;
        setTypedText(phrase.slice(0, s.charIdx));
        if (s.charIdx >= phrase.length) {
          s.phase = 'holding';
        }
      } else if (s.phase === 'holding') {
        s.charIdx++;
        if (s.charIdx >= phrase.length + 40) {
          s.phase = 'fading';
          setTwFading(true);
          s.charIdx = 0;
        }
      } else if (s.phase === 'fading') {
        s.charIdx++;
        if (s.charIdx >= 10) {
          setTwFading(false);
          setTypedText('');
          s.phase = 'pause';
          s.charIdx = 0;
        }
      } else {
        s.charIdx++;
        if (s.charIdx >= 10) {
          s.phraseIdx = (s.phraseIdx + 1) % DEFAULT_PLACEHOLDERS.length;
          setTwPhraseIdx(s.phraseIdx);
          s.charIdx = 0;
          s.phase = 'typing';
        }
      }
    };
    typewriterRef.current = setInterval(tick, 50);
    return () => {
      if (typewriterRef.current) clearInterval(typewriterRef.current);
    };
  }, []);

  // Pause/resume typewriter when generating changes
  useEffect(() => {
    if (generating) {
      if (typewriterRef.current) {
        clearInterval(typewriterRef.current);
        typewriterRef.current = null;
      }
    }
    // Typewriter restarts on next mount cycle or when generating ends
    // The main useEffect will handle restart since it runs on mount
  }, [generating]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (typewriterRef.current) clearInterval(typewriterRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // ── Text Input ──

  const submitText = async () => {
    const text = textInput.trim();
    if (!text) return;
    setSubmitting(true);
    setInputError(null);
    setInputSuccess(null);

    try {
      const res = await fetch('/api/capture/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Capture failed');

      setTextInput('');
      setInputSuccess(data.type === 'link' ? 'Link added to queue' : `"${text.slice(0, 60)}" added to queue`);
      setTimeout(() => setInputSuccess(null), 4000);

      // Wait briefly for enrichment + classification, then refresh
      setTimeout(() => refreshData(), 2000);
    } catch (error: any) {
      setInputError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitText();
    }
  };

  // ── Voice Recording ──

  const startRecording = async () => {
    try {
      setInputError(null);
      setInputSuccess(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        await sendVoiceNote(blob);
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 119) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      setInputError(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Allow it in browser settings.'
          : 'Could not start recording.'
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  };

  const sendVoiceNote = async (blob: Blob) => {
    setProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'voice.webm');

      const res = await fetch('/api/capture/quick', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice capture failed');

      setInputSuccess(`"${data.transcript?.slice(0, 60) || 'Voice note'}..." added to queue`);
      setTimeout(() => setInputSuccess(null), 5000);

      setTimeout(() => refreshData(), 2000);
    } catch (error: any) {
      setInputError(error.message);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="mb-2">
      {/* Input error — always mounted, toggled via display */}
      <div
        style={{ display: inputError ? 'flex' : 'none' }}
        className="mb-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs items-center justify-between"
      >
        <span>{inputError}</span>
        <button onClick={() => setInputError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
      </div>

      {/* All three capture states always mounted — toggled via display to avoid
          React removeChild calls that conflict with Chrome autofill DOM mutations. */}
      <div style={{ display: recording ? 'block' : 'none' }}>
        <button onClick={stopRecording} className="w-full py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2">
          <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
          {formatTime(recordingTime)} &mdash; Recording...
          <span className="ml-1 text-xs text-red-500 font-medium">[Stop]</span>
        </button>
      </div>
      <div style={{ display: processing ? 'block' : 'none' }}>
        <div className="w-full py-3 px-4 bg-poddit-900 border border-poddit-700 rounded-xl text-sm text-stone-400 flex items-center justify-center gap-2">
          <svg className="animate-spin h-4 w-4 text-teal-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Transcribing...
        </div>
      </div>
      <div style={{ display: !recording && !processing ? 'flex' : 'none' }} className="flex-col sm:flex-row gap-2">
        <div className="relative flex-1 input-lens-flare">
          <input
            type="text" value={textInput} onChange={(e) => setTextInput(e.target.value)}
            onKeyDown={handleKeyDown} onFocus={() => setInputFocused(true)} onBlur={() => setInputFocused(false)}
            placeholder=" " disabled={submitting} autoComplete="off"
            className={`w-full px-4 py-3.5 bg-white/[0.07] border rounded-xl text-sm text-white
                       placeholder:text-stone-400 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30
                       focus:bg-white/[0.10] disabled:opacity-40 transition-all
                       ${inputSuccess ? 'border-teal-500/25 shadow-[0_0_12px_rgba(20,184,166,0.08)]' : isEmptyState ? 'border-white/20 shadow-[0_0_20px_rgba(255,255,255,0.04)]' : 'border-white/15'}`}
          />
          {/* Always-mounted overlays — toggled via CSS opacity */}
          <span
            className="absolute inset-0 flex items-center pl-4 pr-4 text-sm text-teal-400 pointer-events-none overflow-hidden whitespace-nowrap transition-opacity duration-200"
            style={{ opacity: inputSuccess && !textInput && !inputFocused ? 1 : 0 }}
            aria-hidden={!(inputSuccess && !textInput && !inputFocused)}
          >
            ✓ {inputSuccess}
          </span>
          <span
            className="absolute inset-0 flex items-center pl-4 pr-4 text-sm text-stone-500 pointer-events-none overflow-hidden whitespace-nowrap"
            style={{
              opacity: !textInput && !inputFocused && !inputSuccess ? (twFading ? 0 : 1) : 0,
              transition: twFading ? 'opacity 0.4s ease-out' : 'none',
            }}
            aria-hidden={!(!textInput && !inputFocused && !inputSuccess)}
          >
            {typedText}<span className="animate-blink-cursor text-teal-400/60 font-light">|</span>
          </span>
          <span className="flare-right" /><span className="flare-bottom" /><span className="flare-left" />
        </div>
        <div className="flex gap-2">
          <button onClick={submitText} disabled={submitting || !textInput.trim()}
            className="flex-1 sm:flex-none px-6 py-3.5 bg-white text-poddit-950 text-sm font-bold rounded-xl hover:bg-stone-100 disabled:bg-stone-800 disabled:text-stone-600 disabled:cursor-not-allowed shadow-[0_2px_8px_rgba(255,255,255,0.10)] hover:shadow-[0_2px_12px_rgba(255,255,255,0.15)] disabled:shadow-none transition-all flex-shrink-0">
            {submitting ? '...' : 'Add'}
          </button>
          <button onClick={startRecording} disabled={submitting} title="Record a voice note"
            className={`px-3 py-3.5 border rounded-xl hover:border-white/30 hover:text-white hover:bg-white/[0.06] disabled:opacity-40 disabled:cursor-not-allowed transition-all flex-shrink-0
                       ${isEmptyState && twPhraseIdx === VOICE_PLACEHOLDER_IDX && !twFading ? 'border-red-400/40 text-red-400 animate-mic-pulse-red' : isEmptyState ? 'border-white/20 text-stone-300 animate-mic-pulse' : 'border-white/15 text-stone-400'}`}>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
