# Changelog

## 2026-10-18 · Step 3 part 1: quizzes and weak topics
- **Quizzes** for each subject (`/subjects/[id]/quizzes`): make one from a note, a page range of a lecture file (up to 50 pages, same page fields as flashcards), everything in the subject, or your weak topics. Multiple choice, fill in the blank or mixed; 5, 10 or 15 questions. Titles are built by the server ("Lecture 3.pdf · pages 1–20 · Mixed"). 3 quizzes a day (9 tries); retaking is free; the same settings again reuse the quiz.
- **Taking a quiz** (`/subjects/[id]/quizzes/[quizId]`): one question at a time, Check → feedback with the explanation, the quote from your notes and a link to the passage (new tab), read aloud, "I don't know", "I think my answer is right" for typed answers, "Report a problem", keyboard shortcuts (1–4/A–D, Enter, R, Esc, ?), streak tag, resume where you left off, end early. Correct: ✓ pop and a paper burst; wrong: a gentle shake (both off with reduced motion or focus mode).
- **Results:** score sticker by band (confetti and `cheer` at 70 % or more), weak-topic line, "Practise what I missed", retake (reshuffled), answer list with All/Missed, "Why?", edit question and remove from quiz.
- **Weak topics** (`/subjects/[id]/weak-topics`): what you missed, with recent tries, where it's from, Practise, Mark as got it (with Undo), See the questions, and the Got it list. Cleared after 2 right answers in a row.
- **Subject page:** Quizzes tile, Ask your notes tile (disabled, "Coming soon" until part 2), 2 × 2 tiles on phones, the weak-topics strip, and "Make a quiz" in note and file menus. Delete confirms now say "Flashcards and quizzes made from it stay, with their quotes."
- **Accuracy:** the 120b model's questions go through `normaliseQuizWithStats` (grounded answers and quotes, exactly 4 options and 1 right for multiple choice, 1–4 word blanks from the passage, topics reused, explanations grounded); weak questions are dropped, never replaced; under 3 good ones refunds the go. Options are shuffled on the server. Answers and explanations reach the browser only after you answer.
- **Shared code:** `PageRangeFields` (`src/components/ui/page-range-fields.tsx`) now draws the page fields in both dialogs; `src/server/source-select.ts` picks notes and page ranges for both.
- **Database:** migration `20261018000001_step3_quizzes_weak_topics.sql` (not yet applied to the live project): `quizzes`, `questions`, `quiz_attempts`, `answers`, `weak_topics` with RLS (read-only to students, answer columns hidden), composite foreign keys and caps. Grant and RLS tests in `supabase/tests/05_grants.sql` and `10_rls.sql`.
- **Tests:** unit tests for the fill-in matcher, weak-topic rules, ordering and scoring, the quiz normaliser and the quiz actions; e2e `e2e/step3-quiz.spec.ts` (build, right and wrong answers, results, weak topics, re-mix, override, resume, delete, keyboard, 375 px).

## 2026-10-17 · Flashcards: any pages up to 50, no duplicate cards, better and more accurate cards
- Pick any pages for a set, up to 50 at a time (was 20), one after another (1–20, 21–40) or overlapping (1–20, 15–34). Still one AI request per set: a wide range is a quick sample, with a friendly hint ("Cards will be spread across pages 1–20, a quick tour of the lot.") and "Want every passage? Use pages 1–6".
- Quick picks "Best fit", "20 pages", "50 pages" (or "All N pages" for files of 50 pages or fewer); changing the first page keeps the pressed pick's size. Files that fit one set get an optional "Choose pages".
- "Next" keeps the size the student chose (1–20 → 21–40; a best-fit set keeps the fit rule), computed on the server (`seriesNext`).
- Overlapping sets skip cards already in the deck from the same file ("Skipped 4 cards you already have."). If every card is already there, nothing is saved and the go is given back ("Every card from pages 15–34 is already in your deck…").
- Progress counts pages covered across all sets ("Pages 1–34 of 42 done", "26 of 42 pages done"), stored per browser as `studynest:cardRanges:<sourceId>`; the old `studynest:cardRange:<sourceId>` is read once and removed.
- Daily flashcard limit 5 → 15 sets (tries 15 → 45). Mindmaps and the app-wide AI budget are unchanged.
- Quality as important as quantity: the prompt asks for key concepts over trivia, one fact per card, answers that stand alone, and an even spread across passages from many pages. The server drops cards that are too short or not a question, answers that repeat the question, near-duplicate questions in a set and cards citing a passage that wasn't sent. Never padded with weaker cards.
- Accuracy: the prompt says answers come only from the passages, with numbers, units, names and terms as written, skipping ambiguous passages. The server drops answers whose numbers aren't in the cited passage or with under half of their content words in it (`isGrounded` in `src/lib/ai/schemas.ts`). No extra AI calls.
- Science notation captured accurately (Bradley; QA, `docs/qa/flashcard-pages-50.md`): PDF text extraction turns Word-style superscripts and subscripts into Unicode (10⁸ was read as "108"), PPTX superscript/subscript runs too, and hyphenated terms split across lines keep their hyphen (α-helix). Grounding compares in a canonical form (NFKC, one minus sign, arrows, superscripts) so H2O matches H₂O while a changed formula, coefficient, charge, exponent, Greek letter, equation, species name, unit prefix, sign or number scale is dropped; fewer false drops (4% = 4.0%, five = 5, 100 000, Latin plurals). The prompt asks for names, formulas, equations, symbols and units copied exactly. Cards fall back to free math/symbol fonts for glyphs Atkinson Hyperlegible lacks, and read-aloud speaks notation ("C 6 H 12 O 6", "Ca 2 plus", "10 to the power 8", "delta G").
- Tests: unit tests for page ranges, quick picks, coverage, validation, dedupe/refund/next rules, the quality filter, grounding (accurate vs wrong number, invented term, outside knowledge) and the prompt wording. e2e `e2e/step2-pages-50.spec.ts` with a 60-page fixture (`e2e/fixtures/very-long-lecture.pdf`, `node e2e/fixtures/make-long-lecture.mjs 60 very-long-lecture.pdf`).
- Accuracy where the fact sits (QA L2): an answer's numbers, formulas and charges must be in the sentence the card comes from (the model's verified quote, or the sentence sharing most words with the card); a value from another sentence counts only when it appears once in the passage and that sentence is about the card's subject. A card asking for one end of a range and giving the other ("lower limit" → 7.45) is dropped. QA sample: false keeps 4 → 2, false drops unchanged at 1 of 37; science sample still 38/38 kept, 17/17 dropped.
- Notes skip duplicates too: making cards from a note again skips cards already in the deck from that note; if all are there, nothing is saved, the go is given back and the dialog says "Every card from this note is already in your deck. Try another source." (Needed because `PROMPT_VERSION` 2 stops older sets matching as "already made".)
- Prompt safety (QA L5): a disguised delimiter is defused on its own, so the rest of the passage reaches the model as written (10⁸ stays 10⁸). `PROMPT_VERSION` 2, so replies cached with the old prompt are not reused.

## 2026-10-15 · Flashcards from long lecture files, set after set
- A file with more text than one set can read (about 14,000 characters) now shows page fields, whatever its page count. The default range is what fits, and the hint says whether every passage on those pages is covered or only a sample ("Use pages 1–6" snaps back). Files that fit in one set are unchanged and are sent whole.
- The result step shows "Pages 1–6 of 42 done" with a progress bar and a "Next: pages 7–12" button that goes straight back to Step 1 with the next range filled in, or says the next pages are for tomorrow when no goes are left. "Already made" for a page range offers the next pages too.
- The dialog remembers the furthest page made per file in this browser (`studynest:cardRange:<sourceId>`) and starts after it next time.
- One shared fit rule (`src/lib/page-range.ts`) for the dialog's hints and the server's answer. `loadMakeOptions` sends per-page character counts (never text); `makeFlashcards` takes a file with or without a page range and returns the range, coverage, page count and next range.
- e2e: `e2e/step2-pages.spec.ts` with a 12-page fixture (`e2e/fixtures/long-lecture.pdf`, made by `make-long-lecture.mjs`).
- Security review: the dialog's per-page counts are now summed in the database (`source_page_chars`, migration `20261015000001_source_page_chars.sql`) instead of reading every passage of every file on each open. Review addendum in `docs/security/step-2-review.md`.
- QA: with one go left the hint under Next reads "Uses your last go for today." Fixed an e2e helper race that made mobile tests fail intermittently under load. More e2e in `e2e/step2-pages-qa.spec.ts` (PPTX, short files, invalid ranges, quota running out mid-series, already made, blocked storage, 375 px, dark mode). Sign-off in `docs/qa/step-2-page-series.md`.

## 2026-10-15 · Sign in on preview deploys
- Sign-in links sent from a Vercel preview now open that preview, not the live site, so new steps can be tried before merge. Needs the preview URL pattern in Supabase's redirect list (README).

## 2026-10-14 · Step 2 security review
- Flashcards, reviews and mindmaps can only be written through the server now (students could write them directly with the public key and skip the card cap and validation).
- Failed AI generations still give the go back, but tries per day are capped (15 flashcard, 9 mindmap), so a note that makes the model fail can't use up the whole app's free AI allowance.
- The 50-subject and 500-notes-per-subject caps and the note size limit now hold in the database too.
- Prompt delimiters can't be faked with look-alike characters, invisible characters or HTML entities; the subject name is defused too. AI text can't carry half an emoji or control characters into the database.
- Privacy page: flashcards, review history, mindmaps and AI usage counts; read aloud and online voices.
- Migration `20261014000002_step2_security_review.sql`; review in `docs/security/step-2-review.md`; hostile-input tests in `src/lib/ai/injection.test.ts` and `src/server/actions/security.test.ts`.

## 2026-10-14 · Step 2 QA fixes
- A production build without an AI key says "AI isn't set up yet" for flashcards and mindmaps instead of making stand-in cards; stand-in output is never reused once real AI is set up.
- Review: Undo removes only the grade it was for (a retried undo could delete an older review); a double tap on a grade no longer flips the next card; a reused client key can't copy one card's schedule onto another; "Review X · N due" shares the new-card allowance like the banner.
- Same notes in two subjects: making cards in the second no longer says "already made".
- Mindmap: regenerating while a layout save was pending no longer moves the new map's nodes.
- Touch targets: small buttons, back links, the logo and the note title are 44 px on phones.
- QA sign-off `docs/qa/step-2.md`; new tests in `e2e/step2-qa.spec.ts` and `src/server/actions/*.test.ts`.

## 2026-10-14 · Step 2: flashcards, spaced repetition, mindmap, read aloud
- Make flashcards from a note or a lecture file (10, 15 or 20 cards; up to 20 pages of a file at a time). Each card keeps the quote it came from and links back to it. Edit, delete (with Undo) and add cards by hand.
- Review sessions with FSRS spaced repetition (`ts-fsrs`): flip, Again/Hard/Good/Easy with the next interval on each button, keyboard shortcuts, Undo, confetti at the end, 20 new cards a day. Due-today counts on the Subjects page, subject tiles and the subject page.
- Mindmap per subject (React Flow): radial layout, drag or arrow keys to move topics (saved), Map/Outline views, passage panel for each topic, Regenerate, Reset layout, Choose sources.
- Read aloud with the browser's own voices: note editor player bar (speed, voice), speaker buttons on cards, review and mindmap passages.
- Source passage links: notes scroll to and mark the passage; new read-only page for lecture files with the text page by page.
- AI on the free Groq API with Cloudflare Workers AI as fallback, server-side only; JSON validated with zod; results cached by a hash of the source text; per-student daily limits (flashcards 5, mindmaps 3) and an app-wide daily budget; a deterministic local generator when no AI key is set (demo mode, CI).
- Migration `20261014000001_step2_flashcards_mindmaps.sql`: `flashcards`, `card_reviews`, `mindmaps`, `ai_app_usage`, quota functions callable only by the server; RLS tests extended.
- New `cheer` sound for the end of a review session.

## 2026-10-14 · Google button follows Supabase
- "Continue with Google" now shows only while the Google provider is switched on in Supabase (checked live, cached for a minute), replacing the `NEXT_PUBLIC_GOOGLE_SIGNIN` flag that could get out of step.

## 2026-10-12 · Fixes after first deploy
- Sign-in links that land on the home page (Supabase falling back to its Site URL) now finish signing in.
- Google sign-in button hidden until `NEXT_PUBLIC_GOOGLE_SIGNIN=1` (it showed a raw Supabase error while the provider was off).
- `vercel.json` pins the Next.js framework.
- Trigger functions can no longer be called through the API.

## 2026-10-11 · Step 1: sign-in, subjects, notes, uploads
- Sticker Notebook design system, synthesised sound set, screen specs (`docs/design/`).
- Sign-in with email magic link or Google (Supabase Auth); demo mode when Supabase isn't configured.
- Subjects with colour and icon: create, edit, delete.
- Rich-text notes with autosave.
- PDF and PPTX uploads (25 MB) with type checks by content, text extraction per page/slide, passages saved for later AI features; scanned PDFs flagged.
- Settings: sound on/off and volume, theme, download everything, delete account. Privacy page.
- Database migrations with RLS on every table and Storage; RLS test suite.
- CI: lint, types, unit, build, audit, Playwright e2e with axe accessibility checks, RLS tests.

## 2026-10-11 · Step 0
- Added team agents: developer, ui-ux-designer, qa-engineer, security-engineer (`.claude/agents/`).
- Added `CLAUDE.md` and `docs/PLAN.md` (architecture, data model, build steps, open questions).
- Added three playable design concepts with generated sounds (`docs/design/concepts.html`).
- Moved to the GitHub repo; each step is a pull request.
- Bradley picked Concept B (Sticker Notebook); plan approved with default answers to open questions.
