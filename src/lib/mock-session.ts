import type { DrillPreset, DrillPromptKind, ProviderCard } from "@/lib/types";

export const drillPreset: DrillPreset = {
  dailyGoal: 20,
  roundDurationSeconds: 60,
  modeLabel: "Training 60",
  words: [
    {
      id: "verdant",
      word: "verdant",
      phonetic: "VUR-dunt",
      category: "junior warm-up",
      pronunciationNote: "Primary stress on the first syllable.",
      definition: "Green with vegetation or fresh growth.",
      sentence:
        "After the spring rain, the hillside looked wonderfully green and lush.",
      origin:
        "From a word that traces back through French to Latin, meaning green.",
      coachingNote: "Anchor on the opening ver- and finish cleanly with -dant.",
    },
    {
      id: "echelon",
      word: "echelon",
      phonetic: "ESH-uh-lahn",
      category: "pressure round",
      pronunciationNote: "The first syllable sounds like 'esh'.",
      definition: "A level or rank in an organization or system.",
      sentence: "She quickly rose to the top rank of the debate team.",
      origin:
        "From French, originally referring to a rung or ladder formation.",
      coachingNote:
        "The tricky part is the middle schwa sound before the final -lon.",
    },
    {
      id: "halcyon",
      word: "halcyon",
      phonetic: "HAL-see-uhn",
      category: "boss round",
      pronunciationNote: "Keep the middle syllable light and smooth.",
      definition:
        "Calm, peaceful, or prosperous, often when recalling an earlier time.",
      sentence:
        "They spoke fondly of those calm and golden summers by the lake.",
      origin: "From Greek myth, linked to a bird associated with calm seas.",
      coachingNote: "Watch the -cyon ending; it sounds softer than it looks.",
    },
  ],
};

export const providerCards: ProviderCard[] = [
  {
    id: "pronouncer",
    label: "Pronouncer Adapter",
    role: "pronouncer",
    detail:
      "TTS adapter slot for Doubao, Polly, or OpenAI with cached word audio.",
    status: "ready",
  },
  {
    id: "dictionary",
    label: "Dictionary Adapter",
    role: "dictionary",
    detail:
      "Structured cue layer staged for Merriam-Webster API and later licensing paths.",
    status: "planned",
  },
  {
    id: "coach",
    label: "Coach Adapter",
    role: "coach",
    detail:
      "Flash-tier model slot for miss explanation, encouragement, and review summaries.",
    status: "ready",
  },
];

export const promptOrder: DrillPromptKind[] = [
  "repeat",
  "definition",
  "sentence",
  "origin",
];
