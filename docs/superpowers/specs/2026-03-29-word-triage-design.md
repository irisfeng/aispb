# Word Triage — Pre-Drill Known-Word Filtering

**Date:** 2026-03-29
**Status:** Draft

## Problem

The word bank has 3,254 words (growing to 5,000+). Many of these are words the student already knows. Drilling known words wastes time. There is currently no way to exclude them.

## Solution

A **pre-drill triage step** where the student reviews the planned word list before starting. She taps words she already knows → they get tagged with a `knownAt` date and replaced by fresh words. She can repeat this filter-and-backfill cycle until satisfied, then starts the drill.

## User Flow

1. User taps "Begin today's drill" (existing button)
2. Instead of jumping straight into the drill, the app shows the **triage view**: a scrollable grid of all planned words for today's session
3. She scans the list and taps words she already knows → they highlight as "known"
4. She taps "Confirm" → known words get tagged (`knownAt = todayKey`), the plan **backfills** with fresh words to maintain the daily goal count
5. The triage view updates with the new list (backfilled words are visually distinguished)
6. She can repeat steps 3–5 as many times as needed
7. When satisfied, she taps "Start Drill" → normal drill session begins with the curated list
8. If she wants to skip triage entirely, a "Start Drill" button is always visible — triage is optional, not a gate

## Data Model

### Change to `WordProgressRecord` in `types.ts`

Add one field:

```typescript
knownAt?: string | null;  // date key "YYYY-MM-DD" when marked as known, null = not known
```

- `knownAt !== null` → word is excluded from drill plans
- `knownAt === null` or `undefined` → word is eligible for drills
- Reversible: setting `knownAt = null` makes the word eligible again

### Why not a separate Set?

`knownAt` lives inside `WordProgressRecord`, which already syncs to both localStorage and Vercel KV via the existing `ProgressMap` pipeline. Zero new storage functions, API routes, or sync effects needed. The date value also enables analytics (triage trends over time).

## Session Engine Changes

### `createDrillPlan()` in `session-engine.ts`

The existing function filters words into "review" and "fresh" pools. Add one filter to each:

- **Review pool:** skip words where `progress[word.id]?.knownAt` is truthy
- **Fresh pool:** skip words where `progress[word.id]?.knownAt` is truthy

No changes to spaced-repetition scheduling, scoring, or notebook generation.

### New: `backfillPlan()` in `session-engine.ts`

When the user marks words as known during triage, the plan needs to replace them:

```
backfillPlan(input: {
  currentPlan: DrillPlan;
  excludedIds: Set<string>;     // words just marked known
  allWords: DrillWord[];
  progress: ProgressMap;
  todayKey: string;
}): DrillPlan
```

Logic:
1. Remove excluded words from the current plan
2. Compute how many slots to fill (`dailyGoal - remaining words`)
3. Pick fresh words not in the plan and not known, using `rankFreshWords()`
4. Return updated plan

If the entire word bank is exhausted (all remaining words are known), the plan is shorter than `dailyGoal`. That's fine — it means she's done with the bank.

## UI Design

### Triage View (in `aispb-app.tsx`)

**When:** Between tapping "Begin" and the drill starting. New state: `triageActive: boolean`.

**Layout (mobile-first):**

```
┌─────────────────────────────┐
│  Today's Words (100)        │
│  Tap words you already know │
│                             │
│ ┌───────┐ ┌──────┐ ┌─────┐ │
│ │ word1 │ │word2 │ │word3│ │
│ └───────┘ └──────┘ └─────┘ │
│ ┌───────┐ ┌──────┐ ┌─────┐ │
│ │ word4 │ │word5 │ │word6│ │
│ └───────┘ └──────┘ └─────┘ │
│         ... more ...        │
│                             │
│  [Confirm 12 Known]         │
│  [Start Drill →]            │
└─────────────────────────────┘
```

- **Word chips:** `flex flex-wrap gap-2`, compact text, tap to toggle
- **Unselected:** default chip style (outline)
- **Selected (known):** highlighted with strikethrough or colored background — tap again to deselect (toggle behavior, same as selecting)
- **Newly backfilled:** subtle indicator (e.g. a dot) so she can see what's new after confirming — only on the first cycle after backfill, clears on next interaction
- **Confirm button:** "Confirm N Known" — disabled when N = 0. Triggers backfill.
- **Start Drill button:** Always visible. Starts drill with current (possibly filtered) plan.
- **Back button:** Returns to main view without starting, plan is discarded

### Sorting

Words shown alphabetically in the triage grid. Alphabetical is easiest for a student to scan and find words she recognizes.

### No pagination needed

At 100–200 words with compact chips, the list fits in a single scrollable area. No batching/pagination complexity.

## Storage & Sync

**No new code.** The `knownAt` field is part of `WordProgressRecord` inside `ProgressMap`. The existing sync pipeline handles it:

1. `saveProgress(progress)` → localStorage (`aispb:progress:v1`)
2. `saveProgressToKv(progress)` → Vercel KV (`aispb:progress`)
3. On load: localStorage first, KV overwrite if available

### Validation in `storage.ts`

The `isValidProgressMap()` function validates known numeric fields. `knownAt` is a string, so it passes through without breaking validation — the validator checks `seenCount`, `correctCount`, `wrongCount`, `currentStreak`, `reviewCount` as numbers but doesn't reject unknown fields.

## Analytics Potential (future, not in v1)

With `knownAt` dates on progress records, future features could include:
- "Words marked known per session" trend chart
- Comparison: self-assessed "known" words vs actual drill accuracy if re-tested
- Coverage report: N known + M drilled + K remaining out of total bank

## Scope — What's NOT in v1

- No "undo known" UI outside of triage (during triage, tapping a selected word deselects it; but after confirming + starting drill, there's no way to un-mark words)
- No analytics dashboard
- No bulk "mark all as unknown" reset
- No triage for review words (only affects fresh word selection)

## Files Changed

| File | Change |
|------|--------|
| `src/lib/types.ts` | Add `knownAt?: string \| null` to `WordProgressRecord` |
| `src/lib/session-engine.ts` | Filter known words in `createDrillPlan()`, add `backfillPlan()` |
| `src/components/aispb-app.tsx` | Triage view state, UI, backfill integration |

## Files NOT Changed

- `storage.ts` — existing `loadProgress`/`saveProgress` handles `knownAt` for free
- `kv-sync.ts` — existing `ProgressMap` sync covers it
- `api/storage/route.ts` — no new keys needed
- `spelling-judge.ts`, `pronouncer-agent.ts`, `voice-turn.ts` — unrelated
- Notebook — unaffected; known words with no drill history won't appear
