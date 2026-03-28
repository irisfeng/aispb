import type { DrillWord } from "@/lib/types";

export interface DictionaryCuePayload {
  word: string;
  definition: string;
  sentence: string;
  origin: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  provider: string;
  fallback: boolean;
}

export interface PronouncerStatusPayload {
  configured: boolean;
  detail: string;
  provider: string;
  mode: "v3" | "legacy" | "unconfigured";
  speaker: string | null;
  format: string | null;
}

export interface PronouncerAudioPayload {
  blob: Blob;
  provider: string;
  speaker: string | null;
  durationSeconds: number | null;
}

export interface VoiceTurnStatusPayload {
  configured: boolean;
  detail: string;
  provider: string;
  routerModel: string | null;
  transcriptionModel: string | null;
}

export type VoiceTurnIntent =
  | "repeat"
  | "definition"
  | "sentence"
  | "origin"
  | "part-of-speech"
  | "all-info"
  | "ready-to-spell"
  | "start-over"
  | "disallowed"
  | "spelling"
  | "clarify";

export interface VoiceTurnResultPayload {
  confidence: "low" | "medium" | "high";
  intent: VoiceTurnIntent;
  normalizedLetters: string;
  provider: string;
  transcript: string;
  usedCloud: boolean;
}

export async function fetchDictionaryCue(
  word: DrillWord,
): Promise<DictionaryCuePayload> {
  const response = await fetch(
    `/api/dictionary?word=${encodeURIComponent(word.word)}`,
    {
      cache: "no-store",
    },
  );

  if (!response.ok) {
    throw new Error(`Dictionary lookup failed with ${response.status}`);
  }

  return (await response.json()) as DictionaryCuePayload;
}

export async function fetchPronouncerStatus(): Promise<PronouncerStatusPayload> {
  const response = await fetch("/api/pronouncer", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Pronouncer status lookup failed with ${response.status}`);
  }

  return (await response.json()) as PronouncerStatusPayload;
}

export async function fetchVoiceTurnStatus(): Promise<VoiceTurnStatusPayload> {
  const response = await fetch("/api/voice-turn", {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Voice turn status lookup failed with ${response.status}`);
  }

  return (await response.json()) as VoiceTurnStatusPayload;
}

export async function interpretVoiceTurnTranscript(
  transcript: string,
): Promise<VoiceTurnResultPayload> {
  const response = await fetch("/api/voice-turn", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ transcript }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Voice turn transcript failed with ${response.status}`);
  }

  return (await response.json()) as VoiceTurnResultPayload;
}

export async function interpretVoiceTurnAudio(
  audio: Blob,
): Promise<VoiceTurnResultPayload> {
  const formData = new FormData();

  formData.set("audio", audio, "voice-turn.webm");

  const response = await fetch("/api/voice-turn", {
    method: "POST",
    body: formData,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`Voice turn audio failed with ${response.status}`);
  }

  return (await response.json()) as VoiceTurnResultPayload;
}

export async function fetchPronouncerAudio(
  text: string,
): Promise<PronouncerAudioPayload> {
  const response = await fetch("/api/pronouncer", {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({ text }),
    cache: "no-store",
  });

  if (!response.ok) {
    let detail = "";

    try {
      const errorPayload = (await response.json()) as {
        detail?: string | null;
        error?: string;
      };

      detail = errorPayload.detail
        ? `${errorPayload.error ?? "Pronouncer request failed."} ${errorPayload.detail}`.trim()
        : (errorPayload.error ?? "");
    } catch {
      detail = "";
    }

    throw new Error(
      detail || `Pronouncer request failed with ${response.status}`,
    );
  }

  const durationHeader = response.headers.get("x-aispb-duration-seconds");
  const durationSeconds =
    durationHeader && !Number.isNaN(Number(durationHeader))
      ? Number(durationHeader)
      : null;

  return {
    blob: await response.blob(),
    provider:
      response.headers.get("x-aispb-provider") ??
      "Volcengine Doubao Speech TTS V3",
    speaker: response.headers.get("x-aispb-speaker"),
    durationSeconds,
  };
}
