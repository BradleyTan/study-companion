# Screen: Timetable (`/timetable`) + import + calendar link

Step 4. The student's week on graph paper: classes as solid subject stickers, planned study blocks as dashed "pencilled-in" stickers. Drag on the grid to add (tap on phones), import the uni timetable file, and get a private calendar link for Google, Apple or Outlook Calendar. No Google sign-in, no two-way sync (PLAN decision 9): the link is read-only and everything is free.

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900.

## Navigation (app header, all signed-in pages)
- Laptop/tablet: logo · "Subjects" · **"Timetable"** · [timer chip] · "Settings" · "Sign out". Current page link has `aria-current="page"` and a `--highlight` underline sticker.
- Phone (375 px): logo · [timer chip] · **Timetable** icon button (calendar icon, label "Timetable") · **Menu** "⋯" button (Subjects, Settings, Sign out). All 44 px. The logo still links to Subjects.

## Data the screen needs
- Subjects (not archived): `id`, `name`, `colour`, `emoji`.
- Slots overlapping the visible week, with recurrence expanded **in `profiles.timezone`** (a 10:00 weekly class stays 10:00 across daylight-saving changes).
- Profile `timezone`, `week_start` (`mon` default / `sun`), calendar link status (exists?, created, last fetched).
- Suggested schema for `timetable_slots` (Step 4 migration owns the final names): `subject_id uuid null` (on subject delete: set null), `title text` (≤ 80), `kind` (`class` / `study` / `other`), `location text null` (≤ 80), `starts_at`, `ends_at` (first occurrence, timestamptz), `recurrence` (`none` / `weekly`), `repeat_until date null`, `skip_dates date[]` (weeks skipped, ≤ 60), `source` (`manual` / `import`), `import_uid text null` (unique per student, for re-imports), `import_batch uuid null`. Cap 300 slots per student. The Google columns (`google_event_id`, `etag`, `sync_state`) and `calendar_connections` are no longer needed (decision 9).
- Calendar link: one secret token per student (`calendar_token`, `calendar_token_created_at`, `calendar_last_fetched_at`); storage and lookup are the security engineer's call, but the panel must be able to show the link again whenever it's opened.

## Rules the developer must match
- **Slots:** start/end on 15-minute steps, end after start, same day, ≤ 12 h. Overlaps are allowed and drawn side by side.
- **Default title** when left empty: class "Biology class", study "Study: Biology", other "Busy"; no subject: "Class" / "Study" / "Busy".
- **Repeating slots:** "Every week" (default for new slots) or "Just once". Editing or deleting one occurrence of a weekly slot asks "Just this week" or "Every week" (radio, default "Just this week"). "Just this week" adds the date to `skip_dates` and, for an edit, creates a one-off slot with the change. "Every week" changes the series from this week on (earlier weeks keep the old times: split the series by setting `repeat_until` and creating a new one).
- **Subject link:** a slot's colour and emoji come from its subject everywhere (here, the subject page, the feed). Deleting a subject keeps its slots as "No subject".
- **Study blocks connect to the timer:** while a Study slot is happening now, it shows a "Start focus" button that starts a focus round with its subject (timer.md), and the timer panel defaults to that subject.

## Layout
**Header row:** title "Timetable" (Permanent Marker, 28 px; 20 px phone). Right (laptop/tablet), or a row under the title (phone): "Add" (primary, "+" icon), "Import timetable" (plain), "Add to my calendar" (plain, calendar-link icon). Phone: "Add" full width, the other two side by side under it.

**Week bar:** "‹" (Previous week) · week label "14 – 20 Oct" (button: jumps back to this week when another week is shown, label "This week" then) · "›" (Next week). Phone: the bar shows the week label and, under it, a **day strip** of 7 chips "Mon 14" … "Sun 20" (radio group; today pre-selected, today's chip has a `--highlight` fill; days with slots show a small dot).

**Grid** (graph paper background, `--grid` lines every 15 min faint, hour lines `--rule`):
- Laptop/tablet: hour column (48 px, "9:00" labels in `--ink-soft` 14 px) + 7 day columns. Day headers sticky: "Mon 14"; today's header is a `--highlight` sticker. Hour height 48 px (tablet 44 px). Visible hours 7:00–22:00, the grid scrolls inside its sticker for the rest (0:00–24:00); on load it scrolls to 30 minutes before the earliest slot of the week (or 8:00).
- Phone: hour column (40 px) + **one day column** (the day chosen in the strip). Swiping left/right on the grid changes day (and week at the ends); the strip is the accessible way.
- **Now line:** across today's column, 2 px `--ink` line with a small `--highlight` pill "Now" (ink outline) at its left end; moves each minute.
- Weekends: on laptop, Saturday and Sunday columns are 0.8× as wide when they have no slots that week.

**Slot stickers** (radius 8, 2.5 px outline, 2 px offset shadow, no rotation; inside text clipped with ellipsis):
| Kind | Look |
|---|---|
| Class | `--subject` fill, solid ink outline, `--on-colour` text, chalkboard icon |
| Study | `--card` fill, **dashed** ink outline, 6 px left band in `--subject`, pencil icon, text `--ink` |
| Other | `--card` fill, solid outline, no band, text `--ink` |
| No subject | as its kind, with `--card` fill (class too), and a small "No subject" chip |

Content by height: ≥ 64 px: emoji + title (bold 14 px), time "10:00–11:00", location; 32–63 px: emoji + title + start time on one line; < 32 px (15 min): emoji + title only, the rest in the accessible name and the details popover. A repeating slot shows a small "↻" icon. The kind is always in words in the accessible name and details, never only the outline style.

**Slot details** (click/tap a slot): popover anchored to the slot (≥ 640 px) or `BottomSheet` (phone): subject chip, title, "Mon 14 Oct, 10:00–11:00", "Every Monday until 13 Dec" / "Just once", location, "Imported from your uni timetable" (imported). Buttons: "Edit", "Delete", and "Start focus" (Study, while happening now or within 15 min before it).

**Create / edit form** (`Dialog` on laptop/tablet, `BottomSheet` on phone), title "New slot" / "Edit slot":
- "What is it?" segmented: **Class | Study | Other** (default Class; Study when created from the subject page).
- Subject `Select` (emoji + name, last option "No subject"; default the subject from context, else the last used).
- Title (optional, placeholder shows the default title).
- Day (date), Start, End (`<input type="time" step="900">`); "1 h 30 min" shown beside End.
- Repeats: radio "Every week" / "Just once"; with Every week, optional "Until" date.
- Location (optional).
- Buttons: "Save slot" (primary) / "Cancel"; edit adds "Delete slot" (danger, inline confirm "Delete Biology class? Just this week / Every week").
- Inline errors: "End has to be after the start.", "A slot can be up to 12 hours.", "You've reached 300 slots. Delete a few old ones first."

## Drag to create (laptop/tablet, mouse or pen)
- Pointer down on an empty spot, drag up or down within the day: a ghost slot (dashed outline, `--highlight` 40 % over `--card`, i.e. `color-mix` of existing tokens) grows in 15-minute steps with a live label "10:00–11:30". Release opens the form prefilled. A plain click without dragging makes a 1-hour slot from the clicked quarter hour.
- Drag an existing slot's body to move it (also across days), its bottom edge (8 px handle, resize cursor) to change the end. Release on a weekly slot asks "Just this week / Every week" (small popover), then saves. Esc during a drag cancels.
- Touch on tablet behaves like phone (below), so scrolling never creates slots by accident.

## Tap to create (phone and touch)
- Tap an empty hour: the form opens prefilled with that hour (or the half hour tapped), 1 hour long. A tap highlights the hour band for 120 ms first so the student sees where it went.
- Move and resize: through Edit only (no long-press drag in Phase 1).

## Import the uni timetable (`Dialog` / `BottomSheet`, title "Import your timetable")
**Step 1: Choose file.** Short help: "Most uni timetable pages have an 'Export', 'Subscribe' or 'Download to calendar' option. Save the .ics file and choose it here." Drop zone (dashed, as uploads): "Drop your .ics file here, or choose a file", "Calendar file (.ics), up to 1 MB". File only, no URL fetching.
**Step 2: Reading.** "Reading your timetable…" (static under reduced motion). Parsed on the server (zod-validated): `VEVENT`s with `SUMMARY`, `DTSTART`/`DTEND` (with `TZID`), `RRULE` weekly, `EXDATE`, `LOCATION`, `UID`. All-day events, events over 12 h and events that ended before today are left out; at most the next 26 weeks and 500 events.
**Step 3: Preview** (nothing is saved yet):
- Summary line: "We found **34 classes** in **6 groups**, 23 Sep – 13 Dec." Left-out line when relevant: "Left out: 3 all-day events, 12 past classes."
- Time zone line if the file's zone differs from the profile: "These times are in Europe/London. They're shown in your time zone (Asia/Singapore)."
- One row per **group** (same `SUMMARY`): checkbox (ticked), name ("BIOL1001 Lecture"), when ("Mon 10:00–11:00, weekly, 12 weeks"; or "4 dates" for one-offs), location, and a subject `Select` with "No subject". The subject is **pre-matched** when the summary contains a subject's name or a course code already used for that subject, otherwise "No subject". Kind is Class.
- Mini week preview under the list (laptop/tablet; phone shows the list only): the first full imported week drawn with the slot stickers.
- Re-import (some `UID`s already imported): checkbox "Replace my previous import" (ticked): updates matching classes, removes imported classes no longer in the file, never touches slots made by hand. Line "6 updated, 2 new, 1 removed".
- Buttons: "Add 34 classes" (primary, count follows ticks) / "Back" / "Cancel".
**Step 4: Done.** Dialog closes, the grid jumps to the first imported week, toast "Added 34 classes to your timetable." with "Undo" (6 s, deletes that `import_batch`), `pop`.

Import errors (in the dialog, `boop`): "That isn't a calendar file. Look for a file ending in .ics." · "That file is over 1 MB." · "We couldn't find any classes in that file." · "This file only has past classes." · "Something went wrong reading that file. Try exporting it again." Partial reads are not errors: they show in the left-out line ("2 events had times we couldn't read").

## Calendar link panel ("Add to my calendar")
`SidePanel` (≥ 640 px) / `BottomSheet` (phone). The same `CalendarLinkPanel` component is used in Settings (settings.md).
- Title "Your calendar link". Intro: "A private link that shows your StudyNest timetable in Google, Apple or Outlook Calendar. When you change a slot here, your calendar catches up by itself."
- **No link yet:** button "Make my calendar link" (primary). Nothing is created until pressed.
- **Link exists:**
  - Read-only input (full width, monospace 14 px, selected on focus) with `https://…/api/calendar/<token>.ics`, label "Calendar link".
  - **"Copy link"** (primary): copies, the button reads "Copied!" with a ✓ for 2 s, polite announcement "Link copied". If the clipboard is blocked: the input text is selected and the line "Press Ctrl+C (or ⌘C) to copy" appears.
  - Warning line with a lock icon: "Anyone with this link can see your timetable. Keep it to yourself."
  - Status line `--ink-soft`: "Made 14 Oct · Last checked by your calendar 2 hours ago" ("Not checked by a calendar yet" before the first fetch).
  - **Steps**, tabs "Google | Apple | Outlook" (default by device: Apple on iOS/macOS, else Google; numbered step list, 16 px):
    - **Google Calendar:** 1. Copy the link above. 2. On a computer, open calendar.google.com (the phone app can't add links). 3. Next to "Other calendars", click **+**, then **From URL**. 4. Paste the link and click **Add calendar**. 5. It shows under "Other calendars", and on your phone too. Note: "Google checks for changes a few times a day, so a new slot can take up to 24 hours to appear."
    - **Apple Calendar:** button "Open in Apple Calendar" (the same link as `webcal://`; on iPhone and Mac this opens the subscribe screen). Or by hand on iPhone: 1. Copy the link. 2. Open **Settings → Apps → Calendar → Calendar Accounts → Add Account → Other** (older iOS: Settings → Calendar → Accounts). 3. Tap **Add Subscribed Calendar**, paste, tap **Next**, then **Save**. On a Mac: Calendar → **File → New Calendar Subscription**, paste, **Subscribe**, set Auto-refresh to **Every hour**.
    - **Outlook:** 1. Copy the link. 2. Open Outlook on the web (outlook.com or your uni's Outlook) and go to Calendar. 3. Click **Add calendar → Subscribe from web**. 4. Paste the link, name it "StudyNest", click **Import**. Note: "Outlook checks for changes every few hours."
    - Under the tabs: "Menus move around sometimes. If a step looks different, search your calendar's help for 'subscribe by URL'."
  - **Reset link** (plain button, under a divider, heading "Link shared by mistake?"): inline confirm "Reset your calendar link? The old link stops working straight away. You'll need to add the new one to your calendar again." [Reset link] (danger) [Cancel]. After: new link shown, toast "New link made. The old one no longer works.", `tear`.
  - **Turn off link** (ghost): confirm "Turn off your calendar link? Calendars using it will stop updating." → back to "No link yet", `tear`.
- **What the feed contains:** every slot (classes, study blocks, other) with title "🧬 Biology class", location, times (repeating slots as weekly events with their skipped weeks), and a stable event id per slot. Nothing else: no notes, no study history. Subject renames show on the next calendar refresh.

## Motion
- New slot (saved): sticker pops in (350 ms spring). Deleted: shrinks 200 ms. Moved/resized: snaps to the 15-minute step with 120 ms ease-out.
- Week change: grid slides 24 px and fades (200 ms) in the direction travelled. Day change on phone: same, 150 ms.
- Reduced motion and focus mode: no slides or pops; changes appear at once (120 ms fade at most). Drag ghosts still follow the pointer (direct manipulation, not decoration).

## States
- **Loading:** header, week bar and an empty grid with 3 grey slot skeletons; buttons enabled except Add-to-calendar status line (shows "…").
- **Empty week (no slots at all):** grid stays visible, with a centred sticker over it: marker line "Your week is wide open", sub-line "Drag on the grid to add a class or study block, or bring in your uni timetable." (phone: "Tap a time to add a class or study block, or bring in your uni timetable."), buttons "Import timetable" (primary) and "Add a slot". Pointer events pass through the area around the sticker so dragging still works.
- **Empty this week, slots in other weeks:** small line in the week bar "Nothing this week" + "Next class: Mon 3 Nov" link.
- **Load error:** sticker card "We couldn't load your timetable." + "Try again".
- **Save failed:** the slot returns to where it was (or the ghost disappears), toast "Couldn't save that slot. Try again.", `boop`; the form keeps what was typed.
- **Offline:** read-only from the last load, banner "You're offline. Changes will need a connection."
- **Calendar link failed to make/reset:** inline "Couldn't make the link. Try again." `boop`; the old link (if any) still works.

## Sounds
`click` on buttons, week/day changes, tabs and Copy link; `pop` when a slot is saved (form or drag) and when an import is added; `tear` on delete, reset link and turn off link; `boop` on save errors and import errors. Nothing while dragging or reading a file. Focus mode: only `chime` (existing rule).

## Keyboard
| Key | Action |
|---|---|
| Tab | Moves through: header buttons → week bar → each day's slots in time order → next day |
| Enter / Space on a slot | Opens its details |
| N | New slot (when focus isn't in a field or dialog), same as "Add" |
| ← / → (focus in the week bar) | Previous / next week |
| T | Back to this week |
| Esc | Closes details, form or panel; cancels a drag |

Creating and moving slots never needs a mouse: "Add" and "Edit" cover everything drag does.

## Accessibility
- The grid is not an ARIA grid. Each day is a `<section>` labelled "Monday 14 October" (today: "Today, Monday 14 October") containing a `<ul>` of slot buttons in time order. Empty grid space is pointer-only (`aria-hidden` drag layer); the "Add" button is the keyboard and screen-reader path.
- Slot accessible name: "Class, Biology, BIOL1001 Lecture, 10:00 to 11:00, Room 2.14, every week". No subject: "…, no subject, …".
- Drag result announced politely: "Biology class moved to Tuesday, 11:00 to 12:00."
- Day strip (phone) is a radio group "Day"; week buttons are labelled "Previous week" / "Next week"; the week label announces "Week of 14 October".
- Import preview: a table with a caption ("Classes found in your file"), checkbox and select labelled by the group name ("Include BIOL1001 Lecture", "Subject for BIOL1001 Lecture").
- Calendar tabs: native tablist pattern (arrow keys between tabs). Steps are an `<ol>`. Bold menu names are plain text, not links.
- Contrast: class text `--on-colour` on subject fills (≥ 7:1 both themes); study/other text `--ink` on `--card`; hour labels `--ink-soft` on `--paper` (AA). Kind is never colour-only (words, icons and outline style). The Now pill is ink on `--highlight`.
- Targets ≥ 44 px for every button and chip; slots shorter than 44 px keep their visual height but get a 44 px hit area where it doesn't overlap a neighbour, and are always reachable through the day list.
