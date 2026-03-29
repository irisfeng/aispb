"use client";

import {
  startTransition,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
} from "react";

import { localCoachAdapter, providerCards } from "@/lib/local-adapters";
import { playEarcon } from "@/lib/earcons";
import {
  buildPronouncerAgentReply,
  classifyPronouncerAgentIntent,
  maskWordInVisibleText,
} from "@/lib/pronouncer-agent";
import type {
  DictionaryCuePayload,
  PronouncerStatusPayload,
  VoiceTurnResultPayload,
  VoiceTurnStatusPayload,
} from "@/lib/provider-client";
import {
  fetchDictionaryCue,
  fetchPronouncerAudio,
  fetchPronouncerStatus,
  fetchVoiceTurnStatus,
  interpretVoiceTurnAudio,
  interpretVoiceTurnTranscript,
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
import { judgeSpellingAttempt } from "@/lib/spelling-judge";
import {
  loadSettingsFromKv,
  loadProgressFromKv,
  saveSettingsToKv,
  saveProgressToKv,
} from "@/lib/kv-sync";
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
type VoiceCaptureMode = "talk" | null;

interface SessionMissEntry {
  word: import("@/lib/types").DrillWord;
  attempt: string;
  cue: DictionaryCuePayload | null;
}

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

const goalOptions = [50, 80, 100, 150, 200];
const roundOptions = [60, 90];
const suggestedPromptOrder: DrillPromptKind[] = [
  "repeat",
  "definition",
  "sentence",
  "origin",
];
const promptLabels: Record<DrillPromptKind, string> = {
  repeat: "Repeat",
  definition: "Definition",
  "part-of-speech": "Part of Speech",
  sentence: "Sentence",
  origin: "Origin",
  "all-info": "All Info",
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

function getSpeechRecognitionConstructor() {
  if (typeof window === "undefined") {
    return null;
  }

  return (window.SpeechRecognition ??
    window.webkitSpeechRecognition ??
    null) as BrowserSpeechRecognitionConstructor | null;
}

function getRecordingMimeType() {
  if (
    typeof window === "undefined" ||
    typeof MediaRecorder === "undefined" ||
    typeof MediaRecorder.isTypeSupported !== "function"
  ) {
    return "";
  }

  const candidates = [
    "audio/webm;codecs=opus",
    "audio/mp4",
    "audio/webm",
    "audio/ogg;codecs=opus",
  ];

  return (
    candidates.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ||
    ""
  );
}

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

export function AispbApp() {
  const [storageReady, setStorageReady] = useState(false);
  const kvLoadedRef = useRef(false);
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
  const [manualUtteranceValue, setManualUtteranceValue] = useState("");
  const [speechCaptureState, setSpeechCaptureState] =
    useState<SpeechCaptureState>("unsupported");
  const [voiceCaptureMode, setVoiceCaptureMode] =
    useState<VoiceCaptureMode>(null);
  const [, setSpeechTranscript] = useState("");
  const [spellingTranscript, setSpellingTranscript] = useState("");
  const [speechError, setSpeechError] = useState<string | null>(null);
  const [status, setStatus] = useState<SubmissionState>("idle");
  const [hintsUsed, setHintsUsed] = useState<DrillPromptKind[]>([]);
  const [restartCount, setRestartCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [sessionCorrectCount, setSessionCorrectCount] = useState(0);
  const [sessionMissCount, setSessionMissCount] = useState(0);
  const [sessionMisses, setSessionMisses] = useState<SessionMissEntry[]>([]);
  const [expandedNotebookWords, setExpandedNotebookWords] = useState<
    Set<string>
  >(new Set());
  const [notebookFilter, setNotebookFilter] = useState<
    "all" | "due" | "mastered" | "weak"
  >("all");
  const [browserSpeechReady, setBrowserSpeechReady] = useState(false);
  const [pronouncerStatus, setPronouncerStatus] =
    useState<PronouncerStatusPayload | null>(null);
  const [voiceTurnStatus, setVoiceTurnStatus] =
    useState<VoiceTurnStatusPayload | null>(null);
  const [lastPronouncerProvider, setLastPronouncerProvider] = useState<
    string | null
  >(null);
  const [dictionaryCache, setDictionaryCache] = useState<
    Record<string, DictionaryCuePayload>
  >({});
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const speechIdleTimerRef = useRef<number | null>(null);
  const voiceCaptureModeRef = useRef<VoiceCaptureMode>(null);
  const shouldJudgeSpeechOnEndRef = useRef(false);
  const roundLockedRef = useRef(false);
  const recognitionHadErrorRef = useRef(false);
  const latestSpeechTranscriptRef = useRef("");
  const latestSpeechInterimTranscriptRef = useRef("");
  const roundIdRef = useRef(0);
  const suppressRecorderOnStopRef = useRef(false);
  const [feed, setFeed] = useState<FeedEntry[]>([
    {
      id: "feed-initial",
      label: "Warmup",
      content:
        "The drill engine is ready. Start a session to generate today's deck and pull in the active pronouncer path.",
      tone: "system",
    },
  ]);
  const [feedExpanded, setFeedExpanded] = useState(false);
  const [notebookPageSize, setNotebookPageSize] = useState(10);

  const todayKey = getTodayKey();
  const previewPlan = useMemo(
    () => createPreviewPlan(settings, progress),
    [settings, progress],
  );
  const plan = activePlan ?? previewPlan;
  const sessionWords = plan.words;
  const totalWords = sessionWords.length;
  const currentWord = sessionWords[currentIndex] ?? sessionWords[0];
  const notebookEntries = useMemo(
    () =>
      getNotebookEntries({
        words: wordBank,
        progress,
        todayKey,
      }),
    [progress, todayKey],
  );
  const currentDictionaryCue = currentWord
    ? dictionaryCache[currentWord.id]
    : null;
  const hasExternalPronouncer = pronouncerStatus?.configured ?? false;
  const pronouncerAvailable = hasExternalPronouncer || browserSpeechReady;
  const cloudVoiceTurnAvailable = voiceTurnStatus?.configured ?? false;
  const browserRecordingSupported =
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia);
  const speechRecognitionSupported =
    (cloudVoiceTurnAvailable && browserRecordingSupported) ||
    Boolean(getSpeechRecognitionConstructor());
  const dueNotebookCount = notebookEntries.filter(
    (entry) => !entry.progress.dueOn || entry.progress.dueOn <= todayKey,
  ).length;
  const filteredNotebookEntries = notebookEntries.filter((entry) => {
    const p = entry.progress;
    if (notebookFilter === "due")
      return !p.dueOn || p.dueOn <= todayKey;
    if (notebookFilter === "mastered") return p.currentStreak >= 4;
    if (notebookFilter === "weak") return p.wrongCount > p.correctCount;
    return true;
  });
  const isVoiceBusy =
    speechCaptureState === "listening" || speechCaptureState === "processing";
  const interactionLocked =
    !sessionStarted || sessionComplete || status !== "idle" || isVoiceBusy;
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
  const voiceStatusLabel = cloudVoiceTurnAvailable
    ? "cloud voice ready"
    : hasExternalPronouncer
      ? "browser mic + volc"
      : browserSpeechReady
        ? "browser fallback"
        : "voice unavailable";
  const talkActionLabel =
    speechCaptureState === "listening" && voiceCaptureMode === "talk"
      ? "Listening... tap to finish"
      : "Talk";
  const talkActionDisabled =
    !sessionStarted ||
    sessionComplete ||
    status !== "idle" ||
    (isVoiceBusy &&
      !(speechCaptureState === "listening" && voiceCaptureMode === "talk"));
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
  const recentFeed = feed.slice(0, 3);
  const safeSpellingTranscript =
    currentWord && status === "idle"
      ? maskWordInVisibleText(spellingTranscript, currentWord)
      : spellingTranscript;

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

  function clearSpeechIdleTimer() {
    if (speechIdleTimerRef.current) {
      window.clearTimeout(speechIdleTimerRef.current);
      speechIdleTimerRef.current = null;
    }
  }

  function stopMediaCaptureTracks() {
    mediaStreamRef.current?.getTracks().forEach((track) => {
      track.stop();
    });
    mediaStreamRef.current = null;
  }

  function resetSpeechAttempt(
    options: {
      clearAttemptDraft?: boolean;
      clearManualUtterance?: boolean;
    } = {},
  ) {
    const { clearAttemptDraft = true, clearManualUtterance = true } = options;

    shouldJudgeSpeechOnEndRef.current = false;
    recognitionHadErrorRef.current = false;
    clearSpeechIdleTimer();
    voiceCaptureModeRef.current = null;
    setVoiceCaptureMode(null);
    latestSpeechTranscriptRef.current = "";
    latestSpeechInterimTranscriptRef.current = "";
    setSpeechTranscript("");
    setSpeechError(null);

    if (clearAttemptDraft) {
      setAttemptDraft("");
    }

    if (clearManualUtterance) {
      setManualUtteranceValue("");
    }
  }

  function createRoundSafeContent(content: string) {
    if (!currentWord) {
      return content;
    }

    return maskWordInVisibleText(content, currentWord);
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

  async function playRoundFeedback(
    kind: "correct" | "incorrect" | "timeout" | "reset",
  ) {
    stopActiveAudio();
    await playEarcon(kind);

    function pick(variants: string[]): string {
      return variants[Math.floor(Math.random() * variants.length)];
    }

    const speechText =
      kind === "correct"
        ? pick(["That is correct.", "Correct.", "That's right.", "Yes, that is correct."])
        : kind === "incorrect"
          ? pick(["That is incorrect.", "I'm sorry, that is incorrect.", "Not quite."])
          : kind === "timeout"
            ? pick(["Time is up.", "That's time.", "Time."])
            : pick(["Starting over.", "Let's start over."]);

    await playPronouncerText(speechText);
  }

  const autoplayCurrentWord = useEffectEvent((nextWord: string) => {
    void playPronouncerText(nextWord);
  });

  function interpretVoiceTurnLocally(
    transcript: string,
  ): VoiceTurnResultPayload {
    const normalizedAttempt = normalizeSpokenSpellingAttempt(transcript, {
      allowWholeWordFallback: true,
    });
    const intent = classifyPronouncerAgentIntent(transcript);

    if (normalizedAttempt.command === "start-over") {
      return {
        confidence: "high",
        intent: "start-over",
        normalizedLetters: "",
        provider: "Local browser router",
        transcript,
        usedCloud: false,
      };
    }

    if (
      intent.kind !== "unknown" &&
      intent.kind !== "disallowed" &&
      intent.kind !== "ready-to-spell"
    ) {
      return {
        confidence: "medium",
        intent: intent.kind,
        normalizedLetters: "",
        provider: "Local browser router",
        transcript,
        usedCloud: false,
      };
    }

    if (intent.kind === "disallowed" || intent.kind === "ready-to-spell") {
      return {
        confidence: "medium",
        intent: intent.kind,
        normalizedLetters: "",
        provider: "Local browser router",
        transcript,
        usedCloud: false,
      };
    }

    if (normalizedAttempt.candidate && normalizedAttempt.looksLikeSpelling) {
      return {
        confidence: "medium",
        intent: "spelling",
        normalizedLetters: normalizedAttempt.candidate,
        provider: "Local browser router",
        transcript,
        usedCloud: false,
      };
    }

    return {
      confidence: "low",
      intent: "clarify",
      normalizedLetters: "",
      provider: "Local browser router",
      transcript,
      usedCloud: false,
    };
  }

  async function submitSpellingCandidate(candidate: string) {
    if (!currentWord || !sessionStarted || sessionComplete) {
      return;
    }

    const normalizedCandidate = candidate.trim().toLowerCase();

    if (!normalizedCandidate) {
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

    const judgement = judgeSpellingAttempt(currentWord, normalizedCandidate);
    roundLockedRef.current = true;

    if (judgement.isCorrect) {
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
          `${formatSpellingCandidate(normalizedCandidate)} locked in cleanly. ${currentWord.coachingNote ?? ""}`,
          "success",
        ),
        ...previous,
      ]);
      void playRoundFeedback("correct");

      window.setTimeout(() => {
        advanceWord();
      }, 1650);
      return;
    }

    await registerMiss("incorrect", normalizedCandidate);
  }

  async function handleVoiceTurnResult(result: VoiceTurnResultPayload) {
    if (roundLockedRef.current) return;

    const capturedRoundId = roundIdRef.current;
    const transcript = result.transcript.trim();



    const roundStillActive = () =>
      !roundLockedRef.current && roundIdRef.current === capturedRoundId;

    if (!transcript) {
      setSpeechError("No clear speech was captured.");
      setFeed((previous) => [
        createFeedEntry(
          "Mic retry",
          "No clear speech was captured. Ask a Bee-style question or spell the letters more distinctly.",
          "danger",
        ),
        ...previous,
      ]);
      return;
    }

    if (result.intent === "start-over") {
      handleStartOver();
      return;
    }

    if (result.intent === "spelling") {
      if (!result.normalizedLetters) {
        setSpeechError("No recognizable letters were captured.");
        setFeed((previous) => [
          createFeedEntry(
            "Mic retry",
            "The utterance sounded like spelling, but the letters were not clear enough to grade. Please spell again.",
            "danger",
          ),
          ...previous,
        ]);
        return;
      }

      if (!roundStillActive()) return;

      setSpeechError(null);
      setSpellingTranscript(transcript);
      setAttemptDraft(result.normalizedLetters);
      await submitSpellingCandidate(result.normalizedLetters);
      return;
    }

    if (
      result.intent === "repeat" ||
      result.intent === "definition" ||
      result.intent === "sentence" ||
      result.intent === "origin" ||
      result.intent === "part-of-speech" ||
      result.intent === "all-info" ||
      result.intent === "ready-to-spell" ||
      result.intent === "disallowed"
    ) {
      if (!roundStillActive()) return;

      await handlePronouncerDialogue(transcript, result.intent);
      return;
    }

    setSpeechError(
      "I heard you, but it was not clearly a Bee request or a spelling attempt. Try a direct prompt or spell the letters more distinctly.",
    );
    setFeed((previous) => [
      createFeedEntry(
        "Ambiguous",
        "That utterance was ambiguous. Ask for definition, sentence, origin, or repeat, or spell the letters one by one.",
        "danger",
      ),
      ...previous,
    ]);
  }

  async function handleUnifiedUtterance(rawTranscript: string) {
    const trimmedTranscript = rawTranscript.trim();

    if (!trimmedTranscript) {
      setSpeechError("No clear speech was captured.");
      return;
    }

    try {
      const result = await interpretVoiceTurnTranscript(trimmedTranscript);

      await handleVoiceTurnResult(result);
      return;
    } catch (error) {
      console.error("voice turn transcript fallback", error);
    }

    await handleVoiceTurnResult(interpretVoiceTurnLocally(trimmedTranscript));
  }

  async function handleCapturedAudio(audio: Blob) {
    try {
      const result = await interpretVoiceTurnAudio(audio);

      await handleVoiceTurnResult(result);
      return;
    } catch (error) {
      console.error("voice turn audio route", error);
      setSpeechError(
        "Cloud voice routing could not process that recording. Try again or use the text fallback below.",
      );
      setFeed((previous) => [
        createFeedEntry(
          "Voice retry",
          "The cloud voice route could not process that recording, so the round stayed open.",
          "danger",
        ),
        ...previous,
      ]);
    }
  }

  async function startCloudSpeechCapture(mode: VoiceCaptureMode) {
    if (!browserRecordingSupported) {
      setSpeechCaptureState("error");
      setSpeechError(
        "This browser cannot stream microphone audio to the server yet. Use the text fallback for now.",
      );
      return;
    }

    stopActiveAudio();
    resetSpeechAttempt({
      clearAttemptDraft: true,
      clearManualUtterance: false,
    });
    voiceCaptureModeRef.current = mode;
    setVoiceCaptureMode(mode);
    setSpeechCaptureState("processing");
    setSpeechError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: true,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      const recordingMimeType = getRecordingMimeType();
      const recorder = recordingMimeType
        ? new MediaRecorder(stream, { mimeType: recordingMimeType })
        : new MediaRecorder(stream);

      mediaStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      mediaChunksRef.current = [];

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          mediaChunksRef.current.push(event.data);
        }
      };
      recorder.onerror = () => {
        stopMediaCaptureTracks();
        mediaRecorderRef.current = null;
        setSpeechCaptureState("error");
        setSpeechError("Microphone capture failed.");
      };
      recorder.onstop = () => {
        if (suppressRecorderOnStopRef.current) {
          suppressRecorderOnStopRef.current = false;
          stopMediaCaptureTracks();
          mediaRecorderRef.current = null;
          mediaChunksRef.current = [];
          return;
        }

        const mimeType = recorder.mimeType || recordingMimeType || "audio/webm";
        const audio = new Blob(mediaChunksRef.current, {
          type: mimeType,
        });

        stopMediaCaptureTracks();
        mediaRecorderRef.current = null;
        mediaChunksRef.current = [];

        if (!audio.size) {
          setSpeechCaptureState("error");
          setSpeechError("No microphone audio was captured.");
          return;
        }

        setSpeechCaptureState("processing");
        void handleCapturedAudio(audio).finally(() => {
          voiceCaptureModeRef.current = null;
          setVoiceCaptureMode(null);
          setSpeechCaptureState("idle");
        });
      };

      recorder.start();
      setSpeechCaptureState("listening");
    } catch (error) {
      console.error("cloud speech capture start", error);
      stopMediaCaptureTracks();
      mediaRecorderRef.current = null;
      setSpeechCaptureState("error");
      setSpeechError("Microphone access was blocked or failed to start.");
    }
  }

  function startBrowserSpeechCapture(mode: VoiceCaptureMode) {
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
        clearSpeechIdleTimer();
        setSpeechCaptureState("listening");
        setSpeechError(null);
      };
      nextRecognition.onresult = (event) => {
        if (roundLockedRef.current) return;

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
          const combinedTranscript = [nextTranscript, interimChunks.join(" ")]
            .filter(Boolean)
            .join(" ")
            .trim();

          const normalized = normalizeSpokenSpellingAttempt(combinedTranscript);
          setAttemptDraft(normalized.candidate);

          clearSpeechIdleTimer();
          speechIdleTimerRef.current = window.setTimeout(() => {
            if (
              recognitionRef.current &&
              voiceCaptureModeRef.current &&
              !recognitionHadErrorRef.current
            ) {
              shouldJudgeSpeechOnEndRef.current = true;
              setSpeechCaptureState("processing");
              recognitionRef.current.stop();
            }
          }, 1200);

          return nextTranscript;
        });
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
          clearSpeechIdleTimer();
          setSpeechCaptureState("processing");
          void handleUnifiedUtterance(transcriptToJudge).finally(() => {
            voiceCaptureModeRef.current = null;
            setVoiceCaptureMode(null);
            setSpeechCaptureState("idle");
          });
          return;
        }

        if (recognitionHadErrorRef.current) {
          return;
        }

        clearSpeechIdleTimer();
        voiceCaptureModeRef.current = null;
        setVoiceCaptureMode(null);
        setSpeechCaptureState("idle");
      };

      recognitionRef.current = nextRecognition;
    }

    stopActiveAudio();
    resetSpeechAttempt({
      clearAttemptDraft: true,
      clearManualUtterance: false,
    });
    voiceCaptureModeRef.current = mode;
    setVoiceCaptureMode(mode);

    try {
      recognitionRef.current.start();
    } catch (error) {
      console.error("speech recognition start", error);
      setSpeechCaptureState("error");
      setSpeechError("Speech recognition failed to start.");
    }
  }

  function startSpeechCapture(mode: VoiceCaptureMode) {
    if (!sessionStarted || sessionComplete || status !== "idle") {
      return;
    }

    if (cloudVoiceTurnAvailable && browserRecordingSupported) {
      void startCloudSpeechCapture(mode);
      return;
    }

    startBrowserSpeechCapture(mode);
  }

  function stopSpeechCaptureAndHandle() {
    if (mediaRecorderRef.current?.state === "recording") {
      setSpeechCaptureState("processing");
      mediaRecorderRef.current.stop();
      return;
    }

    if (!recognitionRef.current || speechCaptureState !== "listening") {
      return;
    }

    shouldJudgeSpeechOnEndRef.current = true;
    clearSpeechIdleTimer();
    setSpeechCaptureState("processing");
    recognitionRef.current.stop();
  }

  function handleVoiceAction() {
    if (speechCaptureState === "listening" && voiceCaptureMode === "talk") {
      stopSpeechCaptureAndHandle();
      return;
    }

    if (isVoiceBusy) {
      return;
    }

    startSpeechCapture("talk");
  }

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      // Load from localStorage immediately for fast startup
      const localSettings = loadSettings();
      const localProgress = loadProgress();
      const canRecordAudio =
        typeof window !== "undefined" &&
        typeof MediaRecorder !== "undefined" &&
        Boolean(navigator.mediaDevices?.getUserMedia);

      setSettings(localSettings);
      setProgress(localProgress);
      setSecondsLeft(localSettings.roundDurationSeconds);
      setBrowserSpeechReady(
        typeof window !== "undefined" && "speechSynthesis" in window,
      );
      setStorageReady(true);

      // Then try KV — if available, overwrite with server data.
      // The kvLoadedRef guard prevents the save effects from writing
      // stale/empty local data back to KV before the cloud data arrives.
      void Promise.all([loadSettingsFromKv(), loadProgressFromKv()])
        .then(([kvSettings, kvProgress]) => {
          if (kvSettings) {
            setSettings(kvSettings);
            saveSettings(kvSettings); // sync back to localStorage
          }
          if (kvProgress) {
            setProgress(kvProgress);
            saveProgress(kvProgress); // sync back to localStorage
          }
        })
        .catch(() => {
          // KV unavailable — localStorage is fine
        })
        .finally(() => {
          kvLoadedRef.current = true;
        });

      void fetchPronouncerStatus()
        .then((nextStatus) => {
          setPronouncerStatus(nextStatus);
        })
        .catch((error) => {
          console.error("pronouncer status fallback", error);
        });
      void fetchVoiceTurnStatus()
        .then((nextStatus) => {
          setVoiceTurnStatus(nextStatus);
          setSpeechCaptureState(
            (nextStatus.configured && canRecordAudio) ||
              getSpeechRecognitionConstructor()
              ? "idle"
              : "unsupported",
          );
        })
        .catch((error) => {
          console.error("voice turn status fallback", error);
          setSpeechCaptureState(
            getSpeechRecognitionConstructor() ? "idle" : "unsupported",
          );
        });
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
      stopActiveAudio();
      clearSpeechIdleTimer();
      if (mediaRecorderRef.current?.state === "recording") {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
      stopMediaCaptureTracks();
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

    // Only write to KV after the initial KV load completes to avoid
    // overwriting cloud data with stale/empty local data.
    if (kvLoadedRef.current) {
      void saveSettingsToKv(settings);
    }
  }, [settings, storageReady]);

  useEffect(() => {
    if (!storageReady) {
      return;
    }

    saveProgress(progress);

    if (kvLoadedRef.current) {
      void saveProgressToKv(progress);
    }
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
    roundLockedRef.current = false;
    roundIdRef.current += 1;

    const nextPlan = createPreviewPlan(settings, progress);

    setActivePlan(nextPlan);
    setSessionStarted(true);
    setSessionComplete(false);
    setCurrentIndex(0);
    setSecondsLeft(nextPlan.settings.roundDurationSeconds);
    resetSpeechAttempt();
    setSpellingTranscript("");
    setStatus("idle");
    setHintsUsed([]);
    setRestartCount(0);
    setStreak(0);
    setBestStreak(0);
    setSessionCorrectCount(0);
    setSessionMissCount(0);
    setSessionMisses([]);
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
      roundLockedRef.current = false;
      roundIdRef.current += 1;

      if (!activePlan) {
        return;
      }

      if (currentIndex === activePlan.words.length - 1) {
        setSessionComplete(true);
        setSessionStarted(false);
        setFeedExpanded(false);
        setNotebookPageSize(10);

        // Auto-scroll to results after render
        requestAnimationFrame(() => {
          document
            .getElementById("session")
            ?.scrollIntoView({ behavior: "smooth", block: "start" });
        });

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
      setSpellingTranscript("");
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

    roundLockedRef.current = true;
    shouldJudgeSpeechOnEndRef.current = false;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    stopMediaCaptureTracks();
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
    // Fetch dictionary cue for the reveal card (use cache if available)
    let missCue: DictionaryCuePayload | null =
      dictionaryCache[currentWord.id] ?? null;
    if (!missCue) {
      try {
        missCue = await fetchDictionaryCue(currentWord);
        if (missCue) {
          setDictionaryCache((prev) => ({
            ...prev,
            [currentWord.id]: missCue!,
          }));
        }
      } catch {
        // proceed without cue
      }
    }

    setSessionMisses((previous) => [
      ...previous,
      { word: currentWord, attempt, cue: missCue },
    ]);
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
    void playRoundFeedback(result === "timeout" ? "timeout" : "incorrect");

    // No auto-advance — user taps "Next word" after reviewing the reveal card
  }

  const tick = useEffectEvent(() => {
    // Don't tick while the reveal card is showing (miss or correct)
    if (roundLockedRef.current) return;

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

  async function deliverPronouncerIntent(
    intentKind: ReturnType<typeof classifyPronouncerAgentIntent>["kind"],
  ) {
    if (!currentWord || !sessionStarted || sessionComplete) {
      return;
    }

    const shouldResolveDictionaryCue =
      intentKind === "definition" ||
      intentKind === "sentence" ||
      intentKind === "origin" ||
      intentKind === "part-of-speech" ||
      intentKind === "all-info";
    let dictionaryCue: DictionaryCuePayload | null = null;

    if (shouldResolveDictionaryCue) {
      try {
        dictionaryCue = await resolveDictionaryCue();
      } catch (error) {
        console.error("dictionary cue resolution failed", error);
      }
    }
    const reply = buildPronouncerAgentReply({
      intent: {
        kind: intentKind,
        transcript: intentKind,
      },
      word: currentWord,
      cue: dictionaryCue,
    });
    let pronouncerProvider: string | null = null;

    if (settings.pronouncerEnabled && reply.speechText) {
      pronouncerProvider = await playPronouncerText(reply.speechText);
    }

    const promptKind = reply.promptKind;

    if (promptKind) {
      setHintsUsed((previous) =>
        previous.includes(promptKind) ? previous : [...previous, promptKind],
      );
    }

    setFeed((previous) => [
      createFeedEntry(
        pronouncerProvider
          ? `${reply.label} · ${pronouncerProvider}`
          : reply.label,
        createRoundSafeContent(reply.displayText),
        reply.tone,
      ),
      ...previous,
    ]);
  }

  async function requestPronouncerPrompt(kind: DrillPromptKind) {
    setFeed((previous) => [
      createFeedEntry("You asked", promptLabels[kind], "system"),
      ...previous,
    ]);
    await deliverPronouncerIntent(kind);
  }

  async function handlePronouncerDialogue(
    rawTranscript: string,
    forcedIntent?: ReturnType<typeof classifyPronouncerAgentIntent>["kind"],
  ) {
    if (!currentWord || !sessionStarted || sessionComplete) {
      return;
    }

    const trimmedTranscript = rawTranscript.trim();

    if (!trimmedTranscript) {
      setSpeechError("No clear prompt request was captured.");
      setFeed((previous) => [
        createFeedEntry(
          "Pronouncer",
          "No clear request was captured. Ask for a repeat, definition, sentence, part of speech, or origin.",
          "danger",
        ),
        ...previous,
      ]);
      return;
    }

    const intentKind =
      forcedIntent ?? classifyPronouncerAgentIntent(trimmedTranscript).kind;

    setFeed((previous) => [
      createFeedEntry("You asked", createRoundSafeContent(trimmedTranscript), "system"),
      ...previous,
    ]);

    await deliverPronouncerIntent(intentKind);
  }

  function handleStartOver() {
    if (!sessionStarted || sessionComplete || status !== "idle") {
      return;
    }

    shouldJudgeSpeechOnEndRef.current = false;
    suppressRecorderOnStopRef.current = true;
    if (mediaRecorderRef.current?.state === "recording") {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    stopMediaCaptureTracks();
    recognitionRef.current?.abort();
    setSpeechCaptureState(speechRecognitionSupported ? "idle" : "unsupported");
    setRestartCount((previous) => previous + 1);
    resetSpeechAttempt();
    setSpellingTranscript("");
    void playRoundFeedback("reset");
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
    const p = entry.progress;
    const acc = p.seenCount > 0 ? Math.round((p.correctCount / p.seenCount) * 100) : 0;
    const dueLabel =
      !p.dueOn || p.dueOn <= todayKey
        ? "due now"
        : `due ${p.dueOn}`;
    const isExpanded = expandedNotebookWords.has(entry.word.id);
    const cachedCue = dictionaryCache[entry.word.id];
    const def = cachedCue?.definition || entry.word.definition;
    const sent = cachedCue?.sentence || entry.word.sentence;
    const orig = cachedCue?.origin || entry.word.origin;
    const hasDetails = Boolean(def || sent || orig);

    return (
      <article
        key={entry.word.id}
        className={`rounded-[22px] border border-[color:var(--line)] bg-white/72 p-4 ${hasDetails ? "cursor-pointer" : ""}`}
        onClick={
          hasDetails
            ? () =>
                setExpandedNotebookWords((prev) => {
                  const next = new Set(prev);
                  if (next.has(entry.word.id)) next.delete(entry.word.id);
                  else next.add(entry.word.id);
                  return next;
                })
            : undefined
        }
      >
        <div className="flex items-center justify-between gap-3">
          <p className="font-[family:var(--font-display)] text-2xl text-[color:var(--foreground)]">
            {entry.word.word}
          </p>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-[color:var(--accent-soft)]/60 px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
              {acc}%
            </span>
            <span className="rounded-full bg-[color:var(--signal)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--signal)]">
              {dueLabel}
            </span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="badge">{p.correctCount}/{p.seenCount} correct</span>
          <span className="badge">streak {p.currentStreak}</span>
          {hasDetails ? (
            <span className="badge">{isExpanded ? "tap to collapse" : "tap for details"}</span>
          ) : null}
        </div>
        {isExpanded ? (
          <div className="mt-3 space-y-1.5 border-t border-[color:var(--line)]/40 pt-3">
            {def ? (
              <p className="text-sm leading-6 text-[color:var(--foreground)]">
                <span className="font-semibold">Definition: </span>
                {def}
              </p>
            ) : null}
            {sent ? (
              <p className="text-sm leading-6 text-[color:var(--foreground)]">
                <span className="font-semibold">Sentence: </span>
                {sent}
              </p>
            ) : null}
            {orig ? (
              <p className="text-sm leading-6 text-[color:var(--foreground)]">
                <span className="font-semibold">Origin: </span>
                {orig}
              </p>
            ) : null}
          </div>
        ) : null}
      </article>
    );
  }

  if (sessionStarted && !sessionComplete && currentWord) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-4 px-4 py-5 sm:px-6 sm:py-8">
        <section className="panel relative overflow-hidden px-5 py-6 sm:px-7 sm:py-7">
          <div className="absolute inset-x-0 top-0 h-px bg-white/70" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">AISPB</p>
              <h1 className="mt-3 font-[family:var(--font-display)] text-3xl leading-none text-[color:var(--foreground)] sm:text-4xl">
                Round {currentIndex + 1}
              </h1>
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
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                  {lastPronouncerProvider ?? "ready"}
                </span>
                <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                  {currentWord.category ?? ""}
                </span>
              </div>
            </div>
            <p className="mt-4 font-[family:var(--font-display)] text-5xl leading-none">
              Word {String(currentIndex + 1).padStart(2, "0")}
            </p>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/70">
              {currentWord.pronunciationNote ?? ""}
            </p>
          </div>

          <div className="mt-5 rounded-[28px] border border-[color:var(--line)] bg-white/78 p-4 shadow-[0_18px_40px_rgba(17,32,51,0.08)]">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="eyebrow">Live Round</p>
                <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                  Use Talk for both Bee-style questions and oral spelling. The
                  router decides whether you asked for a clue or started
                  spelling.
                </p>
              </div>
              <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
                {voiceStatusLabel}
              </span>
            </div>

            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <button
                className="primary-button flex-1 justify-center"
                disabled={talkActionDisabled}
                onClick={() => {
                  handleVoiceAction();
                }}
                type="button"
              >
                {talkActionLabel}
              </button>
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              {suggestedPromptOrder.map((prompt) => (
                <button
                  key={prompt}
                  className="action-button min-h-10 rounded-full px-4 py-2"
                  disabled={interactionLocked}
                  onClick={() => {
                    void requestPronouncerPrompt(prompt);
                  }}
                  type="button"
                >
                  {promptLabels[prompt]}
                </button>
              ))}
              <button
                className="action-button min-h-10 rounded-full px-4 py-2"
                disabled={
                  !sessionStarted || sessionComplete || status !== "idle"
                }
                onClick={handleStartOver}
                type="button"
              >
                Start Over
              </button>
            </div>

            <div className="mt-4 grid gap-3">
              <article className="rounded-[22px] border border-[color:var(--line)] bg-white/70 px-4 py-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                    Spelling
                  </p>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold text-[color:var(--muted)]">
                    auto route
                  </span>
                </div>
                <p className="mt-3 text-sm leading-6 text-[color:var(--foreground)]">
                  {safeSpellingTranscript ||
                    "If you spell letters aloud, they will lock below automatically."}
                </p>
                <p className="mt-3 font-[family:var(--font-display)] text-2xl leading-8 text-[color:var(--foreground)] sm:text-3xl">
                  {formatSpellingCandidate(attemptDraft)}
                </p>
              </article>
            </div>

            {status !== "idle" ? (
              <div className="mt-4 rounded-[22px] border border-[color:var(--line)] bg-[color:var(--accent-soft)]/70 px-4 py-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[color:var(--muted)]">
                  Reveal
                </p>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="font-[family:var(--font-display)] text-3xl leading-none text-[color:var(--foreground)]">
                    {currentWord.word}
                  </p>
                  <span className="rounded-full bg-white/80 px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
                    {status === "correct"
                      ? "correct"
                      : status === "timeout"
                        ? "timed out"
                        : "miss"}
                  </span>
                </div>

                {status !== "correct" && (() => {
                  const cue = currentDictionaryCue;
                  const def = cue?.definition || currentWord.definition;
                  const sent = cue?.sentence || currentWord.sentence;
                  const orig = cue?.origin || currentWord.origin;
                  return (def || sent || orig) ? (
                    <div className="mt-3 space-y-2 border-t border-[color:var(--line)]/50 pt-3">
                      {def ? (
                        <p className="text-sm leading-6 text-[color:var(--foreground)]">
                          <span className="font-semibold">Definition: </span>
                          {def}
                        </p>
                      ) : null}
                      {sent ? (
                        <p className="text-sm leading-6 text-[color:var(--foreground)]">
                          <span className="font-semibold">Sentence: </span>
                          {sent}
                        </p>
                      ) : null}
                      {orig ? (
                        <p className="text-sm leading-6 text-[color:var(--foreground)]">
                          <span className="font-semibold">Origin: </span>
                          {orig}
                        </p>
                      ) : null}
                    </div>
                  ) : null;
                })()}

                {status !== "correct" ? (
                  <button
                    className="primary-button mt-4 w-full"
                    onClick={() => advanceWord()}
                    type="button"
                  >
                    Next word
                  </button>
                ) : null}
              </div>
            ) : null}

            {speechError ? (
              <p className="mt-4 text-sm leading-6 text-[color:var(--signal)]">
                {speechError}
              </p>
            ) : null}

            <div className="mt-4 rounded-[22px] border border-[color:var(--line)] bg-white/70 p-4">
              <label className="eyebrow" htmlFor="spelling-keyboard-input">
                Type spelling
              </label>
              <div className="mt-3 flex gap-2">
                <input
                  className="min-w-0 flex-1 rounded-[20px] border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-3 text-base tracking-widest text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent)]/12"
                  id="spelling-keyboard-input"
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                  onChange={(event) => {
                    setManualUtteranceValue(event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.key === "Enter" &&
                      manualUtteranceValue.trim() &&
                      sessionStarted &&
                      !sessionComplete &&
                      status === "idle"
                    ) {
                      const value = manualUtteranceValue.trim().toLowerCase().replace(/[^a-z]/g, "");
                      setManualUtteranceValue("");
                      void submitSpellingCandidate(value);
                    }
                  }}
                  placeholder="Type the word here"
                  spellCheck={false}
                  type="text"
                  value={manualUtteranceValue}
                />
                <button
                  className="action-button min-h-10 rounded-full px-5"
                  disabled={
                    !sessionStarted ||
                    sessionComplete ||
                    status !== "idle" ||
                    !manualUtteranceValue.trim()
                  }
                  onClick={() => {
                    const value = manualUtteranceValue.trim().toLowerCase().replace(/[^a-z]/g, "");
                    setManualUtteranceValue("");
                    void submitSpellingCandidate(value);
                  }}
                  type="button"
                >
                  Submit
                </button>
              </div>
            </div>

            <div className="mt-4 space-y-2">
              {recentFeed.map((entry) => (
                <article
                  key={entry.id}
                  className={`rounded-[20px] border px-4 py-3 ${feedToneClass[entry.tone]}`}
                >
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em]">
                    {entry.label}
                  </p>
                  <p className="mt-2 text-sm leading-6">{entry.content}</p>
                </article>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div className="stat-card">
                <span className="stat-label">Streak</span>
                <strong>{streak}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Accuracy</span>
                <strong>{sessionAccuracy}%</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Notebook</span>
                <strong>{dueNotebookCount}</strong>
              </div>
            </div>
          </div>
        </section>
      </main>
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
              <h1 className={`display-copy mt-3 max-w-md text-4xl sm:text-5xl ${sessionComplete ? "hidden sm:block" : ""}`}>
                Daily spelling drills with a real review loop behind them.
              </h1>
            </div>
            <div className="hidden rounded-full border border-[color:var(--line)] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--muted)] sm:block">
              Local MVP
            </div>
          </div>

          <p className={`mt-5 max-w-xl text-sm leading-7 text-[color:var(--muted)] sm:text-base ${sessionComplete ? "hidden sm:block" : ""}`}>
            The app now generates a daily plan from a seeded word bank, keeps a
            browser-side notebook, routes dictionary requests through
            Merriam-Webster when configured, and can switch the pronouncer to
            Volcengine Doubao Speech TTS.
          </p>

          <div className={`mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4 ${sessionComplete ? "hidden sm:grid" : ""}`}>
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
            <div className={`rounded-[28px] border border-[color:var(--line)] bg-white/72 p-4 ${sessionComplete ? "hidden sm:block" : ""}`}>
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

        <aside className="panel hidden px-5 py-6 sm:px-6 lg:block">
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

      {sessionComplete ? (
        <section
          className="grid gap-4 lg:grid-cols-[1.04fr_0.96fr]"
          id="session"
        >
          <div className="panel px-5 py-6 sm:px-6 sm:py-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="eyebrow">Session Complete</p>
                <h2 className="mt-2 text-3xl font-semibold text-[color:var(--foreground)]">
                  Review the misses, then spin the next deck.
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-[color:var(--muted)]">
                  The live round is now back at rest. Your spoken requests,
                  spelling attempts, and wrong-word review queue are all saved
                  for the next drill.
                </p>
              </div>
              <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
                {sessionAccuracy}% accuracy
              </span>
            </div>

            <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="stat-card">
                <span className="stat-label">Correct</span>
                <strong>{sessionCorrectCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Misses</span>
                <strong>{sessionMissCount}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Best streak</span>
                <strong>{bestStreak}</strong>
              </div>
              <div className="stat-card">
                <span className="stat-label">Notebook</span>
                <strong>{notebookEntries.length}</strong>
              </div>
            </div>

            <div className="mt-5 h-2.5 overflow-hidden rounded-full bg-white/55">
              <div
                className="h-full rounded-full bg-[linear-gradient(90deg,#0D7C66,#E0B36A)]"
                style={{ width: `${progressPercent}%` }}
              />
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <span className="badge">
                {plan.settings.roundDurationSeconds}s round
              </span>
              <span className="badge">restarts {restartCount}</span>
              {hintsUsed.length === 0 ? (
                <span className="badge">no prompts used</span>
              ) : (
                hintsUsed.map((hint) => (
                  <span key={hint} className="badge">
                    {promptLabels[hint]}
                  </span>
                ))
              )}
            </div>

            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                className="primary-button"
                onClick={beginSession}
                type="button"
              >
                Start next drill
              </button>
              <a className="secondary-button" href="#notebook">
                Review notebook
              </a>
            </div>

            {sessionMisses.length > 0 ? (
              <div className="mt-6">
                <p className="eyebrow">
                  Missed words ({sessionMisses.length})
                </p>
                <div className="mt-3 space-y-3">
                  {sessionMisses.map((miss) => {
                    const def =
                      miss.cue?.definition || miss.word.definition;
                    const sent =
                      miss.cue?.sentence || miss.word.sentence;
                    const orig =
                      miss.cue?.origin || miss.word.origin;
                    return (
                      <article
                        key={miss.word.id}
                        className="rounded-[22px] border border-[color:var(--signal)]/30 bg-[color:var(--signal)]/5 p-4"
                      >
                        <div className="flex items-center justify-between gap-3">
                          <p className="font-[family:var(--font-display)] text-xl text-[color:var(--foreground)]">
                            {miss.word.word}
                          </p>
                          {miss.attempt ? (
                            <span className="rounded-full bg-[color:var(--signal)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--signal)]">
                              typed: {miss.attempt}
                            </span>
                          ) : null}
                        </div>
                        {(def || sent || orig) ? (
                          <div className="mt-3 space-y-1.5 border-t border-[color:var(--line)]/40 pt-3">
                            {def ? (
                              <p className="text-sm leading-6 text-[color:var(--foreground)]">
                                <span className="font-semibold">Definition: </span>
                                {def}
                              </p>
                            ) : null}
                            {sent ? (
                              <p className="text-sm leading-6 text-[color:var(--foreground)]">
                                <span className="font-semibold">Sentence: </span>
                                {sent}
                              </p>
                            ) : null}
                            {orig ? (
                              <p className="text-sm leading-6 text-[color:var(--foreground)]">
                                <span className="font-semibold">Origin: </span>
                                {orig}
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex flex-col gap-4">
            <div className="panel px-5 py-6 sm:px-6">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Feed</p>
                  <h3 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
                    Latest round log
                  </h3>
                </div>
                <span className="rounded-full bg-white/70 px-3 py-1 text-xs font-semibold text-[color:var(--muted)]">
                  newest first
                </span>
              </div>

              <div className="mt-4 space-y-3">
                {feed.slice(0, feedExpanded ? feed.length : 3).map((entry) => (
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
                {!feedExpanded && feed.length > 3 ? (
                  <button
                    type="button"
                    onClick={() => setFeedExpanded(true)}
                    className="w-full rounded-full border border-[color:var(--line)] bg-white/50 py-2 text-xs font-semibold text-[color:var(--muted)] transition-colors hover:bg-white/80"
                  >
                    Show {feed.length - 3} more entries
                  </button>
                ) : null}
              </div>
            </div>

            <div className="panel px-5 py-6 sm:px-6" id="notebook">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="eyebrow">Notebook</p>
                  <h3 className="mt-2 text-lg font-semibold text-[color:var(--foreground)]">
                    Practice review
                  </h3>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs font-semibold text-[color:var(--muted)]">
                    {notebookEntries.length} tracked
                  </span>
                  {dueNotebookCount > 0 ? (
                    <button
                      type="button"
                      onClick={beginSession}
                      className="rounded-full bg-[color:var(--accent)] px-4 py-1.5 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-[color:var(--accent)]/85"
                    >
                      Practice
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 flex gap-2 overflow-x-auto">
                {(["all", "due", "weak", "mastered"] as const).map((tab) => {
                  const isActive = notebookFilter === tab;
                  const labels: Record<string, string> = {
                    all: `All (${notebookEntries.length})`,
                    due: `Due (${dueNotebookCount})`,
                    weak: `Weak (${notebookEntries.filter((e) => e.progress.wrongCount > e.progress.correctCount).length})`,
                    mastered: `Mastered (${notebookEntries.filter((e) => e.progress.currentStreak >= 4).length})`,
                  };
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => { setNotebookFilter(tab); setNotebookPageSize(10); }}
                      className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
                        isActive
                          ? "bg-[color:var(--accent)] text-white"
                          : "bg-[color:var(--accent-soft)]/40 text-[color:var(--muted)] hover:bg-[color:var(--accent-soft)]/70"
                      }`}
                    >
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              <div className="mt-4 space-y-3">
                {filteredNotebookEntries.length === 0 ? (
                  <div className="rounded-[22px] border border-dashed border-[color:var(--line)] bg-white/45 p-4 text-sm leading-6 text-[color:var(--muted)]">
                    {notebookEntries.length === 0
                      ? "No notebook words yet. Words you practise will appear here with accuracy stats."
                      : "No words match this filter."}
                  </div>
                ) : (
                  filteredNotebookEntries.slice(0, notebookPageSize).map(renderNotebookEntry)
                )}
                {filteredNotebookEntries.length > notebookPageSize ? (
                  <button
                    type="button"
                    onClick={() => setNotebookPageSize((prev) => prev + 10)}
                    className="w-full rounded-full border border-[color:var(--line)] bg-white/50 py-2 text-xs font-semibold text-[color:var(--muted)] transition-colors hover:bg-white/80"
                  >
                    Show 10 more ({filteredNotebookEntries.length - notebookPageSize} remaining)
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </section>
      ) : (
        <section className="panel px-5 py-6 sm:px-6" id="session">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">Ready</p>
              <h2 className="mt-2 text-2xl font-semibold text-[color:var(--foreground)]">
                Tap begin to enter a focused round screen.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-[color:var(--muted)]">
                The live drill stays minimal once it starts: one round card, one
                Talk action, quick rule-safe clue chips, and a reveal only after
                the round resolves.
              </p>
            </div>
            <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
              {dueNotebookCount} due
            </span>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="stat-card">
              <span className="stat-label">Deck</span>
              <strong>{previewPlan.words.length}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Timer</span>
              <strong>{settings.roundDurationSeconds}s</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Voice</span>
              <strong>{voiceStatusLabel}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Notebook</span>
              <strong>{notebookEntries.length}</strong>
            </div>
          </div>
        </section>
      )}
    </main>
  );
}
