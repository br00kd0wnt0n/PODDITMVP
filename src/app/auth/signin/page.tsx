'use client';

import { useState, useEffect } from 'react';
import { signIn, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';

export default function SignInPage() {
  const { status } = useSession();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exiting, setExiting] = useState(false);

  // Redirect already-authenticated users to dashboard
  useEffect(() => {
    if (status === 'authenticated') {
      router.replace('/');
    }
  }, [status, router]);

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
        // Trigger fade-out, then client-side navigate after animation
        setExiting(true);
        const targetUrl = result.url;
        setTimeout(() => {
          router.push(targetUrl || '/');
        }, 450);
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className={`min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden transition-all ${exiting ? 'page-exit' : ''}`}>
      {/* Bokeh orbs — bright, warm */}
      <div className="absolute top-[10%] -right-16 w-80 h-80 rounded-full bg-violet-500/[0.08] blur-3xl" />
      <div className="absolute top-[25%] right-24 w-48 h-48 rounded-full bg-amber-400/[0.10] blur-2xl" />
      <div className="absolute bottom-[15%] -left-12 w-72 h-72 rounded-full bg-teal-500/[0.06] blur-3xl" />
      <div className="absolute bottom-[40%] left-20 w-28 h-28 rounded-full bg-rose-400/[0.08] blur-xl" />

      {/* Hero lockup */}
      <div className="relative z-10 flex flex-col items-center mb-10">
        <Image src="/logo.png" alt="Poddit" width={112} height={112} className="rounded-3xl ring-1 ring-white/10 shadow-2xl shadow-violet-500/[0.12] mb-6" />
        <h1 className="text-4xl font-extrabold text-white tracking-tight font-display mb-1">PODDIT</h1>
        <p className="text-stone-400 text-sm tracking-widest uppercase">Your world, explained</p>
      </div>

      {/* Sign-in form */}
      <form onSubmit={handleSubmit} className="w-full max-w-sm relative z-10">
        <div className="p-6 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl backdrop-blur-sm">

          {error && (
            <div role="alert" className="mb-4 p-2.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-xs">
              {error}
            </div>
          )}

          <label htmlFor="email" className="block text-xs text-stone-400 mb-1.5 font-medium">Email address</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            autoFocus
            required
            className="w-full px-4 py-3 bg-white/[0.07] border border-white/15 rounded-xl text-sm text-white
                       placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-white/20
                       focus:border-white/30 focus:bg-white/[0.10] transition-all mb-4"
          />

          <label htmlFor="code" className="block text-xs text-stone-400 mb-1.5 font-medium">Access code</label>
          <input
            id="code"
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter access code"
            required
            className="w-full px-4 py-3 bg-white/[0.07] border border-white/15 rounded-xl text-sm text-white
                       placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-white/20
                       focus:border-white/30 focus:bg-white/[0.10] transition-all mb-4"
          />

          <label className="flex items-start gap-2.5 mb-5 cursor-pointer group">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-stone-600 accent-white flex-shrink-0"
            />
            <span className="text-xs text-stone-500 leading-relaxed group-hover:text-stone-400 transition-colors">
              I agree to receive episode notifications and product updates via email and SMS.
              You can opt out anytime in Settings.
            </span>
          </label>

          <button
            type="submit"
            disabled={loading || !email.trim() || !code.trim() || !consent}
            className="w-full py-3 bg-white text-poddit-950 text-sm font-bold rounded-xl
                       hover:bg-stone-100 disabled:bg-stone-800 disabled:text-stone-600
                       disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2
                       shadow-[0_2px_8px_rgba(255,255,255,0.10)] hover:shadow-[0_2px_12px_rgba(255,255,255,0.15)] disabled:shadow-none"
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

          <p className="text-xs text-stone-500 text-center mt-4">
            Early access — check your invite email for the code.
          </p>
          <p className="text-xs text-stone-500 text-center mt-1">
            Need help? <a href="mailto:Hello@poddit.com" className="text-stone-300 hover:text-white transition-colors">Hello@poddit.com</a>
          </p>
        </div>
      </form>
    </div>
  );
}
