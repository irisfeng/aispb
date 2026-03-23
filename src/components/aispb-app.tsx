"use client";

import { startTransition, useEffect, useEffectEvent, useState } from "react";

import { drillPreset, promptOrder, providerCards } from "@/lib/mock-session";
import type { DrillPromptKind, SubmissionState } from "@/lib/types";

type FeedEntryTone = "system" | "hint" | "success" | "danger";

interface FeedEntry {
  id: string;
  tone: FeedEntryTone;
  label: string;
  content: string;
}

const statusCopy: Record<SubmissionState, string> = {
  idle: "Say each letter cleanly. One wrong character breaks the run.",
  correct: "Correct. Clean entry, clean exit.",
  incorrect: "Miss recorded. Start over and rebuild the spelling from the top.",
  timeout: "Time expired. This word goes to the notebook for review.",
};

const promptLabels: Record<DrillPromptKind, string> = {
  repeat: "Repeat",
  definition: "Definition",
  sentence: "Sentence",
  origin: "Origin",
};

const feedToneClass: Record<FeedEntryTone, string> = {
  system: "border-[color:var(--line)] bg-white/70 text-[color:var(--muted)]",
  hint: "border-[color:var(--accent-soft)] bg-[color:var(--accent-soft)]/60 text-[color:var(--foreground)]",
  success:
    "border-[color:var(--accent)] bg-[color:var(--accent)]/10 text-[color:var(--foreground)]",
  danger:
    "border-[color:var(--signal)] bg-[color:var(--signal)]/10 text-[color:var(--foreground)]",
};

const totalWords = drillPreset.words.length;
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

export function AispbApp() {
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(
    drillPreset.roundDurationSeconds,
  );
  const [answer, setAnswer] = useState("");
  const [status, setStatus] = useState<SubmissionState>("idle");
  const [wrongWordIds, setWrongWordIds] = useState<string[]>([]);
  const [hintsUsed, setHintsUsed] = useState<DrillPromptKind[]>([]);
  const [restartCount, setRestartCount] = useState(0);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const [feed, setFeed] = useState<FeedEntry[]>([
    {
      id: "feed-initial",
      label: "Warmup",
      content:
        "Pronouncer ready. Tap a prompt below to simulate Bee-style dialogue.",
      tone: "system",
    },
  ]);

  const currentWord = drillPreset.words[currentIndex];
  const progressPercent =
    ((sessionComplete ? totalWords : currentIndex) / totalWords) * 100;
  const timerDegrees = (secondsLeft / drillPreset.roundDurationSeconds) * 360;
  const wrongWords = drillPreset.words.filter((word) =>
    wrongWordIds.includes(word.id),
  );

  const openPrompt = (kind: DrillPromptKind) => {
    if (!currentWord) {
      return;
    }

    const content =
      kind === "repeat"
        ? `Pronouncer repeats the word. ${currentWord.pronunciationNote}`
        : kind === "definition"
          ? currentWord.definition
          : kind === "sentence"
            ? currentWord.sentence
            : currentWord.origin;

    setHintsUsed((previous) =>
      previous.includes(kind) ? previous : [...previous, kind],
    );
    setFeed((previous) => [
      createFeedEntry(
        promptLabels[kind],
        content,
        kind === "repeat" ? "system" : "hint",
      ),
      ...previous,
    ]);
  };

  const advanceWord = () => {
    startTransition(() => {
      if (currentIndex === totalWords - 1) {
        setSessionComplete(true);
        setSessionStarted(false);
        setFeed((previous) => [
          createFeedEntry(
            "Session",
            "Prototype complete. Next pass will wire real adapters and persistence.",
            "success",
          ),
          ...previous,
        ]);
        return;
      }

      setCurrentIndex((previous) => previous + 1);
      setSecondsLeft(drillPreset.roundDurationSeconds);
      setAnswer("");
      setStatus("idle");
      setHintsUsed([]);
      setRestartCount(0);
      setFeed((previous) => [
        createFeedEntry(
          "Next word",
          `Round ${currentIndex + 2} is queued. Pronouncer is ready again.`,
          "system",
        ),
        ...previous,
      ]);
    });
  };

  const registerMiss = (reason: "incorrect" | "timeout") => {
    if (!currentWord) {
      return;
    }

    setWrongWordIds((previous) =>
      previous.includes(currentWord.id)
        ? previous
        : [...previous, currentWord.id],
    );
    setStreak(0);
    setStatus(reason);
    setFeed((previous) => [
      createFeedEntry(
        reason === "timeout" ? "Timed out" : "Miss logged",
        `${currentWord.word} will return in the review notebook. ${currentWord.coachingNote}`,
        "danger",
      ),
      ...previous,
    ]);

    if (reason === "timeout") {
      window.setTimeout(() => {
        advanceWord();
      }, 900);
    }
  };

  const tick = useEffectEvent(() => {
    setSecondsLeft((previous) => {
      if (previous <= 1) {
        registerMiss("timeout");
        return drillPreset.roundDurationSeconds;
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
  }, [sessionStarted, sessionComplete]);

  const beginSession = () => {
    setSessionStarted(true);
    setSessionComplete(false);
    setCurrentIndex(0);
    setSecondsLeft(drillPreset.roundDurationSeconds);
    setAnswer("");
    setStatus("idle");
    setHintsUsed([]);
    setRestartCount(0);
    setWrongWordIds([]);
    setStreak(0);
    setFeed([
      createFeedEntry(
        "Session start",
        "Pronouncer says the first word. Ask for a definition, sentence, or origin whenever needed.",
        "system",
      ),
    ]);
  };

  const handleStartOver = () => {
    setRestartCount((previous) => previous + 1);
    setAnswer("");
    setStatus("idle");
    setFeed((previous) => [
      createFeedEntry(
        "Start over",
        "Spelling reset. In the real rules, previously spoken letters cannot change order.",
        "system",
      ),
      ...previous,
    ]);
  };

  const handleSubmit = () => {
    if (!currentWord || !answer.trim()) {
      return;
    }

    const normalizedAnswer = answer.trim().toLowerCase();
    const normalizedWord = currentWord.word.toLowerCase();

    if (normalizedAnswer === normalizedWord) {
      const nextStreak = streak + 1;
      setStatus("correct");
      setStreak(nextStreak);
      setBestStreak((previous) => Math.max(previous, nextStreak));
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

    registerMiss("incorrect");
  };

  const activeAccuracy =
    Math.round(
      ((currentIndex - wrongWords.length + (status === "correct" ? 1 : 0)) /
        Math.max(currentIndex + 1, 1)) *
        100,
    ) || 0;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl flex-col gap-6 px-4 py-5 sm:px-6 sm:py-8">
      <section className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="panel relative overflow-hidden px-5 py-6 sm:px-7 sm:py-8">
          <div className="absolute inset-x-0 top-0 h-px bg-white/70" />
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="eyebrow">AISPB</p>
              <h1 className="display-copy mt-3 max-w-md text-4xl sm:text-5xl">
                Daily spelling drills with the rhythm of a real Bee round.
              </h1>
            </div>
            <div className="hidden rounded-full border border-[color:var(--line)] bg-white/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-[color:var(--muted)] sm:block">
              Mobile first
            </div>
          </div>

          <p className="mt-5 max-w-xl text-sm leading-7 text-[color:var(--muted)] sm:text-base">
            This first scaffold focuses on the fundamentals: a clean daily
            ritual, Bee-style prompt requests, flawless spelling validation, and
            a review loop that turns misses into tomorrow&apos;s targets.
          </p>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="stat-card">
              <span className="stat-label">Plan</span>
              <strong>{drillPreset.dailyGoal} words</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Round</span>
              <strong>{drillPreset.roundDurationSeconds}s</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Mode</span>
              <strong>{drillPreset.modeLabel}</strong>
            </div>
            <div className="stat-card">
              <span className="stat-label">Focus</span>
              <strong>Precision</strong>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row">
            <button
              className="primary-button"
              onClick={beginSession}
              type="button"
            >
              Begin today&apos;s drill
            </button>
            <a className="secondary-button" href="#session">
              Inspect session prototype
            </a>
          </div>
        </div>

        <aside className="panel px-5 py-6 sm:px-6">
          <div className="flex items-center justify-between">
            <p className="eyebrow">Adapters</p>
            <span className="rounded-full bg-[color:var(--accent-soft)] px-3 py-1 text-xs font-semibold text-[color:var(--foreground)]">
              ready for wiring
            </span>
          </div>

          <div className="mt-5 space-y-3">
            {providerCards.map((provider) => (
              <article
                key={provider.id}
                className="rounded-[24px] border border-[color:var(--line)] bg-white/75 p-4 shadow-[0_10px_30px_rgba(17,32,51,0.06)]"
              >
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-sm font-semibold text-[color:var(--foreground)]">
                    {provider.label}
                  </h2>
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
                      provider.status === "ready"
                        ? "bg-[color:var(--accent)]/12 text-[color:var(--accent)]"
                        : "bg-[color:var(--sand)] text-[color:var(--foreground)]"
                    }`}
                  >
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
                Round {Math.min(currentIndex + 1, totalWords)} of {totalWords}
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
              <span className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white/80">
                {currentWord.category}
              </span>
            </div>
            <p className="mt-4 font-[family:var(--font-display)] text-4xl leading-none sm:text-5xl">
              Word{" "}
              {String(Math.min(currentIndex + 1, totalWords)).padStart(2, "0")}
            </p>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/70">
              American pronouncer voice staged. The written word stays hidden
              until the round resolves. Current cue:{" "}
              {currentWord.pronunciationNote}
            </p>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
            {promptOrder.map((prompt) => (
              <button
                key={prompt}
                className="action-button"
                onClick={() => openPrompt(prompt)}
                type="button"
              >
                {promptLabels[prompt]}
              </button>
            ))}
            <button
              className="action-button col-span-2 sm:col-span-5"
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
              className="mt-3 w-full rounded-[22px] border border-[color:var(--line)] bg-[color:var(--paper)] px-4 py-4 text-lg text-[color:var(--foreground)] outline-none transition focus:border-[color:var(--accent)] focus:ring-4 focus:ring-[color:var(--accent)]/12"
              id="spelling-answer"
              onChange={(event) => {
                setAnswer(event.target.value);
                if (status !== "idle") {
                  setStatus("idle");
                }
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
                onClick={handleSubmit}
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
                {Math.max(activeAccuracy, 0)}% accuracy
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
              {hintsUsed.length === 0 ? (
                <span className="badge">No prompts used yet</span>
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
                  Review queue
                </h3>
              </div>
              <span className="rounded-full border border-[color:var(--line)] px-3 py-1 text-xs font-semibold text-[color:var(--muted)]">
                {wrongWords.length} queued
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {wrongWords.length === 0 ? (
                <div className="rounded-[22px] border border-dashed border-[color:var(--line)] bg-white/45 p-4 text-sm leading-6 text-[color:var(--muted)]">
                  Clean board so far. Any miss or timeout will land here with a
                  coaching note.
                </div>
              ) : (
                wrongWords.map((word) => (
                  <article
                    key={word.id}
                    className="rounded-[22px] border border-[color:var(--line)] bg-white/72 p-4"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <p className="font-[family:var(--font-display)] text-2xl text-[color:var(--foreground)]">
                        {word.word}
                      </p>
                      <span className="rounded-full bg-[color:var(--signal)]/10 px-3 py-1 text-xs font-semibold text-[color:var(--signal)]">
                        revisit
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-[color:var(--muted)]">
                      {word.coachingNote}
                    </p>
                  </article>
                ))
              )}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
