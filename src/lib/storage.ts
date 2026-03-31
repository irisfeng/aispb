import type { DrillSettings, ProgressMap } from "@/lib/types";

const SETTINGS_KEY = "aispb:settings:v1";
const PROGRESS_KEY = "aispb:progress:v1";

export const defaultSettings: DrillSettings = {
  dailyGoal: 50,
  roundDurationSeconds: 60,
  pronouncerEnabled: true,
  wordBank: "spbcn-middle",
};

function canUseStorage() {
  return typeof window !== "undefined" && "localStorage" in window;
}

function readJson<T>(key: string, fallback: T): T {
  if (!canUseStorage()) {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);

  if (!raw) {
    return fallback;
  }

  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Runtime validation guards — prevent malformed localStorage from poisoning
// timer math, planning, or spaced-repetition calculations.
// ---------------------------------------------------------------------------

const VALID_DAILY_GOALS = new Set([20, 30, 50, 80, 100]);
const VALID_ROUND_DURATIONS = new Set([60, 90]);
const VALID_WORD_BANKS = new Set(["spbcn-middle", "spbcn-high"]);

function isValidDrillSettings(value: unknown): value is DrillSettings {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  return (
    typeof obj.dailyGoal === "number" &&
    VALID_DAILY_GOALS.has(obj.dailyGoal) &&
    typeof obj.roundDurationSeconds === "number" &&
    VALID_ROUND_DURATIONS.has(obj.roundDurationSeconds) &&
    typeof obj.pronouncerEnabled === "boolean" &&
    (obj.wordBank === undefined ||
      (typeof obj.wordBank === "string" && VALID_WORD_BANKS.has(obj.wordBank)))
  );
}

const PROGRESS_NUMBER_FIELDS = [
  "seenCount",
  "correctCount",
  "wrongCount",
  "currentStreak",
  "reviewCount",
] as const;

function isValidProgressMap(value: unknown): value is ProgressMap {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  for (const entry of Object.values(obj)) {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }

    const record = entry as Record<string, unknown>;

    for (const field of PROGRESS_NUMBER_FIELDS) {
      if (typeof record[field] !== "number") {
        return false;
      }
    }
  }

  return true;
}

export function loadSettings(): DrillSettings {
  const raw = readJson<unknown>(SETTINGS_KEY, defaultSettings);
  if (!isValidDrillSettings(raw)) return defaultSettings;
  // Backfill wordBank for existing users who don't have it yet
  const settings = raw as DrillSettings;
  if (!settings.wordBank) {
    return { ...settings, wordBank: "spbcn-middle" };
  }
  return settings;
}

export function loadProgress(): ProgressMap {
  const raw = readJson<unknown>(PROGRESS_KEY, {});
  return isValidProgressMap(raw) ? raw : {};
}

export function saveSettings(settings: DrillSettings) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function saveProgress(progress: ProgressMap) {
  if (!canUseStorage()) {
    return;
  }

  window.localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
}
