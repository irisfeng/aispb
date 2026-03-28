export type EarconKind = "correct" | "incorrect" | "timeout" | "reset";

const earconRecipes: Record<
  EarconKind,
  Array<{
    durationMs: number;
    frequency: number;
    gain: number;
    offsetMs: number;
    type: OscillatorType;
  }>
> = {
  correct: [
    {
      durationMs: 120,
      frequency: 659,
      gain: 0.018,
      offsetMs: 0,
      type: "sine",
    },
    {
      durationMs: 170,
      frequency: 880,
      gain: 0.02,
      offsetMs: 130,
      type: "sine",
    },
  ],
  incorrect: [
    {
      durationMs: 140,
      frequency: 523,
      gain: 0.016,
      offsetMs: 0,
      type: "sine",
    },
    {
      durationMs: 180,
      frequency: 392,
      gain: 0.017,
      offsetMs: 120,
      type: "sine",
    },
  ],
  timeout: [
    {
      durationMs: 150,
      frequency: 494,
      gain: 0.014,
      offsetMs: 0,
      type: "sine",
    },
    {
      durationMs: 180,
      frequency: 370,
      gain: 0.015,
      offsetMs: 140,
      type: "sine",
    },
  ],
  reset: [
    {
      durationMs: 100,
      frequency: 620,
      gain: 0.014,
      offsetMs: 0,
      type: "sine",
    },
    {
      durationMs: 110,
      frequency: 523,
      gain: 0.013,
      offsetMs: 140,
      type: "sine",
    },
  ],
};

let sharedAudioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") {
    return null;
  }

  if (!sharedAudioContext) {
    const BrowserAudioContext =
      window.AudioContext ||
      (window as typeof window & {
        webkitAudioContext?: typeof AudioContext;
      }).webkitAudioContext;

    if (!BrowserAudioContext) {
      return null;
    }

    sharedAudioContext = new BrowserAudioContext();
  }

  return sharedAudioContext;
}

export async function playEarcon(kind: EarconKind) {
  const audioContext = getAudioContext();

  if (!audioContext) {
    return;
  }

  if (audioContext.state === "suspended") {
    await audioContext.resume();
  }

  const now = audioContext.currentTime;
  let totalDurationMs = 0;

  for (const note of earconRecipes[kind]) {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    const startTime = now + note.offsetMs / 1000;
    const stopTime = startTime + note.durationMs / 1000;

    oscillator.type = note.type;
    oscillator.frequency.setValueAtTime(note.frequency, startTime);

    gainNode.gain.setValueAtTime(0.0001, startTime);
    gainNode.gain.exponentialRampToValueAtTime(note.gain, startTime + 0.02);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, stopTime);

    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);

    oscillator.start(startTime);
    oscillator.stop(stopTime);

    totalDurationMs = Math.max(totalDurationMs, note.offsetMs + note.durationMs);
  }

  await new Promise((resolve) => {
    window.setTimeout(resolve, totalDurationMs + 40);
  });
}
