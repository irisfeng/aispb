import type {
  CoachProviderAdapter,
  DictionaryProviderAdapter,
  DrillWord,
  ProviderCard,
  TtsProviderAdapter,
} from "@/lib/types";

export const localPronouncerAdapter: TtsProviderAdapter = {
  id: "browser-speech",
  label: "Browser Speech",
  async getSpokenText(word, promptKind) {
    if (promptKind === "repeat") {
      return word.word;
    }

    return `${word.word}. ${word.pronunciationNote}`;
  },
};

export const localDictionaryAdapter: DictionaryProviderAdapter = {
  id: "seed-dictionary",
  label: "Seed Dictionary",
  async getDefinition(word) {
    return word.definition;
  },
  async getOrigin(word) {
    return word.origin;
  },
  async getSentence(word) {
    return word.sentence;
  },
};

export const localCoachAdapter: CoachProviderAdapter = {
  id: "seed-coach",
  label: "Seed Coach",
  async summarizeMiss(word, attempt, result) {
    const reason =
      result === "timeout"
        ? "Time ran out before the spelling locked in."
        : `Your attempt was "${attempt || "blank"}".`;

    return `${reason} ${word.coachingNote}`;
  },
};

export const providerCards: ProviderCard[] = [
  {
    id: "pronouncer",
    label: "Pronouncer Adapter",
    role: "pronouncer",
    detail:
      "Pronouncer playback routes through a server provider when configured, with browser speech available as fallback.",
    status: "ready",
  },
  {
    id: "dictionary",
    label: "Dictionary Adapter",
    role: "dictionary",
    detail:
      "Dictionary access now routes through a provider layer: Merriam-Webster when configured, local seed fallback otherwise.",
    status: "ready",
  },
  {
    id: "coach",
    label: "Coach Adapter",
    role: "coach",
    detail:
      "Coach feedback is deterministic for now, ready to upgrade to a lightweight model when credentials are wired.",
    status: "ready",
  },
];

export function getPromptPreview(
  word: DrillWord,
  promptKind: "repeat" | "definition" | "sentence" | "origin",
) {
  if (promptKind === "repeat") {
    return `Pronouncer repeats the word. ${word.pronunciationNote}`;
  }

  if (promptKind === "definition") {
    return word.definition;
  }

  if (promptKind === "sentence") {
    return word.sentence;
  }

  return word.origin;
}
