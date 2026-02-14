'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

interface Source {
  name: string;
  url: string;
  attribution: string;
}

interface Segment {
  id: string;
  order: number;
  topic: string;
  content: string;
  sources: Source[];
}

interface Signal {
  id: string;
  inputType: string;
  title: string | null;
  url: string | null;
  source: string | null;
  channel: string;
}

// Voice display names (matches keys in tts.ts VOICES)
const VOICE_NAMES: Record<string, string> = {
  gandalf: 'Gandalf',
  jon: 'Jon',
  ivy: 'Ivy',
  marcus: 'Marcus',
};

interface Episode {
  id: string;
  title: string;
  summary: string | null;
  script: string;
  audioUrl: string | null;
  audioDuration: number | null;
  voiceKey: string | null;
  signalCount: number;
  topicsCovered: string[];
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  segments: Segment[];
  signals: Signal[];
}

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PlayerPage() {
  const params = useParams();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [activeSegment, setActiveSegment] = useState(0);
  const [loading, setLoading] = useState(true);

  // Audio player state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isSeeking, setIsSeeking] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);

  useEffect(() => {
    fetch(`/api/episodes?id=${params.id}`)
      .then(r => r.json())
      .then(data => {
        setEpisode(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      if (audioRef.current) {
        audioRef.current.pause();
      }
    };
  }, []);

  // Progress tracking via requestAnimationFrame
  const trackProgress = useCallback(() => {
    const audio = audioRef.current;
    if (audio && !audio.paused && !isSeeking) {
      setCurrentTime(audio.currentTime);
    }
    animFrameRef.current = requestAnimationFrame(trackProgress);
  }, [isSeeking]);

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play();
      setIsPlaying(true);
      animFrameRef.current = requestAnimationFrame(trackProgress);
    } else {
      audio.pause();
      setIsPlaying(false);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
    }
  }, [trackProgress]);

  // Unified coordinate extraction for mouse and touch events
  const getClientX = (e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent): number => {
    if ('touches' in e) return e.touches[0]?.clientX ?? (e as TouchEvent).changedTouches[0]?.clientX ?? 0;
    return (e as MouseEvent).clientX;
  };

  const handleSeek = useCallback((e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    const audio = audioRef.current;
    const bar = progressBarRef.current;
    if (!audio || !bar || !duration) return;

    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(getClientX(e) - rect.left, rect.width));
    const pct = x / rect.width;
    const newTime = pct * duration;
    audio.currentTime = newTime;
    setCurrentTime(newTime);
  }, [duration]);

  const handleProgressPointerDown = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    setIsSeeking(true);
    handleSeek(e);

    const onMove = (ev: MouseEvent | TouchEvent) => handleSeek(ev);
    const onUp = () => {
      setIsSeeking(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, [handleSeek]);

  const handleVolumePointerDown = useCallback((e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
    const applyVolume = (ev: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
      const audio = audioRef.current;
      const bar = volumeBarRef.current;
      if (!audio || !bar) return;
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(getClientX(ev) - rect.left, rect.width));
      const newVol = x / rect.width;
      audio.volume = newVol;
      setVolume(newVol);
    };

    applyVolume(e);

    const onMove = (ev: MouseEvent | TouchEvent) => applyVolume(ev);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('touchmove', onMove);
      window.removeEventListener('touchend', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('touchmove', onMove, { passive: false });
    window.addEventListener('touchend', onUp);
  }, []);

  const skipBack = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.max(0, audio.currentTime - 15);
      setCurrentTime(audio.currentTime);
    }
  }, []);

  const skipForward = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 30);
      setCurrentTime(audio.currentTime);
    }
  }, []);

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-poddit-800 rounded w-2/3 mb-4" />
          <div className="h-4 bg-poddit-800 rounded w-full mb-2" />
          <div className="h-4 bg-poddit-800 rounded w-3/4" />
        </div>
      </main>
    );
  }

  if (!episode) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-poddit-400">Episode not found.</p>
        <Link href="/" className="text-white hover:underline mt-2 inline-block">&larr; Back</Link>
      </main>
    );
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Back link */}
      <Link href="/" className="text-sm text-poddit-500 hover:text-white mb-6 inline-flex items-center gap-2 transition-colors">
        <Image src="/logo.png" alt="Poddit" width={20} height={20} className="rounded" />
        &larr; All episodes
      </Link>

      {/* Episode header */}
      <header className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">{episode.title}</h1>
        <div className="flex items-center gap-3 mt-2 text-sm text-poddit-400">
          <span>
            {formatDate(episode.periodStart) === formatDate(episode.periodEnd)
              ? formatDate(episode.periodStart)
              : <>{formatDate(episode.periodStart)} &mdash; {formatDate(episode.periodEnd)}</>
            }
          </span>
          <span>&bull;</span>
          <span>{episode.signalCount} signal{episode.signalCount !== 1 ? 's' : ''}</span>
          {episode.audioDuration && (
            <>
              <span>&bull;</span>
              <span>{Math.round(episode.audioDuration / 60)} min</span>
            </>
          )}
          {episode.voiceKey && VOICE_NAMES[episode.voiceKey] && (
            <>
              <span>&bull;</span>
              <span>Read by {VOICE_NAMES[episode.voiceKey]}</span>
            </>
          )}
        </div>
      </header>

      {/* Custom audio player */}
      {episode.audioUrl && (
        <div className="mb-8 p-4 bg-poddit-900 border border-stone-800/60 rounded-xl">
          {/* Hidden audio element */}
          <audio
            ref={audioRef}
            src={episode.audioUrl}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
            onEnded={() => {
              setIsPlaying(false);
              if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
                animFrameRef.current = null;
              }
            }}
          />

          {/* Controls row */}
          <div className="flex items-center gap-3">
            {/* Skip back 15s */}
            <button
              onClick={skipBack}
              className="text-stone-400 hover:text-white transition-colors flex-shrink-0"
              title="Back 15s"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M11 17l-5-5 5-5" />
                <path d="M18 17l-5-5 5-5" />
              </svg>
            </button>

            {/* Play/Pause */}
            <button
              onClick={togglePlay}
              className="w-10 h-10 flex items-center justify-center rounded-full bg-teal-500 text-poddit-950
                         hover:bg-teal-400 transition-colors flex-shrink-0"
            >
              {isPlaying ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <rect x="6" y="4" width="4" height="16" rx="1" />
                  <rect x="14" y="4" width="4" height="16" rx="1" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                  <path d="M8 5.14v14l11-7-11-7z" />
                </svg>
              )}
            </button>

            {/* Skip forward 30s */}
            <button
              onClick={skipForward}
              className="text-stone-400 hover:text-white transition-colors flex-shrink-0"
              title="Forward 30s"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M13 17l5-5-5-5" />
                <path d="M6 17l5-5-5-5" />
              </svg>
            </button>

            {/* Time display */}
            <span className="text-xs text-stone-400 font-mono tabular-nums flex-shrink-0 w-[72px]">
              {formatTime(currentTime)} / {formatTime(duration)}
            </span>

            {/* Progress bar */}
            <div
              ref={progressBarRef}
              onMouseDown={handleProgressPointerDown}
              onTouchStart={handleProgressPointerDown}
              className="flex-1 h-8 flex items-center cursor-pointer group touch-none"
            >
              <div className="w-full h-1.5 bg-stone-800 rounded-full relative overflow-hidden">
                {/* Played portion */}
                <div
                  className="absolute inset-y-0 left-0 bg-teal-500 rounded-full transition-[width] duration-75 ease-linear"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
            </div>

            {/* Volume */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => {
                  const audio = audioRef.current;
                  if (!audio) return;
                  const newVol = volume > 0 ? 0 : 1;
                  audio.volume = newVol;
                  setVolume(newVol);
                }}
                className="text-stone-400 hover:text-white transition-colors"
              >
                {volume === 0 ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <line x1="23" y1="9" x2="17" y2="15" />
                    <line x1="17" y1="9" x2="23" y2="15" />
                  </svg>
                ) : volume < 0.5 ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
                  </svg>
                )}
              </button>
              <div
                ref={volumeBarRef}
                onMouseDown={handleVolumePointerDown}
                onTouchStart={handleVolumePointerDown}
                className="w-16 h-6 flex items-center cursor-pointer group touch-none"
              >
                <div className="w-full h-1 bg-stone-800 rounded-full relative overflow-hidden">
                  <div
                    className="absolute inset-y-0 left-0 bg-stone-400 group-hover:bg-teal-500 rounded-full transition-colors"
                    style={{ width: `${volume * 100}%` }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      {episode.summary && (
        <div className="mb-8 p-5 bg-poddit-900/50 border border-poddit-800 rounded-xl">
          <h2 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider mb-3">Summary</h2>
          <p className="text-poddit-200 leading-relaxed">{episode.summary}</p>
        </div>
      )}

      {/* Segments */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider mb-4">Segments</h2>

        {/* Segment tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
          {episode.segments.map((seg, i) => (
            <button
              key={seg.id}
              onClick={() => setActiveSegment(i)}
              className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-all ${
                activeSegment === i
                  ? 'bg-teal-500 text-poddit-950 font-semibold'
                  : 'bg-poddit-800 text-poddit-400 hover:bg-poddit-700 hover:text-poddit-200'
              }`}
            >
              {seg.topic}
            </button>
          ))}
        </div>

        {/* Active segment content */}
        {episode.segments[activeSegment] && (
          <div>
            <div className="prose prose-invert prose-sm max-w-none prose-p:text-poddit-200 prose-headings:text-white">
              {episode.segments[activeSegment].content.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            {/* Source cards */}
            {episode.segments[activeSegment].sources?.length > 0 && (
              <div className="mt-6 space-y-2">
                <h3 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider">Sources</h3>
                {(episode.segments[activeSegment].sources as Source[]).map((source, i) => (
                  <a
                    key={i}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-3 bg-poddit-900 border border-poddit-800 rounded-lg
                               hover:border-violet-400/30 transition-all text-sm group"
                  >
                    <span className="text-white font-medium group-hover:underline">{source.name}</span>
                    <span className="text-poddit-600">&mdash;</span>
                    <span className="text-poddit-400">{source.attribution}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Original signals */}
      <section>
        <h2 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider mb-3">Captured Signals</h2>
        <div className="space-y-1">
          {episode.signals.map((signal) => (
            <div key={signal.id} className="flex items-center gap-2 text-sm py-1.5">
              <span className="text-xs font-mono bg-poddit-800 text-poddit-500 px-1.5 py-0.5 rounded">
                {signal.channel}
              </span>
              {signal.url ? (
                <a href={signal.url} target="_blank" rel="noopener noreferrer" className="text-violet-300 hover:underline truncate">
                  {signal.title || signal.url}
                </a>
              ) : (
                <span className="text-poddit-200 truncate">{signal.title}</span>
              )}
              {signal.source && <span className="text-poddit-500 text-xs">({signal.source})</span>}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
