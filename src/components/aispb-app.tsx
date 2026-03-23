"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";

import {
  getPromptPreview,
  localCoachAdapter,
  providerCards,
} from "@/lib/local-adapters";
import type {
  DictionaryCuePayload,
  PronouncerStatusPayload,
} from "@/lib/provider-client";
import {
  fetchDictionaryCue,
  fetchPronouncerAudio,
  fetchPronouncerStatus,
} from "@/lib/provider-client";
import {
  applyDrillResult,
  createDrillPlan,
  getNotebookEntries,
  getTodayKey,
} from "@/lib/session-engine";
import {
  formatSpellingCandidate,
  normalizeSpokenSpellingAttempt,
} from "@/lib/spoken-spelling";
import {
  defaultSettings,
  loadProgress,
  loadSettings,
  saveProgress,
  saveSettings,
} from "@/lib/storage";
import type {
  DrillPlan,
  DrillPromptKind,
  DrillSettings,
  NotebookEntry,
  ProgressMap,
  SubmissionState,
} from "@/lib/types";
import { wordBank } from "@/lib/word-bank";

type FeedEntryTone = "system" | "hint" | "success" | "danger";
type SpeechCaptureState =
  | "idle"
  | "listening"
  | "processing"
  | "unsupported"
  | "error";

interface BrowserSpeechRecognitionAlternative {
  transcript: string;
}

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
}

interface BrowserSpeechRecognitionResultList {
  length: number;
  [index: number]: BrowserSpeechRecognitionResult;
}

interface BrowserSpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: BrowserSpeechRecognitionResultList;
}

interface BrowserSpeechRecognitionErrorEvent extends Event {
  error: string;
  message?: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: ((event: Event) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onstart: ((event: Event) => void) | null;
  abort: () => void;
  start: () => void;
  stop: () => void;
}

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognition;

interface FeedEntry {
  id: string;
  tone: FeedEntryTone;
  label: string;
  content: string;
}

const goalOptions = [5, 10, 20];
const roundOptions = [60, 90];
const promptOrder: DrillPromptKind[] = [
  "repeat",
  "definition",
  "sentence",
  "origin",
];
const promptLabels: Record<DrillPromptKind, string> = {
  repeat: "Repeat",
  definition: "Definition",
  sentence: "Sentence",
  origin: "Origin",
};
const statusCopy: Record<SubmissionState, string> = {
  idle: "Listen first, then spell aloud with clear, distinct letters.",
  correct: "Correct. The round advances automatically.",
  incorrect: "Miss logged. The word moves into review.",
  timeout: "Time expired. The word moves into review.",
};
const feedToneClass: Record<FeedEntryTone, string> = {
  system: "border-[color:var(--line)] bg-white/70 text-[color:var(--muted)]",
  hint: "border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)]/60 text-[color:var(--foreground)]",
  success:
    "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--foreground)]",
  danger:
    "border-[color:var(--signal)] bg-[color:var(--signal)]/10 text-[color:var(--foreground)]",
};

let feedId = 0;

function createFeedEntry(
  label: string,
  content: string,
  tone: FeedEntryTone,
): FeedEntry {
  return {
    id: `feed-${feedId++}`,
    label,
    content,
    tone,
  };
}

function createPreviewPlan(settings: DrillSettings, progress: ProgressMap) {
  return createDrillPlan({
    words: wordBank,
    settings,
    progress,
    todayKey: getTodayKey(),
  });
}

function pronounceWithBrowserSpeech(text: string) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) {
    return false;
  }

  const synth = window.speechSynthesis;
  const utterance = new SpeechSynthesisUtterance(text);
  const voices = synth.getVoices();
  const preferredVoice =
    voices.find((voice) => voice.lang.toLowerCase().includes("en-us")) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith("en"));

  utterance.lang = preferredVoice?.lang ?? "en-US";
  utterance.rate = 0.83;
  utterance.pitch = 0.94;

  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  synth.cancel();
  synth.speak(utterance);

  return true;
}

function getPromptSpeechText(
  word: NonNullable<DrillPlan["words"][number]>,
  promptKind: DrillPromptKind,
  dictionaryCue: DictionaryCuePayload | null,
) {
  if (promptKind === "repeat") {
    return word.word;
  }

  if (promptKind === "definition") {
    return dictionaryCue?.definition ?? word.definition;
  }

  if (promptKind === "sentence") {
    return dictionaryCue?.sentence ?? word.sentence;
  }

  return dictionaryCue?.origin ?? word.origin;
}

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return (window.SpeechRecognition ??
    window.webkitSpeechRecognition ??
    null) as BrowserSpeechRecognitionConstructor | null;
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export function AispbApp() {
  const [storageReady, setStorageReady] = useState(false);
  const [settings, setSettings] = useState<DrillSettings>(defaultSettings);
  const [progress, setProgress] = useState<ProgressMap>({});
  const [activePlan, setActivePlan] = useState<DrillPlan | null>(null);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(
    defaultSettings.roundDurationSeconds,
  );
  const [attemptDraft, setAttemptDraft] = useState("");
  const [manualFallbackValue, setManualFallbackValue] = useState("");
  const [speechCaptureState, setSpeechCaptureState] =
    useState<SpeechCaptureState>("unsupported");
  const [speechTranscript, setSpeechTranscript] = useState("");
  const [speechInterimTranscript, setSpeechInterimTranscript] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmissionState>("idle");
  const [hintsUsed, setHintsUsed] = useState<DrillPromptKind[]>([]);
  const [restartCount, setRestartCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0);
  const [sessionMissCount, setSessionMissCount] = useState(0);
  const [browserSpeechReady, setBrowserSpeechReady] = useState(false);
  const [pronouncerStatus, setPronouncerStatus] =
    useState<PronouncerStatusPayload | null>(null);
  const [lastPronouncerProvider, setLastPronouncerProvider] = useState<
    string | null
  >(null);
  const [dictionaryCache, setDictionaryCache] = useState<
    Record<string, DictionaryCuePayload>
  >({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const shouldJudgeSpeechOnEndRef = useRef(false);
  const recognitionHadErrorRef = useRef(false);
  const latestSpeechTranscriptRef = useRef("");
  const latestSpeechInterimTranscriptRef = useRef("");
  const [feed, setFeed] = useState<FeedEntry[]>([
    {
      id: "feed-initial",
      label: "Warmup",
      content:
        "The drill engine is ready. Start a session to generate today's deck and pull in the active pronouncer path.",
      tone: "system",
    },
  ]);

  const todayKey = getTodayKey();
  const previewPlan = createPreviewPlan(settings, progress);
  const plan = activePlan ?? previewPlan;
  const sessionWords = plan.words;
  const totalWords = sessionWords.length;
  const currentWord = sessionWords[currentIndex] ?? sessionWords[0];
  const notebookEntries = getNotebookEntries({
    words: wordBank,
    progress,
    todayKey,
  });
  const currentDictionaryCue = currentWord
    ? dictionaryCache[currentWord.id]
    : null;
  const hasExternalPronouncer = pronouncerStatus?.configured ?? false;
  const pronouncerAvailable = hasExternalPronouncer || browserSpeechReady;
  const speechRecognitionSupported = speechCaptureState !== "unsupported";
  const combinedSpeechTranscript = [speechTranscript, speechInterimTranscript]
    .filter(Boolean)
    .join(" ")
    .trim();
  const shouldShowManualFallback =
    !speechRecognitionSupported || speechCaptureState === "error";
  const dueNotebookCount = notebookEntries.filter(
    (entry) => !entry.progress.dueOn || entry.progress.dueOn <= todayKey,
  ).length;
  const interactionLocked =
    !sessionStarted ||
    sessionComplete ||
    status !== "idle" ||
    speechCaptureState === "listening" ||
    speechCaptureState === "processing";
  const timerDegrees =
    (secondsLeft / Math.max(plan.settings.roundDurationSeconds, 1)) * 360;
  const progressPercent =
    totalWords === 0
      ? 0
      : sessionComplete
        ? 100
        : (currentIndex / totalWords) * 100;
  const sessionAccuracy = Math.round(
    (sessionCorrectCount /
      Math.max(sessionCorrectCount + sessionMissCount, 1)) *
      100,
  );
  const voiceStatusLabel = hasExternalPronouncer
    ? "volc ready"
    : browserSpeechReady
      ? "browser fallback"
      : "voice unavailable";
  const speechStatusLabel =
    speechCaptureState === "listening"
      ? "listening"
      : speechCaptureState === "processing"
        ? "judging"
        : speechCaptureState === "error"
          ? "mic issue"
          : speechCaptureState === "unsupported"
            ? "manual fallback"
            : "mic ready";
  const pronouncerDetail = hasExternalPronouncer
    ? `${pronouncerStatus?.detail ?? "Volcengine speech is active."} Browser speech stays available as a local fallback.`
    : pronouncerStatus?.detail
      ? `${pronouncerStatus.detail} Browser speech will cover local playback until cloud audio is ready.`
      : browserSpeechReady
        ? "External TTS is not configured yet. Browser speech is carrying local playback for drills and prompt repeats."
        : "No active audio channel is available yet. Add Volcengine speech credentials or use a browser with speech synthesis support.";
  const adapterBadge = lastPronouncerProvider
    ? lastPronouncerProvider
    : currentDictionaryCue?.provider
      ? currentDictionaryCue.provider
      : hasExternalPronouncer
        ? (pronouncerStatus?.provider ?? "Volcengine Doubao Speech TTS V3")
        : browserSpeechReady
          ? "Browser speech fallback"
          : "auto fallback";
  const renderedProviderCards = providerCards.map((provider) => {
    if (provider.role === "pronouncer") {
      return {
        ...provider,
        detail: pronouncerDetail,
        status: pronouncerAvailable ? "ready" : "planned",
      } as const;
    }

    return provider;
  });

  function stopActiveAudio() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }

    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }

    if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
  }

  function resetSpeechAttempt() {
    shouldJudgeSpeechOnEndRef.current = false;
    recognitionHadErrorRef.current = false;
    latestSpeechTranscriptRef.current = "";
    latestSpeechInterimTranscriptRef.current = "";
    setSpeechTranscript("");
    setSpeechInterimTranscript("");
    setSpeechError(null);
    setAttemptDraft("");
    setManualFallbackValue("");
  }

  async function playPronouncerText(text: string) {
    if (!settings.pronouncerEnabled) {
      return null;
    }

    if (hasExternalPronouncer) {
      try {
        const response = await fetchPronouncerAudio(text);

        stopActiveAudio();

        const audioUrl = URL.createObjectURL(response.blob);
        const audio = new Audio(audioUrl);

        audioRef.current = audio;
        audioUrlRef.current = audioUrl;
        audio.onended = stopActiveAudio;
        audio.onerror = stopActiveAudio;
        audio.preload = "auto";
        await audio.play();

        setLastPronouncerProvider(response.provider);

        return response.provider;
      } catch (error) {
        console.error("pronouncer remote fallback", error);
      }
    }

    stopActiveAudio();

    const didSpeak = pronounceWithBrowserSpeech(text);

    if (didSpeak) {
      setLastPronouncerProvider("Browser speech fallback");

      return "Browser speech fallback";
    }

    setLastPronouncerProvider(null);

    return null;
  }

  const autoplayCurrentWord = useEffectEvent((nextWord: string) => {
    void playPronouncerText(nextWord);
  });

  async function submitAttempt(rawAttempt: string) {
    if (!currentWord || !sessionStarted || sessionComplete) {
      return;
    }

    const normalizedAttempt = normalizeSpokenSpellingAttempt(rawAttempt);
    const candidate =
      normalizedAttempt.candidate.trim().toLowerCase() ||
      rawAttempt.trim().toLowerCase();

    if (normalizedAttempt.command === "start-over") {
      handleStartOver();
      return;
    }

    if (!candidate) {
      setSpeechCaptureState(
        speechRecognitionSupported ? "idle" : "unsupported",
      );
      setSpeechError("No recognizable letters were captured.");
      setFeed((previous) => [
        createFeedEntry(
          "Mic retry",
          "No recognizable letters were captured. Try again and say each letter distinctly.",
          "danger",
        ),
        ...previous,
      ]);
      return;
    }

    const normalizedWord = currentWord.word.toLowerCase();

    if (candidate === normalizedWord) {
      const nextStreak = streak + 1;

      setProgress((previous) =>
        applyDrillResult({
          progress: previous,
          wordId: currentWord.id,
          result: "correct",
          todayKey,
        }),
      );
      setStatus("correct");
      setStreak(nextStreak);
      setBestStreak((previous) => Math.max(previous, nextStreak));
      setSessionCorrectCount((previous) => previous + 1);
      setFeed((previous) => [
        createFeedEntry(
          "Correct",
          `${formatSpellingCandidate(candidate)} locked in for ${currentWord.word}. ${currentWord.coachingNote}`,
          "success",
        ),
        ...previous,
      ]);

      window.setTimeout(() => {
        advanceWord();
      }, 850);
      return;
    }

    await registerMiss("incorrect", candidate);
  }

  function startSpeechCapture() {
    if (!sessionStarted || sessionComplete || status !== "idle") {
      return;
    }

    const Recognition = getSpeechRecognitionConstructor();

    if (!Recognition) {
      setSpeechCaptureState("unsupported");
      setSpeechError(
        "This browser does not expose speech recognition yet. Use the manual fallback for now.",
      );
      return;
    }

    if (!recognitionRef.current) {
      const nextRecognition = new Recognition();

      nextRecognition.continuous = true;
      nextRecognition.interimResults = true;
      nextRecognition.lang = "en-US";
      nextRecognition.maxAlternatives = 1;
      nextRecognition.onstart = () => {
        recognitionHadErrorRef.current = false;
        setSpeechCaptureState("listening");
        setSpeechError(null);
      };
      nextRecognition.onresult = (event) => {
        const finalChunks: string[] = [];
        const interimChunks: string[] = [];

        for (
          let index = event.resultIndex;
          index < event.results.length;
          index += 1
        ) {
          const result = event.results[index];
          const chunk = result[0]?.transcript?.trim();

          if (!chunk) {
            continue;
          }

          if (result.isFinal) {
            finalChunks.push(chunk);
          } else {
            interimChunks.push(chunk);
          }
        }

        setSpeechTranscript((previous) => {
          const nextTranscript = [previous, ...finalChunks]
            .filter(Boolean)
            .join(" ")
            .trim();
          latestSpeechTranscriptRef.current = nextTranscript;
          latestSpeechInterimTranscriptRef.current = interimChunks
            .join(" ")
            .trim();

          const normalized = normalizeSpokenSpellingAttempt(
            [nextTranscript, interimChunks.join(" ")].filter(Boolean).join(" "),
          );

          setAttemptDraft(normalized.candidate);

          return nextTranscript;
        });
        setSpeechInterimTranscript(interimChunks.join(" ").trim());
      };
      nextRecognition.onerror = (event) => {
        recognitionHadErrorRef.current = true;
        const nextError =
          event.error === "not-allowed"
            ? "Microphone permission was blocked."
            : `Speech recognition error: ${event.error}.`;

        setSpeechCaptureState("error");
        setSpeechError(nextError);
      };
      nextRecognition.onend = () => {
        const transcriptToJudge = [
          latestSpeechTranscriptRef.current,
          latestSpeechInterimTranscriptRef.current,
        ]
          .filter(Boolean)
          .join(" ")
          .trim();

        if (shouldJudgeSpeechOnEndRef.current) {
          shouldJudgeSpeechOnEndRef.current = false;
          setSpeechCaptureState("processing");
          setSpeechInterimTranscript("");
          void submitAttempt(transcriptToJudge).finally(() => {
            setSpeechCaptureState("idle");
          });
          return;
        }

        if (recognitionHadErrorRef.current) {
          return;
        }

        setSpeechCaptureState("idle");
      };

      recognitionRef.current = nextRecognition;
    }

    resetSpeechAttempt();

    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("speech recognition start", error);
      setSpeechCaptureState("error");
      setSpeechError("Speech recognition failed to start.");
    }
  }

  function stopSpeechCaptureAndJudge() {
    if (!recognitionRef.current || speechCaptureState !== "listening") {
      return;
    }

    shouldJudgeSpeechOnEndRef.current = true;
    setSpeechCaptureState("processing");
    recognitionRef.current.stop();
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      const nextSettings = loadSettings();
      const nextProgress = loadProgress();

      setSettings(nextSettings);
      setProgress(nextProgress);
      setSecondsLeft(nextSettings.roundDurationSeconds);
      setBrowserSpeechReady(
        typeof window !== "undefined" && "speechSynthesis" in window,
      );
      setSpeechCaptureState(
        getSpeechRecognitionConstructor() ? "idle" : "unsupported",
      );
      setStorageReady(true);
      void fetchPronouncerStatus()
        .then((nextStatus) => {
          setPronouncerStatus(nextStatus);
        })
        .catch((error) => {
          console.error("pronouncer status fallback", error);
        });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      stopActiveAudio();
      recognitionRef.current?.abort();
      recognitionRef.current = null;

      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    saveSettings(settings);
  }, [settings, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    saveProgress(progress);
  }, [progress, storageReady]);

  useEffect(() => {
    if (!sessionStarted || !currentWord) {
      return;
    }

    if (!settings.pronouncerEnabled || sessionComplete) {
      return;
    }

    if (!hasExternalPronouncer && !browserSpeechReady) {
      return;
    }

    autoplayCurrentWord(currentWord.word);
  }, [
    browserSpeechReady,
    currentIndex,
    currentWord,
    currentWord?.id,
    hasExternalPronouncer,
    sessionComplete,
    sessionStarted,
    settings.pronouncerEnabled,
  ]);

  function updateSettings(patch: Partial<DrillSettings>) {
    setSettings((previous) => {
      const nextSettings = {
        ...previous,
        ...patch,
      };

      if (!sessionStarted && patch.roundDurationSeconds) {
        setSecondsLeft(patch.roundDurationSeconds);
      }

      return nextSettings;
    });
  }

  async function resolveDictionaryCue() {
    if (!currentWord) {
      throw new Error("No active word available.");
    }

    const cached = dictionaryCache[currentWord.id];

    if (cached) {
      return cached;
    }

    const nextCue = await fetchDictionaryCue(currentWord);

    setDictionaryCache((previous) => ({
      ...previous,
      [currentWord.id]: nextCue,
    }));

    return nextCue;
  }

  function beginSession() {
    const nextPlan = createPreviewPlan(settings, progress);

    setActivePlan(nextPlan);
    setSessionStarted(true);
    setSessionComplete(false);
    setCurrentIndex(0);
    setSecondsLeft(nextPlan.settings.roundDurationSeconds);
    resetSpeechAttempt();
    setStatus("idle");
    setHintsUsed([]);
    setRestartCount(0);
    setStreak(0);
    setSessionCorrectCount(0);
    setSessionMissCount(0);
    setLastPronouncerProvider(null);
    setFeed([
      createFeedEntry(
        "Session start",
        `Today's deck is ready: ${nextPlan.stats.reviewCount} review word(s), ${nextPlan.stats.freshCount} fresh word(s). Round 1 is live.`,
        "system",
      ),
    ]);
  }

  function advanceWord() {
    startTransition(() => {
      if (!activePlan) {
        return;
      }

      if (currentIndex === activePlan.words.length - 1) {
        setSessionComplete(true);
        setSessionStarted(false);
        setFeed((previous) => [
          createFeedEntry(
            "Session complete",
            `Finished ${activePlan.words.length} word(s). Accuracy ${Math.round(
              (sessionCorrectCount /
                Math.max(sessionCorrectCount + sessionMissCount, 1)) *
                100,
            )}% this run.`,
            "success",
          ),
          ...previous,
        ]);
        return;
      }

      setCurrentIndex((previous) => previous + 1);
      setSecondsLeft(activePlan.settings.roundDurationSeconds);
      resetSpeechAttempt();
      setStatus("idle");
      setHintsUsed([]);
      setRestartCount(0);
      setFeed((previous) => [
        createFeedEntry(
          "Next word",
          `Round ${currentIndex + 2} is live. Listen first, then spell.`,
          "system",
        ),
        ...previous,
      ]);
    });
  }

  async function registerMiss(
    result: Exclude<SubmissionState, "idle" | "correct">,
    attempt: string,
  ) {
    if (!currentWord) {
      return;
    }

    shouldJudgeSpeechOnEndRef.current = false;
    recognitionRef.current?.abort();
    setSpeechCaptureState(speechRecognitionSupported ? "idle" : "unsupported");

    const coachCopy = await localCoachAdapter.summarizeMiss(
      currentWord,
      attempt,
      result,
    );

    setProgress((previous) =>
      applyDrillResult({
        progress: previous,
        wordId: currentWord.id,
        result,
        todayKey,
      }),
    );
    setSessionMissCount((previous) => previous + 1);
    setStreak(0);
    setStatus(result);
    setFeed((previous) => [
      createFeedEntry(
        result === "timeout" ? "Timed out" : "Miss logged",
        coachCopy,
        "danger",
      ),
      ...previous,
    ]);

    window.setTimeout(() => {
      advanceWord();
    }, 950);
  }

  const tick = useEffectEvent(() => {
    setSecondsLeft((previous) => {
      if (previous <= 1) {
        void registerMiss("timeout", attemptDraft.trim());
        return plan.settings.roundDurationSeconds;
      }

      return previous - 1;
    });
  });

  useEffect(() => {
    if (!sessionStarted || sessionComplete) {
      return;
    }

    const intervalId = window.setInterval(() => {
      tick();
    }, 1000);

    return () => window.clearInterval(intervalId);
  }, [sessionComplete, sessionStarted]);

  async function openPrompt(kind: DrillPromptKind) {
    if (!currentWord || !sessionStarted || sessionComplete) {
      return;
    }

    let displayText = getPromptPreview(currentWord, "repeat");
    let dictionaryCue: DictionaryCuePayload | null = null;
    let pronouncerProvider: string | null = null;

    if (kind !== "repeat") {
      dictionaryCue = await resolveDictionaryCue();
      displayText =
        kind === "definition"
          ? dictionaryCue.definition
          : kind === "sentence"
            ? dictionaryCue.sentence
            : dictionaryCue.origin;
    } else {
      displayText = getPromptPreview(currentWord, kind);
    }

    if (settings.pronouncerEnabled) {
      pronouncerProvider = await playPronouncerText(
        getPromptSpeechText(currentWord, kind, dictionaryCue),
      );
    }

    setHintsUsed((previous) =>
      previous.includes(kind) ? previous : [...previous, kind],
    );
    setFeed((previous) => [
      createFeedEntry(
        kind === "repeat"
          ? `${promptLabels[kind]} · ${pronouncerProvider ?? "text only"}`
          : `${promptLabels[kind]} · ${dictionaryCue?.provider ?? "dictionary"}`,
        displayText,
        kind === "repeat" ? "system" : "hint",
      ),
      ...previous,
    ]);
  }

  function handleStartOver() {
    if (!sessionStarted || sessionComplete || status !== "idle") {
      return;
    }

    shouldJudgeSpeechOnEndRef.current = false;
    recognitionRef.current?.abort();
    setSpeechCaptureState(speechRecognitionSupported ? "idle" : "unsupported");
    setRestartCount((previous) => previous + 1);
    resetSpeechAttempt();
    setFeed((previous) => [
      createFeedEntry(
        "Start over",
        "Captured spelling reset. In official play, previously spoken letters cannot be reordered after a restart.",
        "system",
      ),
      ...previous,
    ]);
  }

  function renderNotebookEntry(entry: NotebookEntry) {
    const dueLabel =
      !entry.progress.dueOn || entry.progress.dueOn <= todayKey
        ? "due now"
        : `due ${entry.progress.dueOn}`;

    return (
      <article
        key={entry.word.id}
        className="rounded-[22px] border border-[color:var(--line)] bg-white/72 p-4"
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-[family:var(--font-display)] text-2xl text-[color:var(--foreground)]">
            {entry.word.word}
          </p>
          <span className="rounded-full bg-[color:var(--signal)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--signal)]">
            {dueLabel}
          </span>
        </div>
        <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
          {entry.word.coachingNote}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="badge">misses {entry.progress.wrongCount}</span>
          <span className="badge">
            review load {entry.progress.reviewCount}
          </span>
          <span className="badge">streak {entry.progress.currentStreak}</span>
        </div>
      </article>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel relative overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
          <div className="absolute inset-x-0 top-0 h-px bg-white/70" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">AISPB</p>
              <h1 className="display-copy mt-3 max-w-md text-4xl sm:text-5xl">
                Daily spelling drills with a real review loop behind them.
              </h1>
            </div>
            <div className="hidden rounded-full border border-[color:var(--line)] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--muted)] sm:block">
              Local MVP
            </div>
          </div>

          <p className="mt-5 max-w-xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            The app now generates a daily plan from a seeded word bank, keeps a
            browser-side notebook, routes dictionary requests through
            Merriam-Webster when configured, and can switch the pronouncer to
            Volcengine Doubao Speech TTS.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="stat-card">
              <span className="stat-label">Deck</span>
              <strong>{previewPlan.words.length} words</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Review</span>
              <strong>{previewPlan.stats.reviewCount}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Fresh</span>
              <strong>{previewPlan.stats.freshCount}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Notebook</span>
              <strong>{dueNotebookCount} due</strong>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-4">
            <div className="rounded-[28px] border border-[color:var(--line)] bg-white/72 p-4">
              <div className="flex items-center justify-between gap-3">
                <p className="eyebrow">Settings</p>
                <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
                  {voiceStatusLabel}
                </span>
              </div>

              <div className="mt-4">
                <p className="text-sm font-semibold text-[color:var(--foreground)]">
                  Daily goal
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {goalOptions.map((option) => (
                    <button
                      key={option}
                      className={`setting-chip ${settings.dailyGoal === option ? "setting-chip-active" : ""}`}
                      onClick={() => updateSettings({ dailyGoal: option })}
                      type="button"
                    >
                      {option} words
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4">
                <p className="text-sm font-semibold text-[color:var(--foreground)]">
                  Round timer
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {roundOptions.map((option) => (
                    <button
                      key={option}
                      className={`setting-chip ${settings.roundDurationSeconds === option ? "setting-chip-active" : ""}`}
                      onClick={() =>
                        updateSettings({ roundDurationSeconds: option })
                      }
                      type="button"
                    >
                      {option}s
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between gap-3 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-[color:var(--foreground)]">
                    Pronouncer audio
                  </p>
                  <p className="mt-1 text-xs leading-5 text-[color:var(--muted)]">
                    {pronouncerDetail}
                  </p>
                </div>
                <button
                  className={`setting-chip ${settings.pronouncerEnabled ? "setting-chip-active" : ""}`}
                  disabled={!pronouncerAvailable}
                  onClick={() =>
                    updateSettings({
                      pronouncerEnabled: !settings.pronouncerEnabled,
                    })
                  }
                  type="button"
                >
                  {settings.pronouncerEnabled ? "On" : "Off"}
                </button>
              </div>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                className="primary-button"
                onClick={beginSession}
                type="button"
              >
                Begin today&apos;s drill
              </button>
              <a className="secondary-button" href="#session">
                Jump to session
              </a>
            </div>
          </div>
        </div>

        <aside className="panel px-5 py-6 sm:px-6">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Adapters</p>
            <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
              {adapterBadge}
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {renderedProviderCards.map((provider) => (
              <article
                key={provider.id}
                className="rounded-[24px] border border-[color:var(--line)] bg-white/75 p-4 shadow-[0_10px_30px_rgba(17,32,51,0.06)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                    {provider.label}
                  </h2>
                  <span className="rounded-full bg-[color:var(--accent)]/12 px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-[color:var(--accent)]">
                    {provider.status}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                  {provider.detail}
                </p>
              </article>
            ))}
          </div>
        </aside>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]" id="session">
        <div className="panel px-5 py-6 sm:px-6 sm:py-7">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Session</p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--foreground)]">
                {sessionComplete
                  ? "Session complete"
                  : `Round ${Math.min(currentIndex + 1, Math.max(totalWords, 1))} of ${Math.max(totalWords, 1)}`}
              </h2>
            </div>
            <div
              aria-hidden="true"
              className="timer-shell"
              style={{
                background: `conic-gradient(var(--accent) ${timerDegrees}deg, rgba(255,255,255,0.32) ${timerDegrees}deg)`,
              }}
            >
              <div className="timer-core">
                <span className="timer-value">{secondsLeft}</span>
                <span className="timer-label">seconds</span>
              </div>
            </div>
          </div>

          <div className="mt-5 rounded-[28px] border border-[color:var(--line)] bg-[color:var(--ink)] px-5 py-5 text-[color:var(--paper)]">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm uppercase tracking-[0.22em] text-white/55">
                Pronouncer cue
              </p>
              <div className="flex flex-wrap gap-2">
                {lastPronouncerProvider ? (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                    {lastPronouncerProvider}
                  </span>
                ) : null}
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                  {currentWord?.category ?? "standby"}
                </span>
                {currentWord ? (
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                    {currentWord.planReason}
                  </span>
                ) : null}
              </div>
            </div>
            <p className="mt-4 font-[family:var(--font-display)] text-4xl leading-none sm:text-5xl">
              Word{" "}
              {String(
                Math.min(currentIndex + 1, Math.max(totalWords, 1)),
              ).padStart(2, "0")}
            </p>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/70">
              {currentWord
                ? `Current cue: ${currentWord.pronunciationNote}`
                : "Start a session to load the first word."}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {promptOrder.map((prompt) => (
              <button
                key={prompt}
                className="action-button"
                disabled={interactionLocked}
                onClick={() => {
                  void openPrompt(prompt);
                }}
                type="button"
              >
                {promptLabels[prompt]}
              </button>
            ))}
            <button
              className="action-button col-span-2 sm:col-span-5"
              disabled={!sessionStarted || sessionComplete || status !== "idle"}
              onClick={handleStartOver}
              type="button"
            >
              Start Over
            </button>
          </div>

          <div className="mt-5 rounded-[28px] border border-[color:var(--line)] bg-white/78 p-4 shadow-[0_18px_40px_rgba(17,32,51,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Spell Aloud</p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                  Say each letter distinctly, then tap stop so the app can judge
                  the attempt like an oral round.
                </p>
              </div>
              <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
                {speechStatusLabel}
              </span>
            </div>

            <div className="mt-4 rounded-[22px] border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Live transcript
              </p>
              <p className="mt-3 min-h-12 text-sm leading-6 text-[color:var(--foreground)]">
                {combinedSpeechTranscript ||
                  "No speech captured yet. Tap start and spell the letters aloud."}
              </p>
            </div>

            <div className="mt-3 rounded-[22px] border border-[color:var(--line)] bg-white/70 px-4 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                Locked letters
              </p>
              <p className="mt-3 font-[family:var(--font-display)] text-2xl leading-8 text-[color:var(--foreground)] sm:text-3xl">
                {formatSpellingCandidate(attemptDraft)}
              </p>
            </div>

            {speechError ? (
              <p className="mt-3 text-sm leading-6 text-[color:var(--signal)]">
                {speechError}
              </p>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                className="primary-button justify-center"
                disabled={
                  !sessionStarted ||
                  sessionComplete ||
                  status !== "idle" ||
                  speechCaptureState === "listening" ||
                  speechCaptureState === "processing"
                }
                onClick={startSpeechCapture}
                type="button"
              >
                Start speaking
              </button>
              <button
                className="secondary-button justify-center"
                disabled={speechCaptureState !== "listening"}
                onClick={stopSpeechCaptureAndJudge}
                type="button"
              >
                Stop and judge
              </button>
            </div>

            {shouldShowManualFallback ? (
              <div className="mt-4 rounded-[22px] border border-dashed border-[color:var(--line)] bg-white/60 p-4">
                <label className="eyebrow" htmlFor="manual-spelling-fallback">
                  Manual Fallback
                </label>
                <input
                  className="mt-3 w-full rounded-[20px] border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-3 text-base text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent)]/12"
                  id="manual-spelling-fallback"
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setManualFallbackValue(nextValue);
                    setAttemptDraft(
                      normalizeSpokenSpellingAttempt(nextValue).candidate,
                    );
                  }}
                  placeholder="temporary fallback if mic recognition is unavailable"
                  spellCheck={false}
                  type="text"
                  value={manualFallbackValue}
                />
                <button
                  className="secondary-button mt-3 justify-center"
                  disabled={
                    !sessionStarted ||
                    sessionComplete ||
                    status !== "idle" ||
                    !manualFallbackValue.trim()
                  }
                  onClick={() => {
                    void submitAttempt(manualFallbackValue);
                  }}
                  type="button"
                >
                  Judge fallback attempt
                </button>
              </div>
            ) : null}

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-[color:var(--muted)]">
                {statusCopy[status]}
              </p>
              <p className="text-xs leading-5 text-[color:var(--muted)]">
                Say “start over” or tap the reset button to clear the capture.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="panel px-5 py-6 sm:px-6">
            <div className="flex items-center justify-between">
              <p className="eyebrow">Momentum</p>
              <span className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs font-semibold text-[color:var(--muted)]">
                {sessionAccuracy}% accuracy
              </span>
            </div>

            <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white/55">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#0D7C66,#E0B36A)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="stat-card">
                <span className="stat-label">Streak</span>
                <strong>{streak}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Best</span>
                <strong>{bestStreak}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Restarts</span>
                <strong>{restartCount}</strong>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="badge">correct {sessionCorrectCount}</span>
              <span className="badge">misses {sessionMissCount}</span>
              <span className="badge">
                {plan.settings.roundDurationSeconds}s rounds
              </span>
              {hintsUsed.length === 0 ? (
                <span className="badge">No prompts used</span>
              ) : (
                hintsUsed.map((hint) => (
                  <span key={hint} className="badge">
                    {promptLabels[hint]}
                  </span>
                ))
              )}
            </div>
          </div>

          <div className="panel px-5 py-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Feed</p>
                <h3 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
                  Bee-style dialogue log
                </h3>
              </div>
              <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-[color:var(--muted)]">
                newest first
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {feed.map((entry) => (
                <article
                  key={entry.id}
                  className={`rounded-[22px] border p-4 ${feedToneClass[entry.tone]}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    {entry.label}
                  </p>
                  <p className="mt-2 text-sm leading-6">{entry.content}</p>
                </article>
              ))}
            </div>
          </div>

          <div className="panel px-5 py-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="eyebrow">Notebook</p>
                <h3 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
                  Persistent review queue
                </h3>
              </div>
              <span className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs font-semibold text-[color:var(--muted)]">
                {notebookEntries.length} tracked
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {notebookEntries.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[color:var(--line)] bg-white/45 p-4 text-sm leading-6 text-[color:var(--muted)]">
                  No notebook words yet. Misses and timeouts persist locally and
                  return in future daily plans.
                </div>
              ) : (
                notebookEntries.slice(0, 5).map(renderNotebookEntry)
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
