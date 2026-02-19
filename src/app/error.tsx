'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error for debugging — visible in Railway logs if it happens server-adjacent
    console.error('[ErrorBoundary]', error?.message, error?.stack);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-poddit-950 px-4">
      <div className="text-center max-w-sm">
        <div className="mb-6">
          <div className="w-12 h-12 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center mx-auto">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-red-400">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        </div>
        <h2 className="text-lg font-semibold text-white mb-2">Something went wrong</h2>
        <p className="text-sm text-stone-400 mb-6">
          Try refreshing — if the problem persists, clear your browser cache or try an incognito tab.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => reset()}
            className="px-5 py-2.5 bg-teal-500/15 text-teal-400 text-sm font-semibold rounded-xl border border-teal-500/20 hover:bg-teal-500/25 transition-all"
          >
            Try again
          </button>
          <button
            onClick={() => window.location.reload()}
            className="px-5 py-2.5 text-stone-500 text-sm hover:text-stone-300 transition-colors"
          >
            Hard refresh
          </button>
        </div>
        <p className="text-xs text-stone-700 mt-8">
          If this keeps happening, contact <a href="mailto:hello@poddit.com" className="text-stone-600 hover:text-stone-400 transition-colors underline">hello@poddit.com</a>
        </p>
      </div>
    </div>
  );
}
