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
- [ ] Replace mock session data with canonical word-source adapters.
- [ ] Implement persistent wrong-word notebook and daily scheduling.
- [ ] Integrate real pronouncer, dictionary, and coach providers.

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
