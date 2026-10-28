# QA sign-off: student test feedback (study notes, mindmap details, exam-style flashcards)

**Result: PASS** (2026-10-28), branch `claude/feedback-ai-quality-kgmile`. No High or Critical bugs. I found 9 bugs and fixed all of them in the working tree (not committed): 3 Medium (the dialog vanished on a subject's first notes, web pages lost superscripts so 10⁸ became 108, and Chinese/Japanese numbers were never checked) and 6 Low. The open items are Low or Info. The only e2e failure (`polish.spec.ts:292`, both projects) also fails on `main` and comes from the preinstalled Chromium 153 not matching Playwright 1.56.1. It isn't caused by this branch (see below). Before merge: apply `20261028000001_study_notes_quota.sql` to the live project. With no Groq key, every check ran on the local generator; the real-model path was checked by reading the code and through validator tests.

## Automated
| Suite | Result |
|---|---|
| Lint (`eslint src e2e`), typecheck, production build (`DEMO_MODE=1 next build`) | Clean |
| Unit (Vitest) | 631 passed in 39 files (609 before QA; 22 added: `src/lib/ai/feedback.qa.test.ts` and 1 in `study-notes.test.ts`) |
| E2E (Playwright, desktop Chrome + Pixel 7), full run on the final build | 191 passed, 11 skipped (phone-only or desktop-only by design), 2 failed: `polish.spec.ts:292` on both projects. That failure is not from this branch (see below). Before QA: 179 passed, the same 2 failed. 12 new tests in `e2e/feedback-qa.spec.ts`. |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations: Make notes dialog at 375 px in dark mode (choose step, web tab with an inline error, the "not a link" message, the ready step), long-file range error, mindmap outline and passage panel at 375 px in dark mode, plus the developer's checks |
| DB tests | Not run (no database in this session). The migration only widens the `ai_usage.kind` check; RLS and grants are unchanged |

## The `polish.spec.ts:292` failure ("Open on a file row opens a new tab…")
**Verdict: an environment issue, not a regression.** Nothing in this branch touches it.
- Playwright 1.56.1 is pinned to Chromium revision 1194 (Chrome 141). The preinstalled browser at `/opt/pw-browsers` is revision 1243, **Chrome for Testing 153.0.8010.12**.
- I built `main` (`ac880c0`) in a separate `git worktree` and served it on port 3200 with the same local config. It **fails the same way**: 8 of 8 runs with `--repeat-each=4`, plus 1 of 2 in a first single run. The branch fails 7 of 8. So it's pre-existing and a little flaky in timing.
- Cause (a probe that logged the popup's events): the new tab opens, the file is sent as an attachment, so Chrome 153 **downloads it and closes the tab at once** (`["page", "download heart.pdf", "close"]`). `tab.evaluate(() => window.opener)` then races a closed page: "Target page, context or browser has been closed". The bundled Chrome 141 keeps the empty tab open, which is why CI passes.
- The app does what it should: the tab opens, the opener is cut, the file downloads. In a newer Chrome, the test needs to read `opener` before the download closes the tab (for example, check `tab.opener()` or listen for `download` on the popup). The other choice is to run with the browser pinned to Playwright's version. I left the test as it is (the code wasn't touched, and the CI browser matches).

## What was covered
**Make study notes (make-notes.md, PLAN 3h)**
- From a note: ready step, "Study notes: …" title, made-from line, `h2` per topic, bullets, bold key terms, quota 5 → 4, the same text again is free (developer e2e + action tests).
- From a long file (`very-long-lecture.pdf`, 60 pages, new e2e): the page-range fields and the "Long file: notes are made a few pages at a time." line show. Best fit is pages 1–4 (10,000 characters a set). The hint says "Covers every passage on pages 1–4.", and with the 50-pages pick, "Notes will be spread across pages 1–50, a quick tour of the lot.". Asking for 55 pages shows the inline "Up to 50 pages at a time." with `aria-invalid` and focus on Last page, and nothing is sent. The note's first line says "very-long-lecture.pdf, pages 1–4". 1–50 shows the sampled line on the ready step. Quota 5 → 3.
- From a web link: the SSRF guard and messages (developer unit and e2e). New: `not a link at all` shows the 🔗 "doesn't look like a web link" message, focus goes to the title, and Back keeps the text. Empty: inline error, `aria-invalid`, `aria-describedby` = hint + error, focus back in the field. The error clears when you type. No real websites are used in any test.
- Empty subject: opens on "A web page". "My notes & files" says "Add a note or a lecture file first…". A subject with only a file opens on "My notes & files". The empty box's copy and both buttons are there.
- 375 px in dark mode (new e2e): Make notes and + New note sit on one row under "Notes" (44 px tall). The dialog stays inside the viewport. No sideways scroll on any step. Axe is clean.
- Keyboard only (new e2e): Enter on the button opens the dialog, and Tab stays inside it. Space picks the note, Enter on Make notes starts it, the ready title takes focus, and Esc closes the dialog.
- Sound (new e2e, a Web Audio spy that counts oscillators and noise buffers): with sound on, the click/pop sounds play. With "Play sounds" off, the whole flow (tabs, the empty-link `boop`, radios, making, ready) starts **zero** tones.
- Validation with model-shaped replies (`feedback.qa.test.ts`):
  - **Science notation:** H₂O/H2O, Ca²⁺/Ca2+, 10⁸/10^8, −70 mV/-70 mV and C₆H₁₂O₆/C6H12O6 are kept when the passage has them. Ca⁺, 10⁹, 108, +70 mV, 70 mV, −70 V and C₆H₁₀O₅ are dropped, and `dropped` counts them.
  - **Other languages:** German (a swapped number is dropped), Chinese and Japanese (bug 3).
  - **Prompt injection:** the passage text stays in the user message inside a single `<passages>` block, and `</passages>` in a note can't close it early. An obeyed "HACKED" reply, or points built from outside knowledge, give `null`, so "failed" and the go comes back.
  - **Markup:** `<img onerror>` points fail grounding. Anything kept is a Tiptap text node, never HTML.
  - **Odd shapes:** a numeric title, `passage: 1`, `[p1]`, `p1, p2`, a missing heading ("Key points") or missing terms, and wrong types. Over 40 sections is rejected. Long replies are capped at 12 sections and 10 points.
  - **Key terms:** a term must appear in its passage, duplicates are dropped, and short definitions are dropped.
  - **Empty or one sentence:** gives "too short" (bug 6).
- Huge or hostile page: `htmlToText` on 2 MB of real-looking HTML takes about 100 ms and stays capped at 60,000 characters. 2–4 MB hostile inputs (unclosed quotes, 200k `<sup>`, entities, `<li>` runs, stray `<`, unclosed `<script>`) each finish in under 0.4 s (test limit 2 s).
- Real-model path (code reading): one 120b request; `runAiTask` reserves the go first and settles it (refunded on failure). The web page is read only after the go is reserved. A cached web read gives the go back. The cache is keyed on the prompt version and the passage hashes. A "local" cached reply is never reused once AI is set up. The model cites refs, which are mapped through the server's own list, so web passages have local ids and nothing is stored but the note. The 200 KB cache cap, the 500-note cap, the ownership checks and the zod input checks are in place.

**Mindmap details (mindmap.md "Details")**
- Map, outline and panel details, Hide/Show remembered (developer e2e). New at 375 px in dark mode: the outline detail and the passage panel's detail stay in the viewport with no sideways scroll, and axe is clean. "Hide/Show details on map" is offered only in Map view (as built).
- `nodeDetail` / `normaliseMindmap` with model-shaped nodes: grounded Ca²⁺, 10⁸ and H2O details are kept. +70 mV and injected "ignore previous instructions" details are dropped while the node stays. A numeric passage ref works. A self-parented node is dropped and the root keeps the subject name. CJK details (bug 3).

**Exam-style flashcards (flashcards.md "What a good card is")**
- Prompt contents, yes/no and about-the-lecture drops, and the "according to…" clean-up and its ReDoS fix (developer tests). New: a realistic mixed reply (compare/explain/process kept, "covered in this lecture"/title/outside-knowledge cards dropped). "According to Fick's law, …" and Spanish "Según los apuntes…" are left alone. Bugs 4, 5 and 7.

**Regression:** the full e2e suite (Steps 1–4 and polish) on the final build: all pass apart from the environment failure above.

## Bugs found and fixed
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| 1 | Medium | On a subject with **no notes yet**, the Make notes dialog vanished on success: no ready step, no "Open notes", no pop, no toast. The note just appeared in the list. This is the most likely first use (new subject → upload slides, or paste a link, since the dialog opens on the web tab). | New subject, upload `very-long-lecture.pdf`, ✨ Make notes, Make notes. The dialog closes by itself. The action's `revalidatePath` swaps the empty box for the list header, and the dialog inside the empty box's button is unmounted. | `MakeNotesHost` (in `make-notes-dialog.tsx`) holds one dialog at a fixed place in the Notes section; both buttons open it through context (a button outside a host still has its own). `subjects/[id]/page.tsx` wraps the section's content. e2e: the long-file test starts from an empty subject (failed before). |
| 2 | Medium | Web pages lost `<sup>`/`<sub>`: `10<sup>8</sup>` was read as **108**, `mc<sup>2</sup>` as mc2, `SO<sub>4</sub><sup>2−</sup>` as SO42−. The notes then faithfully copied a wrong number, and a model writing Ca²⁺ was dropped against "Ca2+". Wikipedia uses these tags everywhere. | `htmlToText("<p>Cultures reach 10<sup>8</sup> cells</p>")` → "Cultures reach 108 cells". | `html.ts`: sup/sub runs of up to 40 characters become Unicode through the existing `extract/scripts.ts` (`toScript`), the same as PDF/PPTX extraction. Runs it can't map (`[3]` citations, letters) stay as before. Unit tests. |
| 3 | Medium | Chinese/Japanese: a number between characters ("把**5**个") was never checked, so "钠钾泵每次把5个钠离子泵出细胞" was kept against a passage saying 3. Also, CJK points or details under 12 characters ("水从稀溶液流向浓溶液。", 11) were dropped as "too short". This is shared with flashcards (the number gap was there before this branch). | See `feedback.qa.test.ts` "Chinese". | `text.ts scanNumbers`: Han, Hiragana, Katakana and Thai letters next to a number no longer make it part of a word. `notes.ts` and `nodeDetail`: the minimum is 6 characters for scripts without spaces. All 609 existing tests still pass. |
| 4 | Low | `examFront` capitalised the first letter after removing "According to the notes,": **PH**, **MRNA**, **P53**, and α-helix became **Α**-helix (Greek capital alpha). | `examFront("According to the notes, pH of blood is kept at what value?")` → "PH of blood…". | Only a plain lower-case first word is capitalised. Unit test. |
| 5 | Low | Embryology cards were dropped as "about the lecture": "What happens to the embryo in week 3 of development?" and "…in week 4 of gestation?". | `cardQualityIssue(…)` → `about_the_lecture`. | "in/on/during week N" followed by "of …" counts as content, unless it's "of the course/module/unit/term/semester". "What is covered in week 3?" is still dropped. Unit test. |
| 6 | Low | A note of one or two long sentences (over the 200-character floor) said "The note maker got muddled. Try again." Retrying could never work, and each retry used one of the 15 tries. | A note with one 240-character sentence → Make notes. | `study-notes.ts`: when the generation fails and the passages have fewer than 3 sentences, the result is "too short" (✏️ "This note is a bit short…"). The go is refunded as before. Action test. |
| 7 | Low | "Does osmosis need ATP, and why?" / "No: it is passive…" was dropped as a yes/no card, though it asks for a reason. | `cardQualityIssue(…)` → `yes_no`. | Not counted as yes/no when the front also says why, how or explain. Unit test. |
| 8 | Low | A page that leaves out `</head>` (it's optional in HTML; minified pages do this) gave no text at all: "That page doesn't have enough text…". | `htmlToText("<head><title>T</title><body><p>…long text…</p>")` → "". | `<body>` ends the head. Unit test. |
| 9 | Low | Pages wrapped in one `<form>` (ASP.NET and SharePoint, common on university sites) gave no text, because `form` counts as page furniture. | `htmlToText('<body><form id="aspnetForm"><div>…</div></form></body>')` → "". | When the page has under 500 characters with forms dropped and it contains a `<form>`, it's read again with forms kept (buttons, selects and navigation are still dropped). A form inside a normal page is still dropped. Unit tests. |

## Open issues
| # | Severity | Issue | Owner |
|---|---|---|---|
| 1 | Low | Grounding is one-directional for flattened notation: a passage the student typed as "Ca2+" with a model writing "Ca²⁺" (which `FLASHCARD_QUALITY_RULES` asks for) is dropped. The other direction is kept. This was there before (shared with flashcards). Bug 2 fixes it for web pages. For typed notes, either let `scripted` match a flattened passage, or tell the model to copy the passage's form. | Developer |
| 2 | Low | "What forms during week 4?" (no "of …") is still dropped as about-the-lecture. It's ambiguous between a course week and an embryology week. | Designer / developer |
| 3 | Low | In an empty subject, closing the dialog after success puts focus on `<body>`, because the button that opened it has been replaced by the header button. Moving focus to the new header button would be nicer. | Developer |
| 4 | Info | Text in the student's own note or a linked page that is aimed at the AI ("visit evil.example.com…") can end up as a note point if the model copies it, because it is grounded in the source. It's plain text in the student's own note, and links are off in the editor. The model is told to ignore such text. Worth a line in the security review. | Security engineer |
| 5 | Info | Shared `PageRangeFields`: the range error is a plain paragraph, not `role="alert"` (field `aria-invalid` and focus are right). It's the same in Make flashcards and quizzes. | Designer |
| 6 | Info | Making notes, flashcards or a map *from* a study-notes note includes its "✨ Study notes made from … Check them against the original…" line as a passage. The real model is told to skip admin, but the local generator turns it into a point. | Developer |
| 7 | Info (test env) | `polish.spec.ts:292` fails with the preinstalled Chromium 153 (see above). | QA / developer |

## Files changed by QA (working tree, not committed)
- Fixes: `src/components/notes/make-notes-dialog.tsx`, `src/app/(app)/subjects/[id]/page.tsx`, `src/lib/extract/html.ts`, `src/lib/ai/text.ts`, `src/lib/ai/schemas.ts`, `src/lib/ai/notes.ts`, `src/server/actions/study-notes.ts`
- Tests: `src/lib/ai/feedback.qa.test.ts` (new), `src/server/actions/study-notes.test.ts`, `e2e/feedback-qa.spec.ts` (new)
- This file

## Not tested yet
- The real Groq models (no key): reply quality, the 4,000-token notes and maps against the free plan's 8,000 tokens a minute, and how often a real reply leaves fewer than 3 grounded points.
- Real web pages over the network (none can be reached here; the fetcher is covered by the developer's local-server tests and the security review).
- A live Supabase project with the `notes` quota migration applied, and `npm run test:db`.
- Real phones (iOS Safari, Android Chrome) for the dialog and the details-on-map layout.
