# Screen: Settings (`/settings`)

Sections as stacked sticker cards:
1. **Sound:** toggle "Play sounds" (default on), volume slider 0–100 (default 35) with a "Test" button that plays `pop`. Saved immediately; toast "Saved".
2. **Theme:** radio group "Match my device" / "Light" / "Dark" (polish pass: the friendlier app wording), drawn as a segmented control (`.seg`, like "Week starts on"): the chosen one in `--highlight`, a visible focus ring on the keyboard-focused option, 44 px targets.
3. **Study timer** (Step 4, timer.md). Saved immediately to the profile, toast "Saved"; a running phase keeps its length, the change applies from the next one.
   - Steppers (− value +, buttons 44 px, value in an `output`, labels visible): "Focus" 25 min (5–120, step 5), "Short break" 5 min (1–30, step 1), "Long break" 15 min (5–60, step 5), "Long break after" 4 rounds (2–8).
   - Toggle "Start the next round or break by itself" (default off).
   - Toggle "Quiet the app while I focus" (default on), help: "During a focus round only the end chime plays and animations calm down."
   - **Notifications:** toggle "Tell me when time's up, even in another tab" (default off). Turning it on asks the browser (from that click). States under it in `--ink-soft`: allowed "On for this browser."; blocked "Notifications are blocked in your browser. The chime and the tab title still tell you when time's up." (toggle off and disabled, with a short "How to unblock" disclosure: "Click the lock or settings icon next to the web address and allow notifications."); unsupported "This browser can't show notifications. The chime and the tab title still work." Always: "On phones, the alert may only appear when you come back to StudyNest if your browser was closed or the phone was asleep." This is per browser (permission lives there), stored in `localStorage`, not the profile.
   - Suggested profile columns: `timer_focus_min`, `timer_short_min`, `timer_long_min`, `timer_long_every`, `timer_auto_start`, `focus_quiet`.
4. **Timetable and calendar** (Step 4, timetable.md):
   - Radio "Week starts on" Monday (default) / Sunday (`profiles.week_start`).
   - Time zone line (read-only): "Times are shown in Asia/Singapore (from this device)." It already follows the device through `ProfileSync`.
   - **Calendar link:** the same `CalendarLinkPanel` content as on the timetable, inline in the card (no panel): make, copy, steps for Google / Apple / Outlook, reset, turn off. Status "Last checked by your calendar 2 hours ago".
5. **Your data:** "Download everything" (JSON export of subjects, notes, file list and extracted text; files themselves are downloadable from each subject). Step 4: the export also includes timetable slots and study sessions (never the calendar token). Link to the privacy page.
6. **Delete account:** danger card. Requires typing DELETE. Copy: "This permanently deletes your account, notes and files. It can't be undone." Button "Delete my account". Deleting also turns off the calendar link at once.

Sounds: `click` on toggles, steppers and radios; `pop` on Test; calendar link sounds as timetable.md. Phone: steppers full width, one per row.
