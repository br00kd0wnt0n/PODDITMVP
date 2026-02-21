'use client';

import { useState, useRef, useCallback, useEffect } from 'react';

// ──────────────────────────────────────────────
// Shared voice preview hook
// Used by: settings/page.tsx, WelcomeOnboarding.tsx
// Handles: audio playback, caching, progress tracking, cleanup
// ──────────────────────────────────────────────

export function useVoicePreview() {
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [voiceProgress, setVoiceProgress] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const sampleUrlCache = useRef<Record<string, string>>({});

  // Clean up audio on unmount
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  const stopPreview = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
    setPlayingVoice(null);
    setVoiceProgress(0);
  }, []);

  const trackProgress = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    if (audio.duration && audio.duration > 0) {
      setVoiceProgress((audio.currentTime / audio.duration) * 100);
    }
    animFrameRef.current = requestAnimationFrame(trackProgress);
  }, []);

  const playPreview = useCallback(async (voiceKey: string) => {
    if (playingVoice === voiceKey) {
      stopPreview();
      return;
    }

    stopPreview();
    setLoadingVoice(voiceKey);

    try {
      let url = sampleUrlCache.current[voiceKey];
      if (!url) {
        const res = await fetch(`/api/voices/sample?voice=${voiceKey}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to load sample');
        url = data.url;
        sampleUrlCache.current[voiceKey] = url;
      }

      const audio = new Audio(url);
      audioRef.current = audio;

      audio.addEventListener('ended', () => {
        setPlayingVoice(null);
        setVoiceProgress(0);
        if (animFrameRef.current) {
          cancelAnimationFrame(animFrameRef.current);
          animFrameRef.current = null;
        }
      });

      audio.addEventListener('canplaythrough', () => {
        setLoadingVoice(null);
        setPlayingVoice(voiceKey);
        audio.play();
        animFrameRef.current = requestAnimationFrame(trackProgress);
      }, { once: true });

      audio.addEventListener('error', () => {
        setLoadingVoice(null);
        setPlayingVoice(null);
      });

      audio.load();
    } catch (err) {
      console.error('[VoicePreview] Error:', err);
      setLoadingVoice(null);
    }
  }, [playingVoice, stopPreview, trackProgress]);

  return { playingVoice, loadingVoice, voiceProgress, playPreview, stopPreview };
}
