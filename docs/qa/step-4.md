# QA sign-off: Step 4 (study timer, timetable, .ics import, calendar link)

**Result: PASS** (2026-10-19). No High or Critical bugs. Eight bugs were found and fixed on `claude/step-4` (one Medium in the re-import, one Medium in the calendar feed, the rest Low; listed below). The open items are Low, or design questions for Bradley and the designer; none of them blocks a student test in demo mode. The two migrations were tested only on a local throwaway Postgres; the live database was not touched. Still to do: real phones, real uni exports and a live Supabase project (last section).

## Automated
| Suite | Result |
|---|---|
| Lint, typecheck, production build | Clean |
| Unit (Vitest) | 544 passed in 31 files (540 before QA, 4 added) |
| DB (`npm run test:db`, local Postgres 16 + pgvector, `studynest_test`) | GRANT TESTS PASSED, ALL RLS TESTS PASSED (one new cap test) |
| E2E (Playwright, desktop Chrome + Pixel 7), full runs on the final code | 160 passed, 6 skipped (phone-only or desktop-only by design), 0 failed. Run twice: default workers after a clean build (6.6 min) and `--workers=4` (5.0 min). Before QA: 158 tests, 2 failed in the first full run (the study strip URL check and the timer background-tab test). |
| Stress: `step1` + `step4-timer` specs, 4 repeats, 4 workers | Before the hardening: 167 of 168 passed (see "Intermittent" below). After it, with `step4-qa` added: 196 of 196 passed |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations: `/timer` at 375 px in dark mode (idle, running, Stop question); import preview at 375 px; timetable with class, study and other slots, slot details and the calendar link panel in dark mode (desktop and phone); plus the developer's checks (panel, settings, timetable, import, 375 px) |

## The flaky `toHaveURL` the developer saw
**Found and fixed (`e10899a`).** It was `e2e/step4-timetable.spec.ts` "subject page study strip: Add a class, then Next" (failed in my first full run on mobile: expected `?week=2026-10-27`, got `?week=2026-10-26`).

**Cause:** the study strip's Next link opens `/timetable?week=<class date>`. Once the timetable hydrated, it rewrote the address to the week's first day (`history.replaceState`). The test passed only when `toHaveURL` sampled the address before hydration, so it failed under load. It was also a small product bug: on a phone, a reload after following the link showed Monday, not the class's day.

**Fix:** `?week=` now holds the chosen day (the date a link put there, or the day picked in the phone's day strip); this week with today selected still has no parameter. The test now also reloads and checks the address again.

The `step1` spec named by the developer had a separate, known intermittent failure: axe's `document-title` when Next swaps `<title>` between the helper's wait and the scan (Step 2 QA item 9). Seen again in a loaded run. `expectNoA11yViolations` now polls the scan for up to 5 s (`8ad74eb`); a real violation still fails.

## Intermittent: timer rounds that look like they started after the fast-forward
In my first full run, `step4-timer.spec.ts:92` (background tab) failed once, and in the 4-worker stress run `step4-timer.spec.ts:119` failed once (2 in about 330 timer-test runs). In both, the page snapshot shows a round that started about 6 s before the failure with nearly 25 minutes left. In other words, the Start click took effect after `clock.fastForward`, not before it. I could not reproduce it in isolation: 30 repeats of `:92` and 40 repeats of a probe that starts and fast-forwards six rounds per test all passed. The timer code computes the time left as `endsAt − now` everywhere. The probe's `localStorage` read straight after the click always had the running state, and a real student never fast-forwards the clock. **Verdict: a test-harness timing issue under load with Playwright's fake clock, not a timer bug.** Hardened (test only): the two timer tests now wait for Pause to show before `fastForward`, so the jump can't come before the start. After that, the stress run passed 196 of 196. Logged as open item 7 so it is watched in CI.

## What was covered
**Timer (timer.md, PLAN 3f)**
- Wall-clock maths (code review plus tests): the time left is always `endsAt − now`; pause keeps `remainingMs`; "+5 min" stops at 180; display rounds up. One end timeout is re-armed on `visibilitychange`, `pageshow` and `focus`. A wake more than 2 minutes late is silent and logged at `endsAt` (e2e "ended while away").
- Several tabs (exploratory, Playwright with a hooked `AudioParam.setValueAtTime`): with 3 tabs open (subjects, timetable, settings), **exactly one tab chimed** (`[1, 0, 0]`). All three showed "Round done!", and one row was logged. Pause in tab B, Resume in tab A, Stop in tab B: one row, focused time 300 s, pauses excluded.
- Sound off: no chime, and the end card, chip and title still show. Focus mode: `data-focus-mode` on while running and while paused (developer e2e).
- Offline queue: the tally counts queued rounds and saves them on `online` (developer e2e). New: a round that ends while an earlier save is still on its way (bug 5).
- Subject defaults: the page subject, else a Study block happening now, else the last used, else No subject (unit tests and developer e2e).
- `/timer` at 375 px in dark mode: no sideways scroll, every target 44 px or more, axe clean while idle, running and on the Stop question.

**Timetable, import and feed (timetable.md, PLAN 3g)**
- Daylight saving: a weekly 10:00 London class stays at 10:00 in the week of the March 2027 change. A Sunday week start shows "Sunday 28 March" first. A slot at 01:30 on the change day (an hour that doesn't exist) moves forward to 02:30 and is not lost. The feed has `DTSTART;TZID=Europe/London` and a VTIMEZONE with `+0100` (new e2e). Unit probe: the October 2026 change with a Sunday start in London and in New York (shown on the right day and time in both).
- Real-world exports (unit probe plus a new e2e): an Outlook desktop file with `GMT Standard Time`, a quoted TZID, `TZOFFSETTO:-0000`, `SUMMARY;LANGUAGE=en-gb`, `WKST=SU` and an alarm. Also "Customized Time Zone" known only by its offsets (matched to Europe/Berlin), the display name "(UTC+01:00) Amsterdam, Berlin, …" and `W. Europe Standard Time`. All read at the right local times. A student in Asia/Singapore sees Monday 18:00 and the time zone line. Google and every-week-as-its-own-event files are covered by the developer's tests.
- Re-import and Undo: Undo of an import and of a re-import puts back exactly what was there (developer tests). New action tests: a re-import during a long break, and a re-import after the student moved and deleted weeks (bugs 1 and 2).
- 375 px: the import preview table (long group names, subject menus) stays inside the sheet with no sideways scroll; week grid and day strip (developer e2e).
- States: empty week sticker; offline banner with Add disabled; "Couldn't make the link. Try again." when the action fails, then it works on retry; "Couldn't save that slot. Try again." keeps what was typed; import errors (developer e2e); loading skeleton and error boundary present (`loading.tsx`, `error.tsx`).
- Keyboard: Tab goes from the week bar to the slots in time order (exploratory); N, T, arrows and Enter (developer e2e).
- Calendar sync conflicts (brief): no two-way Google sync in Phase 1 (PLAN decision 9), so "edited on both sides", "deleted in Google" and "token expired" don't apply. Instead: Reset makes the old link 404 at once, Turn off deletes it, and the token never appears in the export (developer tests).
- Access control: student B can't read, edit, delete, undo or use A's slots or subjects (action tests). Slots are read-only to students and calendar links are invisible to everyone (RLS tests). The feed looks up only by the hash of a well-formed token.

## Bugs found and fixed
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| 1 | Medium | A re-import during a long break filled the break with the class (timetable and calendar feed). | Import a full-year file (autumn term, 4+ weeks off at Christmas, spring term). Re-import it with "Replace my previous import" in the holidays. The class shows every week of the break. | `37660e1`: the weeks after the earlier run's last date are skipped when the two runs are merged. Action test. |
| 2 | Medium | A re-import brought back weeks the student had moved or deleted, so a moved class showed twice. | Import. Move next week's lecture with "Just this week". Re-import with Replace. The lecture shows on both days. | `ea3deaa`: skipped weeks from the new start on are kept. Action test. |
| 3 | Medium | The calendar feed's VTIMEZONE only covered 10 years from the zone's earliest slot. One slot dated years back (the form accepts 2000 on) left this year with no daylight saving rules: classes an hour off in Google, Apple and Outlook. | Add a one-off slot on 1 Mar 2004 and a weekly class now, then open the feed: no 2026 transitions. | `c0b17ac`: at most 11 years, always around now. Unit test. |
| 4 | Low | The 600-row backstop trigger refused import updates (upserts fire BEFORE INSERT) when 300 live and 300 soft-deleted rows existed (a replace import's Undo window). | With 300 live and 300 just-deleted slots, re-import: "That would go over 300 slots." | `8223605`: only rows that don't exist yet are counted. RLS test (failed before). Migration edited before it is applied. |
| 5 | Low | A round that ended while an earlier save was still on its way stayed queued until the next load or `online` event. | Slow connection. A focus round ends, then the break ends within the save's time. The break stays in `studynest:timer:queue`. | `b6d868e`: the running flush makes one more pass. e2e (failed before). |
| 6 | Low | The timetable rewrote `?week=<day>` to the week's Monday after loading, so a phone reload lost the day. This was also the flaky `toHaveURL`. | Subject page, Next link, phone, reload: Monday is shown. | `e10899a`: the address keeps the chosen day. e2e reloads. |
| 7 | Low | "Nothing this week" pointed a finished weekly series to its first week, not its last. | A series that ended last month, no later slots: "Next class" jumps months back. | `a642fb6`: the latest occurrence before the week. Unit test. |
| 8 | Low | The import preview's Include boxes were 24 px with nothing around them (spec: 44 px targets). | 375 px, import: `smallTargets` lists `input "Include …" 24×24`. | `3df16d1`: the whole 44 px cell ticks the box. e2e taps the corner of the cell. |

Test-only: `8ad74eb` (the axe helper polls past a `<title>` swap). The timer spec waits for the running state before the clock jumps (commit with this sign-off).

## Open issues
| # | Severity | Issue | Owner |
|---|---|---|---|
| 1 | Medium (design) | Re-import versus the student's own "Every week" edits: if a student splits an imported class ("Every week" from week 5, e.g. a new room), a later re-import with Replace restores the imported series to the file's dates. The student's manual series from week 5 then overlaps it (the class shows twice from week 5). The spec says re-import "never touches slots made by hand", so this is as specified, but a student won't expect it. Options: keep the imported series' `repeat_until` when it was shortened by the student, or warn in the preview. | Bradley / designer |
| 2 | Low | Bug 2's fix keeps every skipped week from the new start on. If the uni later puts back a week that an earlier file had skipped, it stays skipped, and there is no way to un-skip one week in the UI. | Designer / developer |
| 3 | Low | `undoImport` works for any batch id at any time on the server (only the toast limits it to 6 s). A replayed or late call could delete classes the batch inserted, or a class it updated once a later import has cleared `import_prev`. It only affects the student's own data. Suggest refusing an undo when the batch is older than a few minutes. Supabase deletes soft-deleted rows of the batch too; demo doesn't. | Security engineer / developer |
| 4 | Low | A round paused for more than 2 days and then stopped is refused by the server ("That round is too long.") and dropped from the queue without a message. | Developer |
| 5 | Low | `editSlot` writes the new one-off or split series first and then updates the original. If the second write fails, there is a duplicate (Supabase path, no transaction). | Developer |
| 6 | Low | "This week: 2 h studied" on the subject page always counts from Monday (as subject.md says), even with "Week starts on Sunday", so on a Sunday the timetable and the strip disagree about "this week". | Designer |
| 7 | Low (test) | Rare fake-clock timing in `step4-timer.spec.ts` under load (see "Intermittent"). | QA / developer |
| 8 | Low | Without Replace, "Add 12 classes" and the toast count every ticked class, also ones already imported that are skipped. | Developer |
| 9 | Info | `siteOrigin()` builds links from the Host header in production when `DEMO_MODE=1` (needed for the e2e production build). Fine for demo mode, which sends no email; worth a look in the security review. | Security engineer |

## Not tested yet
- Real phones: iOS Safari and Android Chrome with the screen locked during a round (when the timer wakes, the notification through the service worker), and the Apple "Open in Apple Calendar" webcal hand-off.
- Real uni exports (Scientia/Syllabus+, CMIS, Celcat, Outlook on the web) beyond the shapes reproduced here. Google, Apple and Outlook subscribing to the feed over the internet, and how quickly they refresh.
- A live Supabase project with both migrations applied (all checks ran on local Postgres with the Supabase stub).
