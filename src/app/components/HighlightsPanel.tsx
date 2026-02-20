'use client';

import React from 'react';

interface HighlightsPanelProps {
  topicFrequency: [string, number][];
  channelBreakdown: [string, number][];
  readyEpisodeCount: number;
  signalCount: number;
  trends?: { topic: string; previous: number; current: number; change: number }[];
  newTopics?: string[];
}

export default function HighlightsPanel({
  topicFrequency,
  channelBreakdown,
  readyEpisodeCount,
  signalCount,
  trends,
  newTopics,
}: HighlightsPanelProps) {
  return (
    <section className="mb-6 lg:mb-0 order-3 lg:col-start-1 lg:row-start-2 lg:self-start relative rounded-2xl bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] overflow-hidden">
      {/* Inner bokeh for Insights panel */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute bottom-[-10%] left-[-5%] w-36 h-36 rounded-full bg-violet-400/10 blur-3xl bokeh-orb bokeh-2" />
        <div className="absolute top-[-15%] right-[-5%] w-28 h-28 rounded-full bg-amber-400/[0.08] blur-2xl bokeh-orb bokeh-4" />
      </div>
      <div className="relative z-10 p-5">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-bold text-white">Your Highlights</h2>
        </div>

          <div className="mt-4">
            {topicFrequency.length === 0 && readyEpisodeCount === 0 ? (
              <div className="py-8 px-4 text-center bg-white/[0.02] border border-white/[0.05] rounded-2xl">
                <p className="text-sm text-stone-400 font-medium mb-1">Your highlights will appear here</p>
                <p className="text-xs text-stone-500 max-w-sm mx-auto">
                  As you capture signals and generate episodes, Poddit learns what interests you most.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Conversational highlight cards */}
                {topicFrequency.length > 0 && (
                  <div className="p-4 bg-white/[0.03] border border-white/[0.05] rounded-2xl">
                    <p className="text-sm text-stone-300 leading-relaxed">
                      You&apos;ve been most curious about{' '}
                      <span className="font-semibold text-violet-400">{topicFrequency[0]?.[0]}</span>
                      {topicFrequency.length > 1 && (<>, <span className="font-semibold text-amber-400">{topicFrequency[1]?.[0]}</span></>)}
                      {topicFrequency.length > 2 && (<>, and <span className="font-semibold text-rose-400">{topicFrequency[2]?.[0]}</span></>)}
                      {topicFrequency.length > 3 && ` — plus ${topicFrequency.length - 3} more topic${topicFrequency.length - 3 !== 1 ? 's' : ''}`}.
                    </p>
                    {topicFrequency.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-3">
                        {topicFrequency.map(([topic, count], i) => {
                          const colors = ['bg-violet-400/15 text-violet-300', 'bg-amber-400/15 text-amber-300', 'bg-rose-400/15 text-rose-300', 'bg-teal-400/15 text-teal-300', 'bg-stone-700/50 text-stone-400'];
                          return (
                            <span key={topic} className={`text-xs px-2.5 py-1 rounded-full ${colors[Math.min(i, colors.length - 1)]}`}>
                              {topic} <span className="opacity-50">×{count}</span>
                            </span>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Curiosity Patterns — trends + new topics */}
                {((trends && trends.length > 0) || (newTopics && newTopics.length > 0)) && (
                  <div className="p-4 bg-white/[0.03] border border-white/[0.05] rounded-2xl space-y-2.5">
                    <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider">Curiosity Patterns</p>
                    {trends && trends.map(t => (
                      <p key={t.topic} className="text-sm text-stone-300 leading-relaxed">
                        <span className="font-semibold text-teal-400">{t.topic}</span>
                        {' '}signals up <span className="font-semibold text-teal-400">{t.change}×</span> this week
                      </p>
                    ))}
                    {newTopics && newTopics.length > 0 && (
                      <p className="text-sm text-stone-300 leading-relaxed">
                        New this week:{' '}
                        {newTopics.map((topic, i) => (
                          <span key={topic}>
                            {i > 0 && (i === newTopics.length - 1 ? ' and ' : ', ')}
                            <span className="font-semibold text-violet-400">{topic}</span>
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                )}

                {/* Activity snapshot */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {readyEpisodeCount > 0 && (
                    <div className="p-3 bg-white/[0.03] border border-white/[0.05] rounded-xl text-center">
                      <p className="text-2xl font-bold text-white">{readyEpisodeCount}</p>
                      <p className="text-xs text-stone-500 mt-0.5">episode{readyEpisodeCount !== 1 ? 's' : ''} created</p>
                    </div>
                  )}
                  {signalCount > 0 && (
                    <div className="p-3 bg-white/[0.03] border border-white/[0.05] rounded-xl text-center">
                      <p className="text-2xl font-bold text-white">{signalCount}</p>
                      <p className="text-xs text-stone-500 mt-0.5">signal{signalCount !== 1 ? 's' : ''} captured</p>
                    </div>
                  )}
                  {channelBreakdown.length > 0 && (
                    <div className="p-3 bg-white/[0.03] border border-white/[0.05] rounded-xl text-center">
                      <p className="text-2xl font-bold text-white">{channelBreakdown.length}</p>
                      <p className="text-xs text-stone-500 mt-0.5">capture channel{channelBreakdown.length !== 1 ? 's' : ''} used</p>
                    </div>
                  )}
                </div>

                {/* Favourite channel nudge */}
                {channelBreakdown.length > 0 && (() => {
                  const labels: Record<string, string> = { SMS: 'texting', EMAIL: 'email', EXTENSION: 'the Chrome extension', SHARE_SHEET: 'share sheet', API: 'direct input' };
                  const topChannel = channelBreakdown[0]?.[0];
                  const topLabel = labels[topChannel] || topChannel;
                  return (
                    <p className="text-xs text-stone-500 leading-relaxed">
                      Your favourite way to capture is <span className="text-stone-300 font-medium">{topLabel}</span> — keep it up.
                    </p>
                  );
                })()}
              </div>
            )}
          </div>
      </div>
    </section>
  );
}
