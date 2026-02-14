'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Image from 'next/image';

// ──────────────────────────────────────────────
// TYPES
// ──────────────────────────────────────────────

interface AdminStats {
  totals: {
    signals: number;
    episodes: number;
    users: number;
    signalsThisWeek: number;
    episodesThisWeek: number;
  };
  signals: {
    byStatus: Array<{ status: string; count: number }>;
    byChannel: Array<{ channel: string; count: number }>;
    byInputType: Array<{ inputType: string; count: number }>;
  };
  episodes: {
    recent: Array<{
      id: string;
      title: string | null;
      status: string;
      audioDuration: number | null;
      signalCount: number;
      generatedAt: string | null;
      error: string | null;
    }>;
    byStatus: Array<{ status: string; count: number }>;
  };
  recentSignals: Array<{
    id: string;
    inputType: string;
    channel: string;
    rawContent: string;
    url: string | null;
    title: string | null;
    status: string;
    createdAt: string;
  }>;
  health: {
    failedSignals: Array<{
      id: string;
      rawContent: string;
      channel: string;
      createdAt: string;
    }>;
    failedEpisodes: Array<{
      id: string;
      title: string | null;
      error: string | null;
      createdAt: string;
    }>;
  };
  generatedAt: string;
}

// ──────────────────────────────────────────────
// HELPERS
// ──────────────────────────────────────────────

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--';
  const mins = Math.round(seconds / 60);
  return `${mins} min`;
}

function barWidth(count: number, maxCount: number): string {
  if (maxCount === 0) return '0%';
  return `${Math.max(4, Math.round((count / maxCount) * 100))}%`;
}

const STATUS_COLORS: Record<string, string> = {
  QUEUED: 'bg-teal-500',
  ENRICHED: 'bg-teal-400',
  PENDING: 'bg-stone-500',
  USED: 'bg-violet-500',
  SKIPPED: 'bg-stone-600',
  FAILED: 'bg-red-500',
  READY: 'bg-teal-500',
  GENERATING: 'bg-yellow-500',
  SYNTHESIZING: 'bg-yellow-400',
  ARCHIVED: 'bg-stone-600',
};

const CHANNEL_COLORS: Record<string, string> = {
  SMS: 'bg-teal-500',
  EXTENSION: 'bg-violet-400',
  EMAIL: 'bg-teal-300',
  SHARE_SHEET: 'bg-violet-300',
  API: 'bg-stone-400',
};

const INPUT_TYPE_COLORS: Record<string, string> = {
  LINK: 'bg-teal-500',
  TOPIC: 'bg-violet-400',
  VOICE: 'bg-teal-300',
  FORWARDED_EMAIL: 'bg-violet-300',
  CLIPBOARD: 'bg-stone-400',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  READY: 'bg-teal-500',
  GENERATING: 'bg-yellow-500 animate-pulse',
  SYNTHESIZING: 'bg-yellow-400 animate-pulse',
  PENDING: 'bg-stone-500',
  FAILED: 'bg-red-500',
  ARCHIVED: 'bg-stone-600',
};

// ──────────────────────────────────────────────
// ADMIN LOGIN
// ──────────────────────────────────────────────

function AdminLogin({ onAuth, error }: { onAuth: (key: string) => void; error: string | null }) {
  const [key, setKey] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (key.trim()) onAuth(key.trim());
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <div className="p-6 bg-poddit-900/60 border border-stone-800/60 rounded-xl">
          <div className="flex items-center gap-2 mb-6">
            <Image src="/logo.png" alt="Poddit" width={28} height={28} className="rounded-lg" />
            <h1 className="text-lg font-extrabold text-white font-display">MISSION CONTROL</h1>
          </div>

          {error && (
            <div className="mb-4 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          <label className="block text-xs text-stone-500 mb-1.5">Admin Key</label>
          <input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="Enter API secret..."
            autoFocus
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30
                       focus:border-stone-600 mb-4"
          />
          <button
            type="submit"
            disabled={!key.trim()}
            className="w-full py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                       hover:bg-teal-400 disabled:bg-poddit-700 disabled:text-poddit-500
                       disabled:cursor-not-allowed transition-colors"
          >
            Enter
          </button>
        </div>
      </form>
    </div>
  );
}

// ──────────────────────────────────────────────
// ADMIN DASHBOARD
// ──────────────────────────────────────────────

function AdminDashboard() {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  // Check sessionStorage on mount
  useEffect(() => {
    const saved = sessionStorage.getItem('poddit-admin-key');
    if (saved) {
      setAdminKey(saved);
    }
  }, []);

  // Fetch stats when key is available
  const fetchStats = useCallback(async (key: string) => {
    setLoading(true);
    setAuthError(null);
    try {
      const res = await fetch('/api/admin/stats', {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (res.status === 401) {
        sessionStorage.removeItem('poddit-admin-key');
        setAdminKey(null);
        setAuthError('Invalid admin key');
        return;
      }
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
      sessionStorage.setItem('poddit-admin-key', key);
    } catch (err: any) {
      setAuthError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (adminKey) fetchStats(adminKey);
  }, [adminKey, fetchStats]);

  const handleAuth = (key: string) => {
    setAdminKey(key);
  };

  const handleLock = () => {
    sessionStorage.removeItem('poddit-admin-key');
    setAdminKey(null);
    setStats(null);
  };

  // Auth gate
  if (!adminKey) {
    return <AdminLogin onAuth={handleAuth} error={authError} />;
  }

  // Loading
  if (loading && !stats) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="flex items-center gap-3 text-stone-500">
          <svg className="animate-spin h-5 w-5 text-teal-400" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading mission control...
        </div>
      </div>
    );
  }

  if (!stats) return null;

  const totalFailed = stats.health.failedSignals.length + stats.health.failedEpisodes.length;

  return (
    <main className="max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <a href="/" className="hover:opacity-80 transition-opacity">
            <Image src="/logo.png" alt="Poddit" width={36} height={36} className="rounded-lg" />
          </a>
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight font-display">MISSION CONTROL</h1>
            <p className="text-stone-500 text-xs tracking-widest uppercase">Poddit Admin</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-stone-600">
            {new Date(stats.generatedAt).toLocaleTimeString()}
          </span>
          <button
            onClick={() => fetchStats(adminKey)}
            disabled={loading}
            className="p-2 border border-stone-800 rounded-lg text-stone-400 hover:text-teal-400
                       hover:border-teal-500/30 disabled:opacity-50 transition-all"
            title="Refresh"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 className={loading ? 'animate-spin' : ''}>
              <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2" />
            </svg>
          </button>
          <button
            onClick={handleLock}
            className="p-2 border border-stone-800 rounded-lg text-stone-400 hover:text-red-400
                       hover:border-red-500/30 transition-all"
            title="Lock"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-8">
        <MetricCard label="Total Signals" value={stats.totals.signals} accent="teal" />
        <MetricCard label="Total Episodes" value={stats.totals.episodes} accent="violet" />
        <MetricCard label="Total Users" value={stats.totals.users} accent="stone" />
        <MetricCard label="Signals / Week" value={stats.totals.signalsThisWeek} accent="teal" subtitle="last 7 days" />
        <MetricCard label="Episodes / Week" value={stats.totals.episodesThisWeek} accent="violet" subtitle="last 7 days" />
      </div>

      {/* ── Two-Column: Signals + Episodes ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Signal Breakdown */}
        <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">Signal Breakdown</h2>

          {/* By Status */}
          <h3 className="text-xs text-stone-500 mb-2">By Status</h3>
          <div className="space-y-1.5 mb-5">
            {stats.signals.byStatus.map(({ status, count }) => {
              const max = Math.max(...stats.signals.byStatus.map(s => s.count));
              return (
                <div key={status} className="flex items-center gap-3">
                  <span className="text-xs text-stone-400 w-20 truncate">{status}</span>
                  <div className="flex-1 bg-poddit-800 rounded-full h-2">
                    <div
                      className={`${STATUS_COLORS[status] || 'bg-stone-500'} h-2 rounded-full transition-all duration-500`}
                      style={{ width: barWidth(count, max) }}
                    />
                  </div>
                  <span className="text-xs text-stone-500 w-8 text-right font-mono">{count}</span>
                </div>
              );
            })}
            {stats.signals.byStatus.length === 0 && (
              <p className="text-xs text-stone-600">No signals yet</p>
            )}
          </div>

          {/* By Channel */}
          <h3 className="text-xs text-stone-500 mb-2">By Channel</h3>
          <div className="space-y-1.5 mb-5">
            {stats.signals.byChannel.map(({ channel, count }) => {
              const max = Math.max(...stats.signals.byChannel.map(s => s.count));
              return (
                <div key={channel} className="flex items-center gap-3">
                  <span className="text-xs text-stone-400 w-20 truncate">{channel}</span>
                  <div className="flex-1 bg-poddit-800 rounded-full h-2">
                    <div
                      className={`${CHANNEL_COLORS[channel] || 'bg-stone-500'} h-2 rounded-full transition-all duration-500`}
                      style={{ width: barWidth(count, max) }}
                    />
                  </div>
                  <span className="text-xs text-stone-500 w-8 text-right font-mono">{count}</span>
                </div>
              );
            })}
            {stats.signals.byChannel.length === 0 && (
              <p className="text-xs text-stone-600">No signals yet</p>
            )}
          </div>

          {/* By Input Type */}
          <h3 className="text-xs text-stone-500 mb-2">By Input Type</h3>
          <div className="space-y-1.5">
            {stats.signals.byInputType.map(({ inputType, count }) => {
              const max = Math.max(...stats.signals.byInputType.map(s => s.count));
              return (
                <div key={inputType} className="flex items-center gap-3">
                  <span className="text-xs text-stone-400 w-20 truncate">{inputType}</span>
                  <div className="flex-1 bg-poddit-800 rounded-full h-2">
                    <div
                      className={`${INPUT_TYPE_COLORS[inputType] || 'bg-stone-500'} h-2 rounded-full transition-all duration-500`}
                      style={{ width: barWidth(count, max) }}
                    />
                  </div>
                  <span className="text-xs text-stone-500 w-8 text-right font-mono">{count}</span>
                </div>
              );
            })}
            {stats.signals.byInputType.length === 0 && (
              <p className="text-xs text-stone-600">No signals yet</p>
            )}
          </div>
        </div>

        {/* Episode Overview */}
        <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">Episode Overview</h2>

          {/* Episode status summary */}
          <div className="flex flex-wrap gap-2 mb-4">
            {stats.episodes.byStatus.map(({ status, count }) => (
              <span
                key={status}
                className={`text-xs px-2 py-0.5 rounded-full ${
                  status === 'READY' ? 'bg-teal-500/15 text-teal-300'
                  : status === 'FAILED' ? 'bg-red-500/15 text-red-400'
                  : 'bg-stone-800 text-stone-400'
                }`}
              >
                {status}: {count}
              </span>
            ))}
          </div>

          {/* Recent episodes list */}
          <div className="space-y-1">
            {stats.episodes.recent.map((ep) => (
              <div
                key={ep.id}
                className={`flex items-center gap-3 p-2.5 rounded-lg hover:bg-poddit-900/60 transition-colors ${
                  ep.status === 'FAILED' ? 'border-l-2 border-l-red-500' : ''
                }`}
              >
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT_COLORS[ep.status] || 'bg-stone-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{ep.title || 'Untitled'}</p>
                  {ep.error && (
                    <p className="text-xs text-red-400 truncate">{ep.error}</p>
                  )}
                  <p className="text-xs text-stone-600">
                    {ep.generatedAt ? timeAgo(ep.generatedAt) : '--'}
                  </p>
                </div>
                <span className="text-xs text-stone-500 flex-shrink-0">{formatDuration(ep.audioDuration)}</span>
                <span className="text-xs font-mono bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded flex-shrink-0">
                  {ep.signalCount} sig
                </span>
              </div>
            ))}
            {stats.episodes.recent.length === 0 && (
              <p className="text-sm text-stone-600 text-center py-4">No episodes yet</p>
            )}
          </div>
        </div>
      </div>

      {/* ── Two-Column: Activity + Health ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">

        {/* Activity Timeline */}
        <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">Activity Timeline</h2>
          <div className="space-y-0">
            {stats.recentSignals.map((signal) => (
              <div key={signal.id} className="flex items-start gap-3 py-2.5 border-b border-stone-800/30 last:border-0">
                <span className="text-xs font-mono bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded flex-shrink-0 mt-0.5">
                  {signal.channel}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-poddit-100 truncate">
                    {signal.title || signal.rawContent.slice(0, 80)}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-stone-600">{signal.inputType}</span>
                    <span className="text-xs text-stone-700">&bull;</span>
                    <span className="text-xs text-stone-600">{timeAgo(signal.createdAt)}</span>
                  </div>
                </div>
                <span className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 ${
                  signal.status === 'ENRICHED' ? 'bg-teal-500/15 text-teal-300'
                  : signal.status === 'USED' ? 'bg-violet-500/15 text-violet-300'
                  : signal.status === 'FAILED' ? 'bg-red-500/15 text-red-400'
                  : 'bg-stone-800 text-stone-400'
                }`}>
                  {signal.status}
                </span>
              </div>
            ))}
            {stats.recentSignals.length === 0 && (
              <p className="text-sm text-stone-600 text-center py-4">No signals yet</p>
            )}
          </div>
        </div>

        {/* System Health */}
        <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">System Health</h2>

          {totalFailed === 0 ? (
            <div className="flex items-center gap-2 p-4 bg-teal-500/5 border border-teal-500/10 rounded-xl">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24"
                   fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                   className="text-teal-400">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <p className="text-sm text-teal-300">All systems healthy</p>
            </div>
          ) : (
            <div className="space-y-2">
              {stats.health.failedSignals.map((s) => (
                <div key={s.id} className="p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">SIGNAL</span>
                    <span className="text-xs font-mono bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded">{s.channel}</span>
                    <span className="text-xs text-stone-600">{timeAgo(s.createdAt)}</span>
                  </div>
                  <p className="text-sm text-red-300 truncate">{s.rawContent.slice(0, 100)}</p>
                </div>
              ))}
              {stats.health.failedEpisodes.map((ep) => (
                <div key={ep.id} className="p-3 bg-red-500/5 border border-red-500/10 rounded-lg">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">EPISODE</span>
                    <span className="text-xs text-stone-600">{timeAgo(ep.createdAt)}</span>
                  </div>
                  <p className="text-sm text-white truncate">{ep.title || 'Untitled'}</p>
                  {ep.error && <p className="text-xs text-red-400 truncate mt-0.5">{ep.error}</p>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Support Tickets (Placeholder) ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
        <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-3">Support Tickets</h2>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
               fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
               className="text-stone-600 mb-3">
            <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
            <polyline points="22,6 12,13 2,6" />
          </svg>
          <p className="text-stone-500 text-sm">Coming soon</p>
          <p className="text-stone-600 text-xs mt-1">Support ticket tracking will appear here</p>
        </div>
      </div>
    </main>
  );
}

// ──────────────────────────────────────────────
// METRIC CARD COMPONENT
// ──────────────────────────────────────────────

function MetricCard({ label, value, accent, subtitle }: {
  label: string;
  value: number;
  accent: 'teal' | 'violet' | 'stone';
  subtitle?: string;
}) {
  const accentBorder = accent === 'teal' ? 'border-t-teal-500'
    : accent === 'violet' ? 'border-t-violet-400'
    : 'border-t-stone-500';

  return (
    <div className={`p-4 bg-poddit-900/40 border border-stone-800/40 border-t-2 ${accentBorder} rounded-xl`}>
      <p className="text-xs text-stone-500 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-extrabold text-white mt-1">{value.toLocaleString()}</p>
      {subtitle && <p className="text-xs text-stone-600 mt-1">{subtitle}</p>}
    </div>
  );
}

// ──────────────────────────────────────────────
// PAGE EXPORT
// ──────────────────────────────────────────────

export default function AdminPage() {
  return (
    <Suspense fallback={<div className="max-w-6xl mx-auto px-4 py-8 text-stone-500">Loading...</div>}>
      <AdminDashboard />
    </Suspense>
  );
}
