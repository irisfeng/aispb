import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import type { DrillSettings, ProgressMap, WordProgressRecord } from "@/lib/types";

function getClient() {
  return createSupabaseBrowserClient();
}

// ---- Settings ----

export async function loadSettingsFromSupabase(
  userId: string,
): Promise<DrillSettings | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("user_settings")
    .select("daily_goal, round_duration_seconds, pronouncer_enabled, word_bank")
    .eq("user_id", userId)
    .single();

  if (error || !data) return null;

  // Migrate legacy word_bank string → wordBanks array
  const wordBanks: string[] = Array.isArray(data.word_bank)
    ? (data.word_bank as string[])
    : typeof data.word_bank === "string" && data.word_bank
      ? [data.word_bank as string]
      : ["spbcn-middle"];

  return {
    dailyGoal: data.daily_goal,
    roundDurationSeconds: data.round_duration_seconds,
    pronouncerEnabled: data.pronouncer_enabled,
    wordBanks,
  };
}

export async function saveSettingsToSupabase(
  userId: string,
  settings: DrillSettings,
): Promise<void> {
  const supabase = getClient();
  await supabase.from("user_settings").upsert({
    user_id: userId,
    daily_goal: settings.dailyGoal,
    round_duration_seconds: settings.roundDurationSeconds,
    pronouncer_enabled: settings.pronouncerEnabled,
    word_bank: settings.wordBanks,
    updated_at: new Date().toISOString(),
  });
}

// ---- Progress ----

export async function loadProgressFromSupabase(
  userId: string,
): Promise<ProgressMap | null> {
  const supabase = getClient();
  const { data, error } = await supabase
    .from("user_progress")
    .select("*")
    .eq("user_id", userId);

  if (error || !data || data.length === 0) return null;

  const progress: ProgressMap = {};
  for (const row of data) {
    progress[row.word_id] = {
      wordId: row.word_id,
      seenCount: row.seen_count,
      correctCount: row.correct_count,
      wrongCount: row.wrong_count,
      currentStreak: row.current_streak,
      reviewCount: row.review_count,
      lastResult: row.last_result,
      lastSeenOn: row.last_seen_on,
      dueOn: row.due_on,
      knownAt: row.known_at,
    };
  }

  return progress;
}

export async function saveProgressToSupabase(
  userId: string,
  progress: ProgressMap,
): Promise<void> {
  const supabase = getClient();

  const rows = Object.values(progress).map((record: WordProgressRecord) => ({
    user_id: userId,
    word_id: record.wordId,
    seen_count: record.seenCount,
    correct_count: record.correctCount,
    wrong_count: record.wrongCount,
    current_streak: record.currentStreak,
    review_count: record.reviewCount,
    last_result: record.lastResult,
    last_seen_on: record.lastSeenOn,
    due_on: record.dueOn,
    known_at: record.knownAt ?? null,
  }));

  if (rows.length === 0) return;

  // Batch upsert — Supabase supports this natively
  await supabase
    .from("user_progress")
    .upsert(rows, { onConflict: "user_id,word_id" });
}
