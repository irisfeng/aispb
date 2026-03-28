import {
  classifyPronouncerAgentIntent,
  type PronouncerAgentIntentKind,
} from "@/lib/pronouncer-agent";
import { normalizeSpokenSpellingAttempt } from "@/lib/spoken-spelling";
import type { DrillPromptKind } from "@/lib/types";

const OPENAI_TRANSCRIBE_MODEL = "gpt-4o-mini-transcribe";
const OPENAI_ROUTER_MODEL = "gpt-4o-mini";

const VOLC_LLM_BASE_URL = "https://ark.cn-beijing.volces.com/api/v3";

const supportedVoiceTurnIntents = [
  "repeat",
  "definition",
  "sentence",
  "origin",
  "part-of-speech",
  "all-info",
  "ready-to-spell",
  "start-over",
  "disallowed",
  "spelling",
  "clarify",
] as const;

type SupportedVoiceTurnIntent = (typeof supportedVoiceTurnIntents)[number];

type VoiceTurnConfidence = "low" | "medium" | "high";

interface OpenAiRouterResult {
  confidence: VoiceTurnConfidence;
  intent: SupportedVoiceTurnIntent;
  normalized_letters: string;
}

export type VoiceTurnIntent =
  | DrillPromptKind
  | "ready-to-spell"
  | "start-over"
  | "disallowed"
  | "spelling"
  | "clarify";

export interface VoiceTurnStatusPayload {
  configured: boolean;
  detail: string;
  provider: string;
  routerModel: string | null;
  transcriptionModel: string | null;
}

export interface VoiceTurnResultPayload {
  confidence: VoiceTurnConfidence;
  intent: VoiceTurnIntent;
  normalizedLetters: string;
  provider: string;
  transcript: string;
  usedCloud: boolean;
}

function getOpenAiApiKey() {
  return process.env.OPENAI_API_KEY?.trim() || "";
}

function getVolcLlmApiKey(): string {
  return process.env.VOLC_LLM_API_KEY?.trim() || "";
}

function getVolcLlmEndpointId(): string {
  return process.env.VOLC_LLM_ENDPOINT_ID?.trim() || "";
}

function hasVolcLlmConfig(): boolean {
  return Boolean(getVolcLlmApiKey() && getVolcLlmEndpointId());
}

/**
 * True when the full cloud audio pipeline can work: audio transcription
 * (OpenAI) plus intent routing (Volc LLM or OpenAI).  The client uses this
 * to decide whether to take the cloud recording path.
 */
export function hasVoiceTurnConfig() {
  return Boolean(getOpenAiApiKey());
}

/**
 * True when server-side transcript routing is available (Volc LLM or
 * OpenAI).  This only matters for the transcript-only code path — it does
 * NOT imply that audio transcription works.
 */
export function hasVoiceTurnTranscriptConfig() {
  return hasVolcLlmConfig() || Boolean(getOpenAiApiKey());
}

export function getVoiceTurnProviderStatus(): VoiceTurnStatusPayload {
  const hasTranscription = Boolean(getOpenAiApiKey());

  if (!hasTranscription) {
    const transcriptOnly = hasVolcLlmConfig();
    return {
      configured: false,
      detail: transcriptOnly
        ? "Voice routing has a Volc LLM router but no OPENAI_API_KEY for audio transcription. Add OPENAI_API_KEY to enable cloud recording."
        : "Cloud voice routing is off. Add OPENAI_API_KEY to enable audio transcription; add VOLC_LLM_API_KEY + VOLC_LLM_ENDPOINT_ID for server-side intent routing. Browser speech stays available as fallback.",
      provider: transcriptOnly
        ? "Volcengine Doubao (transcript-only, no transcription)"
        : "Browser speech fallback",
      routerModel: transcriptOnly ? getVolcLlmEndpointId() : null,
      transcriptionModel: null,
    };
  }

  const provider = hasVolcLlmConfig() ? "Volcengine Doubao" : "OpenAI";
  const routerModel = hasVolcLlmConfig() ? getVolcLlmEndpointId() : OPENAI_ROUTER_MODEL;

  return {
    configured: true,
    detail: `Cloud voice routing is ready via ${provider}.`,
    provider: `${provider} voice router`,
    routerModel,
    transcriptionModel: OPENAI_TRANSCRIBE_MODEL,
  };
}

function isPromptIntent(
  value: PronouncerAgentIntentKind,
): value is DrillPromptKind | "ready-to-spell" | "start-over" | "disallowed" {
  return (
    value === "repeat" ||
    value === "definition" ||
    value === "sentence" ||
    value === "origin" ||
    value === "part-of-speech" ||
    value === "all-info" ||
    value === "ready-to-spell" ||
    value === "start-over" ||
    value === "disallowed"
  );
}

function sanitizeLetters(value: string) {
  return value.toLowerCase().replace(/[^a-z]/g, "");
}

function fallbackInterpretTranscript(transcript: string): VoiceTurnResultPayload {
  const normalizedAttempt = normalizeSpokenSpellingAttempt(transcript, {
    allowWholeWordFallback: true,
  });
  const intent = classifyPronouncerAgentIntent(transcript);

  if (normalizedAttempt.command === "start-over") {
    return {
      confidence: "high",
      intent: "start-over",
      normalizedLetters: "",
      provider: "Local voice router fallback",
      transcript,
      usedCloud: false,
    };
  }

  if (isPromptIntent(intent.kind)) {
    return {
      confidence: "medium",
      intent: intent.kind,
      normalizedLetters: "",
      provider: "Local voice router fallback",
      transcript,
      usedCloud: false,
    };
  }

  if (normalizedAttempt.candidate && normalizedAttempt.looksLikeSpelling) {
    return {
      confidence: "medium",
      intent: "spelling",
      normalizedLetters: normalizedAttempt.candidate,
      provider: "Local voice router fallback",
      transcript,
      usedCloud: false,
    };
  }

  return {
    confidence: "low",
    intent: "clarify",
    normalizedLetters: "",
    provider: "Local voice router fallback",
    transcript,
    usedCloud: false,
  };
}

async function transcribeAudioWithOpenAi(args: {
  audioBuffer: ArrayBuffer;
  contentType: string;
  filename: string;
}) {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    throw new Error("Missing OPENAI_API_KEY.");
  }

  const formData = new FormData();
  const extension =
    args.contentType.split("/")[1]?.split(";")[0]?.trim() || "webm";
  const file = new File([args.audioBuffer], `${args.filename}.${extension}`, {
    type: args.contentType,
  });

  formData.set("file", file);
  formData.set("model", OPENAI_TRANSCRIBE_MODEL);
  formData.set("language", "en");
  formData.set(
    "prompt",
    [
      "This is an English spelling bee practice recording.",
      "The speaker may ask for repeat, definition, sentence, part of speech, or origin.",
      "The speaker may also spell letters one by one, use NATO alphabet words, say double plus a letter, or say start over.",
      "Preserve letters and commands exactly instead of guessing a full word.",
    ].join(" "),
  );

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `OpenAI transcription failed: ${response.status} ${response.statusText} ${detail}`.trim(),
    );
  }

  const payload = (await response.json()) as { text?: string };

  return payload.text?.trim() || "";
}

function normalizeModelIntent(value: string): SupportedVoiceTurnIntent {
  if (
    supportedVoiceTurnIntents.includes(
      value as SupportedVoiceTurnIntent,
    )
  ) {
    return value as SupportedVoiceTurnIntent;
  }

  return "clarify";
}

async function routeTranscriptWithVolcDoubao(
  transcript: string,
): Promise<VoiceTurnResultPayload> {
  const apiKey = getVolcLlmApiKey();
  const endpointId = getVolcLlmEndpointId();

  if (!apiKey || !endpointId) {
    return fallbackInterpretTranscript(transcript);
  }

  const localInterpretation = fallbackInterpretTranscript(transcript);

  const response = await fetch(`${VOLC_LLM_BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: endpointId,
      messages: [
        {
          role: "system",
          content: [
            "You route utterances for a children's English spelling bee practice app.",
            "Allowed pronouncer intents: repeat, definition, sentence, origin, part-of-speech, all-info.",
            "Other supported intents: ready-to-spell, start-over, disallowed, spelling, clarify.",
            "Classify natural English requests generously.",
            "Only choose spelling when the utterance is mainly letters, NATO alphabet, or letter instructions like double a.",
            "Never guess missing letters from meaning or pronunciation.",
            "If uncertain between a clue request and spelling, choose clarify.",
            "normalized_letters must contain lowercase a-z only and stay empty unless intent is spelling.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            deterministic_candidate: localInterpretation.normalizedLetters,
            deterministic_confidence: localInterpretation.confidence,
            deterministic_intent: localInterpretation.intent,
            transcript,
          }),
        },
      ],
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(
      `Volcengine Doubao router failed: ${response.status} ${response.statusText} ${detail}`.trim(),
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: { content?: string | null };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return localInterpretation;
  }

  let parsed: OpenAiRouterResult | null = null;
  try {
    parsed = JSON.parse(content) as OpenAiRouterResult;
  } catch {
    return localInterpretation;
  }

  const normalizedLetters = sanitizeLetters(parsed.normalized_letters || "");
  const nextIntent = normalizeModelIntent(parsed.intent || "clarify");

  if (
    nextIntent === "spelling" &&
    !normalizedLetters &&
    localInterpretation.normalizedLetters
  ) {
    return {
      ...localInterpretation,
      provider: "Volcengine Doubao",
      transcript,
      usedCloud: true,
    };
  }

  if (
    nextIntent === "clarify" &&
    localInterpretation.intent !== "clarify" &&
    localInterpretation.confidence !== "low"
  ) {
    return {
      ...localInterpretation,
      provider: "Volcengine Doubao",
      transcript,
      usedCloud: true,
    };
  }

  return {
    confidence: parsed.confidence,
    intent: nextIntent,
    normalizedLetters,
    provider: "Volcengine Doubao",
    transcript,
    usedCloud: true,
  };
}

async function routeTranscriptWithOpenAi(
  transcript: string,
): Promise<VoiceTurnResultPayload> {
  const apiKey = getOpenAiApiKey();

  if (!apiKey) {
    return fallbackInterpretTranscript(transcript);
  }

  const localInterpretation = fallbackInterpretTranscript(transcript);
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_ROUTER_MODEL,
      messages: [
        {
          role: "system",
          content: [
            "You route utterances for a children's English spelling bee practice app.",
            "Allowed pronouncer intents: repeat, definition, sentence, origin, part-of-speech, all-info.",
            "Other supported intents: ready-to-spell, start-over, disallowed, spelling, clarify.",
            "Classify natural English requests generously.",
            "Only choose spelling when the utterance is mainly letters, NATO alphabet, or letter instructions like double a.",
            "Never guess missing letters from meaning or pronunciation.",
            "If uncertain between a clue request and spelling, choose clarify.",
            "normalized_letters must contain lowercase a-z only and stay empty unless intent is spelling.",
          ].join(" "),
        },
        {
          role: "user",
          content: JSON.stringify({
            deterministic_candidate: localInterpretation.normalizedLetters,
            deterministic_confidence: localInterpretation.confidence,
            deterministic_intent: localInterpretation.intent,
            transcript,
          }),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "voice_turn_router",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              confidence: {
                type: "string",
                enum: ["low", "medium", "high"],
              },
              intent: {
                type: "string",
                enum: [...supportedVoiceTurnIntents],
              },
              normalized_letters: {
                type: "string",
              },
            },
            required: ["confidence", "intent", "normalized_letters"],
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const detail = await response.text();

    throw new Error(
      `OpenAI router failed: ${response.status} ${response.statusText} ${detail}`.trim(),
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
      };
    }>;
  };
  const content = payload.choices?.[0]?.message?.content;

  if (!content) {
    return fallbackInterpretTranscript(transcript);
  }

  let parsed: OpenAiRouterResult | null = null;

  try {
    parsed = JSON.parse(content) as OpenAiRouterResult;
  } catch {
    return fallbackInterpretTranscript(transcript);
  }

  const normalizedLetters = sanitizeLetters(parsed.normalized_letters || "");
  const nextIntent = normalizeModelIntent(parsed.intent || "clarify");

  if (
    nextIntent === "spelling" &&
    !normalizedLetters &&
    localInterpretation.normalizedLetters
  ) {
    return {
      ...localInterpretation,
      provider: "OpenAI voice router",
      transcript,
      usedCloud: true,
    };
  }

  if (
    nextIntent === "clarify" &&
    localInterpretation.intent !== "clarify" &&
    localInterpretation.confidence !== "low"
  ) {
    return {
      ...localInterpretation,
      provider: "OpenAI voice router",
      transcript,
      usedCloud: true,
    };
  }

  return {
    confidence: parsed.confidence,
    intent: nextIntent,
    normalizedLetters,
    provider: "OpenAI voice router",
    transcript,
    usedCloud: true,
  };
}

export async function interpretVoiceTurnFromTranscript(
  transcript: string,
): Promise<VoiceTurnResultPayload> {
  const trimmedTranscript = transcript.trim();

  if (!trimmedTranscript) {
    return {
      confidence: "low",
      intent: "clarify",
      normalizedLetters: "",
      provider: hasVoiceTurnTranscriptConfig()
        ? "Cloud voice router"
        : "Local voice router fallback",
      transcript: "",
      usedCloud: hasVoiceTurnTranscriptConfig(),
    };
  }

  try {
    if (hasVolcLlmConfig()) {
      return await routeTranscriptWithVolcDoubao(trimmedTranscript);
    }
  } catch (error) {
    console.error("volcengine doubao router fallback", error);
  }

  try {
    if (getOpenAiApiKey()) {
      return await routeTranscriptWithOpenAi(trimmedTranscript);
    }
  } catch (error) {
    console.error("openai router fallback", error);
  }

  return fallbackInterpretTranscript(trimmedTranscript);
}

export async function interpretVoiceTurnFromAudio(args: {
  audioBuffer: ArrayBuffer;
  contentType: string;
  filename: string;
}): Promise<VoiceTurnResultPayload> {
  try {
    const transcript = await transcribeAudioWithOpenAi(args);

    return await routeTranscriptWithOpenAi(transcript);
  } catch (error) {
    console.error("voice turn audio fallback", error);

    return {
      confidence: "low",
      intent: "clarify",
      normalizedLetters: "",
      provider: "Voice capture fallback",
      transcript: "",
      usedCloud: false,
    };
  }
}
