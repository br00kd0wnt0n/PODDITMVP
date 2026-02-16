'use client';

import { Suspense, useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import Image from 'next/image';
import Link from 'next/link';

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

const HERO_PLACEHOLDERS = [
  'Paste a link you\'ve been meaning to read...',
  'What topic are you curious about?',
  'Forward a newsletter to capture@poddit.com...',
  'Drop a podcast episode URL...',
  '"Why is everyone talking about X?"',
];

function Dashboard() {
  const searchParams = useSearchParams();
  const shared = searchParams.get('shared');
  const { data: session, status } = useSession();
  const router = useRouter();
  const [showUserMenu, setShowUserMenu] = useState(false);

  // Client-side auth guard — redirect if no session
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/auth/signin');
    }
  }, [status, router]);

  // Data state
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [signalCounts, setSignalCounts] = useState<Record<string, number>>({});
  const [episodeLimit, setEpisodeLimit] = useState(3);
  const [userPhone, setUserPhone] = useState<string>('');
  const [showPhonePrompt, setShowPhonePrompt] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [showSendSignals, setShowSendSignals] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  // Input state
  const [textInput, setTextInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [processing, setProcessing] = useState(false);
  const [inputSuccess, setInputSuccess] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  // Generation theatre state
  const [statusPhrase, setStatusPhrase] = useState(0);
  const [progress, setProgress] = useState(0);
  const [signalsCollapsing, setSignalsCollapsing] = useState(false);
  const [newEpisodeId, setNewEpisodeId] = useState<string | null>(null);
  const statusIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Refs for recording
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Welcome banner state
  const [welcomeDismissed, setWelcomeDismissed] = useState(false);

  // Empty state
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const [inputFocused, setInputFocused] = useState(false);
  const placeholderTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Welcome overlay (first-load only, persisted in localStorage)
  const [showWelcomeOverlay, setShowWelcomeOverlay] = useState(false);
  const [welcomeOverlayExiting, setWelcomeOverlayExiting] = useState(false);

  // Feedback panel (opened from account dropdown)
  const [showFeedbackPanel, setShowFeedbackPanel] = useState(false);

  useEffect(() => {
    if (status === 'authenticated' && !loading) {
      const seen = localStorage.getItem('poddit-welcome-seen');
      if (!seen) {
        setShowWelcomeOverlay(true);
      }
    }
  }, [status, loading]);

  const dismissWelcomeOverlay = () => {
    setWelcomeOverlayExiting(true);
    setTimeout(() => {
      setShowWelcomeOverlay(false);
      setWelcomeOverlayExiting(false);
      localStorage.setItem('poddit-welcome-seen', '1');
    }, 250);
  };

  // Save phone number (flexible input — auto-prepends +1 for 10-digit numbers)
  const savePhone = async () => {
    setPhoneError(null);
    let formatted = phoneInput.trim().replace(/[\s\-\(\)\.]/g, '');
    // Auto-prepend +1 for bare 10-digit US numbers
    if (/^\d{10}$/.test(formatted)) formatted = `+1${formatted}`;
    // Accept 1XXXXXXXXXX → +1XXXXXXXXXX
    if (/^1\d{10}$/.test(formatted)) formatted = `+${formatted}`;
    // Must be E.164 at this point
    if (!/^\+[1-9]\d{1,14}$/.test(formatted)) {
      setPhoneError('Enter a valid phone number (e.g. 5551234567)');
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
      // Now open SMS
      const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
      if (isMobile) {
        window.location.href = 'sms:+18555065970';
      } else {
        navigator.clipboard.writeText('+18555065970').then(() => {
          setInputSuccess('Phone saved! Number copied — text your signals.');
          setTimeout(() => setInputSuccess(null), 3000);
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
  const isEmptyState = signals.length === 0 && !loading;
  const hasSignalsNoEpisode = signals.length > 0 && episodes.length === 0;
  const hasEpisodeReady = episodes.length > 0;
  const activeStep = hasEpisodeReady ? 3 : hasSignalsNoEpisode ? 2 : 1;
  const atEpisodeLimit = episodeLimit > 0 && episodes.length >= episodeLimit;

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

  // Placeholder text cycling timer
  useEffect(() => {
    if (!isEmptyState) {
      setPlaceholderIndex(0);
      if (placeholderTimerRef.current) clearInterval(placeholderTimerRef.current);
      return;
    }
    placeholderTimerRef.current = setInterval(() => {
      setPlaceholderIndex(prev => (prev + 1) % HERO_PLACEHOLDERS.length);
    }, 3500);
    return () => {
      if (placeholderTimerRef.current) clearInterval(placeholderTimerRef.current);
    };
  }, [isEmptyState]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (fbTimerRef.current) clearInterval(fbTimerRef.current);
      if (statusIntervalRef.current) clearInterval(statusIntervalRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
      if (placeholderTimerRef.current) clearInterval(placeholderTimerRef.current);
      if (mediaRecorderRef.current?.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
      if (fbMediaRecorderRef.current?.state === 'recording') {
        fbMediaRecorderRef.current.stop();
      }
    };
  }, []);

  // Load data + poll every 10s for new signals (SMS, extension, etc.)
  useEffect(() => {
    refreshData();
    const poll = setInterval(refreshData, 10_000);
    return () => clearInterval(poll);
  }, []);

  const refreshData = async () => {
    try {
      const results = await Promise.allSettled([
        fetch('/api/episodes').then(r => r.json()),
        fetch('/api/signals?status=queued,enriched,pending&limit=20').then(r => r.json()),
        fetch('/api/user/preferences').then(r => r.json()),
      ]);

      // Handle episodes — independent of signals
      if (results[0].status === 'fulfilled') {
        const eps = results[0].value;
        setEpisodes(Array.isArray(eps) ? eps : []);
      }

      // Handle signals — independent of episodes
      if (results[1].status === 'fulfilled') {
        const sigs = results[1].value;
        const signalList = sigs.signals || [];
        setSignals(signalList);
        setSelectedIds(new Set(signalList.map((s: Signal) => s.id)));
        const counts: Record<string, number> = {};
        (sigs.counts || []).forEach((c: any) => { counts[c.status] = c._count; });
        setSignalCounts(counts);
      }

      // Handle user preferences (episode limit + phone)
      if (results[2].status === 'fulfilled') {
        const prefs = results[2].value;
        if (prefs.episodeLimit !== undefined) {
          setEpisodeLimit(prefs.episodeLimit);
        }
        if (prefs.phone) {
          setUserPhone(prefs.phone);
        }
      }
    } catch {
      // Unexpected error in allSettled handling
    } finally {
      setLoading(false);
    }
  };

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return '';
    const mins = Math.round(seconds / 60);
    return `${mins} min`;
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

  const generateNow = async () => {
    if (selectedIds.size === 0) return;
    setGenerating(true);
    setGenerateError(null);
    setNewEpisodeId(null);
    startTheatre();

    try {
      const res = await fetch('/api/generate-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ signalIds: Array.from(selectedIds) }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Generation failed');

      stopTheatre();
      setNewEpisodeId(data.episodeId);

      // Brief pause to show 100%, then refresh
      await new Promise(r => setTimeout(r, 800));
      await refreshData();
    } catch (error: any) {
      stopTheatre();
      setGenerateError(error.message);
    } finally {
      setGenerating(false);
      setSignalsCollapsing(false);
      setProgress(0);
    }
  };

  // ── Text Input ──

  const submitText = async () => {
    const text = textInput.trim();
    if (!text) return;
    setSubmitting(true);
    setInputError(null);
    setInputSuccess(null);

    try {
      const res = await fetch('/api/capture/quick', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Capture failed');

      setTextInput('');
      setInputSuccess(data.type === 'link' ? 'Link added to queue' : `"${text.slice(0, 60)}" added to queue`);
      setTimeout(() => setInputSuccess(null), 4000);

      // Wait briefly for enrichment + classification, then refresh
      setTimeout(() => refreshData(), 2000);
    } catch (error: any) {
      setInputError(error.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submitText();
    }
  };

  // ── Voice Recording ──

  const startRecording = async () => {
    try {
      setInputError(null);
      setInputSuccess(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : 'audio/mp4';

      const mediaRecorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(track => track.stop());
        const blob = new Blob(chunksRef.current, { type: mediaRecorder.mimeType });
        await sendVoiceNote(blob);
      };

      mediaRecorder.start();
      setRecording(true);
      setRecordingTime(0);
      timerRef.current = setInterval(() => {
        setRecordingTime(prev => {
          if (prev >= 119) {
            stopRecording();
            return prev;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err: any) {
      setInputError(
        err.name === 'NotAllowedError'
          ? 'Microphone access denied. Allow it in browser settings.'
          : 'Could not start recording.'
      );
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setRecording(false);
  };

  const sendVoiceNote = async (blob: Blob) => {
    setProcessing(true);
    try {
      const formData = new FormData();
      formData.append('audio', blob, 'voice.webm');

      const res = await fetch('/api/capture/quick', {
        method: 'POST',
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Voice capture failed');

      setInputSuccess(`"${data.transcript?.slice(0, 60) || 'Voice note'}..." added to queue`);
      setTimeout(() => setInputSuccess(null), 5000);

      setTimeout(() => refreshData(), 2000);
    } catch (error: any) {
      setInputError(error.message);
    } finally {
      setProcessing(false);
    }
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

  // Don't render dashboard until session is confirmed
  if (status === 'loading' || status === 'unauthenticated') {
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

      {/* Dashboard bokeh + lens flare — always visible for atmosphere */}
      <div aria-hidden="true" className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="bokeh-orb bokeh-3 absolute top-[8%] right-[10%] w-[40vw] h-[40vw] rounded-full bg-teal-400/[0.07] blur-3xl" />
        <div className="bokeh-orb bokeh-1 absolute bottom-[12%] left-[5%] w-[35vw] h-[35vw] rounded-full bg-violet-400/[0.06] blur-3xl" />
        <div className="bokeh-orb bokeh-5 absolute top-[45%] left-[55%] w-[30vw] h-[30vw] rounded-full bg-amber-400/[0.05] blur-2xl" />
        <div className="bokeh-orb bokeh-2 absolute top-[20%] left-[25%] w-[20vw] h-[20vw] rounded-full bg-amber-300/[0.04] blur-2xl" />
      </div>

      {/* ── Welcome Overlay (first load) ── */}
      {showWelcomeOverlay && (
        <div className={`fixed inset-0 z-50 overflow-y-auto ${welcomeOverlayExiting ? 'overlay-exit' : 'overlay-enter'}`}>
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={dismissWelcomeOverlay} />

          {/* Centering wrapper — min-height trick ensures true centering even on short viewports */}
          <div className="min-h-full flex items-center justify-center px-4 py-6">
            {/* Modal */}
            <div className={`relative w-full max-w-md bg-poddit-950 border border-stone-800/60 rounded-2xl shadow-2xl
                             ${welcomeOverlayExiting ? 'modal-exit' : 'modal-enter'}`}>

            <div className="p-6">
              {/* Header */}
              <div className="flex items-center gap-3 mb-5">
                <div className="w-10 h-10 rounded-xl overflow-hidden flex-shrink-0 ring-1 ring-white/10">
                  <video
                    src="/logo_loop.mp4"
                    autoPlay
                    loop
                    muted
                    playsInline
                    className="w-full h-full object-cover"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-extrabold text-white">Welcome to <span className="font-display">PODDIT</span></h2>
                    <span className="text-[9px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">BETA</span>
                  </div>
                  <p className="text-xs text-stone-500">Early Access Preview</p>
                </div>
              </div>

              {/* Steps */}
              <div className="space-y-3 mb-5">
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-teal-500/15 text-teal-400 text-[11px] font-bold flex items-center justify-center mt-0.5">1</span>
                  <div>
                    <p className="text-sm font-medium text-white">Capture signals</p>
                    <p className="text-xs text-stone-500 mt-0.5">Save links, topics, or voice notes — via text, the input bar, or the share sheet.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-violet-400/15 text-violet-400 text-[11px] font-bold flex items-center justify-center mt-0.5">2</span>
                  <div>
                    <p className="text-sm font-medium text-white">Generate an episode</p>
                    <p className="text-xs text-stone-500 mt-0.5">Hit <span className="text-teal-400 font-medium">Poddit Now</span> anytime, or wait for your automated Friday roundup.</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <span className="flex-shrink-0 w-6 h-6 rounded-full bg-amber-500/15 text-amber-400 text-[11px] font-bold flex items-center justify-center mt-0.5">3</span>
                  <div>
                    <p className="text-sm font-medium text-white">Listen &amp; learn</p>
                    <p className="text-xs text-stone-500 mt-0.5">Get a personalized audio episode that researches and explains everything you saved.</p>
                  </div>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-stone-800/60 my-4" />

              {/* Feedback callout */}
              <div className="flex items-start gap-3 p-3 bg-amber-500/[0.05] border border-amber-500/10 rounded-xl">
                <div className="w-5 h-5 rounded-full bg-amber-400/15 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                       className="text-amber-400">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div>
                  <p className="text-sm font-medium text-amber-300/90">Your feedback shapes Poddit</p>
                  <p className="text-xs text-stone-500 mt-0.5">
                    As an early tester, your input is invaluable. Tap the <span className="text-amber-300/70">Feedback</span> option
                    in your account menu to report bugs, share ideas, or tell us what you think — text or voice.
                  </p>
                </div>
              </div>

              {/* CTA */}
              <button
                onClick={() => {
                  dismissWelcomeOverlay();
                  router.push('/welcome');
                }}
                className="w-full mt-5 py-3 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                           hover:bg-teal-400 transition-colors shadow-[0_0_16px_rgba(20,184,166,0.15)]"
              >
                Get Started
              </button>
            </div>
          </div>
          </div>
        </div>
      )}

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

      {/* Header */}
      <div className="flex items-center justify-between mb-8 relative z-30">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl overflow-hidden flex-shrink-0 ring-1 ring-white/10">
            <video
              src="/logo_loop.mp4"
              autoPlay
              loop
              muted
              playsInline
              className="w-full h-full object-cover"
            />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-extrabold text-white tracking-tight font-display">PODDIT</h1>
              <span className="text-[10px] font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-300 border border-amber-500/20">BETA</span>
            </div>
            <p className="text-stone-400 text-xs tracking-widest uppercase">Your world, explained</p>
          </div>
        </div>

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
                  <Link
                    href="/settings"
                    className="block px-3 py-2 text-sm text-stone-300 hover:bg-poddit-800 hover:text-white transition-colors"
                  >
                    Settings
                  </Link>
                  <Link
                    href="/usage"
                    className="block px-3 py-2 text-sm text-stone-300 hover:bg-poddit-800 hover:text-white transition-colors"
                  >
                    Usage
                  </Link>
                  <button
                    onClick={() => { setShowFeedbackPanel(true); setShowUserMenu(false); }}
                    className="w-full text-left px-3 py-2 text-sm text-amber-300/80 hover:bg-poddit-800 hover:text-amber-300 transition-colors"
                  >
                    Feedback
                  </button>
                  <button
                    onClick={() => signOut({ callbackUrl: '/auth/signin' })}
                    className="w-full text-left px-3 py-2 text-sm text-stone-400 hover:bg-poddit-800 hover:text-red-400 transition-colors"
                  >
                    Sign out
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* ── Capture Input Bar — prominent, right after header ── */}
      <section className={`mb-4 transition-all duration-700 ${isEmptyState ? '-mt-2' : ''}`}>
        {/* Input error */}
        {inputError && (
          <div className="mb-2 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center justify-between">
            <span>{inputError}</span>
            <button onClick={() => setInputError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
          </div>
        )}

        {/* Input success */}
        {inputSuccess && (
          <div className="mb-2 p-2 bg-teal-400/10 border border-teal-400/20 rounded-lg text-teal-300 text-xs">
            {'\u2713'} {inputSuccess}
          </div>
        )}

        {/* Recording state */}
        {recording ? (
          <button
            onClick={stopRecording}
            className="w-full py-3 px-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400
                       hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
          >
            <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse" />
            {formatTime(recordingTime)} &mdash; Recording...
            <span className="ml-1 text-xs text-red-500 font-medium">[Stop]</span>
          </button>
        ) : processing ? (
          <div className="w-full py-3 px-4 bg-poddit-900 border border-poddit-700 rounded-xl text-sm text-stone-400
                          flex items-center justify-center gap-2">
            <svg className="animate-spin h-4 w-4 text-teal-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            Transcribing...
          </div>
        ) : (
          /* Default: text input + buttons */
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1 input-lens-flare">
              <input
                type="text"
                value={textInput}
                onChange={(e) => setTextInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={() => setInputFocused(true)}
                onBlur={() => setInputFocused(false)}
                placeholder={!isEmptyState ? 'Save a link, topic, or thought...' : ' '}
                disabled={submitting}
                className={`w-full px-4 py-3 bg-poddit-900/80 border rounded-xl text-sm text-white
                           placeholder:text-stone-500 focus:outline-none focus:ring-2 focus:ring-teal-500/25 focus:border-teal-500/40
                           focus:shadow-[0_0_12px_rgba(20,184,166,0.08)]
                           disabled:opacity-40 transition-all
                           ${isEmptyState
                             ? 'border-teal-500/20 shadow-[0_0_16px_rgba(20,184,166,0.08)]'
                             : 'border-stone-700/60 shadow-[0_0_0_1px_rgba(20,184,166,0.04)]'
                           }`}
              />
              {isEmptyState && !textInput && !inputFocused && (
                <span
                  key={placeholderIndex}
                  className="absolute inset-0 flex items-center pl-4 pr-4 text-sm text-stone-500 pointer-events-none animate-placeholder-cycle overflow-hidden whitespace-nowrap text-ellipsis"
                >
                  {HERO_PLACEHOLDERS[placeholderIndex]}
                </span>
              )}
              {/* Lens flare edges — right, bottom, left (top uses ::before) */}
              <span className="flare-right" />
              <span className="flare-bottom" />
              <span className="flare-left" />
            </div>
            <div className="flex gap-2">
              <button
                onClick={submitText}
                disabled={submitting || !textInput.trim()}
                className="flex-1 sm:flex-none px-5 py-3 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                           hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-600 disabled:cursor-not-allowed
                           shadow-[0_0_12px_rgba(20,184,166,0.15)] hover:shadow-[0_0_16px_rgba(20,184,166,0.25)]
                           disabled:shadow-none transition-all flex-shrink-0"
              >
                {submitting ? '...' : 'Add'}
              </button>
              <button
                onClick={startRecording}
                disabled={submitting}
                className={`px-3 py-3 border rounded-xl
                           hover:border-violet-400/40 hover:text-violet-400 hover:bg-violet-400/5
                           disabled:opacity-40 disabled:cursor-not-allowed
                           transition-all flex-shrink-0
                           ${isEmptyState
                             ? 'border-violet-400/25 text-violet-400/60 animate-mic-pulse'
                             : 'border-stone-700/60 text-stone-400'
                           }`}
                title="Record a voice note"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </button>
            </div>
          </div>
        )}
      </section>

      {/* ── Collapsible Chips: Send Signals + How It Works ── */}
      <div className="flex flex-wrap gap-2 mb-5">
        {/* Send Signals chip */}
        <button
          onClick={() => setShowSendSignals(prev => !prev)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
                     ${showSendSignals
                       ? 'border-teal-500/30 bg-teal-500/10 text-teal-300'
                       : 'border-stone-800/50 bg-poddit-950/60 text-stone-400 hover:border-stone-700 hover:text-stone-300'
                     }`}
        >
          {/* Source icons row */}
          <span className="flex items-center gap-1 opacity-70">
            {/* SMS */}
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            {/* Share */}
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/>
            </svg>
            {/* Mic */}
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
            </svg>
            {/* Link */}
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/>
            </svg>
          </span>
          Send Signals
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" className={`transition-transform duration-200 ${showSendSignals ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>

        {/* How It Works chip */}
        <button
          onClick={() => setShowHowItWorks(prev => !prev)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium transition-all
                     ${showHowItWorks
                       ? 'border-violet-400/30 bg-violet-400/10 text-violet-300'
                       : 'border-stone-800/50 bg-poddit-950/60 text-stone-400 hover:border-stone-700 hover:text-stone-300'
                     }`}
        >
          {/* Step indicator dots */}
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full ${activeStep >= 1 ? 'bg-teal-400' : 'bg-stone-700'}`} />
            <span className={`w-1.5 h-1.5 rounded-full ${activeStep >= 2 ? 'bg-violet-400' : 'bg-stone-700'}`} />
            <span className={`w-1.5 h-1.5 rounded-full ${activeStep >= 3 ? 'bg-amber-400' : 'bg-stone-700'}`} />
          </span>
          How It Works
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" strokeWidth="2" className={`transition-transform duration-200 ${showHowItWorks ? 'rotate-180' : ''}`}>
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </button>
      </div>

      {/* ── Send Signals expanded panel ── */}
      {showSendSignals && (
        <div className="mb-5 p-4 bg-poddit-950/60 border border-stone-800/25 rounded-xl relative overflow-hidden
                         animate-fade-in-up lens-flare-edge" style={{ animationFillMode: 'forwards' }}>
          <div className="absolute -top-12 -right-12 w-32 h-32 rounded-full bg-teal-500/[0.03] blur-2xl pointer-events-none" />
          <p className="text-xs text-stone-500 mb-3">
            <span className="text-stone-300 font-medium">Send signals to Poddit</span> via
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {/* Text / Voice */}
            <button
               onClick={() => {
                 if (!userPhone) {
                   setShowPhonePrompt(true);
                   setPhoneError(null);
                   return;
                 }
                 const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
                 if (isMobile) {
                   window.location.href = 'sms:+18555065970';
                 } else {
                   navigator.clipboard.writeText('+18555065970').then(() => {
                     setInputSuccess('Phone number copied!');
                     setTimeout(() => setInputSuccess(null), 3000);
                   });
                 }
               }}
               className="flex flex-col items-center gap-2 p-3 rounded-lg border border-stone-800/30 bg-poddit-950/30
                          hover:border-teal-500/25 hover:bg-teal-500/5 transition-all group text-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                   className="text-stone-600 group-hover:text-teal-400 transition-colors">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <div>
                <p className="text-xs font-medium text-stone-300 group-hover:text-teal-300 transition-colors">Text / Voice</p>
                <p className="text-[10px] text-stone-600 mt-0.5 font-mono">(855) 506-5970</p>
              </div>
            </button>

            {/* Chrome Extension */}
            <div className="flex flex-col items-center gap-2 p-3 rounded-lg border border-stone-800/20 bg-poddit-950/20
                            opacity-50 text-center cursor-default">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
                   className="text-stone-700">
                <circle cx="12" cy="12" r="10" /><circle cx="12" cy="12" r="4" />
                <line x1="21.17" y1="8" x2="12" y2="8" /><line x1="3.95" y1="6.06" x2="8.54" y2="14" /><line x1="10.88" y1="21.94" x2="15.46" y2="14" />
              </svg>
              <div>
                <p className="text-xs font-medium text-stone-500">Chrome</p>
                <p className="text-[10px] text-stone-700 mt-0.5">Coming soon</p>
              </div>
            </div>

            {/* App Share */}
            <div className="flex flex-col items-center gap-2 p-3 rounded-lg border border-stone-800/30 bg-poddit-950/30 text-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" /><polyline points="16 6 12 2 8 6" /><line x1="12" y1="2" x2="12" y2="15" />
              </svg>
              <div>
                <p className="text-xs font-medium text-stone-300">Share</p>
                <p className="text-[10px] text-stone-600 mt-0.5">From any app</p>
              </div>
            </div>

            {/* Direct Input */}
            <div className="flex flex-col items-center gap-2 p-3 rounded-lg border border-stone-800/30 bg-poddit-950/30 text-center">
              <div className="flex items-center gap-1.5">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600">
                  <path d="M12 20h9" /><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600">
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" /><path d="M19 10v2a7 7 0 0 1-14 0v-2" /><line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </div>
              <div>
                <p className="text-xs font-medium text-stone-300">Type or speak</p>
                <p className="text-[10px] text-stone-600 mt-0.5">Links or topics</p>
              </div>
            </div>
          </div>

          {/* Phone number prompt */}
          {showPhonePrompt && (
            <div className="mt-3 p-3 bg-poddit-950/80 border border-teal-500/20 rounded-lg relative">
              <button
                onClick={() => { setShowPhonePrompt(false); setPhoneError(null); }}
                className="absolute top-2 right-2 text-stone-600 hover:text-stone-400 transition-colors"
                aria-label="Close"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
              <p className="text-xs text-stone-300 mb-2">
                Add your phone number so Poddit can match your texts to your account
              </p>
              <div className="flex gap-2">
                <input
                  type="tel"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && savePhone()}
                  placeholder="(555) 123-4567"
                  className="flex-1 min-w-0 px-3 py-2 bg-poddit-950 border border-stone-800/50 rounded-lg text-sm text-white
                             placeholder:text-stone-600 focus:outline-none focus:border-teal-500/40 transition-colors"
                  autoFocus
                />
                <button
                  onClick={savePhone}
                  disabled={phoneSaving || !phoneInput.trim()}
                  className="px-4 py-2 bg-teal-500/15 text-teal-400 text-xs font-semibold rounded-lg border border-teal-500/20
                             hover:bg-teal-500/25 disabled:opacity-40 disabled:cursor-not-allowed transition-all whitespace-nowrap"
                >
                  {phoneSaving ? 'Saving...' : 'Save & Text'}
                </button>
              </div>
              {phoneError && (
                <p className="text-xs text-red-400 mt-1.5">{phoneError}</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── How It Works expanded panel ── */}
      {showHowItWorks && (
        <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3 animate-fade-in-up" style={{ animationFillMode: 'forwards' }}>
          {([
            { label: 'Capture', desc: 'Save links, topics, or voice notes as they catch your eye.', color: 'teal', step: 1 },
            { label: 'Generate', desc: 'Hit Poddit Now or wait for your weekly roundup every Friday.', color: 'violet', step: 2 },
            { label: 'Listen', desc: 'Get a personalized audio episode explaining what it all means.', color: 'amber', step: 3 },
          ] as const).map(({ label, desc, color, step }) => {
            const isActive = step === activeStep;
            const isFuture = step > activeStep;
            const borderClass = isActive
              ? color === 'teal' ? 'border-teal-500/30' : color === 'violet' ? 'border-violet-400/30' : 'border-amber-500/30'
              : isFuture ? 'border-stone-800/10' : 'border-stone-800/20';
            const glowClass = isActive
              ? color === 'teal' ? 'animate-glow-pulse-teal' : color === 'violet' ? 'animate-glow-pulse-violet' : 'animate-glow-pulse-amber'
              : '';
            const badgeClass = isActive
              ? color === 'teal' ? 'bg-teal-500/15 text-teal-400' : color === 'violet' ? 'bg-violet-400/15 text-violet-400' : 'bg-amber-500/15 text-amber-400'
              : color === 'teal' ? 'bg-teal-500/8 text-teal-500/70' : color === 'violet' ? 'bg-violet-400/8 text-violet-400/70' : 'bg-amber-500/8 text-amber-400/70';
            const gradientFrom = color === 'teal' ? 'from-teal-500/[0.04]' : color === 'violet' ? 'from-violet-400/[0.04]' : 'from-amber-500/[0.04]';
            const hoverBorder = color === 'teal' ? 'hover:border-teal-500/15' : color === 'violet' ? 'hover:border-violet-400/15' : 'hover:border-amber-500/15';

            return (
              <div
                key={label}
                className={`flex items-start gap-3 p-3 rounded-xl bg-poddit-950/40 border ${borderClass}
                            relative overflow-hidden group ${!isFuture ? hoverBorder : ''} transition-all
                            ${isFuture ? 'opacity-40' : ''} ${glowClass}`}
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${gradientFrom} to-transparent transition-opacity
                                ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
                <span className={`relative flex-shrink-0 w-6 h-6 rounded-full text-[11px] font-bold flex items-center justify-center ${badgeClass}`}>
                  {step}
                </span>
                <div className="relative">
                  <p className={`text-sm font-medium ${isActive ? 'text-stone-200' : 'text-stone-300'}`}>{label}</p>
                  <p className="text-xs text-stone-600 mt-0.5">{desc}</p>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Welcome Banner (first-time users) ── */}
      {!loading && !welcomeDismissed && episodes.length === 0 && signals.length === 0 && (
        <div className="mb-5 p-4 rounded-xl border border-teal-500/15 bg-gradient-to-r from-teal-500/[0.06] via-violet-400/[0.04] to-amber-500/[0.06]
                        relative overflow-hidden opacity-0 animate-fade-in-up" style={{ animationDelay: '0.3s', animationFillMode: 'forwards' }}>
          <button
            onClick={() => setWelcomeDismissed(true)}
            className="absolute top-3 right-3 text-stone-600 hover:text-stone-400 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
          <h3 className="text-sm font-semibold text-white mb-1.5">Welcome to Poddit!</h3>
          <p className="text-xs text-stone-400 leading-relaxed max-w-lg">
            Start by saving anything that catches your eye — a link, a topic, or a voice note.
            When you&apos;re ready, hit <span className="text-teal-400 font-medium">Poddit Now</span> to
            turn your signals into a personalized audio episode. Head to{' '}
            <Link href="/settings" className="text-violet-400 hover:text-violet-300 underline underline-offset-2 transition-colors">
              Settings
            </Link>{' '}
            to customize your experience.
          </p>
        </div>
      )}

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

      {/* ── Two-Column Layout (desktop) ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

        {/* ── Left: Signal Queue ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">
              Queue
              {totalQueued > 0 && (
                <span className="ml-2 text-xs font-normal text-stone-500 normal-case tracking-normal">
                  {totalQueued} signal{totalQueued !== 1 ? 's' : ''} waiting
                </span>
              )}
            </h2>
            {signals.length > 0 && (
              <button
                onClick={toggleAll}
                disabled={generating}
                className="text-xs text-violet-400 hover:text-violet-300 disabled:text-poddit-600 transition-colors"
              >
                {allSelected ? 'Deselect All' : 'Select All'}
              </button>
            )}
          </div>

          {/* Poddit Now button */}
          {signals.length > 0 && (
            atEpisodeLimit ? (
              <div className="mb-4 p-3 bg-amber-500/[0.06] border border-amber-500/15 rounded-xl text-center">
                <p className="text-sm text-amber-300/90 font-medium mb-1">
                  You&apos;ve hit your {episodeLimit}-episode limit
                </p>
                <p className="text-xs text-stone-500">
                  Your feedback helps us unlock more &mdash; tap Feedback in the account menu.
                </p>
              </div>
            ) : (
              <button
                onClick={generateNow}
                disabled={generating || selectedIds.size === 0}
                className={`relative w-full mb-4 py-3 px-4 bg-teal-500 text-poddit-950 text-sm font-bold rounded-xl
                           hover:bg-teal-400 disabled:bg-poddit-800 disabled:text-poddit-500 disabled:cursor-not-allowed
                           transition-all flex items-center justify-center gap-2 uppercase tracking-wide overflow-hidden
                           ${generating ? 'animate-glow-pulse' : ''}`}
              >
                {/* Progress bar overlay */}
                {generating && (
                  <div
                    className="absolute inset-0 bg-teal-600 transition-all duration-1000 ease-out"
                    style={{ width: `${progress}%` }}
                  />
                )}
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
                    <>Poddit <span className="italic text-teal-200">Now</span> ({selectedIds.size} signal{selectedIds.size !== 1 ? 's' : ''})</>
                  )}
                </span>
              </button>
            )
          )}

          {/* Selection count */}
          {signals.length > 0 && !allSelected && selectedIds.size > 0 && (
            <p className="text-xs text-stone-500 mb-3">
              {selectedIds.size} of {signals.length} selected
            </p>
          )}

          {signals.length === 0 ? (
            <div className="relative">
              {/* Placeholder queue cards — visual hint of what fills this space */}
              <div className="space-y-2 opacity-[0.04]">
                <div className="h-14 rounded-xl bg-stone-500 border border-stone-700" />
                <div className="h-14 rounded-xl bg-stone-500 border border-stone-700" />
                <div className="h-14 rounded-xl bg-stone-500 border border-stone-700" />
              </div>
              {/* Instructive copy overlaid */}
              <div className="absolute inset-0 flex items-center justify-center px-4">
                <p className="text-sm text-stone-500 leading-relaxed text-center max-w-sm">
                  Send anything that catches your eye &mdash; links, topics, voice notes &mdash; and they&apos;ll queue up here,
                  ready to become your next personalized episode.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {signals.map((signal, idx) => (
                <div
                  key={signal.id}
                  className={`flex items-start gap-3 p-3 rounded-xl overflow-hidden ${
                    signalsCollapsing && selectedIds.has(signal.id)
                      ? 'animate-signal-collapse'
                      : selectedIds.has(signal.id)
                        ? 'bg-teal-500/5 border border-teal-500/15 transition-all'
                        : 'bg-poddit-900/30 border border-transparent hover:border-stone-800 transition-all'
                  }`}
                  style={signalsCollapsing && selectedIds.has(signal.id) ? {
                    animationDelay: `${idx * 80}ms`,
                    animationFillMode: 'forwards',
                  } : undefined}
                >
                  <input
                    type="checkbox"
                    checked={selectedIds.has(signal.id)}
                    onChange={() => toggleSignal(signal.id)}
                    disabled={generating}
                    className="w-4 h-4 rounded border-stone-600 mt-0.5 flex-shrink-0 accent-teal-500"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-mono bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded flex-shrink-0">
                        {signal.channel}
                      </span>
                      <p className="text-sm text-poddit-100 truncate">
                        {signal.title || signal.rawContent.slice(0, 80)}
                      </p>
                    </div>
                    {signal.source && (
                      <p className="text-xs text-stone-500 ml-0">{signal.source}</p>
                    )}
                    {signal.topics.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {signal.topics.map((topic) => (
                          <span
                            key={topic}
                            className="text-xs bg-violet-400/15 text-violet-300 px-2 py-0.5 rounded-full"
                          >
                            {topic}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="text-xs text-stone-600 whitespace-nowrap flex-shrink-0">
                    {new Date(signal.createdAt).toLocaleDateString()}
                  </span>
                  <button
                    onClick={() => deleteSignal(signal.id)}
                    disabled={generating}
                    className="text-poddit-700 hover:text-red-400 disabled:hover:text-poddit-700 transition-colors p-1 -mr-1 flex-shrink-0"
                    title="Remove from queue"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18"></line>
                      <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── Right: Episodes ── */}
        <section>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-stone-400 uppercase tracking-wider">Episodes</h2>
            {episodes.length > 0 && (
              <span className="text-xs text-stone-600">
                {episodeLimit > 0 ? `${episodes.length}/${episodeLimit}` : `${episodes.length}`} episodes
              </span>
            )}
          </div>

          {loading ? (
            <div className="p-6 text-center text-stone-500">Loading...</div>
          ) : episodes.length === 0 ? (
            <div className="p-8 bg-poddit-900/50 border border-stone-800/50 rounded-xl text-center">
              <p className="text-stone-400 mb-2">No episodes yet.</p>
              <p className="text-sm text-stone-500">
                Capture a few signals, then hit Poddit Now &mdash; or sit back and get a weekly roundup every Friday.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {episodes.map((ep) => (
                <Link
                  key={ep.id}
                  href={`/player/${ep.id}`}
                  className={`block p-4 bg-poddit-900/50 border border-stone-800/50 rounded-xl
                             hover:border-violet-400/30 hover:bg-poddit-900 transition-all group lens-flare-edge lens-flare-edge-alt
                             ${ep.id === newEpisodeId ? 'animate-episode-reveal ring-1 ring-teal-500/30' : ''}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white group-hover:text-violet-300 transition-colors">{ep.title}</h3>
                      <p className="text-sm text-stone-400 mt-1 line-clamp-2">{ep.summary?.slice(0, 120)}...</p>
                    </div>
                    <span className="text-sm text-stone-500 whitespace-nowrap ml-4 flex-shrink-0">
                      {formatDuration(ep.audioDuration)}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 mt-3 text-xs text-stone-500">
                    <span>{ep.signalCount} signal{ep.signalCount !== 1 ? 's' : ''}</span>
                    <span className="text-teal-500/40">&bull;</span>
                    <span>{new Date(ep.generatedAt).toLocaleDateString()}</span>
                    {ep.topicsCovered.length > 0 && (
                      <>
                        <span className="text-teal-500/40">&bull;</span>
                        <span className="text-stone-400 truncate">{ep.topicsCovered.slice(0, 3).join(', ')}</span>
                      </>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

      </div>

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

                {feedbackError && (
                  <div className="mb-3 p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs flex items-center justify-between">
                    <span>{feedbackError}</span>
                    <button onClick={() => setFeedbackError(null)} className="text-red-500/50 hover:text-red-400 ml-2">&times;</button>
                  </div>
                )}

                {feedbackSuccess && (
                  <div className="mb-3 p-2 bg-amber-400/10 border border-amber-400/20 rounded-lg text-amber-300 text-xs">
                    {'\u2713'} {feedbackSuccess}
                  </div>
                )}

                {feedbackRecording ? (
                  <button
                    onClick={stopFeedbackRecording}
                    className="w-full py-2.5 px-4 bg-red-500/10 border border-red-500/30 rounded-xl text-sm text-red-400
                               hover:bg-red-500/20 transition-colors flex items-center justify-center gap-2"
                  >
                    <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
                    {formatTime(feedbackRecordingTime)} &mdash; Recording...
                    <span className="ml-1 text-xs text-red-500 font-medium">[Stop]</span>
                  </button>
                ) : feedbackProcessing ? (
                  <div className="w-full py-2.5 px-4 bg-poddit-900 border border-poddit-700 rounded-xl text-sm text-stone-400
                                  flex items-center justify-center gap-2">
                    <svg className="animate-spin h-4 w-4 text-amber-400" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    Transcribing...
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <textarea
                      value={feedbackText}
                      onChange={(e) => setFeedbackText(e.target.value)}
                      placeholder="Bugs, ideas, anything..."
                      disabled={feedbackSubmitting}
                      rows={3}
                      autoFocus
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
                )}
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
