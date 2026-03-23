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
