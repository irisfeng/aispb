import type { DictionaryCuePayload } from "@/lib/provider-client";
import type { DrillPromptKind, DrillWord } from "@/lib/types";

export type PronouncerAgentIntentKind =
  | DrillPromptKind
  | "ready-to-spell"
  | "start-over"
  | "disallowed"
  | "unknown";

export interface PronouncerAgentIntent {
  kind: PronouncerAgentIntentKind;
  transcript: string;
}

export interface PronouncerAgentReply {
  label: string;
  displayText: string;
  speechText: string | null;
  promptKind: DrillPromptKind | null;
  tone: "system" | "hint";
}

const requestMatchers: Array<{
  kind: PronouncerAgentIntentKind;
  phrases: string[];
}> = [
  {
    kind: "all-info",
    phrases: [
      "all of it",
      "all the information",
      "everything",
      "give me everything",
      "all the clues",
    ],
  },
  {
    kind: "part-of-speech",
    phrases: [
      "part of speech",
      "what part of speech",
      "what kind of word",
      "is it a noun",
      "is it a verb",
      "noun or verb",
    ],
  },
  {
    kind: "definition",
    phrases: [
      "definition",
      "what does it mean",
      "meaning",
      "define it",
      "define the word",
      "what is the definition",
      "what does the word mean",
      "can i have the definition",
      "may i have the definition",
    ],
  },
  {
    kind: "sentence",
    phrases: [
      "sentence",
      "use it in a sentence",
      "put it in a sentence",
      "can you use it in a sentence",
      "may i have a sentence",
      "can i have a sentence",
      "use the word in a sentence",
    ],
  },
  {
    kind: "origin",
    phrases: [
      "origin",
      "language of origin",
      "where does it come from",
      "what language",
      "etymology",
      "what is the origin",
      "may i have the language of origin",
      "can i have the origin",
    ],
  },
  {
    kind: "repeat",
    phrases: [
      "repeat",
      "say it again",
      "again please",
      "pronounce it again",
      "can you repeat",
      "repeat the word",
      "say it one more time",
      "could you repeat that",
      "can you say that again",
      "i didn't catch that",
    ],
  },
  {
    kind: "start-over",
    phrases: ["start over", "start again", "begin again", "restart"],
  },
  {
    kind: "ready-to-spell",
    phrases: [
      "ready",
      "i'm ready",
      "i am ready",
      "that is all",
      "ready to spell",
    ],
  },
  {
    kind: "disallowed",
    phrases: [
      "spell it",
      "spell the word",
      "first letter",
      "starts with",
      "how many letters",
      "give me a hint",
      "what is the spelling",
      "what are the letters",
    ],
  },
];

function normalizeTranscriptText(transcript: string) {
  return transcript
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()?]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function includesPhrase(transcript: string, phrase: string) {
  return transcript === phrase || transcript.includes(phrase);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function classifyPronouncerAgentIntent(
  transcript: string,
): PronouncerAgentIntent {
  const normalizedTranscript = normalizeTranscriptText(transcript);

  for (const matcher of requestMatchers) {
    if (
      matcher.phrases.some((phrase) =>
        includesPhrase(normalizedTranscript, normalizeTranscriptText(phrase)),
      )
    ) {
      return {
        kind: matcher.kind,
        transcript: normalizedTranscript,
      };
    }
  }

  return {
    kind: "unknown",
    transcript: normalizedTranscript,
  };
}

export function maskWordInVisibleText(text: string, word: DrillWord) {
  if (!text.trim()) {
    return text;
  }

  const mask = "•••••";
  const exactWordPattern = new RegExp(`\\b${escapeRegExp(word.word)}\\b`, "gi");

  return text.replace(exactWordPattern, mask);
}

function buildAllInfoCopy(word: DrillWord, cue: DictionaryCuePayload | null) {
  const definition = cue?.definition ?? word.definition ?? "";
  const partOfSpeech = cue?.partOfSpeech ?? "";
  const sentence = cue?.sentence ?? word.sentence ?? "";
  const origin = cue?.origin ?? word.origin ?? "";

  const segments: string[] = [];

  if (definition) {
    segments.push(`The definition is: ${maskWordInVisibleText(definition, word)}`);
  }
  if (partOfSpeech) {
    segments.push(`It's a ${partOfSpeech}.`);
  }
  if (sentence) {
    segments.push(`Here is a sentence: ${maskWordInVisibleText(sentence, word)}`);
  }
  if (origin) {
    segments.push(`The origin is ${maskWordInVisibleText(origin, word)}`);
  }

  const combined = segments.join(" ");

  return {
    displayText: combined || "No additional information is available.",
    speechText: combined || "No additional information is available.",
  };
}

export function buildPronouncerAgentReply(args: {
  intent: PronouncerAgentIntent;
  word: DrillWord;
  cue: DictionaryCuePayload | null;
}): PronouncerAgentReply {
  const { cue, intent, word } = args;

  function pickVariant(variants: string[]): string {
    return variants[Math.floor(Math.random() * variants.length)];
  }

  switch (intent.kind) {
    case "repeat":
      return {
        label: "Pronouncer",
        displayText: "The word has been repeated.",
        speechText: word.word,
        promptKind: "repeat",
        tone: "system",
      };
    case "definition": {
      const definitionRaw = cue?.definition ?? word.definition;
      if (!definitionRaw) {
        return {
          label: "Pronouncer",
          displayText: "Definition is not available for this word.",
          speechText: "Definition is not available for this word.",
          promptKind: "definition",
          tone: "hint",
        };
      }
      const prefix = pickVariant([
        "The definition is:",
        "It means:",
        "The definition:",
      ]);
      const full = `${prefix} ${definitionRaw}`;
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(full, word),
        speechText: maskWordInVisibleText(full, word),
        promptKind: "definition",
        tone: "hint",
      };
    }
    case "sentence": {
      const sentenceRaw = cue?.sentence ?? word.sentence;
      if (!sentenceRaw) {
        return {
          label: "Pronouncer",
          displayText: "A sentence is not available for this word.",
          speechText: "A sentence is not available for this word.",
          promptKind: "sentence",
          tone: "hint",
        };
      }
      const prefix = pickVariant([
        "Here is a sentence:",
        "Used in a sentence:",
        "A sentence:",
      ]);
      const full = `${prefix} ${sentenceRaw}`;
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(full, word),
        speechText: maskWordInVisibleText(full, word),
        promptKind: "sentence",
        tone: "hint",
      };
    }
    case "origin": {
      const originRaw = cue?.origin ?? word.origin;
      if (!originRaw) {
        return {
          label: "Pronouncer",
          displayText: "Origin is not available for this word.",
          speechText: "Origin is not available for this word.",
          promptKind: "origin",
          tone: "hint",
        };
      }
      const prefix = pickVariant([
        "The origin is",
        "It comes from",
        "The language of origin:",
      ]);
      const full = `${prefix} ${originRaw}`;
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(full, word),
        speechText: maskWordInVisibleText(full, word),
        promptKind: "origin",
        tone: "hint",
      };
    }
    case "part-of-speech": {
      if (!cue?.partOfSpeech) {
        return {
          label: "Pronouncer",
          displayText: "Part of speech is not available.",
          speechText: "Part of speech is not available.",
          promptKind: "part-of-speech",
          tone: "hint",
        };
      }
      const pos = cue.partOfSpeech;
      const variant = pickVariant([
        `It's a ${pos}.`,
        `The word is a ${pos}.`,
        `That's a ${pos}.`,
      ]);
      return {
        label: "Pronouncer",
        displayText: variant,
        speechText: variant,
        promptKind: "part-of-speech",
        tone: "hint",
      };
    }
    case "all-info": {
      const allInfoCopy = buildAllInfoCopy(word, cue);

      return {
        label: "Pronouncer",
        displayText: allInfoCopy.displayText,
        speechText: allInfoCopy.speechText,
        promptKind: "all-info",
        tone: "hint",
      };
    }
    case "start-over": {
      const variant = "Say start over to clear your letters.";
      return {
        label: "Pronouncer",
        displayText: variant,
        speechText: variant,
        promptKind: null,
        tone: "system",
      };
    }
    case "ready-to-spell": {
      const variant = pickVariant([
        "Whenever you're ready.",
        "Go ahead.",
      ]);
      return {
        label: "Pronouncer",
        displayText: variant,
        speechText: variant,
        promptKind: null,
        tone: "system",
      };
    }
    case "disallowed": {
      const variant = pickVariant([
        "I can't help with that.",
        "That's not allowed in a Bee.",
        "I can't give spelling clues.",
      ]);
      return {
        label: "Pronouncer",
        displayText: variant,
        speechText: variant,
        promptKind: null,
        tone: "system",
      };
    }
    case "unknown":
    default: {
      const variant = pickVariant([
        "I didn't catch that.",
        "Could you say that again?",
        "I didn't get that.",
      ]);
      return {
        label: "Pronouncer",
        displayText: variant,
        speechText: variant,
        promptKind: null,
        tone: "system",
      };
    }
  }
}
