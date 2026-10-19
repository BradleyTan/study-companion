# Sound set

All sounds are **synthesised in the browser with the Web Audio API** (`src/lib/sound/engine.ts`). No audio files are shipped, so there is nothing to license. Source: original code in this repo. Licence: same as the project.

| Name | When | Recipe | Length |
|---|---|---|---|
| `click` | every button / control | square-ish blip 1125→810 Hz | 50 ms |
| `pop` | success: subject created, upload ready, correct answer | two rising blips | 160 ms |
| `boop` | gentle error / wrong answer | sine 320→210 Hz | 180 ms |
| `flip` | card flip (the page-turn) in review, opening a note | band-passed noise burst | 120 ms |
| `chime` | Step 4: every timer phase ends (focus round and break), in one tab only | three soft sines | 1.4 s |
| `tear` | delete confirmed | short filtered noise sweep down | 140 ms |
| `cheer` | Step 2: review session finished (replaces the last grade's `click`) | three rising sine notes 1047 → 1319 → 1568 Hz (C6-E6-G6), 110 ms each, starting 70 ms apart, gain like `boop` | 250 ms |

Rules:
- Default **on**, volume **0.35**. Toggle and slider in Settings, saved per user (profile) and mirrored to `localStorage` for instant start.
- Rate limit: the same sound can't retrigger within 60 ms, so fast clicking never turns into noise.
- Audio starts only after the first user gesture (browser rule); nothing autoplays.
- Focus mode (Step 4) plays only `chime`. Focus mode is on while a focus round runs or is paused (timer.md).
- Sound never carries meaning alone: every sound has a visible state change with it.
- **One sound per action** (Step 2): a single user action never plays two sounds (e.g. the last review grade plays `cheer` instead of `click`). Long-running work (AI generation, saving layouts) is silent; only its result sounds.
- **Speech wins** (Step 2): while read-aloud is speaking, the provider skips every sound except `click` on the read-aloud controls themselves, so effects never talk over the voice.
- Step 2 usage: flashcards `pop` (cards made / card saved), `tear` (card deleted), `boop` (limits, too little text, AI failed); review `flip`, `click` per grade, `cheer` at the end, never `boop` for "Again"; mindmap `click` on node, `pop` on new map; read-aloud `click` on its controls.
- Step 3 usage: quiz `click` on choosing an option, I don't know and Next; Check plays only its result (`pop` correct, `boop` wrong), never `boop` for "I don't know" or a network error; results `cheer` at ≥ 70 %, otherwise `pop` (never a sad sound on results); quiz made `pop`, quiz deleted `tear`. Weak topics: `pop` on Mark as got it, `cheer` once on All clear. Chat: `click` on Send, `pop` when an answer or not-covered reply arrives, `boop` on errors and limits, `tear` on Clear chat. Nothing while generating or waiting. No new sounds are needed.
- Step 4 usage: timer `click` on Start, Pause, Resume, +5 min, Stop, Skip, steppers and phase switch; `chime` at the end of every phase and nothing else (no ticking, no countdown beeps); with auto-start the end plays only `chime`. `chime` is the **one exception to "speech wins"**: it plays even while read-aloud is speaking, because it is time-critical (the provider's speaking check must let it through). It plays only if the end happened under 2 minutes ago (a phone waking hours later stays silent) and only in the one tab that handles the end. Timetable `click` on buttons, tabs, week and day changes and Copy link; `pop` on slot saved and import added; `tear` on slot deleted, calendar link reset and turned off; `boop` on save and import errors. No new sounds are needed. With sound off, every one of these has a visible state (end card, chip, tab title, toasts).
