import type { DrillSettings, ProgressMap } from "@/lib/types";

const LEGACY_SETTINGS_KEY = "aispb:settings:v1";
const LEGACY_PROGRESS_KEY = "aispb:progress:v1";

// Active user ID — set by setStorageUser() on login, cleared on logout.
// When set, localStorage keys are namespaced per user to prevent cross-user leakage.
let activeUserId: string | null = null;

export function setStorageUser(userId: string | null) {
  activeUserId = userId;
}

function settingsKey(): string {
  return activeUserId
    ? `aispb:${activeUserId}:settings:v1`
    : LEGACY_SETTINGS_KEY;
}

function progressKey(): string {
  return activeUserId
    ? `aispb:${activeUserId}:progress:v1`
    : LEGACY_PROGRESS_KEY;
}

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
  const raw = readJson<unknown>(settingsKey(), defaultSettings);
  if (!isValidDrillSettings(raw)) return defaultSettings;
  const settings = raw as DrillSettings;
  if (!settings.wordBank) {
    return { ...settings, wordBank: "spbcn-middle" };
  }
  return settings;
}

export function loadProgress(): ProgressMap {
  const raw = readJson<unknown>(progressKey(), {});
  return isValidProgressMap(raw) ? raw : {};
}

export function saveSettings(settings: DrillSettings) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(settingsKey(), JSON.stringify(settings));
}

export function saveProgress(progress: ProgressMap) {
  if (!canUseStorage()) return;
  window.localStorage.setItem(progressKey(), JSON.stringify(progress));
}

/** Migrate legacy (non-namespaced) localStorage to the current user's namespace. */
export function migrateLocalStorageToUser(): boolean {
  if (!canUseStorage() || !activeUserId) return false;

  const legacySettings = window.localStorage.getItem(LEGACY_SETTINGS_KEY);
  const legacyProgress = window.localStorage.getItem(LEGACY_PROGRESS_KEY);

  if (!legacySettings && !legacyProgress) return false;

  // Copy to user-namespaced keys
  if (legacySettings) {
    window.localStorage.setItem(settingsKey(), legacySettings);
  }
  if (legacyProgress) {
    window.localStorage.setItem(progressKey(), legacyProgress);
  }

  // Remove legacy keys
  window.localStorage.removeItem(LEGACY_SETTINGS_KEY);
  window.localStorage.removeItem(LEGACY_PROGRESS_KEY);

  return true;
}
