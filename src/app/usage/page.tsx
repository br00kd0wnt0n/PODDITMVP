'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function UsagePage() {
  const [loading, setLoading] = useState(true);
  const [episodeCount, setEpisodeCount] = useState(0);
  const [episodeLimit, setEpisodeLimit] = useState(3);
  const [userType, setUserType] = useState('EARLY_ACCESS');
  const [signalCount, setSignalCount] = useState(0);
  const [requesting, setRequesting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([
      fetch('/api/episodes').then(r => r.json()),
      fetch('/api/user/preferences').then(r => r.json()),
      fetch('/api/signals?status=queued,enriched,pending,used&limit=1').then(r => r.json()),
    ]).then(([eps, prefs, sigs]) => {
      setEpisodeCount(Array.isArray(eps) ? eps.length : 0);
      setEpisodeLimit(prefs.episodeLimit ?? 3);
      setUserType(prefs.userType || 'EARLY_ACCESS');
      // Total signal count from counts array
      const counts = sigs.counts || [];
      const total = counts.reduce((sum: number, c: { _count: number }) => sum + c._count, 0);
      setSignalCount(total);
    }).catch(() => {
      setError('Failed to load usage data');
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const requestMore = async () => {
    setRequesting(true);
    setError(null);
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: 'Episode limit increase request — user wants to continue testing.',
          type: 'REQUEST',
        }),
      });
      if (!res.ok) throw new Error('Failed to submit request');
      setRequestSent(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setRequesting(false);
    }
  };

  const isUnlimited = episodeLimit < 0;
  const usagePercent = isUnlimited ? 0 : episodeLimit > 0 ? Math.min(100, Math.round((episodeCount / episodeLimit) * 100)) : 0;
  const atLimit = !isUnlimited && episodeCount >= episodeLimit;

  const tierLabel = userType === 'MASTER' ? 'Master' : userType === 'TESTER' ? 'Tester' : 'Early Access';

  if (loading) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-poddit-800 rounded w-1/3" />
          <div className="h-40 bg-poddit-800 rounded" />
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8 page-enter">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link href="/" className="text-stone-500 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>
        <Image src="/logo.png" alt="Poddit" width={28} height={28} className="rounded" />
        <div>
          <h1 className="text-lg font-extrabold text-white font-display">Usage</h1>
          <p className="text-xs text-stone-500">{tierLabel} Plan</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      <div className="space-y-6">

        {/* ── Episodes ── */}
        <section className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xs text-stone-400 uppercase tracking-wider font-semibold">Episodes</h2>
            <span className="text-xs text-stone-600">{tierLabel}</span>
          </div>

          <div className="flex items-end gap-3 mb-4">
            <span className="text-4xl font-extrabold text-white tabular-nums">{episodeCount}</span>
            {!isUnlimited && (
              <span className="text-lg text-stone-600 mb-0.5">/ {episodeLimit}</span>
            )}
            {isUnlimited && (
              <span className="text-sm text-stone-500 mb-1">unlimited</span>
            )}
          </div>

          {/* Progress bar */}
          {!isUnlimited && (
            <div className="w-full bg-poddit-800 rounded-full h-2 mb-2">
              <div
                className={`h-2 rounded-full transition-all duration-500 ${
                  atLimit ? 'bg-amber-500' : 'bg-teal-500'
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
          )}

          {atLimit && (
            <p className="text-xs text-amber-400/80 mt-2">
              You&apos;ve used all {episodeLimit} episodes in your {tierLabel.toLowerCase()} plan.
            </p>
          )}

          {!atLimit && !isUnlimited && (
            <p className="text-xs text-stone-500 mt-2">
              {episodeLimit - episodeCount} episode{episodeLimit - episodeCount !== 1 ? 's' : ''} remaining
            </p>
          )}
        </section>

        {/* ── Signals ── */}
        <section className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-xs text-stone-400 uppercase tracking-wider font-semibold mb-4">Signals Captured</h2>
          <div className="flex items-end gap-2">
            <span className="text-4xl font-extrabold text-white tabular-nums">{signalCount}</span>
            <span className="text-sm text-stone-500 mb-1">total</span>
          </div>
        </section>

        {/* ── Request More ── */}
        {!isUnlimited && (
          <section className="p-5 bg-poddit-950/60 border border-amber-500/10 rounded-xl">
            <h2 className="text-xs text-stone-400 uppercase tracking-wider font-semibold mb-2">Need More Episodes?</h2>
            <p className="text-xs text-stone-500 mb-4">
              Want to keep testing? Request an increase and we&apos;ll review it.
            </p>

            {requestSent ? (
              <div className="p-3 bg-teal-400/10 border border-teal-400/20 rounded-xl text-sm text-teal-300 text-center">
                Request submitted! We&apos;ll review it shortly.
              </div>
            ) : (
              <button
                onClick={requestMore}
                disabled={requesting}
                className="w-full py-3 bg-amber-500/15 border border-amber-500/25 text-amber-300 text-sm font-semibold rounded-xl
                           hover:bg-amber-500/25 hover:border-amber-500/40 disabled:opacity-50 disabled:cursor-not-allowed
                           transition-all flex items-center justify-center gap-2"
              >
                {requesting ? (
                  <>
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Requesting...
                  </>
                ) : (
                  'Request More Episodes'
                )}
              </button>
            )}
          </section>
        )}

      </div>
    </main>
  );
}
