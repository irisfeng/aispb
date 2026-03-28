import type { DrillWord } from "@/lib/types";

export type SpellingMismatchReason =
  | "blank"
  | "wrong-letter"
  | "missing-letter"
  | "extra-letter";

export interface SpellingJudgement {
  actualLetter: string | null;
  candidate: string;
  expectedLetter: string | null;
  isCorrect: boolean;
  mismatchIndex: number | null;
  normalizedWord: string;
  reason: SpellingMismatchReason | null;
}

export function judgeSpellingAttempt(
  word: Pick<DrillWord, "word">,
  candidate: string,
): SpellingJudgement {
  const normalizedWord = word.word.trim().toLowerCase();
  const normalizedCandidate = candidate.trim().toLowerCase();

  if (!normalizedCandidate) {
    return {
      actualLetter: null,
      candidate: normalizedCandidate,
      expectedLetter: normalizedWord[0] ?? null,
      isCorrect: false,
      mismatchIndex: 0,
      normalizedWord,
      reason: "blank",
    };
  }

  const sharedLength = Math.min(
    normalizedWord.length,
    normalizedCandidate.length,
  );

  for (let index = 0; index < sharedLength; index += 1) {
    if (normalizedWord[index] !== normalizedCandidate[index]) {
      return {
        actualLetter: normalizedCandidate[index] ?? null,
        candidate: normalizedCandidate,
        expectedLetter: normalizedWord[index] ?? null,
        isCorrect: false,
        mismatchIndex: index,
        normalizedWord,
        reason: "wrong-letter",
      };
    }
  }

  if (normalizedCandidate.length < normalizedWord.length) {
    return {
      actualLetter: null,
      candidate: normalizedCandidate,
      expectedLetter: normalizedWord[normalizedCandidate.length] ?? null,
      isCorrect: false,
      mismatchIndex: normalizedCandidate.length,
      normalizedWord,
      reason: "missing-letter",
    };
  }

  if (normalizedCandidate.length > normalizedWord.length) {
    return {
      actualLetter: normalizedCandidate[normalizedWord.length] ?? null,
      candidate: normalizedCandidate,
      expectedLetter: null,
      isCorrect: false,
      mismatchIndex: normalizedWord.length,
      normalizedWord,
      reason: "extra-letter",
    };
  }

  return {
    actualLetter: null,
    candidate: normalizedCandidate,
    expectedLetter: null,
    isCorrect: true,
    mismatchIndex: null,
    normalizedWord,
    reason: null,
  };
}
