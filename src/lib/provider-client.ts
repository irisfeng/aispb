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
  provider: string;
  speaker: string | null;
  format: string | null;
}

export interface PronouncerAudioPayload {
  blob: Blob;
  provider: string;
  speaker: string | null;
  durationSeconds: number | null;
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
    throw new Error(`Pronouncer request failed with ${response.status}`);
  }

  const durationHeader = response.headers.get("x-aispb-duration-seconds");
  const durationSeconds =
    durationHeader && !Number.isNaN(Number(durationHeader))
      ? Number(durationHeader)
      : null;

  return {
    blob: await response.blob(),
    provider:
      response.headers.get("x-aispb-provider") ?? "Volcengine short-text TTS",
    speaker: response.headers.get("x-aispb-speaker"),
    durationSeconds,
  };
}
