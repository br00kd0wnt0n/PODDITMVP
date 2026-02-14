'use client';

import { useState } from 'react';
import { signIn } from 'next-auth/react';
import Image from 'next/image';

export default function SignInPage() {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        window.location.href = result.url;
      }
    } catch {
      setError('Something went wrong. Please try again.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden">
      {/* Horizontal lens flare streak — signin-specific */}
      <div className="absolute top-1/2 -translate-y-1/2 left-0 right-0 h-[1px] bg-gradient-to-r from-transparent via-amber-500/[0.08] to-transparent" />

      <form onSubmit={handleSubmit} className="w-full max-w-sm relative z-10">
        <div className="p-6 bg-poddit-900/60 border border-stone-800/60 rounded-xl backdrop-blur-sm">
          <div className="flex items-center gap-2 mb-2">
            <Image src="/logo.png" alt="Poddit" width={32} height={32} className="rounded-lg" />
            <h1 className="text-xl font-extrabold text-white font-display">PODDIT</h1>
          </div>
          <p className="text-stone-500 text-sm mb-6">Sign in to your personal podcast</p>

          {error && (
            <div className="mb-4 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs">
              {error}
            </div>
          )}

          <label className="block text-xs text-stone-500 mb-1.5">Email address</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            autoFocus
            required
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30
                       focus:border-stone-600 mb-4"
          />

          <label className="block text-xs text-stone-500 mb-1.5">Access code</label>
          <input
            type="password"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Enter access code"
            required
            className="w-full px-4 py-2.5 bg-poddit-950 border border-stone-800 rounded-xl text-sm text-white
                       placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30
                       focus:border-stone-600 mb-4"
          />

          <button
            type="submit"
            disabled={loading || !email.trim() || !code.trim()}
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
            Early access — ask Brook for the code.
          </p>
        </div>
      </form>
    </div>
  );
}
