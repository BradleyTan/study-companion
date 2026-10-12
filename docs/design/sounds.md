# Sound set

All sounds are **synthesised in the browser with the Web Audio API** (`src/lib/sound/engine.ts`). No audio files are shipped, so there is nothing to license. Source: original code in this repo. Licence: same as the project.

| Name | When | Recipe | Length |
|---|---|---|---|
| `click` | every button / control | square-ish blip 1125→810 Hz | 50 ms |
| `pop` | success: subject created, upload ready, correct answer | two rising blips | 160 ms |
| `boop` | gentle error / wrong answer | sine 320→210 Hz | 180 ms |
| `flip` | card flip, opening a note | band-passed noise burst | 120 ms |
| `chime` | Pomodoro ends (Step 4) | three soft sines | 1.4 s |
| `tear` | delete confirmed | short filtered noise sweep down | 140 ms |

Rules:
- Default **on**, volume **0.35**. Toggle and slider in Settings, saved per user (profile) and mirrored to `localStorage` for instant start.
- Rate limit: the same sound can't retrigger within 60 ms, so fast clicking never turns into noise.
- Audio starts only after the first user gesture (browser rule); nothing autoplays.
- Focus mode (Step 4) plays only `chime`.
- Sound never carries meaning alone: every sound has a visible state change with it.
