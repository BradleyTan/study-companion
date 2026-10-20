# Screen: Study timer (global panel + `/timer`)

Step 4. A Pomodoro timer that lives in the app frame, so it keeps running while the student moves between notes, cards and quizzes. It should feel like a friendly kitchen timer stuck to the notebook: one big ring, one big button, a little tomato sticker for every round done. While a focus round runs, the whole app goes quiet (focus mode).

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900.

## Where it lives
- **Timer chip** in the app header on every signed-in page (the header stays above the review and quiz sessions' slim bars too), between "Timetable" and "Settings" (timetable.md "Navigation"). It is the only way the timer shows up uninvited: no floating bubbles, no pop-ups.
- Tapping the chip opens the **timer panel**: `BottomSheet` on phone (auto height, max 90dvh), `SidePanel` 400 px from the right on tablet and laptop. It doesn't block the page behind (non-modal side panel; the phone sheet is modal with a scrim, like the mindmap panel).
- **`/timer`** is the same component full size ("focus view"), linked from the panel's "Full screen" icon button and the subject page study strip. The header stays; nothing else is on the page.
- One `TimerProvider` in `src/app/(app)/layout.tsx` (client) owns the state; chip, panel, `/timer` and the subject page read it. Navigation never resets it.

## Data the screen needs
- Subjects (not archived): `id`, `name`, `colour`, `emoji`.
- Timer defaults from the profile (settings.md): `timer_focus_min` 25, `timer_short_min` 5, `timer_long_min` 15, `timer_long_every` 4, `timer_auto_start` false, `focus_quiet` true.
- Today's sessions (local day in `profiles.timezone`): focus rounds and seconds per subject, for the tally.
- Suggested schema for `study_sessions` (Step 4 migration owns the final names): `subject_id uuid null` (on subject delete: set null, the time still counts), `kind` (`pomodoro` / `break`), `planned_min`, `started_at`, `ended_at`, **`focused_sec int`** (running time only, pauses excluded), **`completed boolean`**, **`client_key text`** (unique per student). Read-only to students like the Step 3 tables; written by a server action.

## Rules the developer must match
- **Wall-clock, not ticks.** Running state is `{ sessionId, phase, subjectId, plannedSec, startedAt, endsAt }`; paused state stores `remainingSec` instead of `endsAt`. Remaining time is always `endsAt − Date.now()`, never a counter that is decremented. The state is saved to `localStorage` (`studynest:timer`) on every change, so a reload, a closed tab or a sleeping phone picks up exactly where the clock is.
- **Display** rounds up: `ceil(remaining / 1000)`, so it starts at 25:00 and shows 00:00 only at the end. Redraw with `requestAnimationFrame` (or a 250 ms interval) while visible; recompute at once on `visibilitychange`, `pageshow` and `focus`.
- **End detection** uses its own one-shot `setTimeout(endsAt − now)`, re-armed on every state change and on `visibilitychange`. Don't rely on the redraw loop: browsers throttle chained timers in hidden tabs to once a minute, a single timeout is not.
- **Ended while away:** if the page wakes (phone unlocked, tab reopened) and `now ≥ endsAt`, the phase is completed with `ended_at = endsAt`. `chime` plays only if the end was under 2 minutes ago; otherwise silent, and the panel shows "Your focus round finished at 14:25. Nice work!" (break: "Your break ended at 14:30.").
- **Several tabs:** state syncs through the `storage` event. Exactly one tab handles an end (claims it by writing `endedHandledBy` for that `sessionId` first, or `navigator.locks`); only that tab plays `chime`, shows the notification and logs. The log is idempotent anyway (`client_key = sessionId`).
- **Logging:** each phase is saved once when it ends (completed, stopped or ended while away). Rounds with `focused_sec < 60` are not saved. A failed save is queued in `localStorage` and retried on the next load or `online` event; the tally counts queued rounds so nothing looks lost. One device's timer only (no cross-device sync in Phase 1).
- **Cycle:** after a focus round, the next break is long when `completedFocusToday % timer_long_every == 0` within the current run of rounds (a "Done for now" or a gap of over 60 minutes resets the run to round 1).
- **Auto-start** (off by default): when on, the next phase starts by itself at the end. When off, the timer waits on the end card.
- **Focus mode** (`setFocusMode` in the sound provider) is on while a focus round is running **or paused**, and off during breaks and when idle, if `focus_quiet` is on (default). It follows the existing rules: only `chime` plays, decorative motion follows reduced-motion rules, no confetti. Read-aloud still works.
- **Durations:** focus 5–120 min (step 5), short break 1–30 (step 1), long break 5–60 (step 5), long break every 2–8 rounds. Changing a duration while a phase runs applies from the next phase. "+5 min" adds to the running phase only (max 180 min total).
- **Subject:** default is the subject of the current page (`/subjects/[id]/…`), else the subject of a timetable Study block happening now, else the last used, else "No subject". It can be changed while running; the whole round is logged under the final choice.

## Layout (panel and `/timer`)
Top to bottom, centred, single column on every width:

1. **Panel header** (panel only): title "Study timer" (bold 20 px), icon buttons "Full screen" (→ `/timer`) and "Close" (44 px).
2. **Subject picker:** `Select` labelled "Studying", options "🧬 Biology", …, last option "No subject". Under 640 px full width; otherwise 280 px. No subjects yet: only "No subject" plus a small link "Make a subject".
3. **Phase switch** (idle only): segmented control "Focus · 25 | Short break · 5 | Long break · 15" (radio group). Hidden while running; the phase name shows in the ring instead.
4. **Ring:** SVG, diameter 240 px in the panel, 320 px on `/timer` laptop/tablet, 260 px on `/timer` phone (never wider than the viewport minus 32 px).
   - 16 px band with 2.5 px `--ink` outlines on both edges; track `--card`.
   - **Focus drains:** the band starts full in `--subject` (`--highlight` with No subject) and empties clockwise from 12 o'clock. **Break fills:** starts empty, fills with `--success`. A 4 px ink notch marks the moving edge so progress is visible without relying on the pastel against the track.
   - Centre: phase label 16 px `--ink-soft` ("Focus", "Short break", "Long break", "Paused"), time **56 px** bold Atkinson Hyperlegible, `font-variant-numeric: tabular-nums` (48 px in the 240 px ring), and the subject chip under it.
   - Round dots under the time: `timer_long_every` small circles, filled ink for rounds done in this run, outline for the rest ("Round 2 of 4").
5. **Controls** (one row, 44 px+, wrap on phone):
   - Idle: primary **"Start focus"** / "Start break" (full width on phone, 220 px otherwise) + ghost duration stepper "− 25 min +" for the chosen phase (buttons labelled "Shorter" / "Longer"; changes save to the profile default, toast "Saved").
   - Running: primary **"Pause"**, plain "+5 min", plain "Stop" (focus) or "Skip break" (break).
   - Paused: primary **"Resume"**, plain "Stop".
   - Stop asks inline (no dialog), replacing the controls: "End this round? 12 min of Biology will be saved." [End round] (plain) [Keep going] (primary). Under a minute: "End this round? It's under a minute, so it won't be saved."
6. **End card** (replaces the controls when a phase ends and auto-start is off; tape on top, sticker pop):
   - Focus done: heading "Round done! 🍅", line "That's 3 today. Time for a 5-minute break." (long break: "Four in a row! Take a proper 15-minute break."). Buttons "Start break" (primary), "Skip break" (ghost).
   - Break done: heading "Break's over", line "Ready for another round?" Buttons "Start focus" (primary), "Done for now" (ghost; resets the run).
7. **Today tally** (sticker card, `--card`): heading "Today", a row of small 🍅 stickers (one per round, max 12 shown, then "+3"), line "3 rounds · 1 h 15 min", then per-subject rows: emoji, name, time ("Biology · 50 min"). Empty: "No rounds yet today. One round is 25 minutes. You've got this."
8. **Notification nudge** (see below), at the bottom, only when it applies.

**Timer chip** (header): sticker chip, min 44 px tall, fixed min-width so digits don't shift the header.
- Idle: clock icon + "Timer", `--card` fill.
- Focus running: mini ring (20 px, same drain) + "18:42", fill `--subject` (or `--highlight`), `--on-colour` text.
- Break running: mini ring filling + "Break 4:12", `--success` fill.
- Paused: pause icon + "18:42", `--card` fill, dashed outline.
- Ended, waiting (auto-start off): "Round done!" with `--highlight` fill and a one-time 350 ms pop.
- Phone: the chip drops the word "Break" (icon only) to fit beside the logo and Timetable/Menu buttons.

**Tab title** while running: "18:42 · Focus · StudyNest" (break "4:12 · Break · StudyNest", paused "Paused · StudyNest"); after an end, "Time's up! · StudyNest" until the tab is visible again. Updated at most once a second.

## Notifications (optional)
- The app works fully without them: the chime, the chip, the tab title and the end card always tell the student.
- **Never asked on page load.** The nudge card appears in the panel after the first completed focus round, if `Notification.permission === "default"` and it wasn't dismissed: "Want a nudge when time's up? Your browser will ask first. We only use it for the timer." [Turn on] [Not now]. "Turn on" calls `Notification.requestPermission()` (from that click). "Not now" hides it for 30 days (`localStorage`). Settings has the same toggle.
- Shown only when the tab is hidden at the end, through the service worker (`registration.showNotification`, needed on Android). Title "Round done! 🍅" / "Break's over", body "Time for a 5-minute break." / "Ready for another round?", `tag: "studynest-timer"` (replaces the previous one), `silent` when sound is off. Clicking focuses the tab and opens the panel.
- Denied: the nudge never shows; settings shows "Notifications are blocked in your browser. The chime and the tab title still tell you when time's up."
- Honest limit (help text in settings): "On phones, the alert may only appear when you come back to StudyNest if your browser was closed or the phone was asleep." No push server in Phase 1.

## Motion
- Ring: the band moves with a 1000 ms linear transition per second (calm, continuous). Reduced motion: no transition, it steps once a second.
- Phase end: ring does one 350 ms spring scale (1 → 1.04 → 1), the new 🍅 sticker pops into the tally, end card pops in. Focus mode has just ended at this moment, so this plays unless reduced motion is on.
- Panel and sheet: Step 2 panel motion (250 ms slide; reduced motion 120 ms fade).
- Nothing else moves while a focus round runs (focus mode): no loops, no pops, chip updates digits only.

## States
- **Loading** (profile/subjects not yet loaded): ring drawn with the stored or default duration, Start disabled for at most a moment; the chip shows "Timer". Running state from `localStorage` renders immediately, before any network.
- **Ended while away:** see Rules; the end card shows with the away line.
- **Save failed / offline:** no interruption; tally shows queued rounds; after 3 failed retries a small line in the tally: "1 round is waiting to be saved. It'll save when you're back online."
- **Subject deleted while running:** round continues as "No subject".
- **Time zone changed mid-day:** today's tally uses the profile time zone; nothing else changes.

## Sounds
`click` on Start, Pause, Resume, +5 min, Stop, Skip, stepper and phase switch; **`chime`** at the end of every phase (focus and break), only in the one tab handling the end. Nothing during the countdown, no ticking. In focus mode only `chime` plays (existing rule). **`chime` is the one exception to "speech wins"**: it still plays while read-aloud is speaking (the provider's speaking check must let `chime` through). With sound off: no chime; the end card, chip, title and (if allowed) the notification still show. Auto-start: the end plays only `chime`, never also `click`.

## Keyboard
| Key | Where | Action |
|---|---|---|
| Space | `/timer`, focus not on a control or text field | Start / Pause / Resume |
| Esc | Panel | Close, focus returns to the chip |
| Enter / Space | Any control | Native button behaviour |

No global single-key shortcut (review and quiz already use letters). The chip is early in the header's tab order on every page.

## Accessibility
- The ring is `aria-hidden`. The time is in an element with `role="timer"` and `aria-live="off"`, labelled "Focus, Biology, 18 minutes 42 seconds left" (updated each second in the name, never announced on its own).
- A polite live region announces only: start ("Focus started: 25 minutes, Biology. Focus mode is on: sounds and animations are quieter."), pause ("Paused with 18 minutes left."), resume, "1 minute left.", end ("Round done! Time for a 5-minute break."), and the ended-while-away line. Break start: "Break started: 5 minutes."
- Chip accessible name: "Study timer: focus, 18 minutes left, Biology" / "Study timer, not running"; `aria-expanded` and `aria-controls` for the panel.
- Phase switch is a native radio group; stepper buttons are labelled "Shorter focus" / "Longer focus" and the value is a read-only `output` ("25 minutes").
- Focus: opening the panel moves focus to its title; the end card's heading receives focus only when the panel is open (never steals focus from another page).
- Contrast: time `--ink` on `--card`/`--paper`; chip fills (`--subject`, `--highlight`, `--success`) carry `--on-colour` (≥ 7:1 both themes); paused chip ink on card. Ring progress is a supplement to the numbers and has ink edges plus the notch (non-text 3:1 met by the outlines).
- Targets ≥ 44 px; the phone ring is never the only control (buttons below it).
