# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AISPB is a mobile-first Spelling Bee training web app for junior middle-school competition prep. Users do daily word drills with oral spelling via browser speech recognition, Bee-style dialogue (repeat/definition/sentence/origin), wrong-word notebook, and spaced-repetition scheduling.

## Commands

```bash
npm run dev          # Start Next.js dev server (Turbopack)
npm run build        # Production build
npm run start        # Serve production build
npm run lint         # ESLint (flat config, Next.js + TypeScript rules)
npm run typecheck    # TypeScript strict check (tsc --noEmit)
```

No formal test framework (jest/vitest). Verification is: `npm run typecheck && npm run lint && npm run build` plus manual browser smoke testing and curl against API routes.

## Architecture

**Next.js 16 App Router** with React 19, TypeScript 5, Tailwind CSS 4.

### Entry Flow

`src/app/page.tsx` → `<AispbApp />` (single client component in `src/components/aispb-app.tsx`) manages all drill state, speech capture, intent routing, and UI transitions.

### Provider Adapter Pattern

All external integrations use swappable adapters defined in `src/lib/types.ts`:

- **TtsProviderAdapter** — text-to-speech (Volcengine Doubao Speech V3, or browser fallback)
- **DictionaryProviderAdapter** — word data (Merriam-Webster API, or seed fallback)
- **CoachProviderAdapter** — miss feedback

Routes (`src/app/api/dictionary/route.ts`, `src/app/api/pronouncer/route.ts`) transparently fall back to local implementations (`src/lib/local-adapters.ts`) when cloud credentials are absent.

### Key Modules in `src/lib/`

- **session-engine.ts** — Deterministic drill planning (review vs. fresh word balancing via stable hash), spaced-repetition scheduling (2-streak → 7 days, 1 miss → repeat tomorrow), notebook generation
- **pronouncer-agent.ts** — Rule-based intent classifier for Bee-style requests (repeat/definition/sentence/origin/part-of-speech/all-info/ready-to-spell/start-over/disallowed/unknown). Masks the target word in responses to prevent reading the answer aloud
- **spoken-spelling.ts** — Oral letter normalization: NATO alphabet, "double" patterns, "start over" commands, filler filtering, whole-word fallback
- **volcengine-speech.ts** — V3 TTS (SSE + PCM→WAV conversion with leading-noise trimming). Legacy V1 SAMI path behind `VOLC_SPEECH_USE_LEGACY` flag
- **merriam-webster.ts** — Collegiate API client with MW markup stripping, 24h revalidation cache
- **word-bank.ts** — Seed word list (28 words, difficulty 2–5)
- **storage.ts** — Browser localStorage persistence for settings + progress

### Environment Variables

Copy `.env.example` → `.env.local`. All are optional — the app runs fully offline with seed data and browser TTS.

- `MW_DICTIONARY_API_KEY` / `MW_DICTIONARY_TYPE` — Merriam-Webster cloud dictionary
- `VOLC_SPEECH_APP_ID` / `VOLC_SPEECH_ACCESS_TOKEN` / `VOLC_SPEECH_SPEAKER` — Volcengine V3 TTS
- `VOLC_ACCESSKEY` / `VOLC_SECRETKEY` / `VOLC_SPEECH_USE_LEGACY` — Legacy SAMI path (opt-in)

## Working Conventions

### Planning & Execution

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately
- Write detailed specs upfront to reduce ambiguity

### Task Management

1. Write plan to `tasks/todo.md` with checkable items
2. Check in before starting implementation
3. Mark items complete as you go
4. Add review section to `tasks/todo.md`
5. Capture lessons in `tasks/lessons.md` after corrections

### Verification Before Done

- Never mark a task complete without proving it works
- Run `npm run typecheck && npm run lint && npm run build` at minimum
- Ask: "Would a staff engineer approve this?"

### Subagents

- Use liberally to keep main context window clean
- One task per subagent for focused execution

### Self-Improvement

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Review lessons at session start

### Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Autonomous Bug Fixing**: When given a bug report, just fix it — zero hand-holding.
- **Elegance (Balanced)**: For non-trivial changes, ask "is there a more elegant way?" Skip for obvious fixes.

## Key Lessons (from `tasks/lessons.md`)

- Spoken prompt requests ("definition", "use it in a sentence") must be classified as pronouncer dialogue, never fed into the spelling judge
- The ask-vs-spell distinction belongs inside the intent router, not exposed as separate UI buttons
- A mobile Bee app must hide mode machinery — keep the live round to the smallest possible number of obvious actions
- Volcengine speech auth docs and voice-list docs are separate sources; validate speaker defaults against the official voice list, not integration examples
- Live cloud integrations must be matched against the exact current console product line before documenting env variables or auth flow
