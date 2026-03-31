# AISPB

A mobile-first **Spelling Bee training web app** built for SPBCN (Spelling Bee of China) competition prep. Students run daily word drills with oral spelling via browser speech recognition, Bee-style dialogue prompts, a wrong-word notebook, and spaced-repetition scheduling.

**Live demo:** [aispb.vercel.app](https://aispb.vercel.app)

## Features

**Competition-Authentic Drill Flow**
- Bee-style pronouncer dialogue: *repeat*, *definition*, *sentence*, *origin*, *part of speech*
- Timed oral spelling rounds with browser speech recognition
- NATO alphabet and "double-letter" pattern support
- Word masking prevents visual cheating during prompts

**Spaced Repetition Engine**
- Graduated review intervals (1 / 2 / 5 / 7 days) based on streak performance
- Pre-drill triage: mark known words to skip, auto-backfill with fresh words
- Post-session wrong-word review drill (untimed, chainable)
- Per-word progress tracking: streaks, accuracy, due dates

**Two Official Word Banks**
- Middle School: 3,254 words from the SPBCN official list
- High School: 3,204 words from the SPBCN official list
- Switchable in settings; progress shared across banks

**Cloud + Offline**
- Runs fully offline with seed data and browser TTS
- Optional Volcengine Doubao Speech V3 for natural pronunciation
- Optional iFlytek streaming ASR for voice capture
- Optional Merriam-Webster Collegiate API for definitions and etymology
- Vercel KV cloud sync for cross-device progress

## Tech Stack

- **Next.js 16** (App Router, Turbopack)
- **React 19** with server and client components
- **TypeScript 5** (strict mode)
- **Tailwind CSS 4**
- **Vercel** for deployment and KV storage

## Quick Start

```bash
git clone https://github.com/irisfeng/aispb.git
cd aispb
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) on your phone or browser.

The app works immediately with no configuration. To enable cloud services, copy `.env.example` to `.env.local` and fill in the relevant API keys. See `.env.example` for all available options.

## Architecture

```
src/
  app/                  Next.js App Router
    api/                API routes (dictionary, pronouncer, voice-turn, storage)
    page.tsx            Entry point
  components/
    aispb-app.tsx       Main client component (drill UI, settings, notebook)
  lib/
    session-engine.ts   Drill planning, spaced-repetition scheduling
    pronouncer-agent.ts Intent classifier for Bee-style dialogue
    spoken-spelling.ts  Oral letter normalization (NATO, "double" patterns)
    spelling-judge.ts   Answer evaluation with British/American variant support
    word-bank.ts        Middle school word bank (3,254 words)
    word-bank-high.ts   High school word bank (3,204 words)
    storage.ts          Browser localStorage persistence
    kv-sync.ts          Vercel KV cloud sync
    volcengine-speech.ts  Doubao Speech V3 TTS
    merriam-webster.ts    Collegiate API client
    types.ts            Core TypeScript interfaces
```

### Provider Adapter Pattern

All external integrations use swappable adapters (`TtsProviderAdapter`, `DictionaryProviderAdapter`, `CoachProviderAdapter`). API routes transparently fall back to local implementations when cloud credentials are absent.

## Development

```bash
npm run dev          # Start dev server (Turbopack)
npm run typecheck    # TypeScript strict check
npm run lint         # ESLint
npm run build        # Production build
```

## License

MIT
