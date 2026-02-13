'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';
import Image from 'next/image';

interface Episode {
  id: string;
  title: string;
  summary: string | null;
  audioUrl: string | null;
  audioDuration: number | null;
  signalCount: number;
  topicsCovered: string[];
  generatedAt: string;
}

interface Signal {
  id: string;
  inputType: string;
  channel: string;
  rawContent: string;
  url: string | null;
  title: string | null;
  source: string | null;
  topics: string[];
  status: string;
  createdAt: string;
}

function Dashboard() {
  const searchParams = useSearchParams();
  const shared = searchParams.get('shared');

  // Data state
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Input state
  const [textInput, setTextInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [inputSuccess, setInputSuccess] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  // Refs for recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  // Load data
  useEffect(() => {
    refreshData();
  }, []);

  const refreshData = async () => {
    try {
      const [eps, sigs] = await Promise.all([
        fetch('/api/episodes').then(r => r.json()),
        fetch('/api/signals?status=queued,enriched,pending&limit=20').then(r => r.json()),
      ]);
      setEpisodes(Array.isArray(eps) ? eps : []);
      const signalList = sigs.signals || [];
      setSignals(signalList);
      setSelectedIds(new Set(signalList.map((s: Signal) => s.id)));
      const counts: Record<string, number> = {};
      (sigs.counts || []).forEach((c: any) => { counts[c.status] = c._count; });
      setSignalCounts(counts);
    } catch {
      // silent fail on refresh
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '';
    const mins = Math.round(seconds / 60);
    return `${mins} min`;
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Selection ──

  const toggleSignal = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const allSelected = selectedIds.size === signals.length && signals.length > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(signals.map(s => s.id)));
    }
  };

  // ── Delete ──

  const deleteSignal = async (id: string) => {
    try {
      const res = await fetch(`/api/signals?id=${id}`, { method: 'DELETE' });
      if (res.ok) {
        setSignals((prev) => prev.filter((s) => s.id !== id));
        setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        setSignalCounts((prev) => {
          const updated = { ...prev };
          const total = (updated.QUEUED || 0) + (updated.ENRICHED || 0);
          if (total > 0) {
            if ((updated.ENRICHED || 0) >= (updated.QUEUED || 0)) {
              updated.ENRICHED = (updated.ENRICHED || 1) - 1;
            } else {
              updated.QUEUED = (updated.QUEUED || 1) - 1;
            }
          }
          return updated;
        });
      }
    } catch (error) {
      console.error('[Dashboard] Failed to delete signal:', error);
    }
  };

  // ── Generate ──

  const generateNow = async () => {
    if (selectedIds.size === 0) return;
    setGenerating(true);
    setGenerateError(null);

    try {
      const res = await fetch('/api/generate-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalIds: Array.from(selectedIds) }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      await refreshData();
    } catch (error: any) {
      setGenerateError(error.message);
    } finally {
      setGenerating(false);
    }
  };

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

  // ── Render ──

  const totalQueued = (signalCounts.QUEUED || 0) + (signalCounts.ENRICHED || 0);

  return (
    <main className="max-w-5xl mx-auto px-4 py-8">
      {/* Header — Logo left, capture channels right */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <Image
            src="/logo.png"
            alt="Poddit"
            width={44}
            height={44}
            className="rounded-lg"
          />
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight font-display">PODDIT</h1>
            <p className="text-stone-400 text-xs tracking-widest uppercase">Your world, explained</p>
          </div>
        </div>

        {/* Capture channels */}
        <div className="flex items-center gap-4 text-xs">
          <a href="sms:+18555065970" className="flex items-center gap-1.5 text-stone-400 hover:text-teal-400 transition-colors group">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-500 group-hover:text-teal-400 transition-colors">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <span className="font-mono">(855) 506-5970</span>
          </a>
          <span className="text-stone-700">|</span>
          <a href="https://github.com/br00kd0wnt0n/PODDITMVP/tree/main/extension"
             target="_blank" rel="noopener noreferrer"
             className="flex items-center gap-1.5 text-stone-400 hover:text-violet-400 transition-colors group">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-stone-500 group-hover:text-violet-400 transition-colors">
              <circle cx="12" cy="12" r="10" />
              <circle cx="12" cy="12" r="4" />
              <line x1="21.17" y1="8" x2="12" y2="8" />
              <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
              <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
            </svg>
            Chrome extension
          </a>
          <span className="text-stone-700">|</span>
          <span className="flex items-center gap-1.5 text-stone-500">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
              <polyline points="16 6 12 2 8 6" />
              <line x1="12" y1="2" x2="12" y2="15" />
            </svg>
            Share sheet
          </span>
        </div>
      </div>

      {/* ── How It Works ── */}
      <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="flex items-start gap-3 p-3 rounded-xl bg-poddit-900/40 border border-stone-800/40">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-teal-500/10 text-teal-400 text-xs font-bold flex items-center justify-center">1</span>
          <div>
            <p className="text-sm font-medium text-white">Capture</p>
            <p className="text-xs text-stone-500 mt-0.5">Save links, topics, or voice notes as they catch your eye.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-xl bg-poddit-900/40 border border-stone-800/40">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-violet-400/10 text-violet-400 text-xs font-bold flex items-center justify-center">2</span>
          <div>
            <p className="text-sm font-medium text-white">Generate</p>
            <p className="text-xs text-stone-500 mt-0.5">Hit Poddit Now or wait for your weekly roundup every Friday.</p>
          </div>
        </div>
        <div className="flex items-start gap-3 p-3 rounded-xl bg-poddit-900/40 border border-stone-800/40">
          <span className="flex-shrink-0 w-7 h-7 rounded-full bg-teal-500/10 text-teal-400 text-xs font-bold flex items-center justify-center">3</span>
          <div>
            <p className="text-sm font-medium text-white">Listen</p>
            <p className="text-xs text-stone-500 mt-0.5">Get a personalized audio episode explaining what it all means.</p>
          </div>
        </div>
      </div>

      {/* Share confirmation toast */}
      {shared === 'success' && (
        <div className="mb-6 p-3 bg-teal-400/10 border border-teal-400/20 rounded-lg text-teal-300 text-sm">
          Captured! It&apos;ll show up in your next episode.
        </div>
      )}

      {/* Generate error toast */}
      {generateError && (
        <div className="mb-6 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center justify-between">
          <span>Generation failed: {generateError}</span>
          <button onClick={() => setGenerateError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
        </div>
      )}

      {/* ── Capture Input Bar ── */}
      <section className="mb-8">
        {/* Input error */}
        {inputError && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center justify-between">
            <span>{inputError}</span>
            <button onClick={() => setInputError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
          </div>
        )}

        {/* Input success */}
        {inputSuccess && (
          <div className="mb-2 p-2 bg-teal-400/10 border border-teal-400/20 rounded-lg text-teal-300 text-xs">
            &check; {inputSuccess}
          </div>
        )}

        {/* Recording state */}
        {recording ? (
          <button
            onClick={stopRecording}
            className="w-full py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400
                       hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            {formatTime(recordingTime)} &mdash; Recording...
            <span className="ml-1 text-xs text-red-500 font-medium">[Stop]</span>
          </button>
        ) : processing ? (
          <div className="w-full py-3 px-4 bg-poddit-900 border border-poddit-700 rounded-xl text-sm text-stone-400
                          flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-teal-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Transcribing...
          </div>
        ) : (
          /* Default: text input + buttons */
          <div className="flex gap-2">
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Save a link, topic, or thought..."
              disabled={submitting}
              className="flex-1 px-4 py-2.5 bg-poddit-900 border border-stone-800 rounded-xl text-sm text-white
                         placeholder:text-stone-500 focus:outline-none focus:ring-1 focus:ring-teal-400/30 focus:border-stone-600
                         disabled:opacity-40 transition-all"
            />
            <button
              onClick={submitText}
              disabled={submitting || !textInput.trim()}
              className="px-4 py-2.5 bg-teal-500 text-poddit-950 text-sm font-semibold rounded-xl
                         hover:bg-teal-400 disabled:bg-poddit-700 disabled:text-poddit-500 disabled:cursor-not-allowed
                         transition-colors flex-shrink-0"
            >
              {submitting ? '...' : 'Add'}
            </button>
            <button
              onClick={startRecording}
              disabled={submitting}
              className="px-3 py-2.5 border border-stone-800 rounded-xl text-stone-400
                         hover:border-violet-400 hover:text-violet-400 hover:bg-violet-400/5
                         disabled:opacity-40 disabled:cursor-not-allowed
                         transition-all flex-shrink-0"
              title="Record a voice note"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                <line x1="12" x2="12" y1="19" y2="22" />
              </svg>
            </button>
          </div>
        )}
      </section>

      {/* ── Two-Column Layout (desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* ── Left: Signal Queue ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">
              Queue
              {totalQueued > 0 && (
                <span className="ml-2 text-xs font-normal text-stone-500 normal-case tracking-normal">
                  {totalQueued} signal{totalQueued !== 1 ? 's' : ''} waiting
                </span>
              )}
            </h2>
            {signals.length > 0 && (
              <button
                onClick={toggleAll}
                disabled={generating}
                className="text-xs text-violet-400 hover:text-violet-300 disabled:text-poddit-600 transition-colors"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {/* Poddit Now button */}
          {signals.length > 0 && (
            <button
              onClick={generateNow}
              disabled={generating || selectedIds.size === 0}
              className="w-full mb-4 py-3 px-4 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                         hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500 disabled:cursor-not-allowed
                         transition-all flex items-center justify-center gap-2 uppercase tracking-wide"
            >
              {generating ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Connecting the dots...
                </>
              ) : (
                <>Poddit <span className="italic text-teal-200">Now</span> ({selectedIds.size} signal{selectedIds.size !== 1 ? 's' : ''})</>
              )}
            </button>
          )}

          {/* Selection count */}
          {signals.length > 0 && !allSelected && selectedIds.size > 0 && (
            <p className="text-xs text-stone-500 mb-3">
              {selectedIds.size} of {signals.length} selected
            </p>
          )}

          {signals.length === 0 ? (
            <div className="p-8 bg-poddit-900/50 border border-stone-800/50 rounded-xl text-center">
              <p className="text-stone-400 mb-2">Your queue is empty.</p>
              <p className="text-sm text-stone-500">
                Save what catches your eye &mdash; a link, a topic, a voice note.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {signals.map((signal) => (
                <div
                  key={signal.id}
                  className={`flex items-start gap-3 p-3 rounded-xl transition-all ${
                    selectedIds.has(signal.id)
                      ? 'bg-teal-500/5 border border-teal-500/15'
                      : 'bg-poddit-900/30 border border-transparent hover:border-stone-800'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(signal.id)}
                    onChange={() => toggleSignal(signal.id)}
                    disabled={generating}
                    className="w-4 h-4 rounded border-stone-600 mt-0.5 flex-shrink-0 accent-teal-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded flex-shrink-0">
                        {signal.channel}
                      </span>
                      <p className="text-sm text-poddit-100 truncate">
                        {signal.title || signal.rawContent.slice(0, 80)}
                      </p>
                    </div>
                    {signal.source && (
                      <p className="text-xs text-stone-500 ml-0">{signal.source}</p>
                    )}
                    {signal.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {signal.topics.map((topic) => (
                          <span
                            key={topic}
                            className="text-xs bg-violet-400/15 text-violet-300 px-2 py-0.5 rounded-full"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-stone-600 whitespace-nowrap flex-shrink-0">
                    {new Date(signal.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => deleteSignal(signal.id)}
                    disabled={generating}
                    className="text-poddit-700 hover:text-red-400 disabled:hover:text-poddit-700 transition-colors p-1 -mr-1 flex-shrink-0"
                    title="Remove from queue"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Right: Episodes ── */}
        <section>
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-3">Episodes</h2>

          {loading ? (
            <div className="p-6 text-center text-stone-500">Loading...</div>
          ) : episodes.length === 0 ? (
            <div className="p-8 bg-poddit-900/50 border border-stone-800/50 rounded-xl text-center">
              <p className="text-stone-400 mb-2">No episodes yet.</p>
              <p className="text-sm text-stone-500">
                Capture a few signals, then hit Poddit Now &mdash; or sit back and get a weekly roundup every Friday.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {episodes.map((ep) => (
                <a
                  key={ep.id}
                  href={`/player/${ep.id}`}
                  className="block p-4 bg-poddit-900/50 border border-stone-800/50 rounded-xl
                             hover:border-violet-400/30 hover:bg-poddit-900 transition-all group"
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white group-hover:text-violet-300 transition-colors">{ep.title}</h3>
                      <p className="text-sm text-stone-400 mt-1 line-clamp-2">{ep.summary?.slice(0, 120)}...</p>
                    </div>
                    <span className="text-sm text-stone-500 whitespace-nowrap ml-4 flex-shrink-0">
                      {formatDuration(ep.audioDuration)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-stone-500">
                    <span>{ep.signalCount} signals</span>
                    <span className="text-teal-500/40">&bull;</span>
                    <span>{new Date(ep.generatedAt).toLocaleDateString()}</span>
                    {ep.topicsCovered.length > 0 && (
                      <>
                        <span className="text-teal-500/40">&bull;</span>
                        <span className="text-stone-400 truncate">{ep.topicsCovered.slice(0, 3).join(', ')}</span>
                      </>
                    )}
                  </div>
                </a>
              ))}
            </div>
          )}
        </section>

      </div>

    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-4 py-8 text-stone-500">Loading...</div>}>
      <Dashboard />
    </Suspense>
  );
}
