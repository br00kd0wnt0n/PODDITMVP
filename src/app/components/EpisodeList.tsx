'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface Episode {
  id: string;
  title: string;
  summary: string | null;
  audioUrl: string | null;
  audioDuration: number | null;
  signalCount: number;
  topicsCovered: string[];
  generatedAt: string;
  status?: string;
  rated?: boolean;
  channels?: string[];
  signalTopics?: string[];
}

interface EpisodeListProps {
  episodes: Episode[];
  episodeLimit: number;
  loading: boolean;
  generating: boolean;
  newEpisodeId: string | null;
}

const EPISODE_ACCENTS = [
  { bg: 'bg-violet-500/[0.12]', text: 'text-violet-400', border: 'border-violet-500/20', pill: 'bg-violet-400/15 text-violet-300' },
  { bg: 'bg-amber-500/[0.12]', text: 'text-amber-400', border: 'border-amber-500/20', pill: 'bg-amber-400/15 text-amber-300' },
  { bg: 'bg-rose-500/[0.12]', text: 'text-rose-400', border: 'border-rose-500/20', pill: 'bg-rose-400/15 text-rose-300' },
];

function formatDuration(seconds: number | null) {
  if (!seconds) return '';
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

export default function EpisodeList({
  episodes,
  episodeLimit,
  loading,
  generating,
  newEpisodeId,
}: EpisodeListProps) {
  const [expandedEpisodeId, setExpandedEpisodeId] = useState<string | null>(null);

  return (
    <section className="mb-6 lg:mb-0 order-2 lg:col-start-2 lg:row-start-1 lg:row-span-2">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold text-white">Your Episodes</h2>
        {episodes.filter(e => e.status === 'READY' || !e.status).length > 0 && (
          <span className="text-xs text-stone-500">
            {(() => { const readyCount = episodes.filter(e => e.status === 'READY' || !e.status).length; return episodeLimit > 0 ? `${readyCount} of ${episodeLimit}` : `${readyCount}`; })()}
          </span>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2].map(i => <div key={i} className="h-28 bg-poddit-900/50 rounded-2xl animate-pulse" />)}
        </div>
      ) : episodes.length === 0 && !generating ? (
        <div className="py-10 px-4 text-center bg-poddit-900/30 border border-stone-800/30 rounded-2xl">
          <div className="w-14 h-14 rounded-2xl bg-violet-400/10 flex items-center justify-center mx-auto mb-4">
            <svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400">
              <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
            </svg>
          </div>
          <p className="text-sm text-stone-400 font-medium mb-1">No episodes yet</p>
          <p className="text-xs text-stone-500 max-w-sm mx-auto">
            Once you have signals in your queue, hit Generate My Episode to create your first personalized audio episode.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {episodes.map((ep, idx) => {
            // Generating/synthesizing placeholder card
            if (ep.status === 'GENERATING' || ep.status === 'SYNTHESIZING') {
              return (
                <div key={ep.id} className="relative rounded-2xl bg-teal-500/[0.06] border border-teal-500/15 overflow-hidden animate-pulse">
                  <div className="p-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0">
                        <svg className="animate-spin h-5 w-5 text-teal-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Generating your episode...</p>
                        <p className="text-xs text-stone-500 mt-0.5">
                          {ep.status === 'SYNTHESIZING' ? 'Creating audio — almost there' : 'Synthesising your signals — this takes a few minutes'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }

            const accent = EPISODE_ACCENTS[idx % EPISODE_ACCENTS.length];
            const isExpanded = expandedEpisodeId === ep.id;
            return (
              <div key={ep.id}
                className={`relative rounded-2xl ${accent.bg} border ${accent.border} overflow-hidden hover:border-stone-700/50 transition-all
                           ${ep.id === newEpisodeId ? 'animate-episode-reveal ring-1 ring-white/10' : ''} lens-flare-edge lens-flare-edge-alt`}>
                <div className="p-4">
                  {/* Play button — top right */}
                  <Link href={`/player/${ep.id}`} prefetch={false}
                    className="absolute top-4 right-4 flex-shrink-0 w-10 h-10 rounded-xl bg-teal-500 text-poddit-950 flex items-center justify-center hover:bg-teal-400 transition-colors shadow-[0_0_12px_rgba(20,184,166,0.2)]">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="ml-0.5">
                      <polygon points="6 3 20 12 6 21 6 3"/>
                    </svg>
                  </Link>
                  {/* Content — no left gap needed, play button is absolute positioned */}
                  <div className="pr-14">
                    <Link href={`/player/${ep.id}`} prefetch={false} className="group">
                      <h3 className="font-bold text-white text-base group-hover:text-stone-200 transition-colors leading-snug">{ep.title}</h3>
                    </Link>
                    <div className="flex items-center gap-2 mt-1 text-xs text-stone-500">
                      {formatDuration(ep.audioDuration) && <span>{formatDuration(ep.audioDuration)}</span>}
                      {formatDuration(ep.audioDuration) && <span className="text-stone-700">&bull;</span>}
                      <span>{ep.signalCount} signal{ep.signalCount !== 1 ? 's' : ''}</span>
                      <span className="text-stone-700">&bull;</span>
                      <span>{new Date(ep.generatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </div>
                  </div>
                  {/* Synopsis */}
                  {ep.summary && (
                    <div className="mt-2">
                      <p className={`text-sm text-stone-400 leading-relaxed ${isExpanded ? '' : 'line-clamp-2'}`}>{ep.summary}</p>
                      {ep.summary.length > 120 && (
                        <button onClick={(e) => { e.preventDefault(); setExpandedEpisodeId(isExpanded ? null : ep.id); }}
                          className={`text-xs ${accent.text} opacity-70 hover:opacity-100 mt-1 transition-opacity`}>
                          {isExpanded ? 'Show less' : 'Read more'}
                        </button>
                      )}
                    </div>
                  )}
                  {/* Topic pills */}
                  {ep.topicsCovered.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2.5">
                      {ep.topicsCovered.slice(0, 4).map(topic => (
                        <span key={topic} className={`text-xs ${accent.pill} px-2 py-0.5 rounded-full`}>{topic}</span>
                      ))}
                      {ep.topicsCovered.length > 4 && <span className="text-xs text-stone-600">+{ep.topicsCovered.length - 4}</span>}
                    </div>
                  )}

                  {/* Episode rating CTA */}
                  {ep.rated ? (
                    <div className="flex items-center gap-1.5 mt-2.5 text-xs text-stone-600">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Rated
                    </div>
                  ) : (
                    <Link href={`/player/${ep.id}#rate`} prefetch={false} className={`inline-flex items-center gap-1.5 mt-2.5 text-xs ${accent.text} opacity-70 hover:opacity-100 transition-opacity`}>
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                      </svg>
                      How was it?
                    </Link>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
