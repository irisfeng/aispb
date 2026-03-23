type MwPronunciation = {
  mw?: string;
};

type MwEntry = {
  meta?: {
    id?: string;
    stems?: string[];
  };
  fl?: string;
  hwi?: {
    prs?: MwPronunciation[];
  };
  shortdef?: string[];
  et?: unknown[];
  def?: Array<{
    sseq?: unknown[];
  }>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMwEntry(value: unknown): value is MwEntry {
  return isRecord(value);
}

function normalizeQuery(word: string) {
  return word.trim().toLowerCase();
}

function normalizeMwText(value: string) {
  return value
    .replace(/\{(?:a_link|d_link|et_link|i_link|mat|sx)\|([^|}]+)(?:\|[^}]*)?\}/g, "$1")
    .replace(/\{\/?(?:it|b|inf|sup|sc|wi|phrase|qword|gloss|parahw)\}/g, "")
    .replace(/\{bc\}/g, "")
    .replace(/\{ldquo\}/g, "\"")
    .replace(/\{rdquo\}/g, "\"")
    .replace(/\{p_br\}/g, " ")
    .replace(/\{[^}]+\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function extractEtymology(entry: MwEntry) {
  if (!Array.isArray(entry.et)) {
    return null;
  }

  for (const item of entry.et) {
    if (
      Array.isArray(item) &&
      item[0] === "text" &&
      typeof item[1] === "string"
    ) {
      return normalizeMwText(item[1]);
    }
  }

  return null;
}

function extractSentence(node: unknown): string | null {
  if (Array.isArray(node)) {
    if (node[0] === "vis" && Array.isArray(node[1])) {
      for (const item of node[1]) {
        if (isRecord(item) && typeof item.t === "string") {
          return normalizeMwText(item.t);
        }
      }
    }

    for (const child of node) {
      const found = extractSentence(child);

      if (found) {
        return found;
      }
    }

    return null;
  }

  if (isRecord(node)) {
    for (const child of Object.values(node)) {
      const found = extractSentence(child);

      if (found) {
        return found;
      }
    }
  }

  return null;
}

function selectEntry(entries: MwEntry[], word: string) {
  const normalizedWord = normalizeQuery(word);

  return (
    entries.find((entry) =>
      entry.meta?.id?.split(":")[0]?.toLowerCase() === normalizedWord,
    ) ??
    entries.find((entry) =>
      entry.meta?.stems?.some((stem) => stem.toLowerCase() === normalizedWord),
    ) ??
    entries[0] ??
    null
  );
}

export function hasMerriamWebsterConfig() {
  return Boolean(process.env.MW_DICTIONARY_API_KEY);
}

export function getMerriamWebsterDictionaryType() {
  return process.env.MW_DICTIONARY_TYPE?.trim() || "collegiate";
}

export async function lookupMerriamWebsterWord(word: string) {
  const apiKey = process.env.MW_DICTIONARY_API_KEY;

  if (!apiKey) {
    return null;
  }

  const dictionaryType = getMerriamWebsterDictionaryType();
  const response = await fetch(
    `https://www.dictionaryapi.com/api/v3/references/${dictionaryType}/json/${encodeURIComponent(
      word,
    )}?key=${encodeURIComponent(apiKey)}`,
    {
      headers: {
        Accept: "application/json",
      },
      next: {
        revalidate: 86400,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Merriam-Webster lookup failed: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as unknown;

  if (!Array.isArray(payload)) {
    return null;
  }

  const entries = payload.filter(isMwEntry);
  const entry = selectEntry(entries, word);

  if (!entry) {
    return null;
  }

  return {
    provider: `Merriam-Webster ${dictionaryType}`,
    fallback: false,
    phonetic: entry.hwi?.prs?.[0]?.mw ?? null,
    partOfSpeech: entry.fl ?? null,
    definition:
      entry.shortdef?.map(normalizeMwText).filter(Boolean).join("; ") ?? null,
    sentence:
      extractSentence(entry.def) ??
      null,
    origin: extractEtymology(entry),
  };
}
