'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { isValidPhone } from '@/lib/phone';
import { useVoicePreview } from '@/hooks/useVoicePreview';

interface Voice {
  key: string;
  name: string;
  description: string;
  isDefault: boolean;
}

const BRIEFING_STYLES = [
  { key: 'essential', label: 'Essential', duration: '3-5 min', description: 'Concise executive briefing. Key themes, what matters, what to watch.' },
  { key: 'standard', label: 'Standard', duration: '7-10 min', description: 'Balanced deep dives with cross-theme insights. The full Poddit experience.' },
  { key: 'strategic', label: 'Strategic', duration: '10-15 min', description: 'In-depth analysis with counterpoints, implications, and decision prompts.' },
];

const RESEARCH_DEPTHS = [
  { key: 'explain-more', label: 'Explain More', description: 'Always provide context, even for topics you\'ve explored before.' },
  { key: 'auto', label: 'Auto', description: 'Poddit calibrates depth based on your signal history. Familiar topics go deeper, new ones get more context.' },
  { key: 'go-deeper', label: 'Go Deeper', description: 'Skip background and basics. Focus on what\'s new, counterpoints, and implications.' },
];

export default function SettingsPage() {
  const { data: session } = useSession();

  // Form state
  const [name, setName] = useState('');
  const [namePronunciation, setNamePronunciation] = useState('');
  const [phone, setPhone] = useState('');
  const [voice, setVoice] = useState('gandalf');
  const [briefingStyle, setBriefingStyle] = useState('standard');
  const [researchDepth, setResearchDepth] = useState('auto');
  const [timezone, setTimezone] = useState('America/New_York');
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);

  // UI state
  const [voices, setVoices] = useState<Voice[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Voice preview (shared hook)
  const { playingVoice, loadingVoice, voiceProgress, playPreview, stopPreview } = useVoicePreview();

  // Track saved state for unsaved changes warning
  const savedState = useRef<string>('');
  const getCurrentState = useCallback(() =>
    JSON.stringify({ name, namePronunciation, phone, voice, briefingStyle, researchDepth, timezone, notificationsEnabled }),
  [name, namePronunciation, phone, voice, briefingStyle, researchDepth, timezone, notificationsEnabled]);
  const isDirty = !loading && savedState.current !== '' && savedState.current !== getCurrentState();

  // Load preferences + voices
  useEffect(() => {
    Promise.all([
      fetch('/api/user/preferences').then(r => r.json()),
      fetch('/api/voices').then(r => r.json()),
    ]).then(([prefs, voiceData]) => {
      setName(prefs.name || '');
      setPhone(prefs.phone || '');
      const p = prefs.preferences || {};
      setNamePronunciation(p.namePronunciation || '');
      setVoice(p.voice || 'gandalf');
      setBriefingStyle(p.briefingStyle || 'standard');
      setResearchDepth(p.researchDepth || 'auto');
      setTimezone(p.timezone || 'America/New_York');
      setNotificationsEnabled(!!prefs.consentedAt);
      setVoices(voiceData.voices || []);
      // Snapshot saved state (use setTimeout to ensure all setState calls have flushed)
      setTimeout(() => {
        savedState.current = JSON.stringify({
          name: prefs.name || '', namePronunciation: p.namePronunciation || '', phone: prefs.phone || '',
          voice: p.voice || 'gandalf', briefingStyle: p.briefingStyle || 'standard',
          researchDepth: p.researchDepth || 'auto', timezone: p.timezone || 'America/New_York',
          notificationsEnabled: !!prefs.consentedAt,
        });
      }, 0);
    }).catch(() => {
      setError('Failed to load settings');
    }).finally(() => {
      setLoading(false);
    });
  }, []);

  // Warn on page close/refresh with unsaved changes
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (savedState.current && savedState.current !== getCurrentState()) {
        e.preventDefault();
      }
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [getCurrentState]);

  // Wrap playPreview to also select the voice
  const handleVoicePreview = useCallback((voiceKey: string) => {
    setVoice(voiceKey);
    playPreview(voiceKey);
  }, [playPreview]);

  const handleSave = async () => {
    stopPreview();
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
          preferences: { voice, briefingStyle, researchDepth, namePronunciation: namePronunciation || undefined, timezone },
          consent: notificationsEnabled,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to save');

      savedState.current = getCurrentState();
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
      <main className="max-w-lg mx-auto px-4 py-8 relative z-10">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-poddit-800 rounded w-1/3" />
          <div className="h-40 bg-poddit-800 rounded" />
          <div className="h-40 bg-poddit-800 rounded" />
        </div>
      </main>
    );
  }

  return (
    <>
      {/* ── Bokeh orbs — desktop only (100px blur too heavy for mobile GPU) ── */}
      <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden hidden sm:block">
        <div className="bokeh-orb absolute top-[15%] left-[10%] w-[40vw] h-[40vw] rounded-full bg-teal-500/[0.06] blur-[100px] animate-drift-1" />
        <div className="bokeh-orb absolute bottom-[20%] right-[5%] w-[35vw] h-[35vw] rounded-full bg-violet-500/[0.05] blur-[100px] animate-drift-3" />
        <div className="bokeh-orb absolute top-[60%] left-[50%] w-[25vw] h-[25vw] rounded-full bg-amber-400/[0.04] blur-[80px] animate-drift-5" />
      </div>

    <main className="max-w-lg mx-auto px-4 py-8 relative z-10">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8 animate-fade-in-up">
        <Link href="/" className="text-stone-500 hover:text-white transition-colors">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </Link>
        <Image src="/logo.png" alt="Poddit" width={28} height={28} className="rounded" />
        <h1 className="text-lg font-extrabold text-white font-display">Settings</h1>
      </div>

      {/* Success/error toasts — hidden here, shown next to Save button instead */}

      {/* Error toast — keep at top for visibility on initial load errors */}
      {error && !success && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-2xl backdrop-blur-sm text-red-400 text-sm flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
        </div>
      )}

      <div className="space-y-6">

        {/* ── Section 1: Display Name ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
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
            className="w-full px-4 py-2.5 bg-white/[0.07] border border-white/15 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 focus:bg-white/[0.10]
                       transition-colors"
          />
          {name && (
            <div className="mt-3">
              <label className="block text-xs text-stone-500 mb-1.5">
                Pronunciation guide <span className="text-stone-600">(optional)</span>
              </label>
              <input
                type="text"
                value={namePronunciation}
                onChange={(e) => setNamePronunciation(e.target.value)}
                placeholder={`e.g. ${name}`}
                className="w-full px-4 py-2 bg-white/[0.05] border border-white/10 rounded-xl text-sm text-white
                           placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 focus:bg-white/[0.08]
                           transition-colors"
              />
              <p className="text-[11px] text-stone-600 mt-1">
                How the narrator should say your name. Leave blank if it sounds fine as-is.
              </p>
            </div>
          )}
        </section>

        {/* ── Section 2: Voice Selection ── */}
        <section className="relative p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl overflow-hidden">
          {/* Inner bokeh — desktop only */}
          <div className="absolute top-[10%] right-[5%] w-[30%] h-[30%] rounded-full bg-violet-500/[0.08] blur-[60px] pointer-events-none hidden sm:block" />
          <div className="absolute bottom-[10%] left-[10%] w-[25%] h-[25%] rounded-full bg-amber-400/[0.06] blur-[50px] pointer-events-none hidden sm:block" />

          <label className="relative block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Voice
          </label>
          <p className="relative text-xs text-stone-500 mb-3">
            Tap to preview, tap again to stop
          </p>
          <div className="relative grid grid-cols-1 sm:grid-cols-2 gap-2">
            {voices.map((v) => {
              const isSelected = voice === v.key;
              const isPlaying = playingVoice === v.key;
              const isLoading = loadingVoice === v.key;

              return (
                <button
                  key={v.key}
                  onClick={() => handleVoicePreview(v.key)}
                  disabled={isLoading}
                  className={`relative p-3 rounded-xl border text-left transition-all overflow-hidden ${
                    isSelected
                      ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_12px_rgba(20,184,166,0.15)] lens-flare-edge'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  } ${isLoading ? 'cursor-wait' : ''}`}
                >
                  {/* Progress fill — sweeps left to right like Poddit Now button */}
                  {isPlaying && (
                    <div
                      className="absolute inset-0 bg-teal-500/15 transition-[width] duration-100 ease-linear"
                      style={{ width: `${voiceProgress}%` }}
                    />
                  )}
                  {/* Loading shimmer */}
                  {isLoading && (
                    <div className="absolute inset-0 animate-pulse bg-teal-500/10" />
                  )}
                  {/* Content */}
                  <div className="relative z-10 flex items-start justify-between">
                    <div>
                      <p className={`text-sm font-semibold ${isSelected ? 'text-teal-300' : 'text-white'}`}>
                        {v.name}
                      </p>
                      <p className="text-xs text-stone-500 mt-0.5">{v.description}</p>
                    </div>
                    {/* Play/stop indicator */}
                    <div className="flex-shrink-0 ml-2 mt-0.5">
                      {isLoading ? (
                        <svg className="animate-spin h-3.5 w-3.5 text-teal-400" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                      ) : isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
                             className="text-teal-400">
                          <rect x="6" y="4" width="4" height="16" rx="1" />
                          <rect x="14" y="4" width="4" height="16" rx="1" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"
                             className={isSelected ? 'text-teal-400/60' : 'text-stone-600'}>
                          <path d="M8 5.14v14l11-7-11-7z" />
                        </svg>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Section 3: Briefing Style ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Briefing Style
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Controls the depth, structure, and length of your episodes
          </p>
          <div className="grid grid-cols-1 gap-2">
            {BRIEFING_STYLES.map((style) => {
              const isSelected = briefingStyle === style.key;
              return (
                <button
                  key={style.key}
                  onClick={() => setBriefingStyle(style.key)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_12px_rgba(20,184,166,0.15)] lens-flare-edge'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-1">
                    <p className={`text-sm font-semibold ${isSelected ? 'text-teal-300' : 'text-white'}`}>
                      {style.label}
                    </p>
                    <span className={`text-xs font-mono ${isSelected ? 'text-teal-400/70' : 'text-stone-600'}`}>
                      {style.duration}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500 leading-relaxed">{style.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Section 4: Research Depth ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Research Depth
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Controls how much background context Poddit provides per topic
          </p>
          <div className="grid grid-cols-1 gap-2">
            {RESEARCH_DEPTHS.map((depth) => {
              const isSelected = researchDepth === depth.key;
              return (
                <button
                  key={depth.key}
                  onClick={() => setResearchDepth(depth.key)}
                  className={`p-3.5 rounded-xl border text-left transition-all ${
                    isSelected
                      ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_12px_rgba(20,184,166,0.15)] lens-flare-edge'
                      : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15] hover:bg-white/[0.05]'
                  }`}
                >
                  <p className={`text-sm font-semibold ${isSelected ? 'text-teal-300' : 'text-white'}`}>
                    {depth.label}
                  </p>
                  <p className="text-xs text-stone-500 leading-relaxed mt-1">{depth.description}</p>
                </button>
              );
            })}
          </div>
        </section>

        {/* ── Section 5: Timezone ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Timezone
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Used for episode dates and scheduling
          </p>
          <select
            value={timezone}
            onChange={(e) => setTimezone(e.target.value)}
            className="w-full px-4 py-2.5 bg-white/[0.07] border border-white/15 rounded-xl text-sm text-white
                       focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 focus:bg-white/[0.10]
                       transition-colors appearance-none cursor-pointer"
            style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23666' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' }}
          >
            <optgroup label="North America">
              <option value="America/New_York">Eastern Time (New York)</option>
              <option value="America/Chicago">Central Time (Chicago)</option>
              <option value="America/Denver">Mountain Time (Denver)</option>
              <option value="America/Los_Angeles">Pacific Time (Los Angeles)</option>
              <option value="America/Anchorage">Alaska (Anchorage)</option>
              <option value="Pacific/Honolulu">Hawaii (Honolulu)</option>
              <option value="America/Toronto">Eastern Time (Toronto)</option>
              <option value="America/Vancouver">Pacific Time (Vancouver)</option>
            </optgroup>
            <optgroup label="Europe">
              <option value="Europe/London">GMT / BST (London)</option>
              <option value="Europe/Paris">CET (Paris)</option>
              <option value="Europe/Berlin">CET (Berlin)</option>
              <option value="Europe/Amsterdam">CET (Amsterdam)</option>
              <option value="Europe/Madrid">CET (Madrid)</option>
              <option value="Europe/Rome">CET (Rome)</option>
              <option value="Europe/Zurich">CET (Zurich)</option>
              <option value="Europe/Stockholm">CET (Stockholm)</option>
              <option value="Europe/Dublin">GMT / IST (Dublin)</option>
              <option value="Europe/Lisbon">WET (Lisbon)</option>
              <option value="Europe/Athens">EET (Athens)</option>
              <option value="Europe/Helsinki">EET (Helsinki)</option>
              <option value="Europe/Moscow">MSK (Moscow)</option>
            </optgroup>
            <optgroup label="Asia & Pacific">
              <option value="Asia/Dubai">GST (Dubai)</option>
              <option value="Asia/Kolkata">IST (Mumbai)</option>
              <option value="Asia/Singapore">SGT (Singapore)</option>
              <option value="Asia/Hong_Kong">HKT (Hong Kong)</option>
              <option value="Asia/Shanghai">CST (Shanghai)</option>
              <option value="Asia/Tokyo">JST (Tokyo)</option>
              <option value="Asia/Seoul">KST (Seoul)</option>
              <option value="Australia/Sydney">AEST (Sydney)</option>
              <option value="Australia/Melbourne">AEST (Melbourne)</option>
              <option value="Australia/Perth">AWST (Perth)</option>
              <option value="Pacific/Auckland">NZST (Auckland)</option>
            </optgroup>
            <optgroup label="Other">
              <option value="America/Mexico_City">CST (Mexico City)</option>
              <option value="America/Sao_Paulo">BRT (São Paulo)</option>
              <option value="America/Argentina/Buenos_Aires">ART (Buenos Aires)</option>
              <option value="Africa/Johannesburg">SAST (Johannesburg)</option>
              <option value="Africa/Lagos">WAT (Lagos)</option>
              <option value="Africa/Cairo">EET (Cairo)</option>
              <option value="UTC">UTC</option>
            </optgroup>
          </select>
        </section>

        {/* ── Section 5: Phone Number ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
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
            autoComplete="tel"
            className={`w-full px-4 py-2.5 bg-white/[0.07] border rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 focus:bg-white/[0.10]
                       transition-colors font-mono ${phone && !isValidPhone(phone) ? 'border-red-500/40' : 'border-white/15'}`}
          />
          {phone && !isValidPhone(phone) && (
            <p className="text-xs text-red-400/80 mt-1.5">Must start with + followed by country code and number (e.g., +15551234567)</p>
          )}
        </section>

        {/* ── Section 5: Notifications ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
          <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
            Notifications
          </label>
          <p className="text-xs text-stone-500 mb-3">
            Receive episode alerts and product updates via email and SMS
          </p>
          <label className="flex items-center gap-3 cursor-pointer group">
            <button
              type="button"
              role="switch"
              aria-checked={notificationsEnabled}
              onClick={() => setNotificationsEnabled(prev => !prev)}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                notificationsEnabled ? 'bg-teal-500' : 'bg-stone-700'
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  notificationsEnabled ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
            <span className={`text-sm ${notificationsEnabled ? 'text-stone-300' : 'text-stone-500'}`}>
              {notificationsEnabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>
        </section>

        {/* ── Section 5b: Email Notification Preferences ── */}
        <EmailPreferencesSection />

        {/* ── Email (read-only) ── */}
        <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
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
            className="w-full px-4 py-2.5 bg-white/[0.04] border border-white/[0.06] rounded-xl text-sm text-stone-500
                       cursor-not-allowed"
          />
        </section>

        {/* ── Save Button + inline confirmation ── */}
        <div className="space-y-3">
          {isDirty && (
            <p className="text-xs text-amber-400/80 text-center">You have unsaved changes</p>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-3 text-sm font-bold rounded-xl
                       transition-colors flex items-center justify-center gap-2
                       ${isDirty
                         ? 'bg-teal-500 text-poddit-950 hover:bg-teal-400 shadow-[0_0_16px_rgba(20,184,166,0.3)]'
                         : 'bg-teal-500/60 text-poddit-950/80 hover:bg-teal-400 shadow-[0_0_12px_rgba(20,184,166,0.2)]'
                       }
                       disabled:bg-poddit-700 disabled:text-poddit-500 disabled:cursor-not-allowed`}
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
          {success && (
            <div className="p-3 bg-teal-400/10 border border-teal-400/20 rounded-2xl text-teal-300 text-sm text-center">
              Settings saved!
            </div>
          )}
          {error && (
            <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-2xl text-red-400 text-sm flex items-center justify-between">
              <span>{error}</span>
              <button onClick={() => setError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
            </div>
          )}
        </div>

      </div>
    </main>
    </>
  );
}

// ──────────────────────────────────────────────
// Email Notification Preferences (self-contained)
// ──────────────────────────────────────────────

const EMAIL_PREF_TOGGLES = [
  { key: 'transactional', label: 'Episode notifications', description: 'New episodes, first signal, milestones' },
  { key: 'nudges', label: 'Weekly nudges', description: 'Mid-week check-ins, quiet week reminders' },
  { key: 'discovery', label: 'Tips & insights', description: 'Feature tips, curiosity reflections' },
  { key: 'reengagement', label: 'Re-engagement', description: 'Check-ins if you\'ve been away' },
] as const;

function EmailPreferencesSection() {
  const [prefs, setPrefs] = useState<Record<string, boolean> | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch('/api/user/email-preferences')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setPrefs(data); })
      .catch(() => {}); // Silently fail — section just won't show
  }, []);

  const togglePref = async (key: string) => {
    if (!prefs || saving) return;
    const newValue = !prefs[key];
    const newPrefs = { ...prefs, [key]: newValue };

    // If turning any category back on, ensure unsubscribedAll is cleared
    if (newValue && prefs.unsubscribedAll) {
      newPrefs.unsubscribedAll = false;
    }

    setPrefs(newPrefs);
    setSaving(true);

    try {
      const res = await fetch('/api/user/email-preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: newValue, ...(newValue && prefs.unsubscribedAll ? { unsubscribedAll: false } : {}) }),
      });
      if (res.ok) {
        const updated = await res.json();
        setPrefs(updated);
      }
    } catch {
      // Revert on failure
      setPrefs(prefs);
    } finally {
      setSaving(false);
    }
  };

  if (!prefs) return null;

  return (
    <section className="p-4 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl">
      <label className="block text-xs text-stone-400 uppercase tracking-wider mb-2 font-semibold">
        Email Notifications
      </label>
      <p className="text-xs text-stone-500 mb-3">
        Choose which emails you receive from Poddit
      </p>

      {prefs.unsubscribedAll && (
        <div className="mb-3 p-2.5 bg-amber-500/5 border border-amber-500/15 rounded-xl">
          <p className="text-xs text-amber-400">You've unsubscribed from all emails. Toggle a category below to re-enable.</p>
        </div>
      )}

      <div className="space-y-2.5">
        {EMAIL_PREF_TOGGLES.map(toggle => (
          <label key={toggle.key} className="flex items-center justify-between gap-3 cursor-pointer group">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-stone-300 group-hover:text-white transition-colors">{toggle.label}</p>
              <p className="text-xs text-stone-600">{toggle.description}</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={!!prefs[toggle.key]}
              onClick={() => togglePref(toggle.key)}
              disabled={saving}
              className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${
                prefs[toggle.key] ? 'bg-teal-500' : 'bg-stone-700'
              } ${saving ? 'opacity-50' : ''}`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform shadow-sm ${
                  prefs[toggle.key] ? 'translate-x-4' : 'translate-x-0'
                }`}
              />
            </button>
          </label>
        ))}
      </div>
    </section>
  );
}
