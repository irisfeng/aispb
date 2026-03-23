export type SpokenAttemptCommand = "start-over";

export interface NormalizedSpokenAttempt {
  candidate: string;
  command: SpokenAttemptCommand | null;
  transcript: string;
}

const fillerTokens = new Set([
  "and",
  "comma",
  "dash",
  "hyphen",
  "period",
  "please",
  "space",
  "the",
  "uh",
  "um",
]);

const spokenLetterMap: Record<string, string> = {
  alpha: "a",
  are: "r",
  ar: "r",
  ay: "a",
  be: "b",
  bee: "b",
  bravo: "b",
  cee: "c",
  charlie: "c",
  cue: "q",
  d: "d",
  dee: "d",
  delta: "d",
  e: "e",
  echo: "e",
  ef: "f",
  eff: "f",
  ex: "x",
  f: "f",
  foxtrot: "f",
  g: "g",
  gee: "g",
  golf: "g",
  h: "h",
  hotel: "h",
  i: "i",
  india: "i",
  j: "j",
  jay: "j",
  juliet: "j",
  juliett: "j",
  k: "k",
  kay: "k",
  kilo: "k",
  l: "l",
  lima: "l",
  m: "m",
  mike: "m",
  n: "n",
  november: "n",
  o: "o",
  oh: "o",
  oscar: "o",
  p: "p",
  papa: "p",
  pea: "p",
  pee: "p",
  q: "q",
  queue: "q",
  quebec: "q",
  r: "r",
  romeo: "r",
  s: "s",
  sierra: "s",
  t: "t",
  tango: "t",
  tea: "t",
  tee: "t",
  u: "u",
  uniform: "u",
  vee: "v",
  victor: "v",
  v: "v",
  whiskey: "w",
  whisky: "w",
  w: "w",
  x: "x",
  xray: "x",
  "x-ray": "x",
  y: "y",
  yankee: "y",
  why: "y",
  wye: "y",
  you: "u",
  yew: "u",
  z: "z",
  zebra: "z",
  zed: "z",
  zee: "z",
};

const multiTokenCommandMatchers: Array<{
  command: SpokenAttemptCommand;
  tokens: string[];
}> = [
  { command: "start-over", tokens: ["start", "over"] },
  { command: "start-over", tokens: ["start", "again"] },
  { command: "start-over", tokens: ["begin", "again"] },
];

function normalizeTranscriptText(transcript: string) {
  return transcript
    .toLowerCase()
    .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenizeTranscript(transcript: string) {
  return normalizeTranscriptText(transcript)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function findCommand(tokens: string[]) {
  for (const matcher of multiTokenCommandMatchers) {
    const windowSize = matcher.tokens.length;

    for (
      let startIndex = 0;
      startIndex <= tokens.length - windowSize;
      startIndex += 1
    ) {
      const candidate = tokens.slice(startIndex, startIndex + windowSize);

      if (candidate.join(" ") === matcher.tokens.join(" ")) {
        return matcher.command;
      }
    }
  }

  if (tokens.includes("restart")) {
    return "start-over";
  }

  return null;
}

function mapTokenToLetter(token: string) {
  if (/^[a-z]$/.test(token)) {
    return token;
  }

  return spokenLetterMap[token] ?? "";
}

function pushLetterCandidate(
  tokens: string[],
  startIndex: number,
): {
  letters: string;
  nextIndex: number;
} | null {
  const currentToken = tokens[startIndex];

  if (
    currentToken === "double" &&
    startIndex + 1 < tokens.length &&
    !(tokens[startIndex + 1] === "u" || tokens[startIndex + 1] === "you")
  ) {
    const doubledLetter = mapTokenToLetter(tokens[startIndex + 1]);

    if (doubledLetter) {
      return {
        letters: `${doubledLetter}${doubledLetter}`,
        nextIndex: startIndex + 2,
      };
    }
  }

  if (
    currentToken === "double" &&
    startIndex + 1 < tokens.length &&
    (tokens[startIndex + 1] === "u" || tokens[startIndex + 1] === "you")
  ) {
    return {
      letters: "w",
      nextIndex: startIndex + 2,
    };
  }

  const mappedLetter = mapTokenToLetter(currentToken);

  if (!mappedLetter) {
    return null;
  }

  return {
    letters: mappedLetter,
    nextIndex: startIndex + 1,
  };
}

export function normalizeSpokenSpellingAttempt(
  transcript: string,
): NormalizedSpokenAttempt {
  const normalizedTranscript = normalizeTranscriptText(transcript);
  const tokens = tokenizeTranscript(transcript);
  const command = findCommand(tokens);
  let candidate = "";

  for (let index = 0; index < tokens.length; ) {
    const token = tokens[index];

    if (fillerTokens.has(token)) {
      index += 1;
      continue;
    }

    const pushedLetter = pushLetterCandidate(tokens, index);

    if (pushedLetter) {
      candidate += pushedLetter.letters;
      index = pushedLetter.nextIndex;
      continue;
    }

    index += 1;
  }

  if (!candidate && /^[a-z]+(?: [a-z]+)*$/.test(normalizedTranscript)) {
    candidate = normalizedTranscript.replaceAll(" ", "");
  }

  return {
    candidate,
    command,
    transcript: normalizedTranscript,
  };
}

export function formatSpellingCandidate(candidate: string) {
  if (!candidate) {
    return "No letters locked yet.";
  }

  return candidate.toUpperCase().split("").join(" ");
}
