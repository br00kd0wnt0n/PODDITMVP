'use client';

import { Suspense, useEffect, useState } from 'react';
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
  status: string;
  createdAt: string;
}

function Dashboard() {
  const searchParams = useSearchParams();
  const shared = searchParams.get('shared');

  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/episodes').then(r => r.json()),
      fetch('/api/signals?status=queued&limit=20').then(r => r.json()),
    ]).then(([eps, sigs]) => {
      setEpisodes(Array.isArray(eps) ? eps : []);
      setSignals(sigs.signals || []);
      const counts: Record<string, number> = {};
      (sigs.counts || []).forEach((c: any) => { counts[c.status] = c._count; });
      setSignalCounts(counts);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '';
    const mins = Math.round(seconds / 60);
    return `${mins} min`;
  };

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Poddit</h1>
        <p className="text-gray-500 mt-1">Your week, compressed.</p>
      </div>

      {/* Share confirmation toast */}
      {shared === 'success' && (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-lg text-green-800 text-sm">
          Captured! It&apos;ll show up in your next episode.
        </div>
      )}

      {/* Signal Queue */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">
            Queue
            {(signalCounts.QUEUED || signalCounts.ENRICHED) ? (
              <span className="ml-2 text-sm font-normal text-gray-500">
                {(signalCounts.QUEUED || 0) + (signalCounts.ENRICHED || 0)} signals waiting
              </span>
            ) : null}
          </h2>
        </div>

        {signals.length === 0 ? (
          <div className="p-6 bg-gray-50 rounded-lg text-center text-gray-500">
            <p className="mb-2">No signals in the queue yet.</p>
            <p className="text-sm">
              Text a link or topic to your Poddit number, share from your browser, or forward an email.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {signals.map((signal) => (
              <div key={signal.id} className="flex items-start gap-3 p-3 bg-gray-50 rounded-lg">
                <span className="text-xs font-mono bg-gray-200 text-gray-600 px-2 py-0.5 rounded mt-0.5">
                  {signal.channel}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-900 truncate">
                    {signal.title || signal.rawContent.slice(0, 80)}
                  </p>
                  {signal.source && (
                    <p className="text-xs text-gray-500">{signal.source}</p>
                  )}
                </div>
                <span className="text-xs text-gray-400">
                  {new Date(signal.createdAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Episodes */}
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
