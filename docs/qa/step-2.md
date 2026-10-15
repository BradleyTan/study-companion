# QA sign-off: Step 2 (flashcards, spaced repetition, mindmap, read aloud)

**Result: PASS** (2026-10-14), with the open issues below handed to the developer and security engineer. None of them blocks a student test in demo mode or on a free Supabase project. Still to run against a real Groq key and real phones (see the last section).

## Automated
| Suite | Result |
|---|---|
| Lint, typecheck (`next typegen && tsc`), production build | Clean |
| Unit (Vitest) | 133 passed in 13 files (115 before QA; 18 added) |
| E2E (Playwright, desktop Chrome + Pixel 7) | 50 passed (25 journeys × 2 viewports; 16 journeys before QA, 9 added in `e2e/step2-qa.spec.ts`) |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations on the make-flashcards dialog, deck, review (front and back, end of session), mindmap (map, outline, passage panel), note with read-aloud bar and passage banner. Checked in light mode, and again in dark mode with reduced motion |
| RLS (Postgres 16 + pgvector) | All cross-student checks pass, including the new `flashcards`, `card_reviews`, `mindmaps` and `ai_app_usage` tables and the server-only quota functions |

## What was covered
**Spaced repetition**
- FSRS: Again < Hard < Good < Easy for new cards, no fuzz (the button's interval is the one saved), lapses shrink the interval, reps counted (developer's unit tests, reviewed).
- Due today across time zones: a year-long sweep in 10 zones (Kiritimati +14, Pago Pago −11, Chatham +12:45, Lord Howe with its 30-minute DST, Kathmandu, St John's, São Paulo, London, Los Angeles, Casablanca). Every time, today's bounds contain "now", start and end on the right local dates, and are 23–25 hours long.
- 20 new cards a day: shared across subjects on the banner, the subject tiles and (after the fix) the end-of-session "Review X · N due".
- Review session with 20 cards: Again and Good on a new card return later in the session, Easy leaves it; five grades then U pressed five times returns to the starting count, and a fresh page shows the same session (the server rolled back too).
- Double taps: a double tap on a grade no longer flips the next card. A double-sent grade (same client key) is saved once.
- Undo is idempotent: a retried undo, or undoing a grade that never saved, never deletes an older review.

**Generation, quota and caching** (action-level tests on the demo repo)
- A success counts once; the same text again says "already made" and costs nothing; after deleting those cards, the cached output brings them back for free.
- An AI failure (HTTP 500) gives the go back. The sixth set in a day says "limit". A production build without a key makes nothing and uses no go.
- An empty note and a single sentence are "too short" (flashcards and mindmap) and cost nothing.
- German + Japanese notes: cards are made and every quote is a real sentence from the note.
- Page ranges over 20 pages, backwards ranges and scanned files (no text) are refused. Another student's note is refused.
- Prompt injection inside notes: the developer's tests cover delimiter defusing and validation of a hostile model reply (reviewed).

**Mindmap**: make, keyboard focus and Enter open the passage panel, focus returns on close, arrow keys move a topic and "Saved ✓"; **the moved position survives a reload, and Reset layout restores the original position (also after reload)**; the outline view is remembered; "Open in note" marks the passage.

**Passage links**: from the deck, the note opens with the quote marked. After the note was rewritten, the link shows "This passage has changed since the card was made." with the original quote and no stale mark. The read-only source page for a lecture file is covered by the developer's e2e.

**Read aloud** (fake `speechSynthesis`): play, sentence-by-sentence progress with the spoken mark, pause, **resume re-reads the paused sentence from its start**, stop. With no voices installed, and with no Web Speech at all, the bar explains why and Play is disabled.

**Phones (375 px, touch emulation)**: no horizontal scroll on the subject page, deck, review (both sides), mindmap and the make dialog, and every control is at least 44 × 44 px (asserted).

**Sound**: every Step 2 sound goes through `useSound()` (no direct `playSound` or `AudioContext` use), so the global toggle, volume, focus mode and "speech wins" rules apply. Checked by code review; audio output itself can't be heard in headless runs.

## Bugs found and fixed during QA
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| 1 | High | A production build without `GROQ_API_KEY` gave students the local stand-in generator's cards and maps, silently. | `npm run build && npm start` with Supabase keys and no Groq key; make flashcards. | `da20fd1`: `aiMode()` allows the stand-in only in demo mode or outside production. Otherwise the result is `not_configured`, no go is taken, and the UI says "AI isn't set up yet…" (flashcards also offer "Add a card by hand"). Stand-in output in the cache is never reused once real AI is set up. |
| 2 | Medium | Undo deleted the card's latest review, whatever it was. A retried undo (lost response) or undoing a grade that never saved also deleted an older review, rolling the schedule back by days. | Grade a card that has earlier reviews; drop the network after the undo reaches the server; the client retries. | `abbe6b7`: undo sends the grade's client key and only removes that review. |
| 3 | Medium | A double tap on a grade flipped the next card and showed its answer ("Show answer" appears under the finger). | Review, flip, double-tap "Good". | `b1235c3`: taps within 400 ms of a grade are ignored (keyboard clicks are not). |
| 4 | Medium | Touch targets of 25–40 px on phones: card action buttons, review corner buttons, "✕ End", back links, the logo, the note title, small buttons. The specs ask for 44 px. | Open the deck or review at 375 px on a phone. | `b1235c3`: `.btn-sm` is 44 px on touch screens; back links, the logo and the title are 44 px tall. |
| 5 | Medium | The same notes in two subjects: Make flashcards in the second said "already made" (it counted the first subject's cards) and made nothing, every time. | Paste one note into two subjects; make cards in both. | `4b6c013`: only this subject's cards count; the cached output fills the second subject for free. |
| 6 | Low | `reviewCard` with a client key already used for another card copied that card's schedule onto this one. | Call the action with a reused key (buggy or hostile client). | `4b6c013`: refused. |
| 7 | Low | End of session "Review X · N due" gave every subject the whole new-card allowance (e.g. 20 + 20 when only 20 are allowed). | 3 subjects × 15 new cards; finish a session in one. | `4b6c013`: same shared split as the Subjects banner (and one query instead of one per subject). |
| 8 | Low | Regenerating a mindmap while a layout save was waiting or retrying moved nodes of the new map (node ids repeat). | Drag a topic offline, then Regenerate. | `4b6c013`: pending saves are dropped when a new map is made. |
| 9 | Test only | `expectNoA11yViolations` could catch Next swapping `<title>` after an autosave refresh (flaky "document-title" in a Step 1 test). | Seen once in a CI-mode run; passed on retry. | Helper waits for a title first (still fails if a page has none). 10/10 repeats pass. |

New tests: `e2e/step2-qa.spec.ts`, `src/server/actions/review.test.ts`, `src/server/actions/flashcards.test.ts`, extra cases in `src/lib/ai/ai.test.ts` and `src/lib/srs/srs.test.ts` (commits above and `07fe6fa`).

## Open issues (not fixed here)
| # | Severity | Owner | Issue | Suggestion |
|---|---|---|---|---|
| A | Medium | security-engineer | RLS on `flashcards` and `card_reviews` is `for all`, so a student can write rows directly with the publishable key and skip the server actions (card cap, validation, made-up review history). Own data only, but it can fill the free database. | Decide between server-only writes (like `chunks`) or narrower insert/update policies plus check constraints. |
| B | Medium | developer | The daily AI quota is keyed by the student's local day and the time zone can be changed in settings, so switching zones resets the quota. The app-wide budget still caps total use. | Key the per-student quota on a rolling 24 h window or the UTC day, or rate-limit time zone changes. |
| C | Medium | developer | `replaceNoteChunks` (Supabase repo) reads, plans and writes in separate steps without a transaction. An autosave and a Make flashcards on the same note at the same moment can duplicate passages until the next save. | Do the sync in one SQL function (transaction), or add a unique `(note_id, ordinal)` index and retry. |
| D | Low | developer | The 2,000-card cap loads every card row to count them, and a generation can pass the cap by up to 25 cards. | Use a count query; check `count + 25`. |
| E | Low | developer | The source page marks the first copy of a quote in the file, not the copy on the card's own page, when a sentence repeats. | Search the card's own chunk/page first. |
| F | Low | developer | Two tabs reviewing at once can each introduce 20 new cards (the allowance is computed when the session starts). | Acceptable for MVP; recheck the allowance on each first review if it matters. |
| G | Low | ui-ux-designer | `flashcards.md` and `mindmap.md` don't list the new "AI isn't set up yet" state; the quota chip still reads "5 of 5 left today" before the student tries. | Add the state to the specs; optionally show it as soon as the dialog opens. |

## Not yet tested (needs a real key, real devices or the live project)
- **Real Groq and Cloudflare replies**: card and map quality, JSON mode, real 429/413 handling and `retry-after`, token use for a 20-page range, prompt-injection text against a real model, non-English output quality. Needs a free Groq key in a preview deploy.
- **Read aloud on real devices**: iOS Safari and Android Chrome voices, pause/resume, the tab going to the background, Linux with and without speech-dispatcher. Headless runs use a fake `speechSynthesis`.
- **Screen readers**: VoiceOver and TalkBack on the flip, grade buttons, live announcements, the mindmap canvas and outline tree. axe passes, but a manual pass is still needed.
- **Touch drag on the mindmap** with a real finger (pinch zoom, drag vs. pan) and the iOS safe area.
- **Live Supabase**: RLS through PostgREST, the quota functions through the service role, the time zone captured from a real browser profile. The RLS suite runs on a local Postgres with a Supabase stub.
- **Sounds** heard on a real device (flip, cheer, boop), and focus mode once the Step 4 timer exists.
