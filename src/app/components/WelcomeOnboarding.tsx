'use client';

import { useState, useEffect, useCallback } from 'react';
import { normalizePhone } from '@/lib/phone';
import { useVoicePreview } from '@/hooks/useVoicePreview';

interface Voice {
  key: string;
  name: string;
  description: string;
  isDefault: boolean;
}

interface WelcomeOnboardingProps {
  onComplete: () => void;
  userPhone: string;
  onPhoneSaved: (phone: string) => void;
}

const BRIEFING_STYLES = [
  { key: 'essential', label: 'Essential', duration: '3-5 min', description: 'Quick executive briefing' },
  { key: 'standard', label: 'Standard', duration: '7-10 min', description: 'The full Poddit experience' },
  { key: 'strategic', label: 'Strategic', duration: '10-15 min', description: 'In-depth analysis' },
];

const SWIPE_THRESHOLD = 50;

export default function WelcomeOnboarding({ onComplete, userPhone, onPhoneSaved }: WelcomeOnboardingProps) {
  // Card navigation
  const [currentCard, setCurrentCard] = useState(0);
  const [isClosing, setIsClosing] = useState(false);

  // Swipe mechanics
  const [touchStartX, setTouchStartX] = useState(0);
  const [touchStartY, setTouchStartY] = useState(0);
  const [touchDeltaX, setTouchDeltaX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [swipeDecided, setSwipeDecided] = useState(false);
  const [inputFocused, setInputFocused] = useState(false);

  // Card 3: Settings state
  const [voices, setVoices] = useState<Voice[]>([]);
  const [selectedVoice, setSelectedVoice] = useState('jon');
  const [selectedStyle, setSelectedStyle] = useState('standard');
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSaved, setPhoneSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  // Voice preview (shared hook)
  const { playingVoice, loadingVoice, voiceProgress, playPreview: _playPreview, stopPreview } = useVoicePreview();

  // Fetch voices + current preferences on mount
  useEffect(() => {
    Promise.all([
      fetch('/api/voices').then(r => r.json()).catch(() => ({ voices: [] })),
      fetch('/api/user/preferences').then(r => r.json()).catch(() => ({ preferences: {} })),
    ]).then(([voiceData, prefsData]) => {
      setVoices(voiceData.voices || []);
      const p = prefsData.preferences || {};
      if (p.voice) setSelectedVoice(p.voice);
      if (p.briefingStyle) setSelectedStyle(p.briefingStyle);
    });
  }, []);

  // Pre-existing phone
  useEffect(() => {
    if (userPhone) setPhoneSaved(true);
  }, [userPhone]);

  // Wrap playPreview to also select the voice
  const playPreview = useCallback((voiceKey: string) => {
    setSelectedVoice(voiceKey);
    _playPreview(voiceKey);
  }, [_playPreview]);

  // ── Phone save ──
  const savePhone = async () => {
    setPhoneError(null);
    const result = normalizePhone(phoneInput);
    if ('error' in result) {
      setPhoneError(result.error);
      return;
    }
    const formatted = result.formatted;
    setPhoneSaving(true);
    try {
      const res = await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formatted }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save');
      }
      setPhoneSaved(true);
      setPhoneInput('');
      onPhoneSaved(formatted);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to save phone';
      setPhoneError(message);
    } finally {
      setPhoneSaving(false);
    }
  };

  // ── Save preferences + complete ──
  const handleComplete = async () => {
    stopPreview();
    setSaving(true);
    try {
      await fetch('/api/user/preferences', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferences: {
            voice: selectedVoice,
            briefingStyle: selectedStyle,
          },
        }),
      });
    } catch {
      // Settings can be changed later — don't block dismissal
    }
    setSaving(false);
    handleClose();
  };

  const handleClose = () => {
    stopPreview();
    setIsClosing(true);
    setTimeout(() => onComplete(), 250);
  };

  const handleSkip = () => {
    stopPreview();
    handleClose();
  };

  // ── Navigation ──
  const goNext = () => {
    if (currentCard < 2) setCurrentCard(prev => prev + 1);
  };
  const goBack = () => {
    if (currentCard > 0) setCurrentCard(prev => prev - 1);
  };

  // ── Swipe handlers ──
  const handleTouchStart = (e: React.TouchEvent) => {
    if (inputFocused) return;
    setTouchStartX(e.touches[0].clientX);
    setTouchStartY(e.touches[0].clientY);
    setIsSwiping(true);
    setSwipeDecided(false);
    setTouchDeltaX(0);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (!isSwiping || inputFocused) return;
    const deltaX = e.touches[0].clientX - touchStartX;
    const deltaY = e.touches[0].clientY - touchStartY;

    // First significant movement decides: horizontal swipe or vertical scroll
    if (!swipeDecided && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      if (Math.abs(deltaY) > Math.abs(deltaX) * 1.2) {
        // Vertical scroll — release
        setIsSwiping(false);
        return;
      }
      setSwipeDecided(true);
    }

    if (!swipeDecided) return;

    // Rubber band at edges
    if ((currentCard === 0 && deltaX > 0) || (currentCard === 2 && deltaX < 0)) {
      setTouchDeltaX(deltaX * 0.3);
    } else {
      setTouchDeltaX(deltaX);
    }
  };

  const handleTouchEnd = () => {
    if (!isSwiping) return;
    setIsSwiping(false);
    if (Math.abs(touchDeltaX) > SWIPE_THRESHOLD) {
      if (touchDeltaX < 0 && currentCard < 2) setCurrentCard(prev => prev + 1);
      else if (touchDeltaX > 0 && currentCard > 0) setCurrentCard(prev => prev - 1);
    }
    setTouchDeltaX(0);
  };

  // ── Render ──
  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center ${isClosing ? 'overlay-fade-out' : 'overlay-enter'}`}>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/85 backdrop-blur-md" onClick={handleSkip} />

      {/* Modal */}
      <div className={`relative w-full max-w-md mx-4 bg-poddit-950 border border-stone-800/60 rounded-2xl shadow-2xl overflow-hidden ${isClosing ? 'modal-exit' : 'modal-enter'}`}
           style={{ maxHeight: '85vh' }}>

        {/* Inner bokeh — desktop only */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden hidden sm:block">
          <div className="absolute top-[-10%] left-[-10%] w-48 h-48 rounded-full bg-teal-500/10 blur-3xl" />
          <div className="absolute bottom-[-10%] right-[-5%] w-40 h-40 rounded-full bg-violet-400/[0.08] blur-3xl" />
        </div>

        {/* Progress bars */}
        <div className="relative z-10 flex items-center gap-1.5 px-6 pt-5 pb-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              onClick={() => setCurrentCard(i)}
              className={`h-1 rounded-full cursor-pointer transition-all duration-300 ${
                i <= currentCard ? 'bg-teal-400' : 'bg-stone-800'
              } ${i === currentCard ? 'flex-[2]' : 'flex-1'}`}
            />
          ))}
        </div>

        {/* Swipeable card viewport */}
        <div
          className="relative z-10 overflow-hidden"
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <div
            className="flex"
            style={{
              transform: `translateX(calc(-${currentCard * 100}% + ${isSwiping && swipeDecided ? touchDeltaX : 0}px))`,
              transition: isSwiping && swipeDecided ? 'none' : 'transform 300ms cubic-bezier(0.16, 1, 0.3, 1)',
            }}
          >
            {/* ══ Card 1: How Poddit Works ══ */}
            <div className="w-full flex-shrink-0 px-6 py-4">
              <h2 className="text-xl font-bold text-white mb-1.5">How Poddit Works</h2>
              <p className="text-sm text-stone-400 mb-5 leading-relaxed">Poddit turns the links, ideas, and topics you save into a personalized audio briefing &mdash; a podcast made just for you.</p>

              <div className="space-y-0">
                {/* Step 1: Capture */}
                <div className="flex items-start gap-3.5">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-teal-500/15 flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" y1="19" x2="12" y2="22" />
                      </svg>
                    </div>
                    <div className="w-px h-5 bg-stone-800 my-1" />
                  </div>
                  <div className="pt-1.5">
                    <p className="text-sm font-semibold text-teal-300">Capture signals</p>
                    <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Save links, topics, and voice notes throughout your week</p>
                  </div>
                </div>

                {/* Step 2: Signals collect */}
                <div className="flex items-start gap-3.5">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-violet-400/15 flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
                        <polygon points="12 2 2 7 12 12 22 7 12 2" />
                        <polyline points="2 17 12 22 22 17" />
                        <polyline points="2 12 12 17 22 12" />
                      </svg>
                    </div>
                    <div className="w-px h-5 bg-stone-800 my-1" />
                  </div>
                  <div className="pt-1.5">
                    <p className="text-sm font-semibold text-violet-300">Signals collect</p>
                    <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Your queue builds up as you capture things that interest you</p>
                  </div>
                </div>

                {/* Step 3: Generate anytime */}
                <div className="flex items-start gap-3.5">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
                      </svg>
                    </div>
                    <div className="w-px h-5 bg-stone-800 my-1" />
                  </div>
                  <div className="pt-1.5">
                    <p className="text-sm font-semibold text-amber-300">Generate anytime</p>
                    <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">Hit Generate whenever you&apos;re ready, or get an automatic episode every Friday</p>
                  </div>
                </div>

                {/* Step 4: Listen */}
                <div className="flex items-start gap-3.5">
                  <div className="flex flex-col items-center">
                    <div className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-white">
                        <path d="M3 18v-6a9 9 0 0 1 18 0v6" />
                        <path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z" />
                        <path d="M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z" />
                      </svg>
                    </div>
                  </div>
                  <div className="pt-1.5">
                    <p className="text-sm font-semibold text-white">Listen</p>
                    <p className="text-xs text-stone-500 mt-0.5 leading-relaxed">A personal podcast that synthesizes everything you saved</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ══ Card 2: Add to Your Queue ══ */}
            <div className="w-full flex-shrink-0 px-6 py-4">
              <h2 className="text-xl font-bold text-white mb-1.5">How to Add to Your Queue</h2>
              <p className="text-sm text-stone-400 mb-4 leading-relaxed">There are lots of ways to send signals to Poddit. Use whichever fits your flow &mdash; they all end up in your personal queue.</p>

              <div className="space-y-3.5">
                {/* Type or paste */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-teal-400">
                      <path d="M12 20h9" />
                      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Type or paste</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Links, topics, or questions on the dashboard</p>
                  </div>
                </div>

                {/* Voice note */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400">
                      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                      <line x1="12" y1="19" x2="12" y2="22" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Voice note</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Tap the mic and speak what&apos;s on your mind</p>
                  </div>
                </div>

                {/* Text message */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-teal-400">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Text message</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Send links or voice memos to <span className="text-teal-400/80 font-mono">(855) 506-5970</span></p>
                  </div>
                </div>

                {/* Forward email */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-amber-400">
                      <rect width="20" height="16" x="2" y="4" rx="2" />
                      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Forward an email</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Send newsletters to <span className="text-teal-400/80 font-mono">capture@poddit.com</span></p>
                  </div>
                </div>

                {/* Chrome extension */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-teal-400">
                      <circle cx="12" cy="12" r="10" />
                      <circle cx="12" cy="12" r="4" />
                      <line x1="21.17" y1="8" x2="12" y2="8" />
                      <line x1="3.95" y1="6.06" x2="8.54" y2="14" />
                      <line x1="10.88" y1="21.94" x2="15.46" y2="14" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Chrome extension</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Save any page with one click from your browser</p>
                  </div>
                </div>

                {/* Share from any app */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg bg-violet-400/10 flex items-center justify-center flex-shrink-0">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-violet-400">
                      <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
                      <polyline points="16 6 12 2 8 6" />
                      <line x1="12" y1="2" x2="12" y2="15" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Share from any app</p>
                    <p className="text-[11px] text-stone-500 mt-0.5">Use your phone&apos;s share sheet (add Poddit to home screen)</p>
                  </div>
                </div>
              </div>
            </div>

            {/* ══ Card 3: Make It Yours ══ */}
            <div className="w-full flex-shrink-0 px-6 py-4 overflow-y-auto" style={{ maxHeight: '65vh' }}>
              <h2 className="text-xl font-bold text-white mb-1.5">Make It Yours</h2>
              <p className="text-sm text-stone-400 mb-4 leading-relaxed">Set up the basics to get the most out of Poddit. You can always change these later in Settings.</p>

              <div className="space-y-5">
                {/* Phone number */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                    <p className="text-xs font-semibold text-stone-300 uppercase tracking-wider">Phone number</p>
                  </div>
                  <p className="text-[11px] text-stone-500 mb-2.5 leading-relaxed">For SMS capture and episode notifications</p>

                  {phoneSaved ? (
                    <div className="flex items-center gap-2 text-xs text-teal-400">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                      Phone saved
                    </div>
                  ) : (
                    <>
                      <div className="flex gap-2">
                        <input
                          type="tel"
                          value={phoneInput}
                          onChange={(e) => { setPhoneInput(e.target.value); setPhoneError(null); }}
                          onFocus={() => setInputFocused(true)}
                          onBlur={() => setInputFocused(false)}
                          placeholder="(555) 123-4567"
                          autoComplete="off"
                          className={`flex-1 px-3 py-2 bg-white/[0.07] border rounded-lg text-sm text-white placeholder:text-stone-600 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-all ${phoneError ? 'border-red-500/40' : 'border-white/15'}`}
                        />
                        <button
                          onClick={savePhone}
                          disabled={phoneSaving || !phoneInput.trim()}
                          className="px-4 py-2 bg-teal-500 text-poddit-950 text-xs font-bold rounded-lg hover:bg-teal-400 disabled:bg-stone-800 disabled:text-stone-600 disabled:cursor-not-allowed transition-all"
                        >
                          {phoneSaving ? '...' : 'Save'}
                        </button>
                      </div>
                      {phoneError && <p className="text-[11px] text-red-400 mt-1.5">{phoneError}</p>}
                    </>
                  )}
                </div>

                {/* Voice selection */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
                      <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
                      <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
                      <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
                    </svg>
                    <p className="text-xs font-semibold text-stone-300 uppercase tracking-wider">Choose your narrator</p>
                  </div>
                  <p className="text-[11px] text-stone-500 mb-2.5">Tap to preview</p>

                  {voices.length > 0 ? (
                    <div className="grid grid-cols-2 gap-2">
                      {voices.map((v) => {
                        const isSelected = selectedVoice === v.key;
                        const isPlaying = playingVoice === v.key;
                        const isLoading = loadingVoice === v.key;
                        return (
                          <button
                            key={v.key}
                            onClick={() => playPreview(v.key)}
                            disabled={isLoading}
                            className={`relative p-2.5 rounded-xl border text-left transition-all overflow-hidden ${
                              isSelected
                                ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_12px_rgba(20,184,166,0.15)]'
                                : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15]'
                            } ${isLoading ? 'cursor-wait' : ''}`}
                          >
                            {isPlaying && (
                              <div className="absolute inset-0 bg-teal-500/15 transition-[width] duration-100 ease-linear" style={{ width: `${voiceProgress}%` }} />
                            )}
                            {isLoading && <div className="absolute inset-0 animate-pulse bg-teal-500/10" />}
                            <div className="relative z-10 flex items-start justify-between">
                              <div>
                                <p className={`text-xs font-semibold ${isSelected ? 'text-teal-300' : 'text-white'}`}>{v.name}</p>
                                <p className="text-[10px] text-stone-600 mt-0.5">{v.description}</p>
                              </div>
                              <div className="flex-shrink-0 ml-1.5 mt-0.5">
                                {isLoading ? (
                                  <svg className="animate-spin h-3 w-3 text-teal-400" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                ) : isPlaying ? (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className="text-teal-400">
                                    <rect x="6" y="4" width="4" height="16" rx="1" />
                                    <rect x="14" y="4" width="4" height="16" rx="1" />
                                  </svg>
                                ) : (
                                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" className={isSelected ? 'text-teal-400/60' : 'text-stone-700'}>
                                    <path d="M8 5.14v14l11-7-11-7z" />
                                  </svg>
                                )}
                              </div>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-stone-600 italic">Choose your voice in Settings later</p>
                  )}
                </div>

                {/* Briefing style */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400">
                      <line x1="4" y1="21" x2="4" y2="14" />
                      <line x1="4" y1="10" x2="4" y2="3" />
                      <line x1="12" y1="21" x2="12" y2="12" />
                      <line x1="12" y1="8" x2="12" y2="3" />
                      <line x1="20" y1="21" x2="20" y2="16" />
                      <line x1="20" y1="12" x2="20" y2="3" />
                      <line x1="1" y1="14" x2="7" y2="14" />
                      <line x1="9" y1="8" x2="15" y2="8" />
                      <line x1="17" y1="16" x2="23" y2="16" />
                    </svg>
                    <p className="text-xs font-semibold text-stone-300 uppercase tracking-wider">Episode style</p>
                  </div>

                  <div className="space-y-1.5">
                    {BRIEFING_STYLES.map((style) => {
                      const isSelected = selectedStyle === style.key;
                      return (
                        <button
                          key={style.key}
                          onClick={() => setSelectedStyle(style.key)}
                          className={`w-full p-2.5 rounded-xl border text-left transition-all ${
                            isSelected
                              ? 'border-teal-500/50 bg-teal-500/5 shadow-[0_0_12px_rgba(20,184,166,0.15)]'
                              : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.15]'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <p className={`text-xs font-semibold ${isSelected ? 'text-teal-300' : 'text-white'}`}>{style.label}</p>
                            <span className={`text-[10px] font-mono ${isSelected ? 'text-teal-400/70' : 'text-stone-600'}`}>{style.duration}</span>
                          </div>
                          <p className="text-[10px] text-stone-500 mt-0.5">{style.description}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation footer */}
        <div className="relative z-10 flex items-center gap-3 px-6 pb-5 pt-3">
          {currentCard > 0 ? (
            <button
              onClick={goBack}
              className="text-sm text-stone-500 hover:text-stone-300 transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}
          <div className="flex-1" />
          <button
            onClick={handleSkip}
            className="text-sm text-stone-600 hover:text-stone-400 transition-colors"
          >
            Skip
          </button>
          {currentCard < 2 ? (
            <button
              onClick={goNext}
              className="px-6 py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl hover:bg-teal-400 transition-colors"
            >
              Next
            </button>
          ) : (
            <button
              onClick={handleComplete}
              disabled={saving}
              className="px-6 py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl hover:bg-teal-400 disabled:bg-stone-700 disabled:text-stone-500 transition-colors"
            >
              {saving ? 'Saving...' : 'Get Started'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
