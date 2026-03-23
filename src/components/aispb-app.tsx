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
  idle: "Listen first, then spell with complete precision.",
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
  const [answer, setAnswer] = useState("");
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
  const dueNotebookCount = notebookEntries.filter(
    (entry) => !entry.progress.dueOn || entry.progress.dueOn <= todayKey,
  ).length;
  const interactionLocked =
    !sessionStarted || sessionComplete || status !== "idle";
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
  const pronouncerDetail = hasExternalPronouncer
    ? `Volcengine short-text TTS is active with speaker ${pronouncerStatus?.speaker ?? "default"}. Browser speech stays available as a local fallback.`
    : browserSpeechReady
      ? "External TTS is not configured yet. Browser speech is carrying local playback for drills and prompt repeats."
      : "No active audio channel is available yet. Add Volcengine speech credentials or use a browser with speech synthesis support.";
  const adapterBadge = lastPronouncerProvider
    ? lastPronouncerProvider
    : currentDictionaryCue?.provider
      ? currentDictionaryCue.provider
      : hasExternalPronouncer
        ? (pronouncerStatus?.provider ?? "Volcengine short-text TTS")
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

    if (!settings.pronouncerEnabled || !browserSpeechReady) {
      return;
    }

    stopActiveAudio();
    pronounceWithBrowserSpeech(currentWord.word);
  }, [
    browserSpeechReady,
    currentIndex,
    currentWord,
    currentWord?.id,
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
    setAnswer("");
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

    if (
      nextPlan.words[0] &&
      settings.pronouncerEnabled &&
      hasExternalPronouncer
    ) {
      void playPronouncerText(nextPlan.words[0].word);
    }
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
      setAnswer("");
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
        void registerMiss("timeout", answer.trim());
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

    setRestartCount((previous) => previous + 1);
    setAnswer("");
    setFeed((previous) => [
      createFeedEntry(
        "Start over",
        "Spelling reset. In official play, previously spoken letters cannot be reordered after a restart.",
        "system",
      ),
      ...previous,
    ]);
  }

  async function handleSubmit() {
    if (!currentWord || !answer.trim() || !sessionStarted || sessionComplete) {
      return;
    }

    const normalizedAnswer = answer.trim().toLowerCase();
    const normalizedWord = currentWord.word.toLowerCase();

    if (normalizedAnswer === normalizedWord) {
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
          `${currentWord.word} locked in. ${currentWord.coachingNote}`,
          "success",
        ),
        ...previous,
      ]);

      window.setTimeout(() => {
        advanceWord();
      }, 850);
      return;
    }

    await registerMiss("incorrect", answer.trim());
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
            Volcengine short-text TTS.
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
              disabled={interactionLocked}
              onClick={handleStartOver}
              type="button"
            >
              Start Over
            </button>
          </div>

          <div className="mt-5 rounded-[28px] border border-[color:var(--line)] bg-white/78 p-4 shadow-[0_18px_40px_rgba(17,32,51,0.08)]">
            <label className="eyebrow" htmlFor="spelling-answer">
              Spell the word
            </label>
            <input
              className="mt-3 w-full rounded-[22px] border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-4 text-lg text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent)]/12 disabled:cursor-not-allowed disabled:opacity-55"
              disabled={!sessionStarted || sessionComplete || status !== "idle"}
              id="spelling-answer"
              onChange={(event) => {
                setAnswer(event.target.value);
              }}
              placeholder="type the full spelling here"
              spellCheck={false}
              type="text"
              value={answer}
            />

            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm leading-6 text-[color:var(--muted)]">
                {statusCopy[status]}
              </p>
              <button
                className="primary-button justify-center px-5 py-3 text-sm"
                disabled={
                  !sessionStarted || sessionComplete || status !== "idle"
                }
                onClick={() => {
                  void handleSubmit();
                }}
                type="button"
              >
                Submit spelling
              </button>
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
