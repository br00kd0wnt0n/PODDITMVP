'use client';

import { Suspense, useEffect, useState, useRef } from 'react';
import { useSearchParams } from 'next/navigation';

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
            // Auto-stop at 2 minutes
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

      // Wait briefly for classification, then refresh
      setTimeout(() => refreshData(), 2000);
    } catch (error: any) {
      setInputError(error.message);
    } finally {
      setProcessing(false);
    }
  };

  // ── Render ──

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Poddit</h1>
          <p className="text-gray-500 mt-1">Your week, compressed.</p>
        </div>
        <a
          href="/shortcut"
          className="text-xs text-indigo-500 hover:text-indigo-600 mt-2"
        >
          iOS Shortcut →
        </a>
      </div>

      {/* Share confirmation toast */}
      {shared === 'success' && (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          Captured! It&apos;ll show up in your next episode.
        </div>
      )}

      {/* Generate error toast */}
      {generateError && (
        <div className="mb-6 p-3 bg-red-50 border border-red-200 rounded-lg text-red-800 text-sm flex items-center justify-between">
          <span>Generation failed: {generateError}</span>
          <button onClick={() => setGenerateError(null)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
        </div>
      )}

      {/* ── Capture Input Bar ── */}
      <section className="mb-6">
        {/* Input error */}
        {inputError && (
          <div className="mb-2 p-2 bg-red-50 border border-red-200 rounded-lg text-red-700 text-xs flex items-center justify-between">
            <span>{inputError}</span>
            <button onClick={() => setInputError(null)} className="text-red-400 hover:text-red-600 ml-2">✕</button>
          </div>
        )}

        {/* Input success */}
        {inputSuccess && (
          <div className="mb-2 p-2 bg-green-50 border border-green-200 rounded-lg text-green-700 text-xs">
            ✓ {inputSuccess}
          </div>
        )}

        {/* Recording state */}
        {recording ? (
          <button
            onClick={stopRecording}
            className="w-full py-3 px-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700
                       hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
          >
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            {formatTime(recordingTime)} — Recording...
            <span className="ml-1 text-xs text-red-500 font-medium">[Stop]</span>
          </button>
        ) : processing ? (
          <div className="w-full py-3 px-4 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-500
                          flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
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
              placeholder="Type a topic or paste a link..."
              disabled={submitting}
              className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900
                         placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent
                         disabled:bg-gray-50 disabled:text-gray-400"
            />
            <button
              onClick={submitText}
              disabled={submitting || !textInput.trim()}
              className="px-4 py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg
                         hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed
                         transition-colors flex-shrink-0"
            >
              {submitting ? '...' : 'Add'}
            </button>
            <button
              onClick={startRecording}
              disabled={submitting}
              className="px-3 py-2.5 border border-gray-300 rounded-lg text-gray-500
                         hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50
                         disabled:opacity-50 disabled:cursor-not-allowed
                         transition-colors flex-shrink-0"
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

      {/* ── Signal Queue ── */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Queue
            {(signalCounts.QUEUED || signalCounts.ENRICHED) ? (
              <span className="ml-2 text-sm font-normal text-gray-500">
                {(signalCounts.QUEUED || 0) + (signalCounts.ENRICHED || 0)} signals waiting
              </span>
            ) : null}
          </h2>
          {signals.length > 0 && (
            <button
              onClick={toggleAll}
              disabled={generating}
              className="text-xs text-indigo-500 hover:text-indigo-600 disabled:text-gray-300"
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
            className="w-full mb-4 py-2.5 px-4 bg-indigo-600 text-white text-sm font-medium rounded-lg
                       hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed
                       transition-colors flex items-center justify-center gap-2"
          >
            {generating ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Generating your episode...
              </>
            ) : (
              <>Poddit Now ({selectedIds.size} signal{selectedIds.size !== 1 ? 's' : ''})</>
            )}
          </button>
        )}

        {/* Selection count */}
        {signals.length > 0 && !allSelected && selectedIds.size > 0 && (
          <p className="text-xs text-gray-400 mb-3">
            {selectedIds.size} of {signals.length} selected
          </p>
        )}

        {signals.length === 0 ? (
          <div className="p-6 bg-gray-50 rounded-lg text-center text-gray-500">
            <p className="mb-2">No signals in the queue yet.</p>
            <p className="text-sm">
              Add a topic above, record a thought, text your Poddit number, or share from your browser.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {signals.map((signal) => (
              <div
                key={signal.id}
                className={`flex items-start gap-3 p-3 rounded-lg transition-colors ${
                  selectedIds.has(signal.id) ? 'bg-indigo-50 border border-indigo-200' : 'bg-gray-50 border border-transparent'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedIds.has(signal.id)}
                  onChange={() => toggleSignal(signal.id)}
                  disabled={generating}
                  className="w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500 mt-0.5 flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-mono bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded flex-shrink-0">
                      {signal.channel}
                    </span>
                    <p className="text-sm text-gray-900 truncate">
                      {signal.title || signal.rawContent.slice(0, 80)}
                    </p>
                  </div>
                  {signal.source && (
                    <p className="text-xs text-gray-500 ml-0">{signal.source}</p>
                  )}
                  {signal.topics.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {signal.topics.map((topic) => (
                        <span
                          key={topic}
                          className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full"
                        >
                          {topic}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <span className="text-xs text-gray-400 whitespace-nowrap flex-shrink-0">
                  {new Date(signal.createdAt).toLocaleDateString()}
                </span>
                <button
                  onClick={() => deleteSignal(signal.id)}
                  disabled={generating}
                  className="text-gray-300 hover:text-red-500 disabled:hover:text-gray-300 transition-colors p-1 -mr-1 flex-shrink-0"
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

      {/* ── Episodes ── */}
      <section>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Episodes</h2>

        {loading ? (
          <div className="p-6 text-center text-gray-400">Loading...</div>
        ) : episodes.length === 0 ? (
          <div className="p-6 bg-gray-50 rounded-lg text-center text-gray-500">
            <p>No episodes yet. Capture some signals and generate your first one.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {episodes.map((ep) => (
              <a
                key={ep.id}
                href={`/player/${ep.id}`}
                className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-poddit-300 hover:shadow-sm transition-all"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-gray-900">{ep.title}</h3>
                    <p className="text-sm text-gray-500 mt-1">{ep.summary?.slice(0, 120)}...</p>
                  </div>
                  <span className="text-sm text-gray-400 whitespace-nowrap ml-4">
                    {formatDuration(ep.audioDuration)}
                  </span>
                </div>
                <div className="flex items-center gap-3 mt-3 text-xs text-gray-400">
                  <span>{ep.signalCount} signals</span>
                  <span>&middot;</span>
                  <span>{new Date(ep.generatedAt).toLocaleDateString()}</span>
                  {ep.topicsCovered.length > 0 && (
                    <>
                      <span>&middot;</span>
                      <span>{ep.topicsCovered.slice(0, 3).join(', ')}</span>
                    </>
                  )}
                </div>
              </a>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="max-w-2xl mx-auto px-4 py-8 text-gray-400">Loading...</div>}>
      <Dashboard />
    </Suspense>
  );
}
