'use client';

import { Suspense, useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';

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
  feedback: {
    total: number;
    new: number;
    recent: Array<{
      id: string;
      type: string;
      content: string;
      status: string;
      createdAt: string;
      user: { name: string | null; email: string | null };
    }>;
  };
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
  users: Array<{
    id: string;
    name: string | null;
    email: string | null;
    userType: string;
    createdAt: string;
    consentedAt: string | null;
    invitedAt: string | null;
    revokedAt: string | null;
    episodeCount: number;
    signalCount: number;
  }>;
  questionnaire: {
    total: number;
    responses: Array<{
      id: string;
      responses: Record<string, string | string[]>;
      milestone: number;
      createdAt: string;
      user: { name: string | null; email: string | null };
    }>;
  };
  accessRequests: Array<{
    id: number;
    full_name: string;
    email: string;
    company_role: string | null;
    referral_source: string | null;
    nda_accepted: boolean;
    nda_accepted_at: string | null;
    created_at: string;
  }>;
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

const USER_TYPE_LABELS: Record<string, string> = {
  MASTER: 'Master',
  EARLY_ACCESS: 'Early Access',
  TESTER: 'Tester',
};

const USER_TYPE_COLORS: Record<string, string> = {
  MASTER: 'bg-amber-500/15 text-amber-300',
  EARLY_ACCESS: 'bg-teal-500/15 text-teal-300',
  TESTER: 'bg-violet-500/15 text-violet-300',
};

function AdminDashboard() {
  const [adminKey, setAdminKey] = useState<string | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [updatingUser, setUpdatingUser] = useState<string | null>(null);
  const [invitingEmail, setInvitingEmail] = useState<string | null>(null);
  const [revokingUser, setRevokingUser] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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

  // Update user type
  const updateUserType = async (userId: string, newType: string) => {
    if (!adminKey) return;
    setUpdatingUser(userId);
    try {
      const res = await fetch('/api/admin/stats', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ userId, userType: newType }),
      });
      if (res.ok) {
        // Refresh stats to reflect the change
        await fetchStats(adminKey);
      }
    } catch {
      // Error handling
    } finally {
      setUpdatingUser(null);
    }
  };

  // Grant access — send invite email with unique code
  const inviteUser = async (email: string, name?: string) => {
    if (!adminKey) return;
    setInvitingEmail(email);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ email, name }),
      });
      const data = await res.json();
      if (res.ok) {
        const verb = data.action === 'invited' ? 'Invited' : data.action === 'reinvited' ? 'Re-invited' : 'Sent code to';
        setActionMessage({
          type: data.emailSent ? 'success' : 'error',
          text: data.emailSent ? `${verb} ${email}` : `User created but email failed for ${email}`,
        });
        await fetchStats(adminKey);
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Invite failed' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to send invite' });
    } finally {
      setInvitingEmail(null);
    }
  };

  // Revoke access
  const revokeUser = async (userId: string) => {
    if (!adminKey) return;
    setRevokingUser(userId);
    setActionMessage(null);
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (res.ok) {
        setActionMessage({ type: 'success', text: `Revoked access for ${data.revoked}` });
        await fetchStats(adminKey);
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Revoke failed' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Failed to revoke access' });
    } finally {
      setRevokingUser(null);
    }
  };

  useEffect(() => {
    if (adminKey) {
      fetchStats(adminKey);
    }
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
          <Link href="/" className="hover:opacity-80 transition-opacity">
            <Image src="/logo.png" alt="Poddit" width={36} height={36} className="rounded-lg" />
          </Link>
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

      {/* Action toast */}
      {actionMessage && (
        <div className={`mb-6 p-3 rounded-xl text-sm flex items-center justify-between ${
          actionMessage.type === 'success'
            ? 'bg-teal-500/10 border border-teal-500/20 text-teal-300'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          <span>{actionMessage.text}</span>
          <button onClick={() => setActionMessage(null)} className="ml-3 opacity-60 hover:opacity-100 transition-opacity">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}

      {/* ── Key Metrics ── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        <MetricCard label="Total Signals" value={stats.totals.signals} accent="teal" />
        <MetricCard label="Total Episodes" value={stats.totals.episodes} accent="violet" />
        <MetricCard label="Total Users" value={stats.totals.users} accent="stone" />
        <MetricCard label="Signals / Week" value={stats.totals.signalsThisWeek} accent="teal" subtitle="last 7 days" />
        <MetricCard label="Episodes / Week" value={stats.totals.episodesThisWeek} accent="violet" subtitle="last 7 days" />
        <MetricCard label="Feedback" value={stats.feedback.total} accent="amber" subtitle={`${stats.feedback.new} new`} />
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

      {/* ── User Feedback ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400/60" />
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">User Feedback</h2>
            {stats.feedback.new > 0 && (
              <span className="text-xs bg-amber-500/15 text-amber-300 px-2 py-0.5 rounded-full">
                {stats.feedback.new} new
              </span>
            )}
          </div>
          <span className="text-xs text-stone-600">{stats.feedback.total} total</span>
        </div>

        {stats.feedback.recent.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                 className="text-stone-600 mb-3">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
            </svg>
            <p className="text-stone-500 text-sm">No feedback yet</p>
            <p className="text-stone-600 text-xs mt-1">User feedback will appear here once submitted</p>
          </div>
        ) : (
          <div className="space-y-2">
            {stats.feedback.recent.map((fb) => (
              <div key={fb.id} className="p-3 bg-poddit-950/40 border border-stone-800/30 rounded-lg">
                <div className="flex items-center gap-2 mb-1.5">
                  {/* Type badge */}
                  <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${
                    fb.type === 'REQUEST' ? 'bg-amber-500/15 text-amber-300'
                    : fb.type === 'VOICE' ? 'bg-violet-500/15 text-violet-300'
                    : 'bg-teal-500/15 text-teal-300'
                  }`}>
                    {fb.type}
                  </span>
                  {/* Status badge */}
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    fb.status === 'NEW' ? 'bg-amber-500/15 text-amber-300'
                    : fb.status === 'REVIEWED' ? 'bg-stone-800 text-stone-400'
                    : 'bg-teal-500/10 text-teal-400'
                  }`}>
                    {fb.status}
                  </span>
                  <span className="text-xs text-stone-600 ml-auto">{timeAgo(fb.createdAt)}</span>
                </div>
                <p className="text-sm text-poddit-100 line-clamp-2">{fb.content}</p>
                <p className="text-xs text-stone-600 mt-1.5">
                  {fb.user.name || fb.user.email || 'Unknown user'}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Questionnaire Responses ── */}
      {(stats.questionnaire?.responses || []).length > 0 && (
        <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-teal-400/60" />
              <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">Questionnaire Responses</h2>
            </div>
            <span className="text-xs text-stone-600">{stats.questionnaire.total} total</span>
          </div>

          <div className="space-y-4">
            {stats.questionnaire.responses.map((qr) => {
              const r = qr.responses as Record<string, string | string[]>;
              return (
                <div key={qr.id} className="p-4 bg-poddit-950/40 border border-stone-800/30 rounded-lg">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white font-medium">{qr.user.name || qr.user.email || 'Unknown'}</span>
                      <span className="text-xs bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded">
                        Milestone {qr.milestone}
                      </span>
                    </div>
                    <span className="text-xs text-stone-600">{timeAgo(qr.createdAt)}</span>
                  </div>

                  <div className="space-y-2.5 text-xs">
                    {r.describe && (
                      <div>
                        <span className="text-stone-500">Describe to a friend:</span>
                        <p className="text-stone-300 mt-0.5">&ldquo;{r.describe}&rdquo;</p>
                      </div>
                    )}
                    {r.useful && (
                      <div>
                        <span className="text-stone-500">Usefulness:</span>
                        <span className="text-stone-300 ml-1.5">{r.useful}</span>
                      </div>
                    )}
                    {r.changed && (
                      <div>
                        <span className="text-stone-500">Changed thinking:</span>
                        <span className="text-stone-300 ml-1.5">{r.changed}</span>
                      </div>
                    )}
                    {r.likelihood && (
                      <div>
                        <span className="text-stone-500">Open tomorrow:</span>
                        <span className="text-stone-300 ml-1.5">{r.likelihood}</span>
                      </div>
                    )}
                    {r.friction && (
                      <div>
                        <span className="text-stone-500">Friction:</span>
                        <span className="text-stone-300 ml-1.5">{r.friction}</span>
                      </div>
                    )}
                    {r.essential && (
                      <div>
                        <span className="text-stone-500">Can&apos;t live without:</span>
                        <p className="text-stone-300 mt-0.5">&ldquo;{r.essential}&rdquo;</p>
                      </div>
                    )}
                    {Array.isArray(r.listenWhen) && r.listenWhen.length > 0 && (
                      <div>
                        <span className="text-stone-500">Listens:</span>
                        <span className="text-stone-300 ml-1.5">{(r.listenWhen as string[]).join(', ')}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Users Management ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-400/60" />
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">Users</h2>
          </div>
          <span className="text-xs text-stone-600">{(stats.users || []).length} total</span>
        </div>

        {(stats.users || []).length === 0 ? (
          <p className="text-sm text-stone-600 text-center py-4">No users yet</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-stone-800/40">
                  <th className="text-xs text-stone-500 font-medium pb-2 pr-4">User</th>
                  <th className="text-xs text-stone-500 font-medium pb-2 pr-4">Type</th>
                  <th className="text-xs text-stone-500 font-medium pb-2 pr-4 text-center">Episodes</th>
                  <th className="text-xs text-stone-500 font-medium pb-2 pr-4 text-center">Signals</th>
                  <th className="text-xs text-stone-500 font-medium pb-2 pr-4">Status</th>
                  <th className="text-xs text-stone-500 font-medium pb-2 pr-4">Joined</th>
                  <th className="text-xs text-stone-500 font-medium pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {(stats.users || []).map((u) => {
                  const isRevoked = !!u.revokedAt;
                  const isInvited = !!u.invitedAt;
                  const hasSignedIn = !!u.consentedAt;
                  return (
                  <tr key={u.id} className={`border-b border-stone-800/20 last:border-0 hover:bg-poddit-900/60 transition-colors ${isRevoked ? 'opacity-50' : ''}`}>
                    <td className="py-2.5 pr-4">
                      <p className="text-sm text-white truncate max-w-[200px]">{u.name || '--'}</p>
                      <p className="text-xs text-stone-500 truncate max-w-[200px]">{u.email}</p>
                    </td>
                    <td className="py-2.5 pr-4">
                      <select
                        value={u.userType}
                        onChange={(e) => updateUserType(u.id, e.target.value)}
                        disabled={updatingUser === u.id || isRevoked}
                        className={`text-xs px-2 py-1 rounded-lg border-0 cursor-pointer transition-all
                          ${USER_TYPE_COLORS[u.userType] || 'bg-stone-800 text-stone-400'}
                          ${updatingUser === u.id || isRevoked ? 'opacity-50' : 'hover:ring-1 hover:ring-stone-600'}
                          focus:outline-none focus:ring-1 focus:ring-teal-400/30`}
                        style={{ WebkitAppearance: 'none', MozAppearance: 'none' }}
                      >
                        {Object.entries(USER_TYPE_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 pr-4 text-center">
                      <span className="text-sm font-mono text-stone-300">{u.episodeCount}</span>
                    </td>
                    <td className="py-2.5 pr-4 text-center">
                      <span className="text-sm font-mono text-stone-300">{u.signalCount}</span>
                    </td>
                    <td className="py-2.5 pr-4">
                      {isRevoked ? (
                        <span className="text-xs bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">Revoked</span>
                      ) : hasSignedIn ? (
                        <span className="text-xs bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded">Active</span>
                      ) : isInvited ? (
                        <span className="text-xs bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded">Invited</span>
                      ) : (
                        <span className="text-xs bg-stone-800 text-stone-500 px-1.5 py-0.5 rounded">Pending</span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4">
                      <span className="text-xs text-stone-500">{timeAgo(u.createdAt)}</span>
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        {isRevoked ? (
                          <button
                            onClick={() => u.email && inviteUser(u.email, u.name || undefined)}
                            disabled={invitingEmail === u.email}
                            className="text-xs px-2.5 py-1 rounded-lg bg-teal-500/10 text-teal-400
                                       hover:bg-teal-500/20 disabled:opacity-50 transition-all"
                          >
                            {invitingEmail === u.email ? 'Restoring...' : 'Restore'}
                          </button>
                        ) : (
                          <>
                            {!hasSignedIn && isInvited && (
                              <button
                                onClick={() => u.email && inviteUser(u.email, u.name || undefined)}
                                disabled={invitingEmail === u.email}
                                className="text-xs px-2.5 py-1 rounded-lg bg-stone-800 text-stone-400
                                           hover:bg-stone-700 hover:text-stone-300 disabled:opacity-50 transition-all"
                                title="Resend invite email"
                              >
                                {invitingEmail === u.email ? 'Sending...' : 'Resend'}
                              </button>
                            )}
                            <button
                              onClick={() => revokeUser(u.id)}
                              disabled={revokingUser === u.id}
                              className="text-xs px-2.5 py-1 rounded-lg bg-red-500/10 text-red-400
                                         hover:bg-red-500/20 disabled:opacity-50 transition-all"
                            >
                              {revokingUser === u.id ? 'Revoking...' : 'Revoke'}
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── Access Requests (from PODDIT-CONCEPT) ── */}
      {(stats.accessRequests || []).length > 0 && (
        <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mt-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-violet-400/60" />
              <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">Access Requests</h2>
            </div>
            <span className="text-xs text-stone-600">{stats.accessRequests.length} requests</span>
          </div>

          <div className="space-y-2">
            {stats.accessRequests.map((ar) => {
              const matchedUser = (stats.users || []).find(u => u.email === ar.email);
              const isActive = matchedUser && !matchedUser.revokedAt;
              const isRevoked = matchedUser?.revokedAt;
              const isInvited = matchedUser?.invitedAt && !matchedUser.consentedAt && !matchedUser.revokedAt;
              return (
                <div key={ar.id} className="p-3 bg-poddit-950/40 border border-stone-800/30 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-sm text-white font-medium truncate">{ar.full_name}</p>
                        {ar.nda_accepted ? (
                          <span className="text-xs bg-teal-500/10 text-teal-400 px-1.5 py-0.5 rounded flex-shrink-0">NDA Signed</span>
                        ) : (
                          <span className="text-xs bg-amber-500/10 text-amber-300 px-1.5 py-0.5 rounded flex-shrink-0">No NDA</span>
                        )}
                      </div>
                      <p className="text-xs text-stone-400 truncate">{ar.email}</p>
                      <div className="flex items-center gap-2 mt-1">
                        {ar.company_role && (
                          <span className="text-xs text-stone-500">{ar.company_role}</span>
                        )}
                        {ar.company_role && ar.referral_source && (
                          <span className="text-xs text-stone-700">&bull;</span>
                        )}
                        {ar.referral_source && (
                          <span className="text-xs text-stone-600">via {ar.referral_source}</span>
                        )}
                      </div>
                      <p className="text-xs text-stone-600 mt-1">{timeAgo(ar.created_at)}</p>
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2">
                      {isActive && matchedUser.consentedAt ? (
                        <span className="text-xs bg-teal-500/15 text-teal-300 px-2.5 py-1 rounded-lg">Active User</span>
                      ) : isRevoked ? (
                        <button
                          onClick={() => inviteUser(ar.email, ar.full_name)}
                          disabled={invitingEmail === ar.email}
                          className="text-xs px-3 py-1.5 rounded-lg bg-teal-500/10 text-teal-400
                                     hover:bg-teal-500/20 disabled:opacity-50 transition-all font-medium"
                        >
                          {invitingEmail === ar.email ? 'Restoring...' : 'Restore Access'}
                        </button>
                      ) : isInvited ? (
                        <span className="text-xs bg-amber-500/10 text-amber-300 px-2.5 py-1 rounded-lg">Invited</span>
                      ) : (
                        <button
                          onClick={() => inviteUser(ar.email, ar.full_name)}
                          disabled={invitingEmail === ar.email}
                          className="text-xs px-3 py-1.5 rounded-lg bg-teal-500 text-poddit-950
                                     hover:bg-teal-400 disabled:opacity-50 transition-all font-bold"
                        >
                          {invitingEmail === ar.email ? (
                            <span className="flex items-center gap-1.5">
                              <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Sending...
                            </span>
                          ) : 'Grant Access'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </main>
  );
}

// ──────────────────────────────────────────────
// METRIC CARD COMPONENT
// ──────────────────────────────────────────────

function MetricCard({ label, value, accent, subtitle }: {
  label: string;
  value: number;
  accent: 'teal' | 'violet' | 'stone' | 'amber';
  subtitle?: string;
}) {
  const accentBorder = accent === 'teal' ? 'border-t-teal-500'
    : accent === 'violet' ? 'border-t-violet-400'
    : accent === 'amber' ? 'border-t-amber-400'
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
