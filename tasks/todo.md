# Task Tracker

## Current Task

- [x] Reconfirm that project development and testing must follow `rules.md`.
- [x] Create a `memory` directory for daily progress logging.
- [x] Add today's dated development log.
- [x] Record the result in a project task tracker.
- [x] Expand API evaluation beyond Alibaba Cloud and Volcengine using current official pricing and capability references.
- [x] Revise the main plan so vendor selection is role-based and includes broader TTS and LLM options.
- [x] Research whether Merriam-Webster provides official APIs or licensing paths suitable for the app's authoritative dictionary layer.
- [x] Initialize local git metadata for the project workspace.
- [x] Bind the workspace to `https://github.com/irisfeng/aispb`.
- [x] Commit the current planning and process files.
- [x] Exclude local-only source and planning directories from git sync.
- [x] Push the initial project state to GitHub.
- [x] Scaffold the first mobile-first web app implementation.
- [x] Add the base app configuration for Next.js, TypeScript, Tailwind, and linting.
- [x] Define the initial domain model for words, sessions, prompts, and provider adapters.
- [x] Build a polished mobile-first landing screen with a clear daily drill entry point.
- [x] Build the first drill session prototype with timer, prompt actions, and answer flow.
- [x] Add a lightweight review/statistics section for wrong words and streak feedback.
- [x] Verify the app builds cleanly and document the result.
- [x] Add a concise root README for public repo onboarding.
- [x] Replace the static session mock with a reusable local word-bank adapter.
- [x] Add local session planning with configurable daily goal and round duration.
- [x] Implement persistent wrong-word notebook and progress storage in the browser.
- [x] Add a browser-based pronouncer fallback for the local MVP.
- [x] Verify the upgraded local MVP with lint, typecheck, and build.
- [x] Add environment-aware Merriam-Webster dictionary integration with local fallback.
- [x] Route dictionary access through a provider layer instead of direct local adapter calls.
- [x] Add a documented env template for real provider credentials.
- [x] Integrate a real pronouncer provider through a server-side adapter.
- [x] Add the first Volcengine pronouncer token and audio invoke flow.
- [x] Route pronouncer playback through the provider layer with browser speech fallback.
- [x] Expose pronouncer provider status in the mobile UI.
- [x] Verify pronouncer integration with lint, typecheck, build, and local HTTP checks.
- [x] Validate the current live Volcengine credentials against the pronouncer route.
- [x] Fix the live auth and product-line mismatch by separating Doubao Speech V3 from the legacy SAMI path.
- [x] Re-verify pronouncer status, browser fallback, and notebook flow under the current env.
- [x] Validate successful live cloud playback once `VOLC_SPEECH_ACCESS_TOKEN` is added.
- [x] Replace typed spelling submission with a spoken-letter answer flow aligned to Spelling Bee oral rounds.
- [x] Add speech recognition capture and normalization for spelled-letter answers.
- [x] Preserve `start over` behavior in the spoken-answer flow without relying on keyboard entry.
- [x] Investigate and fix the odd raspy leading artifact in the current American female pronouncer audio.
- [x] Re-verify the end-to-end oral drill flow with live pronouncer playback and spoken-answer judging.
- [x] Separate spoken Bee queries from spoken spelling attempts so prompt requests are never judged as answers.
- [x] Add a rules-safe pronouncer dialogue agent layer with natural-language intent handling for official Bee-style requests.
- [x] Refine the mobile session UI around a clean ask/spell flow instead of a dense action grid.
- [x] Remove explicit dev-like start/stop friction from the round flow and reduce the session UI to a simpler mobile interaction model.
- [x] Simplify the overall mobile surface so the live round reads like one focused card instead of multiple tool panels.
- [x] Re-investigate the current pronouncer onset artifact and harden the cloud audio parsing/trim path against noisy V3 pre-roll.
- [x] Replace the exposed `Ask pronouncer` / `Spell answer` split with a single primary talk action that routes intent internally.
- [x] Rebuild the spoken round around a server-routed voice pipeline: ASR -> dialogue / spelling router -> guarded reply generation -> TTS.
- [x] Add scenario-aware ASR handling for spelling mode versus free-form Bee dialogue, including stronger guardrails for disallowed clue requests.
- [x] Change respell behavior so a fresh spelling attempt replaces the previously locked letters instead of appending ambiguously.
- [x] Grade spelling letter-by-letter so any wrong letter is immediately treated as an incorrect attempt.
- [x] Add success / miss earcons plus spoken feedback for correct, incorrect, timeout, and reset events.
- [x] Soften and serialize feedback earcons so child-facing audio does not startle or overlap with speech playback.
- [x] Prevent the target word from appearing anywhere in the live UI before the round resolves, even when the pronouncer repeats it aloud.
- [ ] Refactor the oversized client round logic into smaller speech, judging, and presentation modules before adding the new pipeline.
- [ ] Add a cartoon-cute visual refresh for the live round after the interaction and correctness changes are stable.
- [ ] Integrate a production coach provider.
- [ ] Replace local seed data with the cleaned canonical word source.
- [ ] Upgrade browser-only persistence to a syncable data layer.

## Review

1. `memory/` now exists and uses date-based Markdown files.
2. Today's work has been logged in `memory/2026-03-23.md`.
3. Project process tracking files now exist under `tasks/` to support the workflow described in `rules.md`.
4. API vendor evaluation now includes broader TTS and model options for later implementation decisions.
5. The implementation plan now treats provider choice as a swappable adapter decision rather than a hard dependency on one cloud vendor.
6. Merriam-Webster is usable as an official API-backed dictionary source for MVP, but the public API offering does not appear to expose the `Unabridged` product used as the Scripps official reference.
7. The initial public GitHub sync succeeded with only `.gitignore`, `rules.md`, and `tasks/` tracked; `pdf/`, `docs/`, and `memory/` remain local-only.
8. The first runnable app scaffold now exists with a refined mobile-first UI, adapter-oriented domain model, and an interactive drill prototype.
9. Verification completed with `npm run lint`, `npm run typecheck`, `npm run build`, plus local `next dev` HTTP checks returning `200 OK`.
10. The repo now has a concise public-facing README describing purpose, stack, current scope, and local run commands.
11. The app now behaves as a true local MVP: seeded word bank, configurable daily planning, browser-side notebook persistence, and browser speech fallback are all wired.
12. Dictionary lookups now go through a real provider seam: a Next API route uses Merriam-Webster when `MW_DICTIONARY_API_KEY` is configured and falls back to local seed data otherwise.
13. Verification now also includes a local HTTP check for `/api/dictionary?word=verdant`, which currently returns the local fallback payload when no API key is present.
14. Pronouncer playback now has a server-side path: `/api/pronouncer` reports provider status and synthesizes audio through the active Volcengine provider path when credentials are configured.
15. The mobile UI now surfaces pronouncer status, prefers the cloud provider for explicit prompt requests, and falls back to browser speech when external credentials are absent.
16. Verification for the pronouncer path now includes `npm run lint`, `npm run typecheck`, `npm run build`, local HTTP checks for `/api/pronouncer`, and a Playwright smoke flow covering session start, prompt buttons, and notebook updates.
17. Live Volcengine debugging showed that the current console app belongs to the newer Doubao Speech product line, so `AK/SK + GetToken` is the wrong runtime path for this app even though the account credentials themselves are valid.
18. The pronouncer provider now prefers Doubao Speech V3 with `APP ID + Access Token`, only uses the old SAMI chain when `VOLC_SPEECH_USE_LEGACY=true`, and reports missing `VOLC_SPEECH_ACCESS_TOKEN` as a configuration gap instead of failing with a generic `502`.
19. Re-verification now includes `GET /api/pronouncer`, `POST /api/pronouncer` under the current env, plus a Playwright smoke flow confirming browser fallback, Definition prompt logging, miss capture, and notebook persistence still work after the provider refactor.
20. After the app-level `Access Token` was added, live cloud playback succeeded: `/api/pronouncer` returned `200 OK` with `audio/mpeg`, the home screen moved to `volc ready`, and a Playwright click on `Repeat` triggered a real `POST /api/pronouncer 200` in the dev server logs.
21. Research against the official 2025 Scripps rules confirmed that Bee spelling rounds are oral: the speller speaks letters aloud, may ask for repetition/definition/sentence/origin, and indicates completion orally after spelling the word.
22. The answer card now uses spoken-letter capture as the primary interaction, with browser speech recognition, spelled-letter normalization, and an emergency manual fallback only when speech capture is unavailable.
23. The odd leading pronouncer artifact was traced to the runtime path rather than the word data alone: the app previously auto-played browser speech even when cloud TTS was active, causing overlapping audio; the provider path now auto-plays through one channel only, and V3 output is normalized to `pcm -> wav` with leading low-amplitude noise trimmed.
24. Re-verification now includes rule research, parser sample checks for spoken-letter normalization, a clean dev-server restart, a fresh Playwright smoke flow for the spoken-answer UI, and live pronouncer checks confirming a single `POST /api/pronouncer 200` on session start plus another on explicit `Repeat`.
25. The live round now has two distinct interaction lanes: `Ask pronouncer` for Bee-style dialogue and `Spell answer` for oral spelling capture, so spoken requests such as `definition` are no longer eligible for spelling judgment.
26. The pronouncer layer now behaves like a guarded dialogue agent: it classifies natural-language requests such as repeat, definition, sentence, part of speech, origin, and `all info`, while refusing out-of-bounds spelling-clue requests.
27. Re-verification for this round included `npm run lint`, `npm run typecheck`, `npm run build`, Playwright browser flow checks for session start plus definition/all-info prompt delivery, and parser assertions confirming `definition` produces no spelling candidate while spoken letters still normalize correctly.
28. The mobile live round has been simplified again: one tap now starts either `Ask pronouncer` or `Spell answer`, speech capture auto-finishes after a short pause, and the active session surface is reduced to a single focused round card.
29. The pre-session page no longer exposes the full disabled round UI; it now collapses to a short readiness card until a drill actually starts.
30. Re-verification for the simplification pass included `npm run lint`, `npm run typecheck`, `npm run build`, a clean dev-server restart, and Playwright smoke checks for landing-state simplification plus `Begin today's drill -> Definition` on the focused round screen.
31. The odd onset sound was reproduced against live Volcengine output and traced to low-energy pre-roll in the raw PCM rather than a browser-only playback artifact.
32. The V3 trimming path now uses consecutive activity windows with a minimal 1ms backtrack instead of the earlier looser sample-threshold/backtrack strategy, reducing the chance that noisy pre-roll leaks into the final WAV.
33. Verification for the audio pass included live provider sampling, direct waveform inspection of raw versus trimmed PCM-derived WAV files, plus `npm run lint`, `npm run typecheck`, and `npm run build`.
34. The live round now exposes a single `Talk` primary action and keeps intent routing internal, so users no longer have to choose between `Ask pronouncer` and `Spell answer` before speaking.
35. Verification for the single-action pass included `npm run lint`, `npm run typecheck`, `npm run build`, and a Playwright smoke flow against a local production instance confirming `Begin today's drill` leads to a round with one `Talk` button plus rule-safe clue chips, and `Definition` still routes through the pronouncer path.
36. Development and test records for the single-action talk-flow pass are now explicitly marked in the dated local memory log for audit and morning acceptance.
37. The app now includes a server-side `voice-turn` route that can transcribe audio and run model-based intent routing when `OPENAI_API_KEY` is configured, while still falling back locally when it is not.
38. Spoken attempt grading is now strict letter-by-letter, so a wrong, missing, or extra letter resolves the round as incorrect instead of drifting through fuzzy matching.
39. The round now plays earcons plus short spoken feedback for correct, incorrect, timeout, and start-over events.
40. The live round no longer exposes the target word before resolution: the round card stays on `Word 01` style labels, repeat prompts stay text-safe, and transcript/feed rendering masks the word until reveal.
41. Verification for this pass included `npm run typecheck`, `npm run lint`, `npm run build`, `curl` checks for `GET/POST /api/voice-turn`, and a Playwright smoke flow confirming the round screen and `Repeat` action do not reveal the target word in visible UI.
42. Feedback earcons now use softer sine-wave chimes and wait for the chime to finish before spoken feedback starts, reducing the chance of a startling or garbled sound.
