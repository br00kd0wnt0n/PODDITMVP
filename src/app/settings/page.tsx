'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';

interface Voice {
  key: string;
  name: string;
  description: string;
  isDefault: boolean;
}

const EPISODE_LENGTHS = [
  { key: 'short', label: 'Short', description: '~5 min' },
  { key: 'medium', label: 'Medium', description: '~10 min' },
  { key: 'long', label: 'Long', description: '~15 min' },
];

export default function SettingsPage() {
  const { data: session } = useSession();

  // Form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [voice, setVoice] = useState('gandalf');
  const [episodeLength, setEpisodeLength] = useState('medium');

  // UI state
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load preferences + voices
  useEffect(() => {
    Promise.all([
      fetch('/api/user/preferences').then(r => r.json()),
      fetch('/api/voices').then(r => r.json()),
    ]).then(([prefs, voiceData]) => {
      setName(prefs.name || '');
      setPhone(prefs.phone || '');
      const p = prefs.preferences || {};
      setVoice(p.voice || 'gandalf');
      setEpisodeLength(p.episodeLength || 'medium');
      setVoices(voiceData.voices || []);
    }).catch(() => {
      setError('Failed to load settings');
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSuccess(false);

    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          phone: phone || null,
          preferences: { voice, episodeLength },
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <main className="max-w-lg mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-poddit-800 rounded w-1/3" />
          <div className="h-40 bg-poddit-800 rounded" />
          <div className="h-40 bg-poddit-800 rounded" />
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-lg mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <a href="/" className="text-stone-500 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </a>
        <Image src="/logo.png" alt="Poddit" width={28} height={28} className="rounded" />
        <h1 className="text-lg font-extrabold text-white font-display">Settings</h1>
      </div>

      {/* Success toast */}
      {success && (
        <div className="mb-4 p-3 bg-teal-400/10 border border-teal-400/20 rounded-lg text-teal-300 text-sm">
          Settings saved!
        </div>
      )}

      {/* Error toast */}
      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
        </div>
      )}

      <div className="space-y-6">

        {/* ── Section 1: Display Name ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Display Name
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Used in personalized episode intros
          </p>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30 focus:border-stone-600"
          />
        </section>

        {/* ── Section 2: Voice Selection ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Voice
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Choose the voice for your episode narration
          </p>
          <div className="grid grid-cols-2 gap-2">
            {voices.map((v) => (
              <button
                key={v.key}
                onClick={() => setVoice(v.key)}
                className={`p-3 rounded-xl border text-left transition-all ${
                  voice === v.key
                    ? 'border-teal-500/50 bg-teal-500/5'
                    : 'border-stone-800/60 bg-poddit-950/50 hover:border-stone-700'
                }`}
              >
                <p className={`text-sm font-semibold ${voice === v.key ? 'text-teal-300' : 'text-white'}`}>
                  {v.name}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">{v.description}</p>
              </button>
            ))}
          </div>
        </section>

        {/* ── Section 3: Episode Length ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Episode Length
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Target duration for generated episodes
          </p>
          <div className="grid grid-cols-3 gap-2">
            {EPISODE_LENGTHS.map((len) => (
              <button
                key={len.key}
                onClick={() => setEpisodeLength(len.key)}
                className={`p-3 rounded-xl border text-center transition-all ${
                  episodeLength === len.key
                    ? 'border-teal-500/50 bg-teal-500/5'
                    : 'border-stone-800/60 bg-poddit-950/50 hover:border-stone-700'
                }`}
              >
                <p className={`text-sm font-semibold ${episodeLength === len.key ? 'text-teal-300' : 'text-white'}`}>
                  {len.label}
                </p>
                <p className="text-xs text-stone-500 mt-0.5">{len.description}</p>
              </button>
            ))}
          </div>
        </section>

        {/* ── Section 4: Phone Number ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Phone Number
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Used for SMS capture and episode notifications. E.164 format (e.g., +15551234567)
          </p>
          <input
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+15551234567"
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30 focus:border-stone-600
                       font-mono"
          />
        </section>

        {/* ── Email (read-only) ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Email
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Used for sign-in and email capture
          </p>
          <input
            type="email"
            value={session?.user?.email || ''}
            disabled
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800/40 rounded-xl text-sm text-stone-500
                       cursor-not-allowed"
          />
        </section>

        {/* ── Save Button ── */}
        <button
          onClick={handleSave}
          disabled={saving}
          className="w-full py-3 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                     hover:bg-teal-400 disabled:bg-poddit-700 disabled:text-poddit-500 disabled:cursor-not-allowed
                     transition-colors flex items-center justify-center gap-2"
        >
          {saving ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </>
          ) : (
            'Save Settings'
          )}
        </button>

      </div>
    </main>
  );
}
