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

## 2026-03-24

1. Child-facing feedback audio must be gentle and sequenced; harsh synthetic waveforms or overlapping earcon-plus-speech playback can feel scary even when the logic is technically correct.

## 2026-03-28

1. Spaced-repetition miss scheduling must push `dueOn` to tomorrow (`addDays(todayKey, 1)`), not same-day (`todayKey`); same-day due means the word reappears immediately in the next plan, which defeats the purpose of a rest interval.
2. Spaced-repetition correct intervals should have graduated tiers (2 → 5 → 7 days by streak), not a binary jump; a single correct answer going straight to 3 days is too aggressive for a beginner.
3. TTS `speechText` must go through `maskWordInVisibleText` the same way `displayText` does; otherwise the pronouncer literally speaks the answer word aloud through the speaker.
4. `localStorage` data cannot be trusted at runtime — `readJson<T>` only casts, it does not validate; production code needs runtime type guards that fall back to defaults when the shape is wrong.
5. API routes that accept user input (pronouncer text, voice-turn audio/transcript) need content-length caps and type validation before any processing; without them, a single large payload can burn cloud credits or crash the server.
6. `hasVoiceTurnConfig` must gate on the transcription key (`OPENAI_API_KEY`), not just the LLM router key; without Whisper, audio recordings hit a dead end and the client takes a cloud path that cannot succeed.
7. Async voice results that resolve after a round resolves (timer fires, advance fires) can corrupt the next round unless guarded by a captured round ID check at each decision point.
8. `MediaRecorder.onstop` fires even when `stop()` is called during Start Over; a suppression flag is needed to distinguish intentional cancellation from natural end-of-recording.
9. `bestStreak` is a session-level stat and must be reset in `beginSession`, not just `advanceWord`; otherwise it carries across drills.
10. Write-only state variables (like `agentTranscript` that was set but never read) are dead weight and should be removed; they add render cycles and confuse future readers.
11. Cloud integrations and voice pipeline code should be separated from bug-fix commits for clean git history; mixed commits make bisect and revert harder.
12. In a spelling training app, any UI element that displays speech recognition transcripts (raw or processed) is a cheating vector — it can leak the target word or partial spelling clues. Evaluate every display element against the core training goal: if the user is not supposed to see the word, they should not see what the system "heard" either.
13. When evaluating whether to remove a UI element, check the product goal first, not just technical dependencies; a technically safe element can still be a product-level defect.
