# QA sign-off: flashcards from long lecture files (page ranges and series)

**Result: PASS** (2026-10-15). One copy bug and one test-reliability bug found and fixed. Four low issues are left open below; none blocks the student test.

Spec: `docs/design/screens/flashcards.md`, "Long files: page ranges and series" (Changelog 2026-10-15). Commits tested: 7a6a060, da50481, 10e0aca, plus the security fixes in 7f98d1d (per-page counts summed in the database).

## Automated
| Suite | Result |
|---|---|
| Typecheck, lint, production build | Clean |
| Unit (Vitest) | 207 passed in 17 files. QA added 5 in `src/server/actions/flashcards-series.qa.test.ts` |
| E2E (Playwright, desktop Chrome + Pixel 7) | 62 passed, 3 full runs in a row: 2 workers; 4 workers; 4 workers with every test run twice (124 passed). No retries, no skipped tests. QA added `e2e/step2-pages-qa.spec.ts` (6 journeys) and a 12-slide PPTX fixture (`e2e/fixtures/long-slides.pptx`, made by `make-long-slides.mjs`) |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations on Step 1 with page fields (covered and sampled hints, with the inline error), the series result, the PPTX result, and again in dark mode with reduced motion |
| `/code-review` (c661a4c..HEAD) | No findings |

## What was covered
**Fit rule and server answer**
- Default range is what fits (1–5 on the 12-page fixture), Next goes 6–10 then 11–12, then "All 12 pages done". Every card in a set quotes a page inside its range.
- Five sets across a 30-page file: each says what comes next and how many goes are left (4, 3, 2, 1, 0). The sixth says "limit". Making pages 1–5 again after that is still "already" and free. Exactly 5 goes used.
- Three sets of one 15-page file: no card front repeats across sets.
- Past-the-end ranges are clamped. A first page past the end is refused with "Pick a page between 1 and 12." or, for PPTX, "Pick a slide between 1 and 12."

**Dialog**
- Files that fit one set (heart.pdf, 2 pages) and notes: no page fields, the old quota hint, no progress block, "Start reviewing" stays primary.
- PPTX: legend "Slides", fields "First slide" / "Last slide", "Covers every passage on slides 1–5.", "Each set of slides uses one go…", "Slides 1–5 of 12 done", "Next: slides 6–10" (spoken "Make the next set: slides 6 to 10"). One slide reads "slide 12".
- Invalid ranges are flagged on submit only, never while typing: first page 0, last before first, empty field. `aria-invalid` is set, focus moves to the bad field, and nothing is sent. The 20-page cap is unit-tested (`rangeError`, zod).
- Changing "First page" re-fits "Last page". A hand-typed last page past the budget shows the sampled hint and "Use pages 1–5", which snaps it back.
- Sampled set: "Pages 1–8 of 12 done (some passages sampled)".
- Quota running out mid-series: the set that uses the last go shows "0 of 5 left today", no Next button, and "That was today's last go. Pages 11–12 are next, tomorrow." "Start reviewing" becomes primary again. Reopening goes straight to the limit message.
- "Already made" for a range: "You already made cards from pages 1–5. Try the next pages or another source." Next is offered first. It reopens Step 1 at 6–10 with focus on "Make flashcards", so Enter makes the set.
- Resume from browser storage: after the series, the next open starts after the furthest page and says "Last time you got to page 10." With `localStorage` throwing on access, the dialog defaults to pages 1–5 and makes a set with no errors.
- Coverage hint live region: announced once, 600 ms after typing stops.

**375 px, keyboard, motion**
- 375 × 740 with touch emulation: no sideways scroll on Step 1 with the page fields and snap button, or on the result. Every control is at least 44 px. On a phone the buttons stack Next, Start reviewing, Done, all full width. Screenshots checked by hand.
- The keyboard alone can make the next set: Next, then Enter.
- Reduced motion: the progress fill has no transition (computed `transition-duration: 0s`).

**Performance of `loadMakeOptions`** (developer's question): 10 files × 100 pages takes 53 ms in demo mode (unit test, budget 1 s). On Supabase, the dialog no longer reads the files' text. Since the security fix (S2-9) it runs one aggregate query that returns counts only.

**Passages with no page number** (developer's question): files from the current extractor always carry page numbers (`chunkPages` with `paged: true`), so in practice nothing is re-sent. In a test with an added page-less glossary passage, 0 cards quoted it across two sets. The remaining risk is the same as security's S2-12 (accepted, low).

## Bugs found
| # | Severity | Bug | Status |
|---|---|---|---|
| Q-1 | Low | **Awkward copy with one go left.** The hint under Next read "Uses 1 of your 1 go left today." Steps: use 4 goes, make a set, look under "Next". | **Fixed.** With one go left it now reads "Uses your last go for today."; otherwise "Uses 1 of your N goes left today." (`make-dialog.tsx`, e2e asserts both). |
| Q-2 | Medium (CI reliability) | **Intermittent mobile e2e failures (mindmap reset, read aloud, others).** This was not caused by the new spec or by shared demo state. `createSubject` in `e2e/helpers.ts` took an `isVisible()` snapshot of "Create your first subject" before the subjects page had rendered. When the snapshot came back false it waited for "+ New subject", which an empty account never shows, and timed out after 30 s. Anything that slows page loads made it more likely: the new spec's 12-page PDF extraction and more parallel workers. Reproduced with `--project=mobile --workers=4 --repeat-each=4`: 3 to 5 failures per run, all at `helpers.ts:13`. `rowAction` had the same race (menu vs. desktop button). | **Fixed.** Both helpers now wait for whichever control is visible first. After the fix: 2 × 64 stress runs and 3 full runs with no failures. |

## Open (low, not blocking)
- **L-1: Progress is per browser and assumes earlier pages were done.** When a visit resumes after the stored page, the line reads "Pages 1–N" even if the student had started at a later page by hand last time. Pages skipped by editing the range still count as done (the stored value is the furthest page). On another device the series starts at page 1. This matches the spec ("furthest page made"); it would need server-side series state to be exact.
- **L-2: Pages made again restart the progress line.** Remaking pages 1–5 after pages 1–10 shows "Pages 1–5 of 12 done" in that session, but storage keeps 10, so the next open still resumes at 11.
- **L-3: Files with no page numbers at all** (`pageChars` null; not produced by the current extractor) still show page fields. Every range would send the same passages, so the second set would come back "already". Suggest treating such a file as one set if older uploads turn out to have it.
- **L-4: "Making cards from the same pages again is free" depends on the card count.** The same pages with a different "About 10 / 15 / 20" count is a new request and uses a go, which is the existing cache rule. Consider "the same pages and number of cards" in the hint.

## Not covered here
- A real Groq key: the deterministic local generator was used. Whether sets near 14,000 characters stay under the free plan's per-minute token limit should be checked once on a preview deploy with a key.
- A real 200-page PDF on Supabase: the per-page counts come from the new `source_page_chars` function. Its RLS is covered by security's `supabase/tests/10_rls.sql`, which needs the `db` job.
