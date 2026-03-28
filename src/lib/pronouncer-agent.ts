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
  const partOfSpeech = cue?.partOfSpeech
    ? `Part of speech: ${cue.partOfSpeech}.`
    : "";
  const sentence = cue?.sentence ?? word.sentence ?? "";
  const origin = cue?.origin ?? word.origin ?? "";
  const maskedDefinition = maskWordInVisibleText(definition, word);
  const maskedSentence = maskWordInVisibleText(sentence, word);
  const maskedOrigin = maskWordInVisibleText(origin, word);

  return {
    displayText: [
      "Definition:",
      maskedDefinition,
      partOfSpeech,
      "Sentence:",
      maskedSentence,
      "Origin:",
      maskedOrigin,
    ]
      .filter(Boolean)
      .join(" "),
    speechText: [
      maskedDefinition,
      partOfSpeech,
      maskedSentence,
      maskedOrigin,
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

  function pickVariant(variants: string[]): string {
    return variants[Math.floor(Math.random() * variants.length)];
  }

  switch (intent.kind) {
    case "repeat":
      return {
        label: "Pronouncer",
        displayText: "The pronouncer repeated the word aloud.",
        speechText: word.word,
        promptKind: "repeat",
        tone: "system",
      };
    case "definition": {
      const definitionRaw = cue?.definition ?? word.definition ?? "Definition not available.";
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(definitionRaw, word),
        speechText: maskWordInVisibleText(definitionRaw, word),
        promptKind: "definition",
        tone: "hint",
      };
    }
    case "sentence": {
      const sentenceRaw = cue?.sentence ?? word.sentence ?? "Example sentence not available.";
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(sentenceRaw, word),
        speechText: maskWordInVisibleText(sentenceRaw, word),
        promptKind: "sentence",
        tone: "hint",
      };
    }
    case "origin": {
      const originRaw = cue?.origin ?? word.origin ?? "Origin not available.";
      return {
        label: "Pronouncer",
        displayText: maskWordInVisibleText(originRaw, word),
        speechText: maskWordInVisibleText(originRaw, word),
        promptKind: "origin",
        tone: "hint",
      };
    }
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
    case "start-over": {
      const displayVariant = pickVariant([
        "Say or tap start over while spelling to clear the captured letters. The Bee does not allow reordered letters after a restart.",
        "You can restart by saying or tapping start over. Bear in mind that Bee rules do not allow reordering earlier letters after a restart.",
        "To clear your letters and begin again, say or tap start over. Note that Bee rules prohibit reordering letters once you restart.",
      ]);
      const speechVariant = pickVariant([
        "Say start over while spelling to clear the captured letters. In Bee rules, earlier letters may not be reordered after a restart.",
        "To restart, say start over. Remember that once you restart, you cannot reorder any letters you already gave.",
        "Go ahead and say start over to clear your letters. Keep in mind that Bee rules do not let you rearrange letters after a restart.",
      ]);
      return {
        label: "Pronouncer",
        displayText: displayVariant,
        speechText: speechVariant,
        promptKind: null,
        tone: "system",
      };
    }
    case "ready-to-spell": {
      const displayVariant = pickVariant([
        "Proceed when ready. Tap Talk and spell the letters aloud when you are set.",
        "Whenever you are set, begin spelling the word letter by letter.",
        "Take your time. Start spelling when you feel confident.",
      ]);
      const speechVariant = pickVariant([
        "Proceed when ready. Tap talk and start spelling when you are set.",
        "Whenever you are set, go ahead and spell the word letter by letter.",
        "Take your time. Begin spelling when you feel confident.",
      ]);
      return {
        label: "Pronouncer",
        displayText: displayVariant,
        speechText: speechVariant,
        promptKind: null,
        tone: "system",
      };
    }
    case "disallowed": {
      const disallowedVariant = pickVariant([
        "I can repeat the word, give the definition, part of speech, origin, or use it in a sentence. I cannot give spelling clues.",
        "Sorry, I am not allowed to help with spelling directly. I can repeat the word, give the definition, part of speech, origin, or use it in a sentence.",
        "That is not something I can help with in a Bee. Try asking me to repeat the word, give the definition, part of speech, origin, or use it in a sentence.",
      ]);
      return {
        label: "Pronouncer",
        displayText: disallowedVariant,
        speechText: disallowedVariant,
        promptKind: null,
        tone: "system",
      };
    }
    case "unknown":
    default: {
      const unknownVariant = pickVariant([
        "Try a Bee-style request such as repeat, definition, part of speech, sentence, or origin.",
        "I did not quite catch that. You can ask me to repeat the word, give the definition, part of speech, sentence, or origin.",
        "Hmm, I am not sure what you need. Try asking to repeat the word, get the definition, part of speech, sentence, or origin.",
      ]);
      return {
        label: "Pronouncer",
        displayText: unknownVariant,
        speechText: unknownVariant,
        promptKind: null,
        tone: "system",
      };
    }
  }
}
