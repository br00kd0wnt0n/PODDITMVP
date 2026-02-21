'use client';

import { useState } from 'react';

interface QuestionnaireModalProps {
  milestone: number;
  onComplete: () => void;
}

export default function QuestionnaireModal({ milestone, onComplete }: QuestionnaireModalProps) {
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [qResponses, setQResponses] = useState<Record<string, string | string[]>>({
    describe: '',
    useful: '',
    changed: '',
    likelihood: '',
    friction: '',
    frictionOther: '',
    essential: '',
    listenWhen: [],
  });

  const submit = async () => {
    setSubmitting(true);
    try {
      const res = await fetch('/api/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: {
            ...qResponses,
            friction: qResponses.friction === 'Something else' && qResponses.frictionOther
              ? `Something else: ${qResponses.frictionOther}`
              : qResponses.friction,
          },
          milestone,
        }),
      });
      if (res.ok) {
        setSuccess(true);
        setTimeout(() => onComplete(), 2500);
      }
    } catch { /* silent */ }
    finally { setSubmitting(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" />
      <div className="relative w-full max-w-lg bg-poddit-950 border border-stone-800/60 rounded-2xl shadow-2xl m-auto shrink-0">
        <div className="p-6">

          {/* Success state */}
          {success ? (
            <div className="text-center py-8">
              <div className="w-16 h-16 rounded-full bg-teal-500/15 flex items-center justify-center mx-auto mb-4">
                <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <h2 className="text-xl font-extrabold text-white mb-2">Thank you!</h2>
              <p className="text-sm text-stone-400">3 more episodes unlocked. Keep exploring.</p>
            </div>
          ) : (
            <>
              {/* Header */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-1">
                  <div className="w-2 h-2 rounded-full bg-teal-400" />
                  <p className="text-xs text-stone-500 uppercase tracking-wider font-medium">Early Access Feedback</p>
                </div>
                <h2 className="text-lg font-extrabold text-white">
                  You&apos;ve listened to {milestone} episodes
                </h2>
                <p className="text-xs text-stone-500 mt-1">
                  That&apos;s enough to know how this feels. Answer these and we&apos;ll unlock 3 more.
                </p>
              </div>

              {/* Progress dots */}
              <div className="flex items-center gap-1.5 mb-5">
                {[0, 1, 2, 3].map((s) => (
                  <div
                    key={s}
                    className={`h-1 rounded-full transition-all duration-300 ${
                      s <= step
                        ? 'bg-teal-400 flex-[2]'
                        : 'bg-stone-800 flex-1'
                    }`}
                  />
                ))}
              </div>

              {/* Step 0: Describe + Usefulness */}
              {step === 0 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      How would you describe Poddit to a friend in one sentence?
                    </label>
                    <textarea
                      value={qResponses.describe as string}
                      onChange={(e) => setQResponses(p => ({ ...p, describe: e.target.value }))}
                      placeholder="It's like..."
                      rows={2}
                      autoComplete="off"
                      className="w-full px-3 py-2.5 bg-poddit-900/80 border border-stone-800/50 rounded-xl text-sm text-white
                                 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      How useful were your episodes?
                    </label>
                    <div className="space-y-2">
                      {[
                        'Genuinely useful — I learned something I wouldn\'t have otherwise',
                        'Interesting but not essential',
                        'Not that useful honestly',
                      ].map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setQResponses(p => ({ ...p, useful: opt }))}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                            qResponses.useful === opt
                              ? 'bg-teal-500/10 border border-teal-500/30 text-teal-300'
                              : 'bg-poddit-900/40 border border-stone-800/30 text-stone-400 hover:border-stone-700'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 1: Changed thinking + Likelihood */}
              {step === 1 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      Did any episode change how you think about a topic?
                    </label>
                    <div className="space-y-2">
                      {[
                        'Yes — it connected things I hadn\'t considered',
                        'Somewhat — it added context I was missing',
                        'No — it mostly told me what I already knew',
                      ].map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setQResponses(p => ({ ...p, changed: opt }))}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                            qResponses.changed === opt
                              ? 'bg-teal-500/10 border border-teal-500/30 text-teal-300'
                              : 'bg-poddit-900/40 border border-stone-800/30 text-stone-400 hover:border-stone-700'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      How likely are you to open Poddit tomorrow?
                    </label>
                    <div className="space-y-2">
                      {[
                        'I\'d check it without being reminded',
                        'I\'d open it if I got a notification',
                        'I\'d probably forget about it',
                      ].map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setQResponses(p => ({ ...p, likelihood: opt }))}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                            qResponses.likelihood === opt
                              ? 'bg-teal-500/10 border border-teal-500/30 text-teal-300'
                              : 'bg-poddit-900/40 border border-stone-800/30 text-stone-400 hover:border-stone-700'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Friction */}
              {step === 2 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      What&apos;s the biggest friction point so far?
                    </label>
                    <div className="space-y-2">
                      {[
                        'Remembering to capture signals throughout the day',
                        'Not knowing what to send it',
                        'Episodes took too long to generate',
                        'Episode quality wasn\'t what I expected',
                        'The app itself was confusing',
                        'Something else',
                      ].map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setQResponses(p => ({ ...p, friction: opt }))}
                          className={`w-full text-left px-3 py-2.5 rounded-xl text-sm transition-all ${
                            qResponses.friction === opt
                              ? 'bg-teal-500/10 border border-teal-500/30 text-teal-300'
                              : 'bg-poddit-900/40 border border-stone-800/30 text-stone-400 hover:border-stone-700'
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                    {qResponses.friction === 'Something else' && (
                      <input
                        type="text"
                        value={qResponses.frictionOther as string}
                        onChange={(e) => setQResponses(p => ({ ...p, frictionOther: e.target.value }))}
                        placeholder="Please specify..."
                        autoComplete="off"
                        className="w-full mt-2 px-3 py-2.5 bg-poddit-900/80 border border-stone-800/50 rounded-xl text-sm text-white
                                   placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30"
                      />
                    )}
                  </div>
                </div>
              )}

              {/* Step 3: Essential + Listen when */}
              {step === 3 && (
                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      What would make Poddit something you can&apos;t live without?
                    </label>
                    <textarea
                      value={qResponses.essential as string}
                      onChange={(e) => setQResponses(p => ({ ...p, essential: e.target.value }))}
                      placeholder="If Poddit could..."
                      rows={2}
                      autoComplete="off"
                      className="w-full px-3 py-2.5 bg-poddit-900/80 border border-stone-800/50 rounded-xl text-sm text-white
                                 placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-teal-400/30 resize-none"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-stone-300 mb-2">
                      When did you listen? <span className="text-stone-600 font-normal">(select all that apply)</span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {[
                        'Commuting',
                        'Working out / walking',
                        'Morning routine',
                        'At my desk',
                        'Before bed',
                        'Haven\'t listened — just read the companion',
                      ].map((opt) => {
                        const selected = (qResponses.listenWhen as string[]).includes(opt);
                        return (
                          <button
                            key={opt}
                            onClick={() => setQResponses(p => ({
                              ...p,
                              listenWhen: selected
                                ? (p.listenWhen as string[]).filter(v => v !== opt)
                                : [...(p.listenWhen as string[]), opt],
                            }))}
                            className={`px-3 py-1.5 rounded-lg text-xs transition-all ${
                              selected
                                ? 'bg-teal-500/15 border border-teal-500/30 text-teal-300'
                                : 'bg-poddit-900/40 border border-stone-800/30 text-stone-400 hover:border-stone-700'
                            }`}
                          >
                            {opt}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Navigation */}
              <div className="flex items-center gap-3 mt-6">
                {step > 0 && (
                  <button
                    onClick={() => setStep(s => s - 1)}
                    className="px-4 py-2.5 text-sm text-stone-400 hover:text-stone-300 transition-colors"
                  >
                    Back
                  </button>
                )}
                <div className="flex-1" />
                {step < 3 ? (
                  <button
                    onClick={() => setStep(s => s + 1)}
                    disabled={
                      (step === 0 && (!qResponses.describe || !qResponses.useful)) ||
                      (step === 1 && (!qResponses.changed || !qResponses.likelihood)) ||
                      (step === 2 && !qResponses.friction)
                    }
                    className="px-6 py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                               hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500
                               disabled:cursor-not-allowed transition-all"
                  >
                    Next
                  </button>
                ) : (
                  <button
                    onClick={submit}
                    disabled={submitting || !qResponses.essential}
                    className="px-6 py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                               hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500
                               disabled:cursor-not-allowed transition-all flex items-center gap-2"
                  >
                    {submitting ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Submitting...
                      </>
                    ) : (
                      'Unlock 3 more episodes'
                    )}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
