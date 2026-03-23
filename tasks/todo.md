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
