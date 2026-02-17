'use client';

import { Suspense, useEffect, useState, useCallback, type ReactNode } from 'react';
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
      user?: { name: string | null; email: string | null };
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
    status: 'healthy' | 'generating' | 'issues' | 'stuck';
    activeEpisodes: Array<{
      id: string;
      title: string | null;
      status: string;
      createdAt: string;
      user: { name: string | null; email: string | null };
    }>;
    stuckEpisodes: Array<{
      id: string;
      title: string | null;
      status: string;
      createdAt: string;
      user: { name: string | null; email: string | null };
    }>;
    lastSuccessfulEpisode: {
      id: string;
      title: string | null;
      generatedAt: string | null;
      user: { name: string | null; email: string | null };
    } | null;
    totalReadyEpisodes: number;
    totalFailedEpisodes: number;
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
    feedbackCount: number;
    ratingCount: number;
    questionnaireCount: number;
  }>;
  episodeRatings: {
    total: number;
    averages: {
      enjoyment: number | null;
      resonance: number | null;
      connections: number | null;
    };
    recent: Array<{
      id: string;
      enjoyment: number;
      resonance: number;
      connections: number;
      feedback: string | null;
      createdAt: string;
      user: { name: string | null; email: string | null };
      episode: { id: string; title: string | null };
    }>;
  };
  questionnaire: {
    total: number;
    responses: Array<{
      id: string;
      userId: string;
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
// TRASH ICON (reusable)
// ──────────────────────────────────────────────

function TrashButton({ onClick, size = 14 }: { onClick: () => void; size?: number }) {
  return (
    <button
      onClick={onClick}
      className="p-1.5 rounded-lg text-stone-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
      title="Delete"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24"
           fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <line x1="10" y1="11" x2="10" y2="17" />
        <line x1="14" y1="11" x2="14" y2="17" />
      </svg>
    </button>
  );
}

// ──────────────────────────────────────────────
// CONFIRM DELETE MODAL
// ──────────────────────────────────────────────

function ConfirmDeleteModal({
  isOpen,
  onConfirm,
  onCancel,
  title,
  description,
  loading,
  requireTypedConfirmation,
}: {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title: string;
  description: ReactNode;
  loading: boolean;
  requireTypedConfirmation?: boolean;
}) {
  const [typed, setTyped] = useState('');

  // Reset typed value when modal opens/closes
  useEffect(() => {
    if (!isOpen) setTyped('');
  }, [isOpen]);

  if (!isOpen) return null;

  const canConfirm = requireTypedConfirmation ? typed === 'DELETE' : true;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />

      {/* Modal */}
      <div className="relative w-full max-w-md p-6 bg-poddit-900 border border-red-500/20 rounded-2xl shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"
                 fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                 className="text-red-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h3 className="text-lg font-bold text-white">{title}</h3>
        </div>

        <div className="text-sm text-stone-400 mb-5 leading-relaxed">{description}</div>

        {requireTypedConfirmation && (
          <div className="mb-5">
            <label className="block text-xs text-stone-500 mb-1.5">
              Type <span className="text-red-400 font-mono font-bold">DELETE</span> to confirm
            </label>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DELETE"
              autoFocus
              className="w-full px-3 py-2 bg-poddit-950 border border-stone-800 rounded-lg text-sm text-white
                         placeholder:text-stone-700 focus:outline-none focus:ring-1 focus:ring-red-500/30
                         focus:border-red-500/30 font-mono"
            />
          </div>
        )}

        <div className="flex items-center gap-3">
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 border border-stone-800 text-stone-400 text-sm rounded-xl
                       hover:bg-poddit-800 disabled:opacity-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={loading || !canConfirm}
            className="flex-1 py-2.5 bg-red-500 text-white text-sm font-bold rounded-xl
                       hover:bg-red-600 disabled:bg-red-500/30 disabled:text-red-300/50
                       disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Deleting...
              </span>
            ) : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────
// TAB BUTTON
// ──────────────────────────────────────────────

function TabButton({ label, count, active, onClick }: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
        active
          ? 'bg-white/10 text-white'
          : 'text-stone-500 hover:text-stone-300 hover:bg-white/[0.03]'
      }`}
    >
      {label}{count !== undefined ? ` (${count})` : ''}
    </button>
  );
}

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

  // Tab state
  const [peopleTab, setPeopleTab] = useState<'users' | 'requests'>('requests');
  const [insightsTab, setInsightsTab] = useState<'feedback' | 'ratings' | 'questionnaire'>('feedback');

  // Delete modal state
  const [deleteModal, setDeleteModal] = useState<{
    type: 'user' | 'feedback' | 'questionnaire' | 'access-request' | 'episode';
    id: string;
    title: string;
    description: ReactNode;
    requireTyped?: boolean;
  } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

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

  // Generic delete handler
  const handleDelete = async () => {
    if (!deleteModal || !adminKey) return;
    setDeleteLoading(true);
    try {
      let body: Record<string, string>;
      switch (deleteModal.type) {
        case 'user':
          body = { action: 'delete-user', userId: deleteModal.id };
          break;
        case 'feedback':
          body = { action: 'delete-feedback', feedbackId: deleteModal.id };
          break;
        case 'questionnaire':
          body = { action: 'delete-questionnaire', userId: deleteModal.id };
          break;
        case 'access-request':
          body = { action: 'delete-access-request', accessRequestId: deleteModal.id };
          break;
        case 'episode':
          body = { action: 'delete-episode', episodeId: deleteModal.id };
          break;
        default:
          return;
      }

      const res = await fetch('/api/admin/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminKey}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();
      if (res.ok) {
        setActionMessage({ type: 'success', text: data.message || 'Deleted successfully' });
        await fetchStats(adminKey);
      } else {
        setActionMessage({ type: 'error', text: data.error || 'Delete failed' });
      }
    } catch {
      setActionMessage({ type: 'error', text: 'Delete request failed' });
    } finally {
      setDeleteLoading(false);
      setDeleteModal(null);
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <MetricCard label="Total Signals" value={stats.totals.signals} accent="teal" />
        <MetricCard label="Total Episodes" value={stats.totals.episodes} accent="violet" />
        <MetricCard label="Total Users" value={stats.totals.users} accent="stone" />
        <MetricCard label="Signals / Week" value={stats.totals.signalsThisWeek} accent="teal" subtitle="last 7 days" />
        <MetricCard label="Episodes / Week" value={stats.totals.episodesThisWeek} accent="violet" subtitle="last 7 days" />
        <MetricCard label="Feedback" value={stats.feedback.total} accent="amber" subtitle={`${stats.feedback.new} new`} />
      </div>

      {/* ── System Health ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mb-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">System Health</h2>
          <div className="flex items-center gap-3 text-xs text-stone-600">
            <span>{stats.health.totalReadyEpisodes} delivered</span>
            <span className="text-stone-700">&bull;</span>
            <span>{stats.health.totalFailedEpisodes} failed</span>
            <span className="text-stone-700">&bull;</span>
            <span>Last success: {stats.health.lastSuccessfulEpisode ? timeAgo(stats.health.lastSuccessfulEpisode.generatedAt || '') : '\u2014'}</span>
          </div>
        </div>

        {/* Current status banner */}
        {stats.health.status === 'stuck' ? (
          <div className="flex items-center gap-2 p-3 bg-red-500/5 border border-red-500/10 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400 flex-shrink-0"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
            <div>
              <p className="text-sm text-red-300 font-medium">Stuck episodes detected</p>
              <p className="text-xs text-red-400/70">{stats.health.stuckEpisodes.length} episode{stats.health.stuckEpisodes.length !== 1 ? 's' : ''} stuck in generation for 10+ minutes</p>
            </div>
          </div>
        ) : stats.health.status === 'generating' ? (
          <div className="flex items-center gap-2 p-3 bg-violet-500/5 border border-violet-500/10 rounded-xl">
            <svg className="animate-spin h-4 w-4 text-violet-400 flex-shrink-0" viewBox="0 0 24 24" fill="none"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
            <div>
              <p className="text-sm text-violet-300 font-medium">Generation in progress</p>
              <p className="text-xs text-violet-400/70">{stats.health.activeEpisodes.map(ep => ep.user?.name || ep.user?.email || 'Unknown').join(', ')}</p>
            </div>
          </div>
        ) : stats.health.status === 'issues' ? (
          <div className="flex items-center gap-2 p-3 bg-amber-500/5 border border-amber-500/10 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 flex-shrink-0"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
            <div>
              <p className="text-sm text-amber-300 font-medium">Recent failures</p>
              <p className="text-xs text-amber-400/70">{stats.health.failedEpisodes.length} episode{stats.health.failedEpisodes.length !== 1 ? 's' : ''}, {stats.health.failedSignals.length} signal{stats.health.failedSignals.length !== 1 ? 's' : ''} failed this week</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-2 p-3 bg-teal-500/5 border border-teal-500/10 rounded-xl">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400 flex-shrink-0"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
            <p className="text-sm text-teal-300">All systems healthy</p>
          </div>
        )}

        {/* Stuck episodes (critical) */}
        {stats.health.stuckEpisodes.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-2">Stuck (10+ min)</p>
            {stats.health.stuckEpisodes.map((ep) => (
              <div key={ep.id} className="p-3 bg-red-500/5 border border-red-500/10 rounded-lg mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono bg-red-500/10 text-red-400 px-1.5 py-0.5 rounded">{ep.status}</span>
                  <span className="text-xs text-stone-600">{timeAgo(ep.createdAt)}</span>
                  <span className="text-xs text-stone-600">{ep.user?.name || ep.user?.email}</span>
                </div>
                <p className="text-sm text-white truncate">{ep.title || 'Untitled'}</p>
              </div>
            ))}
          </div>
        )}

        {/* Recent failures (last 7 days) */}
        {(stats.health.failedEpisodes.length > 0 || stats.health.failedSignals.length > 0) && (
          <div className="mt-3">
            <p className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Failures (last 7 days)</p>
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
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
            </div>
          </div>
        )}
      </div>

      {/* ── People (Users + Access Requests) ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-teal-400/60" />
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">People</h2>
          </div>
          <div className="flex items-center gap-1">
            <TabButton
              label="Users"
              count={(stats.users || []).length}
              active={peopleTab === 'users'}
              onClick={() => setPeopleTab('users')}
            />
            <TabButton
              label="Access Requests"
              count={(stats.accessRequests || []).length}
              active={peopleTab === 'requests'}
              onClick={() => setPeopleTab('requests')}
            />
          </div>
        </div>

        {/* Users Tab */}
        {peopleTab === 'users' && (
          <>
            {(stats.users || []).length === 0 ? (
              <p className="text-sm text-stone-600 text-center py-4">No users yet</p>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto pr-1">
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="sticky top-0 bg-poddit-900/95 backdrop-blur-sm z-10">
                      <tr className="border-b border-stone-800/40">
                        <th className="text-xs text-stone-500 font-medium pb-2 pr-4">User</th>
                        <th className="text-xs text-stone-500 font-medium pb-2 pr-4">Type</th>
                        <th className="text-xs text-stone-500 font-medium pb-2 pr-4 text-center">Ep</th>
                        <th className="text-xs text-stone-500 font-medium pb-2 pr-4 text-center">Sig</th>
                        <th className="text-xs text-stone-500 font-medium pb-2 pr-4 text-center">FB</th>
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
                          <td className="py-2.5 pr-4 text-center">
                            <span className="text-xs font-mono text-stone-500">
                              {u.feedbackCount + u.ratingCount + u.questionnaireCount}
                            </span>
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
                              <TrashButton onClick={() => setDeleteModal({
                                type: 'user',
                                id: u.id,
                                title: 'Delete User',
                                description: (
                                  <div>
                                    <p className="mb-2">
                                      Permanently delete <strong className="text-white">{u.name || u.email}</strong> and all their data:
                                    </p>
                                    <ul className="list-disc list-inside text-xs text-stone-500 space-y-0.5">
                                      <li>{u.episodeCount} episode{u.episodeCount !== 1 ? 's' : ''}</li>
                                      <li>{u.signalCount} signal{u.signalCount !== 1 ? 's' : ''}</li>
                                      <li>{u.feedbackCount} feedback item{u.feedbackCount !== 1 ? 's' : ''}</li>
                                      <li>{u.ratingCount} rating{u.ratingCount !== 1 ? 's' : ''}</li>
                                      <li>{u.questionnaireCount} questionnaire response{u.questionnaireCount !== 1 ? 's' : ''}</li>
                                    </ul>
                                    <p className="mt-3 text-red-400 text-xs font-medium">This action cannot be undone.</p>
                                  </div>
                                ),
                                requireTyped: true,
                              })} />
                            </div>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}

        {/* Access Requests Tab */}
        {peopleTab === 'requests' && (
          <>
            {(stats.accessRequests || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                     className="text-stone-600 mb-3">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" /><line x1="23" y1="11" x2="17" y2="11" />
                </svg>
                <p className="text-stone-500 text-sm">No access requests</p>
                <p className="text-stone-600 text-xs mt-1">Requests from www.poddit.com will appear here</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto space-y-2 pr-1">
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
                          <TrashButton onClick={() => setDeleteModal({
                            type: 'access-request',
                            id: String(ar.id),
                            title: 'Delete Access Request',
                            description: (
                              <p>
                                Remove the access request from <strong className="text-white">{ar.full_name}</strong> ({ar.email})?
                                This removes it from the concept server.
                              </p>
                            ),
                          })} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
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

        {/* Episode Overview — scrollable */}
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

          {/* Recent episodes list — scrollable */}
          <div className="max-h-96 overflow-y-auto space-y-1 pr-1">
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
                  {ep.user && (
                    <p className="text-xs text-stone-500 truncate">{ep.user.name || ep.user.email || 'Unknown user'}</p>
                  )}
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

      {/* ── Activity Timeline — full width, scrollable ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mb-6">
        <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider mb-4">Activity Timeline</h2>
        <div className="max-h-96 overflow-y-auto space-y-0 pr-1">
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

      {/* ── Feedback & Insights (Feedback + Ratings + Questionnaire) ── */}
      <div className="p-5 bg-poddit-900/40 border border-stone-800/40 rounded-xl mb-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-amber-400/60" />
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">Feedback & Insights</h2>
          </div>
          <div className="flex items-center gap-1">
            <TabButton
              label="Feedback"
              count={stats.feedback.total}
              active={insightsTab === 'feedback'}
              onClick={() => setInsightsTab('feedback')}
            />
            <TabButton
              label="Ratings"
              count={stats.episodeRatings?.total || 0}
              active={insightsTab === 'ratings'}
              onClick={() => setInsightsTab('ratings')}
            />
            <TabButton
              label="Questionnaire"
              count={stats.questionnaire?.total || 0}
              active={insightsTab === 'questionnaire'}
              onClick={() => setInsightsTab('questionnaire')}
            />
          </div>
        </div>

        {/* Feedback Tab */}
        {insightsTab === 'feedback' && (
          <>
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
              <div className="max-h-[32rem] overflow-y-auto space-y-2 pr-1">
                {stats.feedback.recent.map((fb) => (
                  <div key={fb.id} className="p-3 bg-poddit-950/40 border border-stone-800/30 rounded-lg">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
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
                      <TrashButton onClick={() => setDeleteModal({
                        type: 'feedback',
                        id: fb.id,
                        title: 'Delete Feedback',
                        description: (
                          <p>
                            Delete this {fb.type.toLowerCase()} feedback from <strong className="text-white">{fb.user.name || fb.user.email || 'Unknown'}</strong>?
                          </p>
                        ),
                      })} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Ratings Tab */}
        {insightsTab === 'ratings' && (
          <>
            {(stats.episodeRatings?.total || 0) === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                     className="text-stone-600 mb-3">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <p className="text-stone-500 text-sm">No ratings yet</p>
                <p className="text-stone-600 text-xs mt-1">Episode ratings will appear here once submitted</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto pr-1">
                {/* Average scores */}
                {stats.episodeRatings.averages.enjoyment !== null && (
                  <div className="flex flex-wrap gap-3 mb-5">
                    {[
                      { label: 'Enjoyment', value: stats.episodeRatings.averages.enjoyment, color: 'teal' },
                      { label: 'Resonance', value: stats.episodeRatings.averages.resonance, color: 'violet' },
                      { label: 'Connections', value: stats.episodeRatings.averages.connections, color: 'amber' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="flex-1 min-w-[100px] p-3 bg-poddit-950/40 border border-stone-800/30 rounded-lg text-center">
                        <p className="text-xs text-stone-500 mb-1">{label}</p>
                        <p className={`text-xl font-extrabold ${
                          color === 'teal' ? 'text-teal-300' : color === 'violet' ? 'text-violet-300' : 'text-amber-300'
                        }`}>
                          {value !== null ? value.toFixed(1) : '--'}
                        </p>
                        <p className="text-xs text-stone-600">/ 5</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Recent ratings */}
                <div className="space-y-2">
                  {stats.episodeRatings.recent.map((rating) => {
                    const avg = ((rating.enjoyment + rating.resonance + rating.connections) / 3);
                    const hasLow = rating.enjoyment <= 2 || rating.resonance <= 2 || rating.connections <= 2;
                    return (
                      <div key={rating.id} className={`p-3 bg-poddit-950/40 border rounded-lg ${
                        hasLow ? 'border-amber-500/20' : 'border-stone-800/30'
                      }`}>
                        <div className="flex items-center justify-between mb-1.5">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-sm text-white truncate">{rating.episode.title || 'Untitled'}</span>
                            {hasLow && (
                              <span className="text-xs bg-amber-500/15 text-amber-300 px-1.5 py-0.5 rounded flex-shrink-0">Low</span>
                            )}
                          </div>
                          <span className="text-xs text-stone-600 flex-shrink-0 ml-2">{timeAgo(rating.createdAt)}</span>
                        </div>
                        <div className="flex items-center gap-3 mb-1">
                          <span className="text-xs text-stone-500">Enjoy: <span className="text-teal-300 font-mono">{rating.enjoyment}</span></span>
                          <span className="text-xs text-stone-500">Reson: <span className="text-violet-300 font-mono">{rating.resonance}</span></span>
                          <span className="text-xs text-stone-500">Conn: <span className="text-amber-300 font-mono">{rating.connections}</span></span>
                          <span className="text-xs text-stone-600 font-mono ml-auto">avg {avg.toFixed(1)}</span>
                        </div>
                        {rating.feedback && (
                          <p className="text-xs text-stone-300 mt-1.5 line-clamp-2 border-t border-stone-800/30 pt-1.5">&ldquo;{rating.feedback}&rdquo;</p>
                        )}
                        <p className="text-xs text-stone-600 mt-1">
                          {rating.user.name || rating.user.email || 'Unknown user'}
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </>
        )}

        {/* Questionnaire Tab */}
        {insightsTab === 'questionnaire' && (
          <>
            {(stats.questionnaire?.responses || []).length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                     className="text-stone-600 mb-3">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                  <line x1="16" y1="13" x2="8" y2="13" />
                  <line x1="16" y1="17" x2="8" y2="17" />
                  <polyline points="10 9 9 9 8 9" />
                </svg>
                <p className="text-stone-500 text-sm">No questionnaire responses</p>
                <p className="text-stone-600 text-xs mt-1">Responses will appear after users complete milestone questionnaires</p>
              </div>
            ) : (
              <div className="max-h-[32rem] overflow-y-auto space-y-4 pr-1">
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
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-stone-600">{timeAgo(qr.createdAt)}</span>
                          <TrashButton onClick={() => setDeleteModal({
                            type: 'questionnaire',
                            id: qr.userId,
                            title: 'Delete Questionnaire Responses',
                            description: (
                              <div>
                                <p>
                                  Delete all questionnaire responses for <strong className="text-white">{qr.user.name || qr.user.email || 'Unknown'}</strong>?
                                </p>
                                <p className="text-xs text-amber-400 mt-2">
                                  This will also remove any bonus episodes granted (+3 per questionnaire).
                                </p>
                              </div>
                            ),
                          })} />
                        </div>
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
            )}
          </>
        )}
      </div>

      {/* ── Confirm Delete Modal ── */}
      <ConfirmDeleteModal
        isOpen={!!deleteModal}
        onConfirm={handleDelete}
        onCancel={() => setDeleteModal(null)}
        title={deleteModal?.title || ''}
        description={deleteModal?.description || ''}
        loading={deleteLoading}
        requireTypedConfirmation={deleteModal?.requireTyped}
      />
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
