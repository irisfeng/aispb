export type DrillPromptKind = "repeat" | "definition" | "sentence" | "origin";

export type SubmissionState = "idle" | "correct" | "incorrect" | "timeout";

export interface DrillWord {
  id: string;
  word: string;
  phonetic: string;
  category: string;
  pronunciationNote: string;
  definition: string;
  sentence: string;
  origin: string;
  coachingNote: string;
}

export interface DrillPreset {
  dailyGoal: number;
  roundDurationSeconds: number;
  modeLabel: string;
  words: DrillWord[];
}

export interface ProviderCard {
  id: string;
  label: string;
  role: "pronouncer" | "dictionary" | "coach";
  detail: string;
  status: "ready" | "planned";
}

export interface TtsProviderAdapter {
  id: string;
  label: string;
  synthesize: (wordId: string, promptKind: DrillPromptKind) => Promise<string>;
}

export interface DictionaryProviderAdapter {
  id: string;
  label: string;
  getDefinition: (wordId: string) => Promise<string>;
  getOrigin: (wordId: string) => Promise<string>;
  getSentence: (wordId: string) => Promise<string>;
}

export interface CoachProviderAdapter {
  id: string;
  label: string;
  summarizeMiss: (wordId: string, attempt: string) => Promise<string>;
}
