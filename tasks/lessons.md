# Lessons

## 2026-03-23

1. When the user points to `rules.md`, operational requirements in that file must be reflected in the repo immediately instead of being treated as a loose reminder.
2. Daily progress logging should be initialized early, not after implementation has already started.
3. When the user broadens supplier scope, the plan should be reframed around provider roles and switching costs instead of comparing only the originally named vendors.
4. Source PDFs, planning docs, and local memory logs should not be pushed to the public GitHub repo unless the user explicitly asks for that.
5. A public repo should get a concise README early, once the first runnable scaffold exists.
6. Public-facing docs should avoid personal names or identifiable details unless the user explicitly wants them included.
7. Once the user says to keep shipping and the implementation path is already clear, move directly into code and verification instead of pausing at recommendation-only updates.
8. Live cloud integrations need to be matched against the exact current console product line before documenting env variables, speaker IDs, or auth flow; older Volcengine SAMI assumptions do not safely apply to a Doubao Speech 2.0 app.
9. For Volcengine speech, auth docs and voice-list docs are separate sources; speaker defaults must be validated against the official voice list page, not inferred from integration examples.
10. For a Spelling Bee product, answer input assumptions must mirror the real competition format first: contestants orally spell letters, so typed entry can only be a fallback or temporary dev aid, not the primary interaction.
11. In a Bee-style oral round, spoken prompt requests such as “definition” or “use it in a sentence” must be classified as pronouncer dialogue, not fed into the spelling judge; the pronouncer experience needs an agent-like dialogue layer, not a flat button board.
12. Even when the round logic is correct, the product still fails if the interaction feels like a debugging console; a mobile Bee app has to hide mode machinery and keep the live round down to the smallest possible number of obvious actions.
13. The ask-vs-spell distinction belongs inside the intent router, not in two sibling primary buttons; if the UI exposes mode management to the user, it still feels wrong even when the routing logic is correct.
