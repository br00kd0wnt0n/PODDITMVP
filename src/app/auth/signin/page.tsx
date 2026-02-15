'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !code.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await signIn('credentials', {
        email: email.trim(),
        code: code.trim(),
        redirect: false,
        callbackUrl: '/',
      });

      if (result?.error) {
        setError('Invalid email or access code.');
        setLoading(false);
      } else if (result?.url) {
        // Trigger fade-out, then navigate after animation
        setExiting(true);
        const targetUrl = result.url;
        setTimeout(() => {
          window.location.href = targetUrl;
        }, 450);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden transition-all ${exiting ? 'page-exit' : ''}`}>
      {/* Extra bokeh for signin — more prominent than global */}
      <div className="absolute top-[15%] -right-16 w-80 h-80 rounded-full bg-amber-500/[0.06] blur-3xl" />
      <div className="absolute top-[25%] right-24 w-40 h-40 rounded-full bg-amber-400/[0.08] blur-2xl" />
      <div className="absolute bottom-[20%] -left-12 w-64 h-64 rounded-full bg-teal-500/[0.05] blur-3xl" />
      <div className="absolute bottom-[35%] left-16 w-24 h-24 rounded-full bg-amber-300/[0.07] blur-xl" />
      {/* Horizontal lens flare streak */}
      <div className="absolute top-[38%] left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-amber-500/[0.15] to-transparent" />
      {/* Secondary softer flare */}
      <div className="absolute top-[38%] left-0 right-0 h-[12px] bg-gradient-to-r from-transparent via-amber-500/[0.04] to-transparent blur-sm" />

      {/* Hero lockup: animated logo + title + subtitle */}
      <div className="relative z-10 flex flex-col items-center mb-10">
        <div className="w-28 h-28 rounded-3xl overflow-hidden ring-1 ring-white/10 shadow-2xl shadow-amber-500/[0.12] mb-6">
          <video
            src="/logo_loop.mp4"
            autoPlay
            loop
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight font-display mb-1">PODDIT</h1>
        <p className="text-stone-400 text-sm tracking-widest uppercase">Your world, explained</p>
      </div>

      {/* Sign-in form */}
      <form onSubmit={handleSubmit} className="w-full max-w-sm relative z-10">
        <div className="p-6 bg-poddit-900/60 border border-stone-800/60 rounded-xl backdrop-blur-sm">

          {error && (
            <div role="alert" className="mb-4 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          <label htmlFor="email" className="block text-xs text-stone-500 mb-1.5">Email address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            required
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30
                       focus:border-stone-600 mb-4"
          />

          <label htmlFor="code" className="block text-xs text-stone-500 mb-1.5">Access code</label>
          <input
            id="code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter access code"
            required
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30
                       focus:border-stone-600 mb-4"
          />

          <label className="flex items-start gap-2.5 mb-4 cursor-pointer group">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-stone-600 accent-teal-500 flex-shrink-0"
            />
            <span className="text-xs text-stone-500 leading-relaxed group-hover:text-stone-400 transition-colors">
              I agree to receive episode notifications and product updates via email and SMS.
              You can opt out anytime in Settings.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !email.trim() || !code.trim() || !consent}
            className="w-full py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                       hover:bg-teal-400 disabled:bg-poddit-700 disabled:text-poddit-500
                       disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
          >
            {loading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Signing in...
              </>
            ) : (
              'Sign in'
            )}
          </button>

          <p className="text-xs text-stone-600 text-center mt-4">
            Early access — check your invite email for the code.
          </p>
          <p className="text-xs text-stone-600 text-center mt-1">
            Need help? <a href="mailto:Hello@poddit.com" className="text-teal-500/70 hover:text-teal-400 transition-colors">Hello@poddit.com</a>
          </p>
        </div>
      </form>
    </div>
  );
}
