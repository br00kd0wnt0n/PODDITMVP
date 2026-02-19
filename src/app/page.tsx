'use client';

import React, { Suspense, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';
import { patchDomForAutofillSafety } from '@/lib/dom-safety';
import HighlightsPanel from '@/app/components/HighlightsPanel';
import EpisodeList from '@/app/components/EpisodeList';
import CaptureInput from '@/app/components/CaptureInput';

const STATUS_PHRASES = [
  'Connecting the dots...',
  'Weaving your story...',
  'Synthesizing insights...',
  'Building your episode...',
  'Researching your signals...',
  'Finding the threads...',
  'Crafting your narrative...',
  'Almost there...',
];

interface Episode {
  id: string;
  title: string;
  summary: string | null;
  audioUrl: string | null;
  audioDuration: number | null;
  signalCount: number;
  topicsCovered: string[];
  generatedAt: string;
  status?: string;
  rated?: boolean;
  channels?: string[];
  signalTopics?: string[];
}

interface Signal {
  id: string;
  inputType: string;
  channel: string;
  rawContent: string;
  url: string | null;
  title: string | null;
  source: string | null;
  topics: string[];
  status: string;
  createdAt: string;
}

const HERO_TAGLINES = [
  "Let\u2019s connect the dots behind your curiosity.",
  'Turn scattered curiosity into clear understanding.',
  'The throughline across everything on your mind.',
  'From signals to synthesis \u2014 your weekly deep dive.',
];

// Twilio inbound numbers per region
const PODDIT_SMS_US = { e164: '+18555065970', display: '(855) 506-5970' };
const PODDIT_SMS_UK = { e164: '+447426985763', display: '+44 7426 985763' };

function Dashboard() {
  const searchParams = useSearchParams();
  const shared = searchParams.get('shared');
  const { data: session, status } = useSession();
  const router = useRouter();
  const heroTagline = useMemo(() => HERO_TAGLINES[Math.floor(Math.random() * HERO_TAGLINES.length)], []);
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Patch DOM methods to prevent Chrome autofill from crashing React reconciler.
  // Must run before any React reconciliation that touches form elements.
  useEffect(() => { patchDomForAutofillSafety(); }, []);

  // Client-side auth guard — redirect if no session
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin');
    }
  }, [status, router]);

  // Data state
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [highlightTopics, setHighlightTopics] = useState<string[]>([]);
  const [highlightChannels, setHighlightChannels] = useState<string[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [episodeLimit, setEpisodeLimit] = useState(3);
  const [userPhone, setUserPhone] = useState<string>('');
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [phoneSuccess, setPhoneSuccess] = useState<string | null>(null);
  const [showCollectSignals, setShowCollectSignals] = useState(false);

  // Derive which Poddit SMS number to show based on user's phone country
  const podditSms = useMemo(() => {
    if (userPhone.startsWith('+44')) return PODDIT_SMS_UK;
    if (userPhone) return PODDIT_SMS_US;
    // No phone saved yet — check browser locale
    if (typeof navigator !== 'undefined') {
      const lang = navigator.language || '';
      if (lang.endsWith('-GB') || lang === 'en-GB') return PODDIT_SMS_UK;
    }
    return PODDIT_SMS_US;
  }, [userPhone]);

  // insightsExpanded state removed — Highlights always visible
  const [userName, setUserName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const generatingRef = useRef(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Generation theatre state
  const [statusPhrase, setStatusPhrase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [signalsCollapsing, setSignalsCollapsing] = useState(false);
  const [newEpisodeId, setNewEpisodeId] = useState<string | null>(null);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Welcome banner (first-load only, persisted in localStorage)
  const [showWelcomeBanner, setShowWelcomeBanner] = useState(false);

  // Setup card (first-load, persisted in localStorage)
  const [showSetupCard, setShowSetupCard] = useState(false);
  const [setupPhoneSaved, setSetupPhoneSaved] = useState(false);

  // Feedback panel (opened from account dropdown)
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && !loading) {
      try {
        const seen = localStorage.getItem('poddit-welcome-seen');
        if (!seen) setShowWelcomeBanner(true);
        const setupDone = localStorage.getItem('poddit-setup-dismissed');
        if (!setupDone) setShowSetupCard(true);
      } catch {
        // localStorage unavailable (private browsing) — show defaults
        setShowWelcomeBanner(true);
        setShowSetupCard(true);
      }
    }
  }, [status, loading]);

  const dismissWelcomeBanner = () => {
    setShowWelcomeBanner(false);
    try { localStorage.setItem('poddit-welcome-seen', '1'); } catch {}
  };

  const dismissSetupCard = () => {
    setShowSetupCard(false);
    try { localStorage.setItem('poddit-setup-dismissed', '1'); } catch {}
  };

  // Save phone from setup card (no SMS redirect)
  const savePhoneSetup = async () => {
    setPhoneError(null);
    let formatted = phoneInput.trim().replace(/[\s\-\(\)\.]/g, '');
    // Auto-prepend +1 for bare 10-digit US numbers
    if (/^\d{10}$/.test(formatted)) formatted = `+1${formatted}`;
    if (/^1\d{10}$/.test(formatted)) formatted = `+${formatted}`;
    // Auto-prepend +44 for UK numbers starting with 0 (e.g. 07911123456)
    if (/^0\d{10}$/.test(formatted)) formatted = `+44${formatted.slice(1)}`;
    if (/^44\d{10}$/.test(formatted)) formatted = `+${formatted}`;
    if (!/^\+[1-9]\d{1,14}$/.test(formatted)) {
      setPhoneError('Include your country code (e.g. +1 for US, +44 for UK)');
      return;
    }
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
      setUserPhone(formatted);
      setPhoneInput('');
      setSetupPhoneSaved(true);
    } catch (err: any) {
      setPhoneError(err.message || 'Failed to save phone');
    } finally {
      setPhoneSaving(false);
    }
  };

  // Save phone number (flexible input — auto-prepends +1 for US, +44 for UK)
  const savePhone = async () => {
    setPhoneError(null);
    let formatted = phoneInput.trim().replace(/[\s\-\(\)\.]/g, '');
    // Auto-prepend +1 for bare 10-digit US numbers
    if (/^\d{10}$/.test(formatted)) formatted = `+1${formatted}`;
    // Accept 1XXXXXXXXXX → +1XXXXXXXXXX
    if (/^1\d{10}$/.test(formatted)) formatted = `+${formatted}`;
    // Auto-prepend +44 for UK numbers starting with 0 (e.g. 07911123456)
    if (/^0\d{10}$/.test(formatted)) formatted = `+44${formatted.slice(1)}`;
    if (/^44\d{10}$/.test(formatted)) formatted = `+${formatted}`;
    // Must be E.164 at this point
    if (!/^\+[1-9]\d{1,14}$/.test(formatted)) {
      setPhoneError('Include your country code (e.g. +1 for US, +44 for UK)');
      return;
    }
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
      setUserPhone(formatted);
      setShowPhonePrompt(false);
      setPhoneInput('');
      // Now open SMS — pick the right number for the user's country
      const smsNum = formatted.startsWith('+44') ? PODDIT_SMS_UK : PODDIT_SMS_US;
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        window.location.href = `sms:${smsNum.e164}`;
      } else {
        navigator.clipboard.writeText(smsNum.e164).then(() => {
          setPhoneSuccess('Phone saved! Number copied — text your signals.');
          setTimeout(() => setPhoneSuccess(null), 3000);
        }).catch(() => {
          setPhoneSuccess('Phone saved! Text your signals to ' + smsNum.display);
          setTimeout(() => setPhoneSuccess(null), 3000);
        });
      }
    } catch (err: any) {
      setPhoneError(err.message || 'Failed to save phone');
    } finally {
      setPhoneSaving(false);
    }
  };

  // Feedback state
  const [feedbackText, setFeedbackText] = useState('');
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [feedbackRecording, setFeedbackRecording] = useState(false);
  const [feedbackRecordingTime, setFeedbackRecordingTime] = useState(0);
  const [feedbackProcessing, setFeedbackProcessing] = useState(false);
  const [feedbackSuccess, setFeedbackSuccess] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  // Feedback recording refs (separate from signal recording)
  const fbMediaRecorderRef = useRef<MediaRecorder | null>(null);
  const fbChunksRef = useRef<Blob[]>([]);
  const fbTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Questionnaire state
  const [showQuestionnaire, setShowQuestionnaire] = useState(false);
  const [questionnaireMilestone, setQuestionnaireMilestone] = useState(0);
  const [questionnaireStep, setQuestionnaireStep] = useState(0);
  const [questionnaireSubmitting, setQuestionnaireSubmitting] = useState(false);
  const [questionnaireSuccess, setQuestionnaireSuccess] = useState(false);
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

  // ── Empty state derived values (used by effects below) ──
  const readyEpisodes = episodes.filter(ep => ep.status === 'READY');
  const isEmptyState = signals.length === 0 && !loading;
  const hasSignalsNoEpisode = signals.length > 0 && readyEpisodes.length === 0;
  const hasEpisodeReady = readyEpisodes.length > 0;
  const activeStep = hasEpisodeReady ? 3 : hasSignalsNoEpisode ? 2 : 1;
  const atEpisodeLimit = episodeLimit > 0 && readyEpisodes.length >= episodeLimit;

  // ── Branded hero computed values ──
  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const getHeroSubtitle = (): React.ReactNode => {
    if (atEpisodeLimit) {
      return `You've generated ${readyEpisodes.length} episode${readyEpisodes.length !== 1 ? 's' : ''} so far. Complete the questionnaire to unlock more.`;
    }
    const isGenerating = episodes.some(ep => ep.status === 'GENERATING' || ep.status === 'SYNTHESIZING');
    if (isGenerating) {
      return 'Your episode is being created — hang tight.';
    }
    const latestEpisode = readyEpisodes.length > 0 ? readyEpisodes[0] : null;
    if (latestEpisode && signals.length > 0) {
      return <>Your latest episode <strong className="italic">&ldquo;{latestEpisode.title}&rdquo;</strong> is ready. {signals.length} new signal{signals.length !== 1 ? 's' : ''} waiting.</>;
    }
    if (latestEpisode) {
      return <>Your latest episode <strong className="italic">&ldquo;{latestEpisode.title}&rdquo;</strong> is ready to play.</>;
    }
    if (signals.length >= 5) {
      return `${signals.length} signals queued up \u2014 you've got a great episode brewing.`;
    }
    if (signals.length > 0) {
      return `You have ${signals.length} signal${signals.length !== 1 ? 's' : ''} in your queue \u2014 perfect for your next episode.`;
    }
    return 'Capture a link, topic, or voice note to get started.';
  };

  // ── Insights: topic frequency + channel breakdown ──
  // Uses highlightTopics/highlightChannels (aggregated server-side from ALL used signals)
  // plus current pending signals for a complete picture
  const topicFrequency = useMemo(() => {
    const counts: Record<string, number> = {};
    const displayName: Record<string, string> = {};
    const normalize = (t: string) => t.trim().toLowerCase();

    const addTopic = (t: string) => {
      const key = normalize(t);
      if (!displayName[key]) displayName[key] = t;
      counts[key] = (counts[key] || 0) + 1;
    };

    // Pending signals — current curiosity
    signals.forEach(s => s.topics.forEach(addTopic));
    // Used signals (from server aggregation) — historical curiosity
    highlightTopics.forEach(addTopic);

    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([key, count]) => [displayName[key], count] as [string, number]);
  }, [signals, highlightTopics]);

  const channelBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    signals.forEach(s => { counts[s.channel] = (counts[s.channel] || 0) + 1; });
    highlightChannels.forEach(ch => { counts[ch] = (counts[ch] || 0) + 1; });
    return Object.entries(counts).sort(([, a], [, b]) => b - a);
  }, [signals, highlightChannels]);

  // ── Episode accent colors (violet/amber/rose — teal reserved for action buttons) ──

  // Check if questionnaire is needed when at episode limit
  useEffect(() => {
    if (!atEpisodeLimit || showQuestionnaire || questionnaireSuccess) return;
    const checkQuestionnaire = async () => {
      try {
        const res = await fetch('/api/questionnaire');
        if (res.ok) {
          const data = await res.json();
          if (data.required) {
            setQuestionnaireMilestone(data.milestone);
            setShowQuestionnaire(true);
          }
        }
      } catch { /* silent */ }
    };
    checkQuestionnaire();
  }, [atEpisodeLimit, showQuestionnaire, questionnaireSuccess]);

  const submitQuestionnaire = async () => {
    setQuestionnaireSubmitting(true);
    try {
      const res = await fetch('/api/questionnaire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          responses: {
            ...qResponses,
            // Merge frictionOther into friction if "Something else" was selected
            friction: qResponses.friction === 'Something else' && qResponses.frictionOther
              ? `Something else: ${qResponses.frictionOther}`
              : qResponses.friction,
          },
          milestone: questionnaireMilestone,
        }),
      });
      if (res.ok) {
        setQuestionnaireSuccess(true);
        // After brief celebration, close and refresh
        setTimeout(async () => {
          setShowQuestionnaire(false);
          setQuestionnaireSuccess(false);
          setQuestionnaireStep(0);
          await refreshData();
        }, 2500);
      }
    } catch { /* silent */ }
    finally { setQuestionnaireSubmitting(false); }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (fbTimerRef.current) clearInterval(fbTimerRef.current);
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (fbMediaRecorderRef.current?.state === 'recording') {
        fbMediaRecorderRef.current.stop();
      }
    };
  }, []);

  // AbortController ref — cancels in-flight fetches when a new poll fires or on unmount
  const abortRef = useRef<AbortController | null>(null);

  // Load data + poll every 30s for new signals (SMS, extension, etc.)
  // Waits for authenticated session before fetching to prevent 401 race conditions.
  // Pauses polling when the tab is hidden (saves API calls + battery)
  useEffect(() => {
    if (status !== 'authenticated') return;

    refreshData();
    let poll = setInterval(refreshData, 30_000);

    const handleVisibility = () => {
      if (document.hidden) {
        clearInterval(poll);
        // Abort any in-flight fetch when tab goes hidden
        abortRef.current?.abort();
      } else {
        refreshData();
        poll = setInterval(refreshData, 30_000);
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(poll);
      abortRef.current?.abort();
      if (generatePollRef.current) clearInterval(generatePollRef.current);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [status]);

  // Auto-open capture channels panel when queue is empty (guide new users)
  useEffect(() => {
    if (!loading && signals.length === 0) {
      setShowCollectSignals(true);
    }
  }, [loading, signals.length]);

  const refreshData = async () => {
    // Skip during generation — the 5s generation poll handles episode updates
    if (generatingRef.current) return;
    // Cancel any in-flight request from a previous poll cycle
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const results = await Promise.allSettled([
        fetch('/api/episodes', { signal: controller.signal }).then(r => r.json()),
        fetch('/api/signals?status=queued,enriched,pending&limit=20', { signal: controller.signal }).then(r => r.json()),
        fetch('/api/user/preferences', { signal: controller.signal }).then(r => r.json()),
      ]);

      // If this request was aborted, don't update state with stale data
      if (controller.signal.aborted) return;

      // Handle episodes — independent of signals
      // Each handler wrapped in try/catch so a malformed response during deploy can't crash the app
      if (results[0].status === 'fulfilled') {
        try {
          const data = results[0].value;
          // New shape: { episodes: [...], highlights: { topics, channels } }
          if (data && data.episodes && Array.isArray(data.episodes)) {
            setEpisodes(data.episodes);
            setHighlightTopics(data.highlights?.topics || []);
            setHighlightChannels(data.highlights?.channels || []);
          } else if (Array.isArray(data)) {
            // Backward compat
            setEpisodes(data);
          }
        } catch (e) {
          console.error('[Dashboard] Failed to parse episodes:', e);
        }
      }

      // Handle signals — independent of episodes
      if (results[1].status === 'fulfilled') {
        try {
          const sigs = results[1].value;
          const signalList = sigs.signals || [];
          setSignals(signalList);
          // Only reset selections on initial load — subsequent polls just add new signals
          setSelectedIds(prev => {
            if (prev.size === 0 && signalList.length > 0) {
              // Initial load: select all
              return new Set(signalList.map((s: Signal) => s.id));
            }
            // Subsequent polls: keep existing selections, auto-select new signals
            const updated = new Set<string>(prev);
            const currentIds = new Set<string>(signalList.map((s: Signal) => s.id));
            // Add newly arrived signals
            for (const id of currentIds) {
              if (!prev.has(id)) updated.add(id);
            }
            // Remove signals that no longer exist (used/deleted)
            for (const id of updated) {
              if (!currentIds.has(id)) updated.delete(id);
            }
            return updated;
          });
          const counts: Record<string, number> = {};
          (sigs.counts || []).forEach((c: any) => { counts[c.status] = c._count; });
          setSignalCounts(counts);
        } catch (e) {
          console.error('[Dashboard] Failed to parse signals:', e);
        }
      }

      // Handle user preferences (episode limit + phone + name)
      if (results[2].status === 'fulfilled') {
        try {
          const prefs = results[2].value;
          if (prefs.episodeLimit !== undefined) {
            setEpisodeLimit(prefs.episodeLimit);
          }
          if (prefs.phone) {
            setUserPhone(prefs.phone);
          }
          if (prefs.name) {
            setUserName(prefs.name);
          }
        } catch (e) {
          console.error('[Dashboard] Failed to parse preferences:', e);
        }
      }
    } catch {
      // Swallow abort errors + unexpected errors in allSettled handling
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  // ── Selection ──

  const toggleSignal = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  };

  const allSelected = selectedIds.size === signals.length && signals.length > 0;

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(signals.map(s => s.id)));
    }
  };

  // ── Delete ──

  const deleteSignal = async (id: string) => {
    try {
      const res = await fetch(`/api/signals?id=${id}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSignals((prev) => prev.filter((s) => s.id !== id));
        setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
        setSignalCounts((prev) => {
          const updated = { ...prev };
          const total = (updated.QUEUED || 0) + (updated.ENRICHED || 0);
          if (total > 0) {
            if ((updated.ENRICHED || 0) >= (updated.QUEUED || 0)) {
              updated.ENRICHED = (updated.ENRICHED || 1) - 1;
            } else {
              updated.QUEUED = (updated.QUEUED || 1) - 1;
            }
          }
          return updated;
        });
      }
    } catch (error) {
      console.error('[Dashboard] Failed to delete signal:', error);
    }
  };

  // ── Generate (with theatre) ──

  const startTheatre = useCallback(() => {
    // Typewriter pause is now handled by CaptureInput reacting to generating prop

    // Collapse signals animation
    setSignalsCollapsing(true);

    // Rotating status phrases
    setStatusPhrase(0);
    statusIntervalRef.current = setInterval(() => {
      setStatusPhrase(prev => (prev + 1) % STATUS_PHRASES.length);
    }, 4000);

    // Progress bar (simulated — fast start, slows down, never reaches 100%)
    setProgress(0);
    let elapsed = 0;
    progressIntervalRef.current = setInterval(() => {
      elapsed += 1;
      // Logarithmic curve: fast early, slow later, caps at ~92%
      setProgress(Math.min(92, Math.log(elapsed + 1) * 18));
    }, 1000);
  }, []);

  const stopTheatre = useCallback(() => {
    if (statusIntervalRef.current) {
      clearInterval(statusIntervalRef.current);
      statusIntervalRef.current = null;
    }
    if (progressIntervalRef.current) {
      clearInterval(progressIntervalRef.current);
      progressIntervalRef.current = null;
    }
    setProgress(100);
  }, []);

  const generatePollRef = useRef<NodeJS.Timeout | null>(null);
  const generateDoneRef = useRef(false);

  // Single cleanup function — every completion path calls this
  const finishGeneration = useCallback(async (outcome: { episodeId?: string; error?: string }) => {
    // Mutual exclusion: first caller wins, rest are no-ops
    if (generateDoneRef.current) return;
    generateDoneRef.current = true;

    // Stop polling IMMEDIATELY + abort any in-flight poll request
    if (generatePollRef.current) {
      clearInterval(generatePollRef.current);
      generatePollRef.current = null;
    }
    abortRef.current?.abort();

    stopTheatre();

    if (outcome.error) {
      setGenerateError(outcome.error);
    } else if (outcome.episodeId) {
      setNewEpisodeId(outcome.episodeId);
      await new Promise(r => setTimeout(r, 800));
    }

    // Fresh state rebuild — clear ref BEFORE refreshData so it actually runs
    generatingRef.current = false;
    setSelectedIds(new Set());
    await refreshData();
    setGenerating(false);
    setSignalsCollapsing(false);
    setProgress(0);
  }, [stopTheatre]);

  const generateNow = async () => {
    if (selectedIds.size === 0) return;
    generateDoneRef.current = false;
    generatingRef.current = true;
    setGenerating(true);
    setGenerateError(null);
    setNewEpisodeId(null);
    startTheatre();

    // Snapshot current episode IDs to detect the new one
    const knownEpisodeIds = new Set(episodes.map(e => e.id));

    // 1. Fire the generation request
    fetch('/api/generate-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ signalIds: Array.from(selectedIds) }),
    }).then(async (res) => {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');
      // Fetch completed — finish if polling hasn't already
      finishGeneration({ episodeId: data.episodeId });
    }).catch((err: Error) => {
      // Distinguish API errors (show to user) from network timeouts (let polling handle)
      const msg = err.message || '';
      const isNetworkError = msg.includes('Failed to fetch') || msg.includes('network') || msg.includes('abort');
      if (!isNetworkError) {
        finishGeneration({ error: msg });
      }
      // Network timeouts are silently ignored — polling will detect the episode
    });

    // 2. Poll /api/episodes every 5s to track progress (replaces dashboard poll during generation)
    let pollCount = 0;
    const maxPolls = 72; // 6 minutes
    generatePollRef.current = setInterval(async () => {
      if (generateDoneRef.current) return; // already finished via fetch
      pollCount++;

      if (pollCount > maxPolls) {
        finishGeneration({ error: 'Generation is taking longer than expected. Check back in a few minutes.' });
        return;
      }

      try {
        const res = await fetch('/api/episodes');
        if (!res.ok) return;
        const data = await res.json();
        // New shape: { episodes: [...], highlights: { topics, channels } }
        const eps = data?.episodes && Array.isArray(data.episodes) ? data.episodes : (Array.isArray(data) ? data : []);
        if (eps.length === 0) return;

        // Always update episodes list (shows GENERATING placeholder)
        setEpisodes(eps);
        if (data?.highlights) {
          setHighlightTopics(data.highlights.topics || []);
          setHighlightChannels(data.highlights.channels || []);
        }

        // Check if the new episode has landed
        const newEp = eps.find((e: Episode) => !knownEpisodeIds.has(e.id));
        if (newEp?.status === 'READY') {
          finishGeneration({ episodeId: newEp.id });
        }
      } catch {
        // Network blip — skip this cycle
      }
    }, 5000);
  };

  // ── Feedback Handlers ──

  const submitFeedback = async () => {
    const text = feedbackText.trim();
    if (!text) return;
    setFeedbackSubmitting(true);
    setFeedbackError(null);
    setFeedbackSuccess(null);

    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to submit feedback');

      setFeedbackText('');
      setFeedbackSuccess('Thank you! Your feedback has been submitted.');
      setTimeout(() => setFeedbackSuccess(null), 5000);
    } catch (error: any) {
      setFeedbackError(error.message);
    } finally {
      setFeedbackSubmitting(false);
    }
  };

  const startFeedbackRecording = async () => {
    try {
      setFeedbackError(null);
      setFeedbackSuccess(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      fbMediaRecorderRef.current = mediaRecorder;
      fbChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) fbChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(fbChunksRef.current, { type: mediaRecorder.mimeType });
        await sendFeedbackVoice(blob);
      };

      mediaRecorder.start();
      setFeedbackRecording(true);
      setFeedbackRecordingTime(0);
      fbTimerRef.current = setInterval(() => {
        setFeedbackRecordingTime(prev => {
          if (prev >= 119) {
            stopFeedbackRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      setFeedbackError(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Allow it in browser settings.'
          : 'Could not start recording.'
      );
    }
  };

  const stopFeedbackRecording = () => {
    if (fbMediaRecorderRef.current && fbMediaRecorderRef.current.state === 'recording') {
      fbMediaRecorderRef.current.stop();
    }
    if (fbTimerRef.current) {
      clearInterval(fbTimerRef.current);
      fbTimerRef.current = null;
    }
    setFeedbackRecording(false);
  };

  const sendFeedbackVoice = async (blob: Blob) => {
    setFeedbackProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'feedback.webm');

      const res = await fetch('/api/feedback', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice feedback failed');

      setFeedbackSuccess('Voice feedback submitted — thank you!');
      setTimeout(() => setFeedbackSuccess(null), 5000);
    } catch (error: any) {
      setFeedbackError(error.message);
    } finally {
      setFeedbackProcessing(false);
    }
  };

  // ── Render ──

  const totalQueued = (signalCounts.QUEUED || 0) + (signalCounts.ENRICHED || 0);

  // Don't render dashboard until session is confirmed AND data has loaded
  // Without `loading` check, returning users with a cached JWT cookie skip the skeleton
  // (status goes straight to 'authenticated') and the full heavy UI renders with empty state,
  // which overwhelms mobile GPU/CPU and crashes Chrome on iOS/Android.
  if (status === 'loading' || status === 'unauthenticated' || loading) {
    return (
      <main className="max-w-5xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-10 bg-poddit-800 rounded w-1/4" />
          <div className="h-24 bg-poddit-800 rounded" />
          <div className="h-48 bg-poddit-800 rounded" />
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto px-4 py-8 page-enter">

      {/* Dashboard bokeh — desktop only (mobile uses layout bokeh alone to avoid GPU crash) */}
      <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none z-0 hidden md:block">
        <div className="bokeh-orb bokeh-3 absolute top-[8%] right-[10%] w-[40vw] h-[40vw] rounded-full bg-teal-400/[0.07] blur-3xl" />
        <div className="bokeh-orb bokeh-1 absolute bottom-[12%] left-[5%] w-[35vw] h-[35vw] rounded-full bg-violet-400/[0.06] blur-3xl" />
        <div className="bokeh-orb bokeh-5 absolute top-[45%] left-[55%] w-[30vw] h-[30vw] rounded-full bg-amber-400/[0.05] blur-2xl" />
        <div className="bokeh-orb bokeh-2 absolute top-[20%] left-[25%] w-[20vw] h-[20vw] rounded-full bg-amber-300/[0.04] blur-2xl" />
      </div>


      {/* ── Questionnaire Modal (at episode limit) ── */}
      {showQuestionnaire && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 py-6 overflow-y-auto">
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" />
          <div className="relative w-full max-w-lg bg-poddit-950 border border-stone-800/60 rounded-2xl shadow-2xl m-auto shrink-0">
            <div className="p-6">

              {/* Success state */}
              {questionnaireSuccess ? (
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
                      You&apos;ve listened to {questionnaireMilestone} episodes
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
                          s <= questionnaireStep
                            ? 'bg-teal-400 flex-[2]'
                            : 'bg-stone-800 flex-1'
                        }`}
                      />
                    ))}
                  </div>

                  {/* Step 0: Describe + Usefulness */}
                  {questionnaireStep === 0 && (
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
                  {questionnaireStep === 1 && (
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
                  {questionnaireStep === 2 && (
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
                  {questionnaireStep === 3 && (
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
                    {questionnaireStep > 0 && (
                      <button
                        onClick={() => setQuestionnaireStep(s => s - 1)}
                        className="px-4 py-2.5 text-sm text-stone-400 hover:text-stone-300 transition-colors"
                      >
                        Back
                      </button>
                    )}
                    <div className="flex-1" />
                    {questionnaireStep < 3 ? (
                      <button
                        onClick={() => setQuestionnaireStep(s => s + 1)}
                        disabled={
                          (questionnaireStep === 0 && (!qResponses.describe || !qResponses.useful)) ||
                          (questionnaireStep === 1 && (!qResponses.changed || !qResponses.likelihood)) ||
                          (questionnaireStep === 2 && !qResponses.friction)
                        }
                        className="px-6 py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                                   hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500
                                   disabled:cursor-not-allowed transition-all"
                      >
                        Next
                      </button>
                    ) : (
                      <button
                        onClick={submitQuestionnaire}
                        disabled={questionnaireSubmitting || !qResponses.essential}
                        className="px-6 py-2.5 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                                   hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500
                                   disabled:cursor-not-allowed transition-all flex items-center gap-2"
                      >
                        {questionnaireSubmitting ? (
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
      )}

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── BRANDED WELCOME HERO ─────────────────────────────────── */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="mb-8 relative z-30">
        {/* Top bar: logo + user menu */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Image src="/logo.png" alt="Poddit" width={40} height={40} className="rounded-2xl ring-1 ring-white/10 flex-shrink-0" />
            <span className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">BETA</span>
          </div>

          {/* Top-right controls */}
          <div className="flex items-center gap-2">
            {/* User menu */}
            {session?.user && (
            <div className="relative">
              <button
                onClick={() => setShowUserMenu(prev => !prev)}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-stone-800/60
                           hover:border-stone-700 hover:bg-poddit-900/60 transition-all text-sm"
              >
                <div className="w-7 h-7 rounded-full bg-teal-500/20 flex items-center justify-center text-teal-400 text-xs font-bold">
                  {(session.user.name || session.user.email || '?')[0].toUpperCase()}
                </div>
                <span className="text-stone-400 hidden sm:inline max-w-[120px] truncate">
                  {session.user.name || session.user.email}
                </span>
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" className="text-stone-600">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>

              {showUserMenu && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setShowUserMenu(false)} />
                  <div className="absolute right-0 top-full mt-1 z-50 w-48 bg-poddit-900 border border-stone-800
                                  rounded-xl shadow-lg overflow-hidden">
                    <div className="px-3 py-2 border-b border-stone-800/60">
                      <p className="text-xs text-stone-500 truncate">{session.user.email}</p>
                    </div>
                    <Link href="/settings" className="block px-3 py-2 text-sm text-stone-300 hover:bg-poddit-800 hover:text-white transition-colors">Settings</Link>
                    <Link href="/usage" className="block px-3 py-2 text-sm text-stone-300 hover:bg-poddit-800 hover:text-white transition-colors">Usage</Link>
                    <button onClick={() => { setShowFeedbackPanel(true); setShowUserMenu(false); }} className="w-full text-left px-3 py-2 text-sm text-amber-300/80 hover:bg-poddit-800 hover:text-amber-300 transition-colors">Feedback</button>
                    <button onClick={() => signOut({ callbackUrl: '/auth/signin' })} className="w-full text-left px-3 py-2 text-sm text-stone-400 hover:bg-poddit-800 hover:text-red-400 transition-colors">Sign out</button>
                  </div>
                </>
              )}
            </div>
          )}
          </div>
        </div>

        {/* ── Welcome banner (first visit only, top of page) ── */}
        {showWelcomeBanner && (
          <div className="mb-5 p-5 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl animate-fade-in-up relative" style={{ animationFillMode: 'forwards' }}>
            <button onClick={dismissWelcomeBanner} className="absolute top-4 right-4 text-stone-600 hover:text-stone-400 transition-colors" aria-label="Dismiss">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <div className="flex items-center gap-2 mb-4">
              <h2 className="text-sm font-bold text-white">Welcome to <span className="font-display">Poddit</span></h2>
              <span className="text-[8px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">BETA</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 mb-4">
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-poddit-950/40 border border-stone-800/20">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-teal-500/15 text-teal-400 text-[10px] font-bold flex items-center justify-center">1</span>
                <div>
                  <p className="text-xs font-medium text-stone-200">Capture</p>
                  <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">Save links, topics, or voice notes as they catch your eye.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-poddit-950/40 border border-stone-800/20">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-violet-400/15 text-violet-400 text-[10px] font-bold flex items-center justify-center">2</span>
                <div>
                  <p className="text-xs font-medium text-stone-200">Generate</p>
                  <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">Hit <span className="text-teal-400/80 font-medium">Generate My Episode</span> or wait for your weekly roundup.</p>
                </div>
              </div>
              <div className="flex items-start gap-2.5 p-2.5 rounded-xl bg-poddit-950/40 border border-stone-800/20">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-amber-500/15 text-amber-400 text-[10px] font-bold flex items-center justify-center">3</span>
                <div>
                  <p className="text-xs font-medium text-stone-200">Listen</p>
                  <p className="text-[11px] text-stone-500 mt-0.5 leading-relaxed">Get a personalized audio episode that explains everything you saved.</p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <p className="text-xs text-stone-500">Your feedback shapes Poddit — tap <span className="text-amber-300/70 font-medium">Feedback</span> in the account menu anytime.</p>
              <Link href="/welcome" onClick={dismissWelcomeBanner} className="text-xs text-teal-400 hover:text-teal-300 font-medium transition-colors whitespace-nowrap">
                View capture channels →
              </Link>
            </div>
          </div>
        )}

        {/* Hero greeting panel — light background with inner bokeh */}
        <div className="relative mb-5 p-5 rounded-2xl bg-gradient-to-br from-white/[0.08] via-white/[0.04] to-transparent border border-white/[0.10] overflow-hidden">
          {/* Inner bokeh orbs — desktop only (reduces GPU load on mobile) */}
          <div className="absolute inset-0 pointer-events-none hidden sm:block">
            <div className="absolute top-[-20%] left-[-10%] w-48 h-48 rounded-full bg-teal-500/20 blur-3xl bokeh-orb bokeh-1" />
            <div className="absolute bottom-[-15%] right-[-5%] w-40 h-40 rounded-full bg-violet-400/[0.18] blur-3xl bokeh-orb bokeh-2" />
            <div className="absolute top-[30%] right-[20%] w-32 h-32 rounded-full bg-amber-400/[0.12] blur-2xl bokeh-orb bokeh-3" />
          </div>
          <div className="relative z-10">
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-extrabold text-white tracking-tight leading-tight mb-2">
              {getGreeting()}{userName ? `, ${userName}` : ''} &mdash;<br className="sm:hidden" /> welcome to your <span className="text-teal-400">Poddit</span>.
            </h1>
            <p className="text-lg sm:text-xl text-stone-300 font-light mb-1">{heroTagline}</p>
            <p className="text-sm text-stone-400 leading-relaxed max-w-xl">{getHeroSubtitle()}</p>
          </div>
        </div>

        {/* ── Setup card (first visit — phone + settings nudge) ── */}
        {showSetupCard && (
          <div className="mb-5 p-5 bg-gradient-to-br from-white/[0.06] via-white/[0.03] to-transparent border border-white/[0.08] rounded-2xl animate-fade-in-up relative" style={{ animationFillMode: 'forwards' }}>
            <button onClick={dismissSetupCard} className="absolute top-4 right-4 text-stone-600 hover:text-stone-400 transition-colors" aria-label="Dismiss">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>

            <h2 className="text-sm font-bold text-white mb-4">Complete Your Setup</h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {/* Phone number section */}
              <div className="p-4 rounded-xl bg-poddit-950/40 border border-stone-800/20">
                <div className="flex items-center gap-2 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400">
                    <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72 12.84 12.84 0 00.7 2.81 2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45 12.84 12.84 0 002.81.7A2 2 0 0122 16.92z" />
                  </svg>
                  <p className="text-xs font-medium text-stone-200">Add your phone number</p>
                </div>
                <p className="text-[11px] text-stone-500 leading-relaxed mb-3">Text links and voice memos straight to Poddit — the fastest way to capture on the go.</p>
                {/* Both states always mounted — toggled via display */}
                <div style={{ display: setupPhoneSaved || userPhone ? 'flex' : 'none' }} className="items-center gap-2 text-xs text-teal-400">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
                  Phone saved
                </div>
                <div style={{ display: !(setupPhoneSaved || userPhone) ? 'block' : 'none' }}>
                  <div className="flex gap-2">
                    <input
                      type="tel"
                      value={phoneInput}
                      onChange={(e) => { setPhoneInput(e.target.value); setPhoneError(null); }}
                      placeholder="(555) 123-4567"
                      autoComplete="off"
                      className={`flex-1 px-3 py-2 bg-white/[0.07] border rounded-lg text-sm text-white placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-white/30 transition-all ${phoneError ? 'border-red-500/40' : 'border-white/15'}`}
                    />
                    <button
                      onClick={savePhoneSetup}
                      disabled={phoneSaving || !phoneInput.trim()}
                      className="px-4 py-2 bg-teal-500 text-white text-xs font-bold rounded-lg hover:bg-teal-400 disabled:bg-stone-700 disabled:text-stone-500 disabled:cursor-not-allowed transition-all"
                    >
                      {phoneSaving ? '...' : 'Save'}
                    </button>
                  </div>
                  {phoneError && <p className="text-[11px] text-red-400 mt-1.5">{phoneError}</p>}
                </div>
              </div>

              {/* Settings nudge section */}
              <div className="p-4 rounded-xl bg-poddit-950/40 border border-stone-800/20">
                <div className="flex items-center gap-2 mb-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
                  </svg>
                  <p className="text-xs font-medium text-stone-200">Personalise your podcast</p>
                </div>
                <p className="text-[11px] text-stone-500 leading-relaxed mb-3">Choose your narrator voice and set your preferred episode length to make Poddit feel like yours.</p>
                <Link
                  href="/settings"
                  onClick={dismissSetupCard}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-teal-400 hover:text-teal-300 transition-colors"
                >
                  Open Settings
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6" /></svg>
                </Link>
              </div>
            </div>

            <button onClick={dismissSetupCard} className="text-xs text-stone-600 hover:text-stone-400 transition-colors">
              Skip for now
            </button>
          </div>
        )}

        {/* Capture input */}
        <CaptureInput
          refreshData={refreshData}
          isEmptyState={isEmptyState}
          generating={generating}
        />
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* ── TWO-COLUMN LAYOUT: Queue + Episodes (side-by-side on lg) */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <div className="flex flex-col lg:grid lg:grid-cols-2 lg:grid-rows-[min-content_1fr] lg:items-start lg:gap-6">

      {/* ── YOUR QUEUE (left column on desktop) ──────────────────── */}
      <section className="mb-6 lg:mb-0 order-1 lg:col-start-1 lg:row-start-1">
        {/* Share confirmation toast */}
        {shared === 'success' && (
          <div className="mb-4 p-3 bg-teal-400/10 border border-teal-400/20 rounded-lg text-teal-300 text-sm">
            Captured! It&apos;ll show up in your next episode.
          </div>
        )}

        {/* Generate error toast */}
        {generateError && (
          <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center justify-between">
            <span>Generation failed: {generateError}</span>
            <button onClick={() => setGenerateError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
          </div>
        )}
        <div className="flex items-center justify-between py-3">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-white">Your Queue</h2>
            {totalQueued > 0 && (
              <span className="px-2.5 py-0.5 text-xs font-semibold rounded-full bg-teal-500/15 text-teal-400 border border-teal-500/20">{totalQueued}</span>
            )}
          </div>
          {/* +/× button: toggles "How to use" panel */}
          {(signals.length > 0 || showCollectSignals) && (
            <button
              onClick={() => setShowCollectSignals(prev => !prev)}
              className={`w-8 h-8 rounded-lg border flex items-center justify-center transition-all
                         ${showCollectSignals ? 'border-teal-500/25 bg-teal-500/10 text-teal-400' : 'border-stone-800/60 text-stone-500 hover:border-stone-700 hover:text-stone-300 hover:bg-white/[0.03]'}`}
              title={showCollectSignals ? 'Close' : 'How to capture signals'}
            >
              {showCollectSignals ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14"/>
                </svg>
              )}
            </button>
          )}
        </div>

        {/* ── How to use (inline in queue, triggered by +/× button) ── */}
        <div className={`grid transition-all duration-300 ease-in-out ${showCollectSignals ? 'grid-rows-[1fr] opacity-100 mb-4' : 'grid-rows-[0fr] opacity-0'}`}>
          <div className="overflow-hidden">
            <div className="p-4 bg-poddit-950/60 border border-stone-800/25 rounded-xl">
              {/* Ways to capture signals */}
              <div className="space-y-1">
                {/* Type / paste */}
                <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400 flex-shrink-0"><path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" /></svg>
                  <p className="text-sm text-stone-300">Type or paste a link above</p>
                </div>
                {/* Voice note */}
                <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400 flex-shrink-0"><path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" /></svg>
                  <p className="text-sm text-stone-300">Tap the mic to record a voice note</p>
                </div>
                {/* SMS */}
                <button
                  onClick={() => { if (!userPhone) { setShowPhonePrompt(true); setPhoneError(null); return; } const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent); if (isMobile) { window.location.href = `sms:${podditSms.e164}`; } else { navigator.clipboard.writeText(podditSms.e164).then(() => { setPhoneSuccess('Number copied!'); setTimeout(() => setPhoneSuccess(null), 3000); }).catch(() => {}); } }}
                  className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-all text-left group"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400 flex-shrink-0"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
                  <p className="text-sm text-stone-300 group-hover:text-stone-200 transition-colors">Text a link or topic to <span className="font-mono text-teal-400/80">{podditSms.display}</span></p>
                </button>
                {/* Email */}
                <button
                  onClick={() => { window.location.href = 'mailto:capture@poddit.com'; }}
                  className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-white/[0.03] transition-all text-left group"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-teal-400 flex-shrink-0"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                  <p className="text-sm text-stone-300 group-hover:text-stone-200 transition-colors">Forward any email to <span className="font-mono text-teal-400/80">capture@poddit.com</span></p>
                </button>
                {/* Chrome — coming soon */}
                <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg opacity-40">
                  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-500 flex-shrink-0"><circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" /><line x1="21.17" y1="8" x2="12" y2="8" /><line x1="3.95" y1="6.06" x2="8.54" y2="14" /><line x1="10.88" y1="21.94" x2="15.46" y2="14" /></svg>
                  <p className="text-sm text-stone-500">Chrome extension &mdash; coming soon</p>
                </div>

                <div className="border-t border-stone-800/20 mt-2 pt-2">
                  {/* Generate */}
                  <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-violet-400 flex-shrink-0"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>
                    <p className="text-sm text-stone-300">Hit <span className="text-violet-400 font-medium">Generate My Episode</span> when you&apos;re ready</p>
                  </div>
                  {/* Auto weekly */}
                  <div className="flex items-center gap-3 py-2.5 px-3 rounded-lg">
                    <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-amber-400 flex-shrink-0"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    <p className="text-sm text-stone-300">Or sit back &mdash; Poddit auto-generates every <span className="text-amber-400 font-medium">Friday</span></p>
                  </div>
                </div>
              </div>

              {/* Phone success toast */}
              {phoneSuccess && (
                <div className="mt-3 p-2 bg-teal-400/10 border border-teal-400/20 rounded-lg text-teal-300 text-xs">
                  ✓ {phoneSuccess}
                </div>
              )}
              {/* Phone number prompt — always mounted, toggled via display */}
              <div style={{ display: showPhonePrompt ? 'block' : 'none' }} className="mt-3 p-3 bg-poddit-950/80 border border-teal-500/20 rounded-lg relative">
                <button onClick={() => { setShowPhonePrompt(false); setPhoneError(null); }} className="absolute top-2 right-2 text-stone-600 hover:text-stone-400 transition-colors" aria-label="Close">
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <p className="text-xs text-stone-300 mb-2">Add your phone number so Poddit can match your texts to your account</p>
                <div className="flex gap-2">
                  <input type="tel" value={phoneInput} onChange={(e) => setPhoneInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && savePhone()}
                    placeholder="(555) 123-4567" autoComplete="off"
                    className="flex-1 min-w-0 px-3 py-2 bg-poddit-950 border border-stone-800/50 rounded-lg text-sm text-white placeholder:text-stone-600 focus:outline-none focus:border-teal-500/40 transition-colors" />
                  <button onClick={savePhone} disabled={phoneSaving || !phoneInput.trim()}
                    className="px-4 py-2 bg-teal-500/15 text-teal-400 text-xs font-semibold rounded-lg border border-teal-500/20 hover:bg-teal-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap">
                    {phoneSaving ? 'Saving...' : 'Save & Text'}
                  </button>
                </div>
                {phoneError && <p className="text-xs text-red-400 mt-1.5">{phoneError}</p>}
              </div>
            </div>
          </div>
        </div>

        <div>
            {/* Poddit Now button */}
            {signals.length > 0 && (
              atEpisodeLimit ? (
                <div className="mb-4 p-3 bg-amber-500/[0.06] border border-amber-500/15 rounded-xl text-center">
                  <p className="text-sm text-amber-300/90 font-medium mb-1">You&apos;ve hit your {episodeLimit}-episode limit</p>
                  <p className="text-xs text-stone-500 mb-2">Want to keep going? Request more episodes.</p>
                  <Link href="/usage" className="inline-block px-4 py-2 bg-amber-500/15 border border-amber-500/25 text-amber-300 text-xs font-semibold rounded-lg hover:bg-amber-500/25 transition-all">
                    Request More Episodes
                  </Link>
                </div>
              ) : (
                <button onClick={generateNow} disabled={generating || selectedIds.size === 0}
                  className={`relative w-full mb-4 py-3 px-4 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2 uppercase tracking-wide overflow-hidden ${generating ? 'animate-glow-pulse' : ''}`}>
                  {generating && <div className="absolute inset-0 bg-teal-600 transition-all duration-1000 ease-out" style={{ width: `${progress}%` }} />}
                  <span className="relative z-10 flex items-center gap-2 drop-shadow-sm">
                    {generating ? (
                      <>
                        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span className="transition-opacity duration-500">{STATUS_PHRASES[statusPhrase]}</span>
                      </>
                    ) : (
                      <>Generate My Episode ({selectedIds.size} signal{selectedIds.size !== 1 ? 's' : ''})</>
                    )}
                  </span>
                </button>
              )
            )}

            {/* Select all / count */}
            {signals.length > 0 && (
              <div className="flex items-center justify-between mb-3">
                {!allSelected && selectedIds.size > 0 && (
                  <p className="text-xs text-stone-500">{selectedIds.size} of {signals.length} selected</p>
                )}
                <button onClick={toggleAll} disabled={generating} className="text-xs text-violet-400 hover:text-violet-300 disabled:text-poddit-600 transition-colors ml-auto">
                  {allSelected ? 'Deselect All' : 'Select All'}
                </button>
              </div>
            )}

            {/* Signal cards or empty state */}
            {signals.length === 0 ? (
              showCollectSignals ? null : (
              <div className="py-8 px-4 text-center">
                <button
                  onClick={() => setShowCollectSignals(true)}
                  className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-4 transition-all bg-teal-500/10 border border-transparent text-teal-400 hover:bg-teal-500/15 hover:border-teal-500/20"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 5v14M5 12h14"/>
                  </svg>
                </button>
                <p className="text-sm text-stone-400 font-medium mb-1">No signals yet</p>
                <p className="text-xs text-stone-500 max-w-sm mx-auto">
                  Drop a link, type a topic, or record a voice note above. Tap <span className="text-teal-400/70 font-medium">+</span> to see all capture channels.
                </p>
              </div>
              )
            ) : (
              <div className="space-y-2">
                {signals.map((signal, idx) => (
                  <div key={signal.id}
                    className={`flex items-start gap-3 p-3 rounded-xl overflow-hidden ${
                      signalsCollapsing && selectedIds.has(signal.id)
                        ? 'animate-signal-collapse'
                        : selectedIds.has(signal.id)
                          ? 'bg-teal-500/5 border border-teal-500/15 transition-all'
                          : 'bg-poddit-900/30 border border-transparent hover:border-stone-800 transition-all'
                    }`}
                    style={signalsCollapsing && selectedIds.has(signal.id) ? { animationDelay: `${idx * 80}ms`, animationFillMode: 'forwards' } : undefined}>
                    <input type="checkbox" checked={selectedIds.has(signal.id)} onChange={() => toggleSignal(signal.id)} disabled={generating} className="w-4 h-4 rounded border-stone-600 mt-0.5 flex-shrink-0 accent-teal-500" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="text-xs font-mono bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded flex-shrink-0">{signal.channel}</span>
                        <p className="text-sm text-poddit-100 truncate">{signal.title || signal.rawContent.slice(0, 80)}</p>
                      </div>
                      {signal.source && <p className="text-xs text-stone-500">{signal.source}</p>}
                      {signal.topics.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {signal.topics.map((topic) => (
                            <span key={topic} className="text-xs bg-violet-400/15 text-violet-300 px-2 py-0.5 rounded-full">{topic}</span>
                          ))}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-stone-600 whitespace-nowrap flex-shrink-0">{new Date(signal.createdAt).toLocaleDateString()}</span>
                    <button onClick={() => deleteSignal(signal.id)} disabled={generating} className="text-poddit-700 hover:text-red-400 disabled:hover:text-poddit-700 transition-colors p-1 -mr-1 flex-shrink-0" title="Remove from queue">
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
      </section>

      {/* ── YOUR EPISODES (right column on desktop) */}
      <EpisodeList
        episodes={episodes}
        episodeLimit={episodeLimit}
        loading={loading}
        generating={generating}
        newEpisodeId={newEpisodeId}
      />

      {/* ── YOUR HIGHLIGHTS ── */}
      <HighlightsPanel
        topicFrequency={topicFrequency}
        channelBreakdown={channelBreakdown}
        readyEpisodeCount={readyEpisodes.length}
        signalCount={signals.length}
      />

      </div>{/* end two-column grid */}

      {/* ── Feedback Modal (opened from account dropdown) ── */}
      {showFeedbackPanel && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setShowFeedbackPanel(false)} />
          <div className="min-h-full flex items-center justify-center px-4 py-6">
            <div className="relative w-full max-w-md bg-poddit-950 border border-stone-800/60 rounded-2xl shadow-2xl">
              <div className="p-5">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-amber-400/60" />
                    <h3 className="text-sm font-semibold text-amber-300/80 uppercase tracking-wider">Feedback</h3>
                  </div>
                  <button
                    onClick={() => setShowFeedbackPanel(false)}
                    className="text-stone-600 hover:text-stone-400 transition-colors"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <p className="text-xs text-stone-500 mb-4">
                  Found a bug? Have an idea? We&apos;d love to hear from you — text or voice.
                </p>

                {/* Feedback error/success — always mounted, toggled via display */}
                <div
                  style={{ display: feedbackError ? 'flex' : 'none' }}
                  className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs items-center justify-between"
                >
                  <span>{feedbackError}</span>
                  <button onClick={() => setFeedbackError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
                </div>
                <div
                  style={{ display: feedbackSuccess ? 'block' : 'none' }}
                  className="mb-3 p-2 bg-amber-400/10 border border-amber-400/20 rounded-lg text-amber-300 text-xs"
                >
                  {'\u2713'} {feedbackSuccess}
                </div>

                {/* All three feedback states always mounted — toggled via display */}
                <div style={{ display: feedbackRecording ? 'block' : 'none' }}>
                  <button
                    onClick={stopFeedbackRecording}
                    className="w-full py-2.5 px-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400
                               hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    {formatTime(feedbackRecordingTime)} &mdash; Recording...
                    <span className="ml-1 text-xs text-red-500 font-medium">[Stop]</span>
                  </button>
                </div>
                <div style={{ display: feedbackProcessing ? 'block' : 'none' }}>
                  <div className="w-full py-2.5 px-4 bg-poddit-900 border border-poddit-700 rounded-xl text-sm text-stone-400
                                  flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Transcribing...
                  </div>
                </div>
                <div style={{ display: !feedbackRecording && !feedbackProcessing ? 'flex' : 'none' }} className="gap-2">
                  <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    placeholder="Bugs, ideas, anything..."
                    disabled={feedbackSubmitting}
                    rows={3}
                    autoComplete="off"
                    className="flex-1 px-3 py-2.5 bg-poddit-900/80 border border-stone-800/50 rounded-xl text-sm text-white
                               placeholder:text-stone-600 focus:outline-none focus:ring-1 focus:ring-amber-500/20 focus:border-amber-500/30
                               disabled:opacity-40 transition-all resize-none"
                  />
                  <div className="flex flex-col gap-2">
                    <button
                      onClick={submitFeedback}
                      disabled={feedbackSubmitting || !feedbackText.trim()}
                      className="px-4 py-2 bg-amber-500/15 border border-amber-500/20 text-amber-300 text-xs font-medium rounded-lg
                                 hover:bg-amber-500/25 hover:border-amber-500/30
                                 disabled:bg-poddit-800/50 disabled:text-poddit-600 disabled:border-stone-800/30 disabled:cursor-not-allowed
                                 transition-all flex-shrink-0"
                    >
                      {feedbackSubmitting ? '...' : 'Send'}
                    </button>
                    <button
                      onClick={startFeedbackRecording}
                      disabled={feedbackSubmitting}
                      className="px-3 py-2 border border-stone-800/40 rounded-lg text-stone-500
                                 hover:border-amber-500/30 hover:text-amber-400 hover:bg-amber-500/5
                                 disabled:opacity-40 disabled:cursor-not-allowed
                                 transition-all flex-shrink-0 flex items-center justify-center"
                      title="Record voice feedback"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                           stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                        <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                        <line x1="12" x2="12" y1="19" y2="22" />
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<div className="max-w-5xl mx-auto px-4 py-8 text-stone-500">Loading...</div>}>
      <Dashboard />
    </Suspense>
  );
}
