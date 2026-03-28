import type {
  DrillPlan,
  DrillSettings,
  DrillWord,
  NotebookEntry,
  PlannedDrillWord,
  ProgressMap,
  SubmissionState,
  WordProgressRecord,
} from "@/lib/types";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function hashSeed(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function rankFreshWords(words: DrillWord[], seed: string) {
  return [...words].sort((left, right) => {
    const leftHash = hashSeed(`${seed}:${left.id}`) * (left.difficulty >= 2 ? 0.6 : 1);
    const rightHash = hashSeed(`${seed}:${right.id}`) * (right.difficulty >= 2 ? 0.6 : 1);

    if (leftHash === rightHash) {
      return right.difficulty - left.difficulty;
    }

    return leftHash - rightHash;
  });
}

export function getTodayKey() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function addDays(dateKey: string, days: number) {
  const date = new Date(`${dateKey}T00:00:00`);
  const nextDate = new Date(date.getTime() + days * DAY_IN_MS);
  const year = nextDate.getFullYear();
  const month = String(nextDate.getMonth() + 1).padStart(2, "0");
  const day = String(nextDate.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function createEmptyProgress(wordId: string): WordProgressRecord {
  return {
    wordId,
    seenCount: 0,
    correctCount: 0,
    wrongCount: 0,
    currentStreak: 0,
    reviewCount: 0,
    lastResult: null,
    lastSeenOn: null,
    dueOn: null,
  };
}

export function createDrillPlan(input: {
  words: DrillWord[];
  settings: DrillSettings;
  progress: ProgressMap;
  todayKey: string;
}): DrillPlan {
  const { progress, settings, todayKey, words } = input;
  const dueWords = words
    .filter((word) => {
      const record = progress[word.id];

      return Boolean(
        record && record.reviewCount > 0 && (!record.dueOn || record.dueOn <= todayKey),
      );
    })
    .sort((left, right) => {
      const leftRecord = progress[left.id]!;
      const rightRecord = progress[right.id]!;

      if (leftRecord.reviewCount !== rightRecord.reviewCount) {
        return rightRecord.reviewCount - leftRecord.reviewCount;
      }

      if (leftRecord.wrongCount !== rightRecord.wrongCount) {
        return rightRecord.wrongCount - leftRecord.wrongCount;
      }

      return right.difficulty - left.difficulty;
    });

  const dueIds = new Set(dueWords.map((word) => word.id));
  const freshWords = rankFreshWords(
    words.filter((word) => {
      if (dueIds.has(word.id)) return false;
      const record = progress[word.id];
      if (!record) return true;
      if (record.dueOn && record.dueOn > todayKey) return false;
      return true;
    }),
    `${todayKey}:${settings.dailyGoal}:${settings.roundDurationSeconds}`,
  );

  const minFreshQuota = 5;
  const maxReview = Math.max(settings.dailyGoal - minFreshQuota, 0);
  const selectedReview = dueWords.slice(0, maxReview);
  const remainingSlots = Math.max(settings.dailyGoal - selectedReview.length, 0);
  const selectedFresh = freshWords.slice(0, remainingSlots);
  const plannedWords: PlannedDrillWord[] = [
    ...selectedReview.map((word) => ({
      ...word,
      planReason: "review" as const,
    })),
    ...selectedFresh.map((word) => ({
      ...word,
      planReason: "fresh" as const,
    })),
  ];

  return {
    id: `plan-${todayKey}-${settings.dailyGoal}-${settings.roundDurationSeconds}`,
    createdOn: todayKey,
    settings,
    words: plannedWords,
    stats: {
      reviewCount: selectedReview.length,
      freshCount: selectedFresh.length,
    },
  };
}

export function applyDrillResult(input: {
  progress: ProgressMap;
  wordId: string;
  result: Exclude<SubmissionState, "idle">;
  todayKey: string;
}): ProgressMap {
  const { progress, result, todayKey, wordId } = input;
  const current = progress[wordId] ?? createEmptyProgress(wordId);
  const next: WordProgressRecord = {
    ...current,
    seenCount: current.seenCount + 1,
    lastResult: result,
    lastSeenOn: todayKey,
  };

  if (result === "correct") {
    const nextStreak = current.currentStreak + 1;
    const nextReviewCount =
      current.reviewCount > 0 && nextStreak >= 2
        ? Math.max(current.reviewCount - 1, 0)
        : current.reviewCount;

    next.correctCount = current.correctCount + 1;
    next.currentStreak = nextStreak;
    next.reviewCount = nextReviewCount;
    next.dueOn = nextReviewCount > 0 ? addDays(todayKey, 1) : addDays(todayKey, nextStreak >= 4 ? 7 : nextStreak >= 2 ? 5 : 2);
  } else {
    next.wrongCount = current.wrongCount + 1;
    next.currentStreak = 0;
    next.reviewCount = Math.min(current.reviewCount + 1, 3);
    next.dueOn = addDays(todayKey, 1);
  }

  return {
    ...progress,
    [wordId]: next,
  };
}

export function getNotebookEntries(input: {
  words: DrillWord[];
  progress: ProgressMap;
  todayKey: string;
}): NotebookEntry[] {
  const { progress, todayKey, words } = input;

  return words
    .map((word) => {
      const record = progress[word.id];

      if (!record || record.seenCount <= 0) {
        return null;
      }

      return {
        word,
        progress: record,
      };
    })
    .filter((entry): entry is NotebookEntry => entry !== null)
    .sort((left, right) => {
      const leftAcc = left.progress.seenCount > 0 ? left.progress.correctCount / left.progress.seenCount : 0;
      const rightAcc = right.progress.seenCount > 0 ? right.progress.correctCount / right.progress.seenCount : 0;

      if (leftAcc !== rightAcc) {
        return leftAcc - rightAcc;
      }

      const leftDueNow = !left.progress.dueOn || left.progress.dueOn <= todayKey ? 1 : 0;
      const rightDueNow = !right.progress.dueOn || right.progress.dueOn <= todayKey ? 1 : 0;

      return rightDueNow - leftDueNow;
    });
}
