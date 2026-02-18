'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Image from 'next/image';
import Link from 'next/link';

interface Source {
  name: string;
  url?: string;  // optional for backwards compat with old episodes
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
  marcus: 'Marcus',  // legacy, kept for existing episodes
  harper: 'Harper',
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
  const [audioError, setAudioError] = useState(false);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const volumeBarRef = useRef<HTMLDivElement>(null);
  const animFrameRef = useRef<number | null>(null);
  const ratingRef = useRef<HTMLDivElement>(null);

  // Episode rating state
  const [showRating, setShowRating] = useState(false);
  const [ratings, setRatings] = useState<{ enjoyment: number; resonance: number; connections: number }>({ enjoyment: 0, resonance: 0, connections: 0 });
  const [followUpText, setFollowUpText] = useState('');
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [ratingSubmitting, setRatingSubmitting] = useState(false);
  const [existingRating, setExistingRating] = useState<{ enjoyment: number; resonance: number; connections: number; feedback: string | null } | null>(null);
  const [audioEnded, setAudioEnded] = useState(false);

  useEffect(() => {
    fetch(`/api/episodes?id=${params.id}`)
      .then(r => {
        if (r.status === 401 || r.status === 403) {
          // Session expired or revoked — redirect to sign-in
          window.location.href = '/auth/signin';
          return null;
        }
        if (!r.ok) return null;
        return r.json();
      })
      .then(data => {
        if (data && data.segments) {
          setEpisode(data);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));

    // Check for existing rating
    fetch(`/api/episodes/rate?episodeId=${params.id}`)
      .then(r => {
        if (!r.ok) return null;
        return r.json();
      })
      .then(data => {
        if (data?.rated && data.rating) {
          setExistingRating(data.rating);
          setRatings({ enjoyment: data.rating.enjoyment, resonance: data.rating.resonance, connections: data.rating.connections });
          setRatingSubmitted(true);
        }
      })
      .catch(() => {});

    // Auto-open rating if navigated with #rate hash
    if (typeof window !== 'undefined' && window.location.hash === '#rate') {
      setShowRating(true);
      // Scroll to rating section after render
      setTimeout(() => ratingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 500);
    }
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

  // Submit episode rating
  const submitRating = useCallback(async () => {
    if (!episode || ratingSubmitting) return;
    if (ratings.enjoyment === 0 || ratings.resonance === 0 || ratings.connections === 0) return;

    setRatingSubmitting(true);
    try {
      const res = await fetch('/api/episodes/rate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          episodeId: episode.id,
          ...ratings,
          feedback: followUpText.trim() || undefined,
        }),
      });
      if (res.ok) {
        setRatingSubmitted(true);
        setExistingRating({ ...ratings, feedback: followUpText.trim() || null });
      }
    } catch (e) {
      console.error('[Rating] Submit failed:', e);
    } finally {
      setRatingSubmitting(false);
    }
  }, [episode, ratings, followUpText, ratingSubmitting]);

  const needsFollowUp = ratings.enjoyment <= 2 || ratings.resonance <= 2 || ratings.connections <= 2;
  const allRated = ratings.enjoyment > 0 && ratings.resonance > 0 && ratings.connections > 0;

  // Channel badge accent colors
  const channelColors: Record<string, string> = {
    SMS: 'bg-teal-400/15 text-teal-300',
    EMAIL: 'bg-violet-400/15 text-violet-300',
    EXTENSION: 'bg-amber-400/15 text-amber-300',
    SHARE_SHEET: 'bg-rose-400/15 text-rose-300',
    API: 'bg-stone-700/50 text-stone-400',
  };

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8 relative z-10">
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
      <main className="max-w-2xl mx-auto px-4 py-8 relative z-10">
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
    <>
    {/* Player bokeh — ambient depth */}
    <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      <div className="bokeh-orb bokeh-3 absolute top-[8%] right-[10%] w-[40vw] h-[40vw] rounded-full bg-teal-400/[0.07] blur-3xl" />
      <div className="bokeh-orb bokeh-1 absolute bottom-[12%] left-[5%] w-[35vw] h-[35vw] rounded-full bg-violet-400/[0.06] blur-3xl" />
      <div className="bokeh-orb bokeh-5 absolute top-[45%] left-[55%] w-[30vw] h-[30vw] rounded-full bg-amber-400/[0.05] blur-2xl" />
      <div className="bokeh-orb bokeh-2 absolute top-[20%] left-[25%] w-[20vw] h-[20vw] rounded-full bg-amber-300/[0.04] blur-2xl" />
    </div>

    <main className="max-w-2xl mx-auto px-4 py-8 relative z-10">
      {/* Back link */}
      <Link href="/" className="text-sm text-poddit-500 hover:text-white mb-6 inline-flex items-center gap-2 transition-colors">
        <Image src="/logo.png" alt="Poddit" width={20} height={20} className="rounded" />
        &larr; All episodes
      </Link>

      {/* Episode header — frosted glass with inner bokeh */}
      <header className="mb-8 relative p-5 rounded-2xl bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent border border-white/[0.10] overflow-hidden animate-fade-in-up" style={{ animationFillMode: 'forwards' }}>
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute top-[-20%] left-[-10%] w-40 h-40 rounded-full bg-teal-500/15 blur-3xl bokeh-orb bokeh-1" />
          <div className="absolute bottom-[-15%] right-[-5%] w-32 h-32 rounded-full bg-violet-400/[0.12] blur-3xl bokeh-orb bokeh-2" />
        </div>
        <div className="relative z-10">
          <h1 className="text-2xl font-extrabold text-white">{episode.title}</h1>
          <div className="flex items-center gap-3 mt-2 text-sm text-poddit-400 flex-wrap">
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
        </div>
      </header>

      {/* Custom audio player */}
      {episode.audioUrl && (
        <div className="mb-8 p-4 bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent border border-white/[0.10] rounded-2xl lens-flare-edge">
          {/* Hidden audio element */}
          <audio
            ref={audioRef}
            src={episode.audioUrl}
            preload="metadata"
            onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
            onEnded={() => {
              setIsPlaying(false);
              setAudioEnded(true);
              if (animFrameRef.current) {
                cancelAnimationFrame(animFrameRef.current);
                animFrameRef.current = null;
              }
              // Auto-show rating after playback if not already rated
              if (!ratingSubmitted) {
                setShowRating(true);
                setTimeout(() => ratingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 300);
              }
            }}
            onError={() => setAudioError(true)}
          />

          {/* Audio error */}
          {audioError && (
            <div className="mb-3 p-2.5 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              Audio failed to load. Try refreshing the page or check your connection.
            </div>
          )}

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
                         hover:bg-teal-400 transition-colors flex-shrink-0 shadow-[0_0_12px_rgba(20,184,166,0.2)]"
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
              <div className="w-full h-1.5 bg-white/[0.08] rounded-full relative overflow-hidden">
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
                <div className="w-full h-1 bg-white/[0.08] rounded-full relative overflow-hidden">
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
        <div className="mb-8 p-5 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
          <h2 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider mb-3">Summary</h2>
          <p className="text-poddit-200 leading-relaxed">{episode.summary}</p>
        </div>
      )}

      {/* Segments */}
      <section className="mb-8 animate-fade-in-up" style={{ animationFillMode: 'forwards' }}>
        <h2 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider mb-4">Segments</h2>

        {/* Segment tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
          {episode.segments.map((seg, i) => (
            <button
              key={seg.id}
              onClick={() => setActiveSegment(i)}
              className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-all ${
                activeSegment === i
                  ? 'bg-teal-500 text-poddit-950 font-semibold shadow-[0_0_12px_rgba(20,184,166,0.25),0_0_4px_rgba(217,149,56,0.15)]'
                  : 'bg-white/[0.06] text-poddit-400 hover:bg-white/[0.10] hover:text-poddit-200'
              }`}
            >
              {seg.topic}
            </button>
          ))}
        </div>

        {/* Active segment content */}
        {episode.segments[activeSegment] && (
          <div className="p-5 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent border border-white/[0.06] rounded-2xl">
            <div className="prose prose-invert prose-sm max-w-none prose-p:text-poddit-200 prose-headings:text-white">
              {episode.segments[activeSegment].content.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            {/* Source cards — only clickable sources shown */}
            {(() => {
              const clickableSources = (episode.segments[activeSegment].sources as Source[])?.filter(s => s.url && s.url.trim()) || [];
              if (clickableSources.length === 0) return null;
              return (
                <div className="mt-6 space-y-2">
                  <h3 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider">Sources</h3>
                  {clickableSources.map((source, i) => (
                    <a
                      key={i}
                      href={source.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-start gap-2.5 p-3 bg-white/[0.03] border border-white/[0.06] rounded-xl text-sm group
                                 hover:border-violet-400/30 hover:bg-white/[0.05] transition-all cursor-pointer"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                           className="text-violet-400/60 mt-0.5 flex-shrink-0 group-hover:text-violet-400 transition-colors">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                      <div className="min-w-0">
                        <span className="text-white font-medium group-hover:underline">{source.name}</span>
                        <span className="text-poddit-600 mx-1.5">&mdash;</span>
                        <span className="text-poddit-400">{source.attribution}</span>
                      </div>
                    </a>
                  ))}
                </div>
              );
            })()}
          </div>
        )}
      </section>

      {/* Original signals */}
      <section className="mb-8">
        <h2 className="text-xs font-semibold text-poddit-500 uppercase tracking-wider mb-3">Captured Signals</h2>
        <div className="p-4 bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent border border-white/[0.06] rounded-2xl space-y-1">
          {episode.signals.map((signal) => (
            <div key={signal.id} className="flex items-center gap-2 text-sm py-1.5">
              <span className={`text-xs font-mono px-1.5 py-0.5 rounded-full flex-shrink-0 ${channelColors[signal.channel] || 'bg-stone-700/50 text-stone-400'}`}>
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

      {/* ─── Episode Rating ─── */}
      <section ref={ratingRef} id="rate" className="mb-8">
        {/* Show rating prompt: after audio ends, or when user clicks "Rate this episode", or if already rated */}
        {!showRating && !ratingSubmitted && (
          <button
            onClick={() => { setShowRating(true); setTimeout(() => ratingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100); }}
            className="w-full py-3 px-4 rounded-2xl border border-white/[0.08] bg-gradient-to-br from-white/[0.04] via-white/[0.02] to-transparent text-stone-400 hover:text-white hover:border-teal-500/30 transition-all text-sm flex items-center justify-center gap-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            Rate this episode
          </button>
        )}

        {(showRating || ratingSubmitted) && (
          <div className={`rounded-2xl border overflow-hidden transition-all duration-500 ${
            ratingSubmitted
              ? 'border-teal-500/20 bg-teal-500/[0.03]'
              : audioEnded
                ? 'border-teal-500/30 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent shadow-[0_0_20px_rgba(20,184,166,0.08)]'
                : 'border-white/[0.08] bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent'
          }`}>
            <div className="p-5">
              {/* Header */}
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                  {ratingSubmitted ? (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Thanks for your feedback
                    </>
                  ) : (
                    <>
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      How was this episode?
                    </>
                  )}
                </h2>
                {!ratingSubmitted && (
                  <button onClick={() => setShowRating(false)} className="text-stone-600 hover:text-stone-400 transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              {/* Rating questions */}
              <div className="space-y-4">
                {([
                  { key: 'enjoyment' as const, label: 'Did you enjoy it?' },
                  { key: 'resonance' as const, label: 'Did it resonate?' },
                  { key: 'connections' as const, label: 'Useful connections?' },
                ]).map(({ key, label }) => (
                  <div key={key} className="flex items-center justify-between gap-3">
                    <span className={`text-sm ${ratingSubmitted ? 'text-stone-500' : 'text-stone-300'}`}>{label}</span>
                    <div className="flex gap-1.5">
                      {[1, 2, 3, 4, 5].map(n => {
                        const isSelected = ratings[key] >= n;
                        const color = n <= 2
                          ? (isSelected ? 'bg-amber-400' : 'bg-white/[0.06] hover:bg-white/[0.10]')
                          : n === 3
                            ? (isSelected ? 'bg-stone-400' : 'bg-white/[0.06] hover:bg-white/[0.10]')
                            : (isSelected ? 'bg-teal-400' : 'bg-white/[0.06] hover:bg-white/[0.10]');
                        return (
                          <button
                            key={n}
                            disabled={ratingSubmitted}
                            onClick={() => setRatings(prev => ({ ...prev, [key]: n }))}
                            className={`w-8 h-8 rounded-full transition-all duration-150 text-xs font-bold ${color} ${
                              isSelected ? 'text-poddit-950 scale-110' : 'text-stone-500'
                            } ${ratingSubmitted ? 'cursor-default' : 'cursor-pointer active:scale-95'}`}
                          >
                            {n}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              {/* Follow-up field (if any rating ≤ 2) */}
              {needsFollowUp && !ratingSubmitted && allRated && (
                <div className="mt-4 pt-4 border-t border-stone-800/60">
                  <p className="text-xs text-amber-400/80 mb-2">We want to get better. What could we improve?</p>
                  <textarea
                    value={followUpText}
                    onChange={e => setFollowUpText(e.target.value)}
                    placeholder="What would make this episode better..."
                    rows={3}
                    maxLength={5000}
                    className="w-full bg-white/[0.05] border border-white/[0.10] rounded-xl px-3 py-2 text-sm text-white placeholder-stone-600 resize-none focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-all"
                  />
                </div>
              )}

              {/* Submit button */}
              {!ratingSubmitted && allRated && (
                <button
                  onClick={submitRating}
                  disabled={ratingSubmitting}
                  className="mt-4 w-full py-2.5 rounded-xl bg-teal-500 text-poddit-950 text-sm font-semibold hover:bg-teal-400 disabled:opacity-50 transition-all shadow-[0_0_12px_rgba(20,184,166,0.2)]"
                >
                  {ratingSubmitting ? 'Submitting...' : 'Submit'}
                </button>
              )}

              {/* Already rated summary */}
              {ratingSubmitted && existingRating?.feedback && (
                <div className="mt-3 pt-3 border-t border-stone-800/40">
                  <p className="text-xs text-stone-500">Your feedback: <span className="text-stone-400">{existingRating.feedback}</span></p>
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </main>
    </>
  );
}
