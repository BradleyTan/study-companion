# QA sign-off: polish pass (before the student test)

**Result: PASS** (2026-10-20, branch `claude/polish`). Every P1 and P2 item of `docs/design/polish.md` works in the demo-mode production build at 375 px and 1280 px, in light and dark. QA found four bugs. All four are fixed with tests: one Medium (long subject names pushed pages sideways on a phone), two Low that touched the developer's flagged areas (Open behind a popup blocker, the phone header menu in dark mode), and one Low copy bug (the quiz results focus button). The student test kit had seven wrong or missing claims; they are corrected in `docs/user-testing.md`. No High or Critical bugs. The open items below are Low and don't block a student test. The live database was not touched.

## Automated (fresh, on the final code)
| Suite | Result |
|---|---|
| Typecheck, lint, production build | Clean |
| Unit (Vitest) | 560 passed in 34 files (558 before QA; `src/lib/open-file.test.ts` added) |
| E2E, `CI=1 npx playwright test` (desktop Chrome + Pixel 7) | 186 tests: 174 passed, 11 skipped (phone-only or desktop-only by design), 0 failed, 1 flaky (passed on retry; open item 1). Before QA: 182 tests, 172 passed, 10 skipped, 0 failed |
| New e2e checked against the old code | With `src/` reverted, the 3 new or extended tests failed (5 failures across both projects); with the fixes they pass |
| Exploratory sweep (Playwright scripts) | 16 pages (landing, subjects, subject, note, source, flashcards, review, all-subjects review, mindmap, quizzes, weak topics, ask, timer, timetable, settings, privacy) × {375, 1280} × {light, dark}, on an account with a note, a 60-page PDF, cards, a 26-node mindmap, a quiz and a chat. **No sideways scroll, axe WCAG 2.1 AA: 0 violations, no page errors.** |

## P1 and P2 items
| Item | Result | How checked |
|---|---|---|
| P1-1 First run: Start-here sticker, "Add a note first" tiles, shared empty states, next-step links | Pass | e2e (show/hide with a note and with a file only, four empty states, Ask hides the composer), screenshots 375/1280 light/dark. "Upload a file" focuses the file input. Review end screens offer "Quiz yourself"; quiz results offer the focus round (see bug 4) |
| P1-2 Weak strip sideways scroll | Pass | e2e at 375 px with weak topics; sweep |
| P1-3 Subject header at 375 px | Pass after bug 3 | "Biology" stays on one line; a 45-letter single word wraps inside the header with no sideways scroll; Edit/Delete sit in "More for …" below 640 px |
| P1-4 Wrong option coral, right mint | Pass | e2e computed colours in both themes; dark screenshot at 375 px |
| P1-5 Chat "Today" divider | Pass | `.chat-day` on the chat, timetable `.day-chip` untouched; e2e |
| P1-6 Theme focus ring | Pass | e2e (keyboard focus → 3 px outline), seg control |
| P1-7 Landing copy | Pass | e2e, no "Coming soon" |
| P1-8 File row name + "Open" | Pass after bug 2 | Name gets its own line at 1280 px ("very-long-lecture.pdf" whole); "Open" on the row and in the phone menu |
| P2-1 `--subject` on subject, note, source pages | Pass | Mint subject: strip band, previews, quote borders mint |
| P2-2 "Next card due …" | Pass | Unit tests; deck after rating |
| P2-3 "All caught up ✓" chip | Pass | e2e (Step 2 specs updated) |
| P2-4 Quota chip next to its button; header aligned with list | Pass | Screenshots at 1280 px |
| P2-5 Breadcrumbs and titles | Pass | "← Biology" + chip on every subject page, "← All subjects" after an all-subjects review, source page and timer titles |
| P2-6 Loading skeletons | Pass | Code review: `subjects/[id]/loading.tsx`, `notes/[noteId]/loading.tsx`, `.skeleton` |
| P2-7 44 px targets | Pass | e2e `smallTargets` on the Pixel 7 project (Settings, Privacy, subject page with weak topics, header) |
| P2-8 Sounds | Pass | Code review: note rows `flip`, outline toggle and breadcrumbs `click`, timetable jump uses `Button` |
| P2-9 Phone mindmap | Pass | 26-node map from a note and a 60-page PDF at 375 px: opens at zoom ≥ 0.7 centred on the root, nodes readable, Outline tip shown; e2e |
| P2-10 Empty timetable leaves the hours visible | Pass | Screenshot 375 px; open item 3 (the Now pill) |
| P2-11 `--danger-line` | Pass | No hard-coded hex left in components; both themes |
| P2-12 "Tried once · have another go" | Pass | Unit tests |

## The developer's questions
- **"Open" on file rows (window.open after an await):** a real problem, bug 2. Fixed for the file row and the source page's "Open the original file".
- **Two "+ Write a note" buttons on an empty subject:** as specified (P1-1 sticker plus the Notes box; P3-7 keeps the box). On a phone they are about two screens apart; on a laptop both show. Each creates one note and opens it. Not a bug. If the student test shows confusion, the designer could drop the Notes box button while the sticker shows.
- **"Start a focus round" with a round already running:** the round was kept (correct), but the label still promised a new round. Bug 4.
- **375 px header with long single-word names:** the header itself is fine. The same names broke other pages: bug 1. Its "⋯" menu was unreadable in dark mode: bug 3.
- **Dark-mode quiz option colours:** correct (mint ✓ / coral ✗ / yellow while selected), text `--on-colour` on fills.
- **Phone mindmap with large maps:** fine (P2-9 row above).

## Bugs found and fixed
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| 1 | Medium | A long subject name pushed pages sideways at 375 px, and the phone then zooms the whole page out. A 60-character name (the maximum), e.g. "Introduction to Molecular and Cellular Biology for Engineers", made the subject chip (`white-space: nowrap`) overflow Flashcards, Mindmap, Quizzes, Weak topics, Review and the note editor by 45 px. A 45-letter single word overflowed the subjects grid card by 121 px and the breadcrumbs by 7 px. | Create a subject with that name at 375 px, open Flashcards: the page scrolls sideways | `5e2dd2c`: `SubjectChip` cuts the name with "…" (`max-w-full`, `truncate`, full name in `title`); the note editor and source page now use it. Breadcrumbs, "Back to …" and the grid card wrap a word wider than the row. e2e at 375 px |
| 2 | Low | "Open" (file row) and "Open the original file" (source page) did nothing when the browser refused the new tab. `window.open` runs after the server action, so Safari/iOS (and Chrome after ~5 s) block it; with the `noopener` feature it also returns null on success, so nothing could fall back. Most likely to hit a tester on an iPhone. | Safari: tap Open on a file row. Or in any browser, make `window.open` return null and click Open | `9eebf3e`: `openFileUrl()` (`src/lib/open-file.ts`) opens the tab without the feature and cuts `opener` by hand. If the tab is refused, it downloads in this tab (the signed URL is an attachment, so the page stays). Unit test; e2e for both paths |
| 3 | Low | The subject header's phone menu (new in P1-3) showed "Edit subject" / "Delete subject" in dark text on the dark card in dark mode. The list inherited `.on-colour` from the subject fill. | 375 px, dark theme, subject page, tap "More for …" | `5e2dd2c`: `RowMenu` lists set `text-ink`. e2e checks the computed colour |
| 4 | Low | Quiz results: "Start a focus round" only opened the timer when a round or break was already running, so the label promised a restart that didn't happen. | Start focus from the study strip, take a quiz, look at the results | `7dd83d3`: the button says "Open the timer" while a round or break is active. e2e: start from results, label changes, round kept, End round brings the label back |

## Student test kit (`docs/user-testing.md`, `2eb106a`)
Walked through as Bradley (checklist, limits, deletion) and as a tester (sign-in, the seven tasks), against the code and the running demo build. Corrected:
1. **Sign-in (the important one):** sign-in links are matched to the browser that asked for them (Supabase PKCE, `exchangeCodeForSession` in `/auth/callback`). The kit said "same device" and suggested "Open in Safari/Chrome" from a mail app's built-in browser. That works only if the tester asked from that browser. Asking on a laptop and opening on a phone fails with "That sign-in link has expired or was already used". The kit now says "same device and same browser" and explains what to do.
2. Real labels: landing **Start studying**, **Email me a sign-in link**, "Check your inbox"; new links once a minute ("We couldn't send the link. Try again in a minute.").
3. Upload status is "Reading text…" then "Ready · N pages", not "reading your file".
4. **Download everything** also has flashcards, quizzes and chats, and doesn't have the uploaded files themselves (use Open first).
5. Timetable import takes a downloaded `.ics` of at most 1 MB, never a link. If the uni only offers "Subscribe", open the link in a browser to download the file.
6. Limits: regenerating from the same text and retaking a quiz are free, and a failed try gives the go back. With 3 quizzes a day, "Practise what I missed" uses the second.
7. Timing: the 20-minute script is realistic only without waits. Real AI calls, a large PDF to read and a 10-question default quiz push tasks 3 and 4 over, so the kit now plans about 45 minutes per tester (20 to 30 on tasks).

Checked and accurate: limits table (`src/lib/limits/ai.ts`, `src/lib/validation.ts`: 15/3/3/20, 20 files a day, 25 MB, 100 MB), Google button hidden until enabled, sound on by default, Settings → Delete account (type DELETE, **Delete my account**, calendar link turned off), the timetable empty state ("Tap a time to add a class…"), "Add to my calendar", "Practise" on weak topics, the `boop` on a wrong answer. Not checkable from the repo: the live URL and the Gmail SMTP set-up (no setting for it in the code; the rate of ~30 an hour matches Supabase's default custom-SMTP limit). Bradley's own dry run the day before covers both.

## Regression (Steps 1 to 4)
The full e2e suite passes (all step specs). The sweep found no sideways scroll, axe violations or console errors on any page in four combinations. Spot checks: sign-in demo, note autosave, PDF upload and extraction, flashcard make/edit, review, mindmap (26 nodes), quiz (right/wrong, results, weak topics), chat with citations, timer start/stop from quiz results, empty timetable, settings theme.

## Open items (none blocking)
1. **Flaky (Low):** `e2e/step3-quiz.spec.ts:81` failed once, desktop, then passed on retry: after `page.reload()` on quiz results, `getByTestId("score")` briefly matched two elements (the second still empty). 6 of 6 repeats passed in isolation, and it wasn't in the earlier full run. Likely a reload/streaming moment in the test, not a product bug. Watch it in CI. If it comes back, scope the locator to the results region.
2. **Two "+ Write a note" buttons** on an empty subject: as designed (see above). Watch in the student test.
3. **Timetable, empty week at 375 px (Low, cosmetic):** the yellow "Now" pill is now half hidden under the empty-week sticker. Before the fix it sat on the hour label.
4. **Very long single-word subject names** wrap mid-word in the marker title (no dictionary hyphenation for made-up words). As specified (`overflow-wrap:anywhere`), only for words wider than the row.
5. Real phones (iOS Safari for the Open fallback and sign-in in a mail app's browser) and the live Supabase project were not available. Bradley's dry run should include one sign-in on an iPhone.
6. P3-2, P3-4 and P3-5 are left for later, as noted in the CHANGELOG.

---

## Add weak topic (2026-10-20)
Feature: "+ Add weak topic" on the Weak topics page (spec: `docs/design/polish.md` "Added for the student test"; dev commits `3bafca8`, `97211dc`, `3aefc3f`, `52f651a`). Tested in demo mode (local quiz generator) against a production build, desktop Chrome and Pixel 7, plus 375 px light and dark.

### What was tested
| Area | Result | How |
|---|---|---|
| Sheet at 375 px, light and dark: title, hint, Topic field, "Up to 40 characters.", inline error, Add above Cancel | Pass | Screenshots. Input full width, 16 px text (no iOS zoom), 44 px tall; Add 47 px and Cancel 45 px, stacked. No sideways scroll. Contrast fine in both themes (axe clean) |
| Sheet placement | Pass (note) | Centred card on phones, the same `dialog.sheet` as Make a quiz. The spec says "bottom sheet on phones, same as Make a quiz", but Make a quiz is centred too, so it matches the app |
| Empty, over 40 characters, spaces tidied ("  Krebs    cycle " → "Krebs cycle"), control characters | Pass | e2e (developer's) and unit tests |
| Duplicate refusal: "KREBS CYCLE" while "Krebs cycle" is open → "That's already on your list.", sheet stays open, no second row | Pass | e2e |
| Reopen from "Got it": add the same name again → toast "Back on your list.", card back on the open list, Got it section gone, one row after reload | Pass | New e2e |
| Practise, a note mentions the topic → quiz made, "From your weak topics", one go used (3 → 2 of 3 left) | Pass | New e2e and unit test |
| Practise, no note mentions it (or no notes at all) → 🔎 "We couldn't find these topics in your notes yet…" with Back, no go used | Pass | e2e and unit tests (quota count stays 0) |
| Quiz miss on a hand-added topic (added in another case with extra spaces) → same card, "Missed once · last today", one ✗ dot, one row | Pass | New e2e (second tab, reload) |
| "I think my answer is right" → Count it on that miss → the topic stays, back to "Added by you today", no "Missed" | Pass | New e2e and unit test |
| A topic that came only from a miss is still deleted on undo (regression) | Pass | Unit test |
| Make a quiz → Weak topics list hint "added by you" | Pass | e2e |
| Keyboard: Enter opens, focus in Topic, Escape cancels (typed text cleared), Enter submits | Pass | New e2e |
| Focus after Add returns to "+ Add weak topic" | Fail, fixed (bug 5) | New e2e |
| 500-topic cap (cleared one can still reopen), another student's subject refused ("Subject not found.") | Pass | Unit tests |
| Sound: `click` on open and Cancel, `boop` on errors, `pop` on success | Pass | Code review (`Button` default sound; Add is `sound={null}` and plays its own) |

### Bugs found and fixed
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| 5 | Low | After adding a topic from an empty state ("Nothing tricky yet" or "All clear!"), focus fell to the page body. The button the sheet came from is unmounted when the list stops being empty, so the native dialog can't return focus; a keyboard user starts again from the top. | Empty Weak topics page, Tab to "+ Add weak topic", Enter, type a topic, Enter: nothing is focused | `weak-topics-list.tsx`: after an add, an effect (it runs after the Dialog's own close effect) focuses the action-row "+ Add weak topic". A `requestAnimationFrame` first try lost the race in dark mode runs. e2e "keyboard: …" |
| 6 | Low | Re-adding a topic cleared over 60 days ago (hidden from "Got it now") showed it as "Added by you today" with no dots until a reload, then "Missed 3 times · last today". The client only knew the history of topics still in its Got it list. | Topic cleared more than 60 days ago, add it again by hand | `addWeakTopic` returns `missCount` and `recent`; the card uses them. Unit test |

### Open items (not blocking)
7. **Reopened topic says "last today" (Low, copy; designer):** reopening a cleared topic sets `lastMissedAt` to now so it sorts first, so a topic with real misses reads "Missed 2 times · last today" though nothing was missed today. Suggest "Missed 2 times · back on your list today" or keep the old date and sort by an "added at". Not specified in the spec.
8. **Practise all with many hand-added topics:** one keyword search per topic without passages. Already capped by the security fix S5-7 (`c797638`, max 60 topics per Practise), which was in the tree for all the runs below. Closed.

### Checks
- `npm test`: 37 files, 586 tests passed. `tsc --noEmit`: clean. `npm run lint`: clean.
- `CI=1 npx playwright test` (full suite, both projects): 183 passed, 11 skipped, 0 failed, no retries needed (the known flaky `step3-quiz.spec.ts:81` and 375 px subject header test passed first time).
- New spec `e2e/polish-add-topic.spec.ts` (3 tests × 2 projects) also passed 3 repeats each.

### Sign-off
**PASS.** "+ Add weak topic" matches the spec, with bugs 5 and 6 fixed and tested. Item 7 is for the designer. The security fixes S5-6 and S5-7 (`c797638`) were in the tree for every run here.
