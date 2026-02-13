'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';

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

interface Episode {
  id: string;
  title: string;
  summary: string | null;
  script: string;
  audioUrl: string | null;
  audioDuration: number | null;
  signalCount: number;
  topicsCovered: string[];
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  segments: Segment[];
  signals: Signal[];
}

export default function PlayerPage() {
  const params = useParams();
  const [episode, setEpisode] = useState<Episode | null>(null);
  const [activeSegment, setActiveSegment] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/episodes?id=${params.id}`)
      .then(r => r.json())
      .then(data => {
        setEpisode(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [params.id]);

  if (loading) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <div className="animate-pulse">
          <div className="h-8 bg-gray-200 rounded w-2/3 mb-4" />
          <div className="h-4 bg-gray-200 rounded w-full mb-2" />
          <div className="h-4 bg-gray-200 rounded w-3/4" />
        </div>
      </main>
    );
  }

  if (!episode) {
    return (
      <main className="max-w-2xl mx-auto px-4 py-8">
        <p className="text-gray-500">Episode not found.</p>
        <a href="/" className="text-poddit-600 hover:underline mt-2 inline-block">← Back</a>
      </main>
    );
  }

  const formatDate = (d: string) => new Date(d).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  return (
    <main className="max-w-2xl mx-auto px-4 py-8">
      {/* Back link */}
      <a href="/" className="text-sm text-gray-400 hover:text-gray-600 mb-4 inline-block">← All episodes</a>

      {/* Episode header */}
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{episode.title}</h1>
        <div className="flex items-center gap-3 mt-2 text-sm text-gray-500">
          <span>{formatDate(episode.periodStart)} — {formatDate(episode.periodEnd)}</span>
          <span>•</span>
          <span>{episode.signalCount} signals</span>
          {episode.audioDuration && (
            <>
              <span>•</span>
              <span>{Math.round(episode.audioDuration / 60)} min</span>
            </>
          )}
        </div>
      </header>

      {/* Audio player */}
      {episode.audioUrl && (
        <div className="mb-8 p-4 bg-poddit-50 rounded-xl">
          <audio
            controls
            className="w-full"
            src={episode.audioUrl}
            preload="metadata"
          >
            Your browser does not support audio playback.
          </audio>
        </div>
      )}

      {/* Summary */}
      {episode.summary && (
        <div className="mb-8 p-4 bg-gray-50 rounded-lg">
          <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2">Summary</h2>
          <p className="text-gray-800 leading-relaxed">{episode.summary}</p>
        </div>
      )}

      {/* Segments */}
      <section className="mb-8">
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-4">Segments</h2>
        
        {/* Segment tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2 mb-4">
          {episode.segments.map((seg, i) => (
            <button
              key={seg.id}
              onClick={() => setActiveSegment(i)}
              className={`px-3 py-1.5 text-sm rounded-full whitespace-nowrap transition-colors ${
                activeSegment === i
                  ? 'bg-poddit-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {seg.topic}
            </button>
          ))}
        </div>

        {/* Active segment content */}
        {episode.segments[activeSegment] && (
          <div>
            <div className="prose prose-gray max-w-none">
              {episode.segments[activeSegment].content.split('\n\n').map((para, i) => (
                <p key={i}>{para}</p>
              ))}
            </div>

            {/* Source cards */}
            {episode.segments[activeSegment].sources?.length > 0 && (
              <div className="mt-4 space-y-2">
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sources</h3>
                {(episode.segments[activeSegment].sources as Source[]).map((source, i) => (
                  <a
                    key={i}
                    href={source.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-start gap-2 p-2 bg-white border border-gray-100 rounded-lg hover:border-poddit-200 transition-colors text-sm"
                  >
                    <span className="text-poddit-600 font-medium">{source.name}</span>
                    <span className="text-gray-400">—</span>
                    <span className="text-gray-500">{source.attribution}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Original signals */}
      <section>
        <h2 className="text-sm font-semibold text-gray-600 uppercase tracking-wide mb-3">Captured Signals</h2>
        <div className="space-y-1">
          {episode.signals.map((signal) => (
            <div key={signal.id} className="flex items-center gap-2 text-sm py-1">
              <span className="text-xs font-mono bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">
                {signal.channel}
              </span>
              {signal.url ? (
                <a href={signal.url} target="_blank" rel="noopener noreferrer" className="text-poddit-600 hover:underline truncate">
                  {signal.title || signal.url}
                </a>
              ) : (
                <span className="text-gray-700 truncate">{signal.title}</span>
              )}
              {signal.source && <span className="text-gray-400 text-xs">({signal.source})</span>}
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
