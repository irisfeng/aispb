import type { DrillSettings, ProgressMap } from "@/lib/types";

const SETTINGS_KEY = "aispb:settings:v1";
const PROGRESS_KEY = "aispb:progress:v1";

export const defaultSettings: DrillSettings = {
  dailyGoal: 20,
  roundDurationSeconds: 60,
  pronouncerEnabled: true,
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

export function loadSettings() {
  return readJson<DrillSettings>(SETTINGS_KEY, defaultSettings);
}

export function loadProgress() {
  return readJson<ProgressMap>(PROGRESS_KEY, {});
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
