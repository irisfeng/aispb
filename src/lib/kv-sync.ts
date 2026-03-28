import type { DrillSettings, ProgressMap } from "@/lib/types";

type KvKey = "settings" | "progress";

async function kvGet<T>(key: KvKey): Promise<T | null> {
  try {
    const res = await fetch(`/api/storage?key=${key}`);

    if (!res.ok) {
      return null;
    }

    const json = (await res.json()) as { value: T | null };
    return json.value ?? null;
  } catch {
    return null;
  }
}

async function kvPut(key: KvKey, value: unknown): Promise<boolean> {
  try {
    const res = await fetch(`/api/storage?key=${key}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value }),
    });

    return res.ok;
  } catch {
    return false;
  }
}

export async function loadSettingsFromKv(): Promise<DrillSettings | null> {
  return kvGet<DrillSettings>("settings");
}

export async function loadProgressFromKv(): Promise<ProgressMap | null> {
  return kvGet<ProgressMap>("progress");
}

export async function saveSettingsToKv(settings: DrillSettings): Promise<boolean> {
  return kvPut("settings", settings);
}

export async function saveProgressToKv(progress: ProgressMap): Promise<boolean> {
  return kvPut("progress", progress);
}
