'use client';

import { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';

export default function WelcomePage() {
  const [platform, setPlatform] = useState<'ios' | 'android' | 'desktop'>('desktop');

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/iPhone|iPad|iPod/i.test(ua)) {
      setPlatform('ios');
    } else if (/Android/i.test(ua)) {
      setPlatform('android');
    }
  }, []);

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
          <h1 className="text-lg font-extrabold text-white font-display">Get Started</h1>
          <p className="text-xs text-stone-500">Early Access Guide</p>
        </div>
      </div>

      <div className="space-y-6">

        {/* ── What to Focus On ── */}
        <section className="p-4 bg-poddit-950/60 border border-teal-500/10 rounded-xl relative overflow-hidden">
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-teal-500/[0.03] blur-2xl pointer-events-none" />
          <h2 className="text-sm font-semibold text-teal-300 uppercase tracking-wider mb-3">What to Focus On</h2>
          <div className="space-y-2.5">
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500/15 text-teal-400 text-[10px] font-bold flex items-center justify-center mt-0.5">1</span>
              <p className="text-sm text-stone-300"><span className="text-white font-medium">Capture signals</span> &mdash; save anything that catches your eye throughout the week</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-400/15 text-violet-400 text-[10px] font-bold flex items-center justify-center mt-0.5">2</span>
              <p className="text-sm text-stone-300"><span className="text-white font-medium">Listen to episodes</span> &mdash; hit Poddit Now or wait for your Friday roundup</p>
            </div>
            <div className="flex items-start gap-2.5">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold flex items-center justify-center mt-0.5">3</span>
              <p className="text-sm text-stone-300"><span className="text-white font-medium">Share feedback</span> &mdash; your input shapes the product</p>
            </div>
          </div>
        </section>

        {/* ── Capture Channels ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-4">Ways to Capture</h2>

          <div className="space-y-4">
            {/* SMS */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="text-teal-400">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Text or Voice Message</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Text a link, topic, or voice note to <span className="text-teal-400 font-mono">(855) 506-5970</span> (US) or <span className="text-teal-400 font-mono">+44 7426 985763</span> (UK)
                </p>
              </div>
            </div>

            {/* Share Sheet */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="text-violet-400">
                  <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                  <polyline points="16 6 12 2 8 6" />
                  <line x1="12" y1="2" x2="12" y2="15" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Share from Any App</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Add Poddit to your homescreen, then use your phone&apos;s share button from any app
                </p>
              </div>
            </div>

            {/* Direct Input */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
                  <path d="M12 20h9" />
                  <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-white">Type or Speak on Dashboard</p>
                <p className="text-xs text-stone-500 mt-0.5">
                  Paste a link or type a topic directly into the input bar
                </p>
              </div>
            </div>

            {/* Email Forward */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-stone-800/60 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="text-stone-500">
                  <rect width="20" height="16" x="2" y="4" rx="2" />
                  <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-400">Email Forward</p>
                <p className="text-xs text-stone-600 mt-0.5">
                  Forward newsletters to capture@poddit.com
                </p>
              </div>
            </div>

            {/* Chrome Extension */}
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 rounded-lg bg-stone-800/60 flex items-center justify-center flex-shrink-0">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" className="text-stone-500">
                  <circle cx="12" cy="12" r="10" />
                  <circle cx="12" cy="12" r="4" />
                  <line x1="21.17" y1="8" x2="12" y2="8" />
                  <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                  <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
                </svg>
              </div>
              <div>
                <p className="text-sm font-medium text-stone-400">Chrome Extension <span className="text-xs text-stone-600 font-normal ml-1">Coming soon</span></p>
                <p className="text-xs text-stone-600 mt-0.5">
                  Save any page with one click
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* ── Install as App ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-3">Add to Homescreen</h2>
          <p className="text-xs text-stone-500 mb-3">
            Install Poddit as an app for the best experience &mdash; including share sheet access.
          </p>

          {platform === 'ios' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="text-xs text-stone-600 font-mono mt-0.5">1.</span>
                <p className="text-xs text-stone-400">Tap the <span className="text-white font-medium">Share</span> button (box with arrow) in Safari</p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-xs text-stone-600 font-mono mt-0.5">2.</span>
                <p className="text-xs text-stone-400">Scroll down and tap <span className="text-white font-medium">Add to Home Screen</span></p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-xs text-stone-600 font-mono mt-0.5">3.</span>
                <p className="text-xs text-stone-400">Tap <span className="text-white font-medium">Add</span> in the top right</p>
              </div>
            </div>
          )}

          {platform === 'android' && (
            <div className="space-y-2">
              <div className="flex items-start gap-2.5">
                <span className="text-xs text-stone-600 font-mono mt-0.5">1.</span>
                <p className="text-xs text-stone-400">Tap the <span className="text-white font-medium">three-dot menu</span> in Chrome</p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-xs text-stone-600 font-mono mt-0.5">2.</span>
                <p className="text-xs text-stone-400">Tap <span className="text-white font-medium">Add to Home screen</span></p>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="text-xs text-stone-600 font-mono mt-0.5">3.</span>
                <p className="text-xs text-stone-400">Tap <span className="text-white font-medium">Add</span> to confirm</p>
              </div>
            </div>
          )}

          {platform === 'desktop' && (
            <div className="space-y-2">
              <p className="text-xs text-stone-400">
                On mobile, you can install Poddit as an app from your browser menu. This enables the share sheet for quick signal capture from any app.
              </p>
              <p className="text-xs text-stone-500 italic">
                Visit this page on your phone to see device-specific instructions.
              </p>
            </div>
          )}
        </section>

        {/* ── Customize ── */}
        <section className="p-4 bg-poddit-900/40 border border-stone-800/40 rounded-xl">
          <h2 className="text-sm font-semibold text-stone-300 uppercase tracking-wider mb-2">Customize</h2>
          <p className="text-xs text-stone-500 mb-3">
            Choose your narrator voice and preferred episode length.
          </p>
          <Link
            href="/settings"
            className="inline-flex items-center gap-2 px-4 py-2 bg-poddit-950 border border-stone-800 rounded-xl
                       text-sm text-stone-300 hover:text-white hover:border-stone-700 transition-all"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
            Open Settings
          </Link>
        </section>

        {/* ── Go to Dashboard ── */}
        <Link
          href="/"
          className="block w-full py-3 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl text-center
                     hover:bg-teal-400 transition-colors shadow-[0_0_16px_rgba(20,184,166,0.15)]"
        >
          Go to Dashboard
        </Link>

      </div>
    </main>
  );
}
