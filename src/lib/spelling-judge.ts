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
  /** When the candidate matched a British/American variant, the accepted form */
  acceptedVariant: string | null;
}

// ---------------------------------------------------------------------------
// British ↔ American spelling variant rules
//
// Each rule is a pair of regex patterns + replacements that transform one
// variant into the other.  Given a target word, we generate all known
// alternate spellings and accept any of them as correct.
// ---------------------------------------------------------------------------

interface VariantRule {
  /** Pattern to match in a word */
  from: RegExp;
  /** Replacement string */
  to: string;
}

/**
 * Bidirectional rules: each pair [a, b] means "a → b" AND "b → a".
 * We apply every rule independently to generate all variant spellings.
 */
const VARIANT_RULE_PAIRS: Array<[VariantRule, VariantRule]> = [
  // -ise ↔ -ize  (organise/organize, maximise/maximize …)
  [{ from: /ise$/g, to: "ize" }, { from: /ize$/g, to: "ise" }],
  [{ from: /ised$/g, to: "ized" }, { from: /ized$/g, to: "ised" }],
  [{ from: /ising$/g, to: "izing" }, { from: /izing$/g, to: "ising" }],
  [{ from: /isation$/g, to: "ization" }, { from: /ization$/g, to: "isation" }],

  // -our ↔ -or  (colour/color, honour/honor …)
  [{ from: /our$/g, to: "or" }, { from: /or$/g, to: "our" }],
  [{ from: /ours$/g, to: "ors" }, { from: /ors$/g, to: "ours" }],
  [{ from: /oured$/g, to: "ored" }, { from: /ored$/g, to: "oured" }],
  [{ from: /ouring$/g, to: "oring" }, { from: /oring$/g, to: "ouring" }],

  // -re ↔ -er  (centre/center, theatre/theater …)
  [{ from: /tre$/g, to: "ter" }, { from: /ter$/g, to: "tre" }],
  [{ from: /tres$/g, to: "ters" }, { from: /ters$/g, to: "tres" }],

  // -ence ↔ -ense  (defence/defense, licence/license …)
  [{ from: /ence$/g, to: "ense" }, { from: /ense$/g, to: "ence" }],

  // -lled ↔ -led, -lling ↔ -ling, -ller ↔ -ler  (travelled/traveled …)
  [{ from: /lled$/g, to: "led" }, { from: /(?<=[aeiou])led$/g, to: "lled" }],
  [{ from: /lling$/g, to: "ling" }, { from: /(?<=[aeiou])ling$/g, to: "lling" }],
  [{ from: /ller$/g, to: "ler" }, { from: /(?<=[aeiou])ler$/g, to: "ller" }],
  [{ from: /llor$/g, to: "lor" }, { from: /(?<=[aeiou])lor$/g, to: "llor" }],

  // -ogue ↔ -og  (catalogue/catalog, dialogue/dialog …)
  [{ from: /ogue$/g, to: "og" }, { from: /og$/g, to: "ogue" }],

  // -ae-/-oe- ↔ -e-  (anaemia/anemia, foetus/fetus …)
  [{ from: /ae/g, to: "e" }, { from: /e/g, to: "ae" }],
  [{ from: /oe/g, to: "e" }, { from: /e/g, to: "oe" }],

  // grey ↔ gray
  [{ from: /grey/g, to: "gray" }, { from: /gray/g, to: "grey" }],
];

/**
 * Generate all known British/American spelling variants for a word.
 * Returns an empty set if no rules match.
 */
function generateVariants(word: string): Set<string> {
  const variants = new Set<string>();

  for (const [ruleA, ruleB] of VARIANT_RULE_PAIRS) {
    if (ruleA.from.test(word)) {
      // Reset lastIndex for global regexes
      ruleA.from.lastIndex = 0;
      variants.add(word.replace(ruleA.from, ruleA.to));
    }
    if (ruleB.from.test(word)) {
      ruleB.from.lastIndex = 0;
      variants.add(word.replace(ruleB.from, ruleB.to));
    }
  }

  // Remove the original word if it ended up in the set
  variants.delete(word);
  return variants;
}

function exactMatch(word: string, candidate: string): boolean {
  return word === candidate;
}

function buildMismatchResult(
  normalizedWord: string,
  normalizedCandidate: string,
): SpellingJudgement {
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
        acceptedVariant: null,
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
      acceptedVariant: null,
    };
  }

  // extra-letter
  return {
    actualLetter: normalizedCandidate[normalizedWord.length] ?? null,
    candidate: normalizedCandidate,
    expectedLetter: null,
    isCorrect: false,
    mismatchIndex: normalizedWord.length,
    normalizedWord,
    reason: "extra-letter",
    acceptedVariant: null,
  };
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
      acceptedVariant: null,
    };
  }

  // Exact match — primary spelling
  if (exactMatch(normalizedWord, normalizedCandidate)) {
    return {
      actualLetter: null,
      candidate: normalizedCandidate,
      expectedLetter: null,
      isCorrect: true,
      mismatchIndex: null,
      normalizedWord,
      reason: null,
      acceptedVariant: null,
    };
  }

  // Check British/American variants
  const variants = generateVariants(normalizedWord);
  for (const variant of variants) {
    if (exactMatch(variant, normalizedCandidate)) {
      return {
        actualLetter: null,
        candidate: normalizedCandidate,
        expectedLetter: null,
        isCorrect: true,
        mismatchIndex: null,
        normalizedWord,
        reason: null,
        acceptedVariant: variant,
      };
    }
  }

  // No match — return detailed mismatch against primary spelling
  return buildMismatchResult(normalizedWord, normalizedCandidate);
}
