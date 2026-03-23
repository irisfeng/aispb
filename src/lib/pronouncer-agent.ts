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
    ],
  },
  {
    kind: "sentence",
    phrases: [
      "sentence",
      "use it in a sentence",
      "put it in a sentence",
      "can you use it in a sentence",
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
  const definition = cue?.definition ?? word.definition;
  const partOfSpeech = cue?.partOfSpeech
    ? `Part of speech: ${cue.partOfSpeech}.`
    : "";
  const sentence = cue?.sentence ?? word.sentence;
  const origin = cue?.origin ?? word.origin;

  return {
    displayText: [
      "Definition:",
      maskWordInVisibleText(definition, word),
      partOfSpeech,
      "Sentence:",
      maskWordInVisibleText(sentence, word),
      "Origin:",
      maskWordInVisibleText(origin, word),
    ]
      .filter(Boolean)
      .join(" "),
    speechText: [
      definition,
      partOfSpeech,
      sentence,
      origin,
    ]
      .filter(Boolean)
      .join(" "),
  };
}

export function buildPronouncerAgentReply(args: {
  intent: PronouncerAgentIntent;
  word: DrillWord;
  cue: DictionaryCuePayload | null;
}): PronouncerAgentReply {
  const { cue, intent, word } = args;

  switch (intent.kind) {
    case "repeat":
      return {
        label: "Pronouncer",
        displayText: "The pronouncer repeated the word aloud.",
        speechText: word.word,
        promptKind: "repeat",
        tone: "system",
      };
    case "definition":
      return {
        label: "Pronouncer",
        displayText: cue?.definition
          ? maskWordInVisibleText(cue.definition, word)
          : maskWordInVisibleText(word.definition, word),
        speechText: cue?.definition ?? word.definition,
        promptKind: "definition",
        tone: "hint",
      };
    case "sentence":
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(cue?.sentence ?? word.sentence, word),
        speechText: cue?.sentence ?? word.sentence,
        promptKind: "sentence",
        tone: "hint",
      };
    case "origin":
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(cue?.origin ?? word.origin, word),
        speechText: cue?.origin ?? word.origin,
        promptKind: "origin",
        tone: "hint",
      };
    case "part-of-speech":
      return {
        label: "Pronouncer",
        displayText:
          cue?.partOfSpeech ?? "Part of speech is not available in the active dictionary source yet.",
        speechText:
          cue?.partOfSpeech
            ? `Part of speech: ${cue.partOfSpeech}.`
            : "Part of speech is not available in the active dictionary source yet.",
        promptKind: "part-of-speech",
        tone: "hint",
      };
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
    case "start-over":
      return {
        label: "Pronouncer",
        displayText:
          "Say or tap start over while spelling to clear the captured letters. The Bee does not allow reordered letters after a restart.",
        speechText:
          "Say start over while spelling to clear the captured letters. In Bee rules, earlier letters may not be reordered after a restart.",
        promptKind: null,
        tone: "system",
      };
    case "ready-to-spell":
      return {
        label: "Pronouncer",
        displayText:
          "Proceed when ready. Use the Spell button to capture the oral spelling attempt.",
        speechText:
          "Proceed when ready. Start spelling when you are set.",
        promptKind: null,
        tone: "system",
      };
    case "disallowed":
      return {
        label: "Pronouncer",
        displayText:
          "I can repeat the word, give the definition, part of speech, origin, or use it in a sentence. I cannot give spelling clues.",
        speechText:
          "I can repeat the word, give the definition, part of speech, origin, or use it in a sentence. I cannot give spelling clues.",
        promptKind: null,
        tone: "system",
      };
    case "unknown":
    default:
      return {
        label: "Pronouncer",
        displayText:
          "Try a Bee-style request such as repeat, definition, part of speech, sentence, or origin.",
        speechText:
          "Try a Bee-style request such as repeat, definition, part of speech, sentence, or origin.",
        promptKind: null,
        tone: "system",
      };
  }
}
