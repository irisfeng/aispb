export type DrillPromptKind =
  | "repeat"
  | "definition"
  | "sentence"
  | "origin"
  | "part-of-speech"
  | "all-info";

export type SubmissionState = "idle" | "correct" | "incorrect" | "timeout";
export type ProviderRole = "pronouncer" | "dictionary" | "coach";
export type PlanReason = "review" | "fresh";

export interface DrillWord {
  id: string;
  word: string;
  difficulty: number;
  source: string;
  phonetic?: string;
  category?: string;
  pronunciationNote?: string;
  definition?: string;
  sentence?: string;
  origin?: string;
  coachingNote?: string;
}

export interface DrillSettings {
  dailyGoal: number;
  roundDurationSeconds: number;
  pronouncerEnabled: boolean;
}

export interface PlannedDrillWord extends DrillWord {
  planReason: PlanReason;
}

export interface DrillPlan {
  id: string;
  createdOn: string;
  settings: DrillSettings;
  words: PlannedDrillWord[];
  stats: {
    reviewCount: number;
    freshCount: number;
  };
}

export interface WordProgressRecord {
  wordId: string;
  seenCount: number;
  correctCount: number;
  wrongCount: number;
  currentStreak: number;
  reviewCount: number;
  lastResult: Exclude<SubmissionState, "idle"> | null;
  lastSeenOn: string | null;
  dueOn: string | null;
  knownAt?: string | null;
}

export type ProgressMap = Record<string, WordProgressRecord>;

export interface NotebookEntry {
  word: DrillWord;
  progress: WordProgressRecord;
}

export interface ProviderCard {
  id: string;
  label: string;
  role: ProviderRole;
  detail: string;
  status: "ready" | "planned";
}

export interface TtsProviderAdapter {
  id: string;
  label: string;
  getSpokenText: (
    word: DrillWord,
    promptKind: DrillPromptKind,
  ) => Promise<string>;
}

export interface DictionaryProviderAdapter {
  id: string;
  label: string;
  getDefinition: (word: DrillWord) => Promise<string>;
  getOrigin: (word: DrillWord) => Promise<string>;
  getSentence: (word: DrillWord) => Promise<string>;
}

export interface CoachProviderAdapter {
  id: string;
  label: string;
  summarizeMiss: (
    word: DrillWord,
    attempt: string,
    result: Exclude<SubmissionState, "idle" | "correct">,
  ) => Promise<string>;
}
