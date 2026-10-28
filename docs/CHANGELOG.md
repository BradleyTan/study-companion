# Changelog

## 2026-10-28 · Student test feedback: study notes, detailed mindmaps, exam-style flashcards
- **Make study notes (new):** "✨ Make notes" on the subject page turns a note, a lecture file (a page range for long ones) or a public web page into tidy notes (headings, one-sentence points, key terms), saved as a new note that works with flashcards, the mindmap, quizzes and chat. Every point is checked against the passage it came from. Web pages are read on the server with strict link rules (public addresses only, checked at connect time; 4 redirects; 10 s; 2 MB; HTML or text). 5 a day per student. Spec `docs/design/screens/make-notes.md`.
- **Mindmaps with details:** every topic carries a short detail from its passage (definition, how it works, key numbers), shown on the map, in the outline and at the top of the passage panel; "Hide/Show details on map"; up to 50 topics. Unsupported details are left out. Maps now use `openai/gpt-oss-120b` (12,000 characters per map).
- **Exam-style flashcards:** the card maker writes like the professor setting the exam: why/how/compare/steps questions, no more than a third plain definitions, model answers. Yes/no cards and cards about the lecture itself are dropped; "according to the notes" wording is removed. Old cached sets aren't reused.
- **Mindmap:** the "notes changed" banner no longer has its own Regenerate button (it doubled the header one); it points to ↻ above.
- **Read aloud:** with an online voice, the voice picker no longer collapses under the "Online voices…" hint on wide screens; the hint wraps onto its own line.
- **Database:** `20261028000001_study_notes_quota.sql` (adds `notes` to `ai_usage.kind`).
- **Tests:** `src/lib/ai/feedback.test.ts`, `src/server/web-page.test.ts`, `src/server/actions/study-notes.test.ts`; e2e `e2e/feedback.spec.ts`.

## 2026-10-20 · Polish pass security review
- **Open a file:** only http(s) addresses are ever opened, in a new tab or in the same-tab fallback.
- **Headers:** a baseline Content-Security-Policy (`base-uri 'self'; object-src 'none'; frame-ancestors 'none'`) on every page.
- **Student test kit:** delete the tester's account together at the end of the session (it needs a recent sign-in); if they've left, delete their Storage folder before the user in the dashboard; give testers a contact address; keep tester names, files and screenshots out of forms, issues and recordings.
- Review: `docs/security/polish-review.md`. No critical or high findings.

## 2026-10-20 · Polish pass QA
- **Phones:** a long subject name (up to the 60-character limit, or one long word) no longer pushes Flashcards, Mindmap, Quizzes, Weak topics, Review, the note editor or the subjects grid sideways; the subject chip cuts the name with "…". The subject header's "More for …" menu is readable in dark mode.
- **Open a file:** "Open" and "Open the original file" download in the same tab when a popup blocker (Safari, iOS) refuses the new tab, instead of doing nothing.
- **Quiz results:** the focus button says "Open the timer" while a round or break is running.
- **Student test kit:** sign-in links must open in the browser that asked for them; real button names, upload status, export contents, .ics import, free re-generations and session length corrected.
- **Tests:** `src/lib/open-file.test.ts`; e2e in `e2e/polish.spec.ts` (Open with and without a popup blocker, long names at 375 px in dark mode, focus button with a round running). Sign-off `docs/qa/polish.md`.

## 2026-10-20 · Polish pass (before the student test)
Every P1 and P2 item of the designer's audit (`docs/design/polish.md`), plus the small P3 fixes that were risk-free. No new features, no migrations, nothing paid.
- **First run:** a brand-new subject shows a "Start with your notes" sticker (Write a note / Upload a file, and the 1-2-3-4 path) until it has a note or a file, and the four tool tiles say "Add a note first". Flashcards, Mindmap, Quizzes and Ask your notes share one "nothing to work from" empty state with "Write a note" and "Upload a file" (Ask hides its composer there). Review end screens offer "Quiz yourself", quiz results offer "Start a focus round".
- **Phones:** the subject page no longer scrolls sideways when weak topics exist; the subject title never splits a short word, and Edit/Delete sit in a "More for Biology" menu below 640 px; the mindmap opens at a readable zoom centred on the root, with a "Tip: Outline is easier to read on a phone." line; the empty timetable sticker leaves the hour labels visible; every listed small target is 44 px.
- **Fixes:** a wrong quiz pick turns coral (it stayed yellow), the right one mint; the chat "Today" divider is a pill again (class clash with the timetable day strip); Settings → Theme is a segmented control with a visible keyboard focus ring; the landing page no longer says flashcards, quizzes and the timer are "Coming soon"; lecture file rows keep the file name on its own line and say "Open" (new tab).
- **Consistency:** the subject colour is set on the subject page, note editor and source page; breadcrumbs read "← Biology" everywhere (with the subject chip on Mindmap and quiz results, "← All subjects" after an all-subjects review); page titles share one size and alignment; quota chips sit right after the button they limit and page headers line up with their lists; the deck shows "All caught up ✓" and "Next card due in 8 days" (from the deck itself) instead of a disabled button and a fixed "tomorrow"; a best quiz score of 0 reads "Tried once · have another go"; subject and note pages get their own loading skeletons; note rows play `flip`, and the remaining breadcrumbs play `click`.
- **Tokens:** `--danger-line` (light `#c23a30`, dark `#ff8a7a`) replaces the last hard-coded colours (Delete account card, invalid inputs).
- **Small P3s:** the "Saved" toast uses the sticker look with a ✓; friendlier upload error copy; tool tiles lean alternately; the empty Notes box is dashed like the drop zone. Left for later: P3-2 (disabled button look), P3-4 (timer page steppers; timer.md asks for ghost), P3-5 (phone timetable day heading).
- **Specs:** `design-system.md` (`--danger-line`), `settings.md` (Theme wording and control), `subject.md` (Start sticker, phone header, file row, score copy), `mindmap.md` (phone zoom).
- **Tests:** unit tests for "Next card due …" and the best-score copy; e2e `e2e/polish.spec.ts` (first-run sticker show/hide and the four empty states, file row, 375 px header and menu, wrong/right option colours in both themes, no sideways scroll with weak topics, theme focus ring, 44 px targets, landing copy, phone mindmap zoom) and updated Step 1–3 specs.

## 2026-10-19 · Step 4 security review
- **Import:** a hostile timetable file can no longer take seconds of server CPU (at most 8,000 dates worked out per file; zone checks cached). Undo of an import works only for the latest import and for 5 minutes on the server, the same in Supabase and demo.
- **Calendar feed:** only real time zone names go into the feed (profile time zone checked on read, a format check on `timetable_slots.tz` in the not-yet-applied Step 4 migration); zone rules are cached and lines folded without per-character encoding, so a feed builds in well under 100 ms.
- **Links:** sign-in and calendar links never use the Host header in production unless the app is the in-memory demo.
- **Privacy page:** calendar apps keep the slots they already read after the link is reset or turned off.
- Review in `docs/security/step-4-review.md`; threat model T21–T23.

## 2026-10-19 · Step 4 QA
- **Re-import fixes:** "Replace my previous import" during a long break (Christmas between two terms) no longer fills the break with the class, and weeks the student moved or deleted with "Just this week" stay out instead of coming back beside the moved copy.
- **Calendar feed:** the time zone rules always cover the current years, so one old slot can't make summer-time classes show an hour off in Google, Apple or Outlook.
- **Timer:** a round that ends while an earlier save is still on its way is saved straight away instead of waiting for the next load.
- **Timetable:** the address keeps the day a link opened (?week=<day>), so a reload on a phone shows that day; "Nothing this week" jumps to a finished series' last week, not its first; the import preview's tick boxes have 44 px targets.
- **Database:** the 600-row backstop on `timetable_slots` no longer refuses import updates (upserts) during a replace import's Undo window (migration edited before it is applied).
- **Tests:** `e2e/step4-qa.spec.ts` (daylight saving week with Sunday start in Europe/London, an Outlook export from Singapore at 375 px, `/timer` at 375 px in dark mode, a save still on its way), new action, lib and RLS tests; the axe helper polls past a `<title>` swap; the flaky study strip URL check is fixed at the cause. Sign-off `docs/qa/step-4.md`.

## 2026-10-19 · Step 4 part 2: timetable and calendar link
- **Timetable** (`/timetable`, linked from the header; a calendar icon on phones): the week on graph paper with classes as subject stickers, study blocks dashed with a subject band, and "Other" slots. Overlaps sit side by side, a Now line moves each minute, empty weekend columns are narrower on laptops. Phones show one day with a day strip (swipe to change day).
- **Adding and changing slots:** drag on the grid with a mouse or pen (15-minute steps, live "10:00–11:30" ghost; a click makes an hour), tap a time on touch screens, or use Add (N). Drag a slot to move it (also to another day) or its bottom edge to resize; Esc cancels. Slot details (popover, bottom sheet on phones) with Edit, Delete and Start focus for a Study block happening now. The form has Class / Study / Other, subject, optional title (default "Biology class"), day, start, end ("1 h 30 min"), Every week / Just once with an optional Until, and location. Weekly slots ask "Just this week" or "Every week" when edited, moved or deleted. Delete has a 6-second Undo.
- **Import your timetable:** choose or drop the .ics file from the uni timetable page (up to 1 MB, read on the server, never fetched from a link). Preview by group with a tick box and a subject menu (pre-matched by subject name or course code), the left-out line ("Left out: 1 all-day event"), the time zone note and a mini week. Re-importing updates matching classes, removes classes no longer in the file and never touches hand-made slots ("1 updated, 1 new, 1 removed"). 6-second Undo.
- **Calendar link ("Add to my calendar", also in Settings):** a private `.ics` feed for Google, Apple or Outlook Calendar, made only on request: copy (with a fallback), "Open in Apple Calendar" (webcal), step-by-step tabs, last-checked status, Reset link and Turn off link with confirms. The feed has every slot with its subject emoji, room and weekly repeats with skipped weeks, nothing else.
- **Subject page:** the study strip shows "Next: Lecture, Tue 10:00 · Room 2.14" (or "Study block now · until 15:00", or "Add a class").
- **Timer:** a Study block happening now picks the timer's default subject.
- **Settings → Timetable and calendar:** week starts on Monday or Sunday, the time zone line and the calendar link. Deleting the account turns the link off first.
- **Database:** migration `20261020000001_step4_timetable_calendar.sql` (not yet applied to the live project): `timetable_slots` (read-only to students, 300-slot cap, subject delete keeps slots as No subject), `calendar_links` (server-only) and `profiles.week_start`. Export includes the timetable (never the calendar link). Privacy page updated.
- **Tests:** unit tests for dates and daylight saving, recurrence and edits, the .ics reader (Google, Outlook and Syllabus-style samples, Windows zones, hostile input), import folding and matching, the feed round trip, grid maths and the timetable actions; grant and RLS tests for both tables; e2e `e2e/step4-timetable.spec.ts` (Add, drag create/move/resize, edits, delete with undo, import with undo and re-import, calendar link and feed with reset and turn off, study strip, keyboard, 375 px, week start).

## 2026-10-19 · Step 4 part 1: study timer
- **Study timer** in the app frame: header chip (live time, ring, paused and "Round done!" states), a side panel under the header (bottom sheet on phones) and a full-size `/timer` page (Space to start, pause and resume). Subject picker (page subject, else last used, else No subject; can change mid-round), Focus · 25 / Short break · 5 / Long break · 15, a draining focus ring and filling break ring, round dots, +5 min (up to 180), Stop with an inline "End this round?", end cards ("Round done! 🍅", "Four in a row!", "Break's over"), today's tally with 🍅 stickers and time per subject.
- **Accurate in the background:** wall-clock timing with one end timeout re-armed on wake; a phone that wakes late logs the round at its real end time silently and says when it finished. Several tabs stay in sync and exactly one of them chimes and logs. Rounds that couldn't be saved wait in the browser and are retried on load and when back online.
- **Focus mode:** while a focus round runs or is paused, only the end chime plays and decorative motion stops (setting "Quiet the app while I focus"). The chime now also plays while read-aloud speaks.
- **Settings → Study timer:** focus, short break, long break and "long break after" steppers, auto-start, quiet mode, and optional browser notifications (asked only from a click; the timer works fully without them).
- **Subject page:** a study strip with Start focus (or the live "Focusing · 18:42") and this week's study time.
- **Header on phones:** logo, timer chip and a Menu with Subjects, Settings and Sign out.
- **Database:** migration `20261019000001_step4_study_timer.sql` (not yet applied to the live project): `study_sessions` (read-only to students, composite key to subjects that keeps the time as No subject when a subject is deleted, unique client key, checks, 10,000-row cap) and timer columns on `profiles`. Export includes study sessions; the privacy page says what the timer stores.
- **Tests:** unit tests for the timer math, phase transitions, the multi-tab end claim, the retry queue, the tally, wording and the logging action (`src/lib/timer/timer.test.ts`, `src/server/actions/timer.test.ts`, sound rules); grant and RLS tests for `study_sessions` and the timer settings; e2e `e2e/step4-timer.spec.ts` (start/pause/resume/stop, background-tab accuracy with a fake clock, end cards and the long-break cycle, ended while away, two tabs, offline queue, settings defaults, subject defaults and the study strip, `/timer` keyboard and reduced motion, 375 px).

## 2026-10-18 · Step 3 security review
- **Quiz answers can't be read early from the AI cache:** students can no longer read `ai_cache` (a cached quiz reply holds every answer). The server reads it with the secret key, pinned to the student. A question's source quote is hidden until it is answered too. Migration `20261018000003_step3_security_review.sql` (not yet applied to the live project; apply it before deploying).
- **Chat CPU:** a reply with a long run of spaces inside a citation bracket no longer ties up the server for seconds (S3-1).
- **Report a problem / Remove from quiz** are refused on a deleted quiz.
- **Privacy page:** says that Ask your notes sends the question and the last few messages with the passages.
- **Tests:** the database test stub grants like Supabase does by default, and the grant tests check every table and function. New `src/server/actions/security-step3.test.ts` (student B against every Step 3 action). Review: `docs/security/step-3-review.md`.

## 2026-10-18 · Step 3 QA
- **Answers stay hidden:** the results of an unfinished quiz attempt are no longer sent (they carried every right answer, accepted answer and explanation).
- **Fill-in typos:** "watch the spelling" no longer accepts a different science term one letter away (afferent/efferent, nitrate/nitrite, ethane/ethene, lactose/lactase, ligase/lipase, neuron/neutron, S phase/M phase, vitamin D/E, β/α cells). Common misspellings (hypothalmus, glycolisis, mitochondira) still count. "five" counts as 5.
- **Accuracy:** quiz fill-ins, explanations and chat sentences that swap one passage term or number for another ("Mitosis produces four haploid gametes", "work best at 45 °C", "3′ to 5′") are dropped; a species the notes never name is not grounded; "Two" and "2" can't both be options. Labelled sample `src/lib/ai/quiz-chat-quality.qa.test.ts`.
- **Weak topics:** "I think my answer is right" on an older miss no longer wipes right answers or a "got it" that came after it.
- **Retake:** "Retake this quiz" no longer refuses every answer with "That answer was already used" (answer keys were cached per question, not per attempt).
- **Weak topics on Supabase:** a topic such as "Ca²⁺" no longer breaks checking an answer (the app's topic key folded it to "ca2+", the database's did not).
- **Edit question:** "1,200" in "Other answers that count" stays one answer; a question with more than 6 other answers can be edited again (up to the database's 10). "I was right" is refused on a reported question or a deleted quiz (it took the miss back twice).
- **Mindmap:** the refresh after making a map no longer remounts the screen (it closed an open passage and could drop a layout save); this was the flaky `step2.spec.ts` mindmap test.
- **Tests:** `e2e/step3-qa.spec.ts` (dark mode + reduced motion axe on every Step 3 screen, answers never in the browser before checking, HTML in notes stays text, practise after a resumed quiz), a delayed-refresh mindmap test in `e2e/step2-qa.spec.ts`, and unit tests above. Sign-off: `docs/qa/step-3.md`.

## 2026-10-18 · Step 3 part 2: ask your notes
- **Ask your notes** (`/subjects/[id]/ask`): a chat that answers only from the subject's notes and ready lecture files. Every sentence carries a numbered citation chip; a chip opens the passage in place (popover from 640 px, bottom sheet on phones) with the cited sentence marked and "Open in note/file" (`passageHref`). Sources list under each answer, "Source deleted" with the saved quote when a note or file is gone.
- **Honest when it doesn't know:** with no passage close enough the reply is "Your notes don't cover that yet, so I won't guess.", with the closest passages it found; no AI call and no question used.
- **Extras:** starter suggestions (from weak topics and note/file titles), "Quiz me with one question" with the answer behind Show answer, read aloud, copy (with a sources list), "Not right?" feedback, day chips, older messages, a typing indicator, drafts kept per subject in this browser, offline notice, Enter to send / Shift+Enter for a new line, "/" to focus, Clear chat (asks first).
- **Limits:** 20 questions a day (60 tries); the chip shows "N of 20 questions left today" (on phones from 3 left); at the limit the composer becomes a sticker with Make a quiz / Review flashcards. Same question about the same notes again: answered from the cache, free.
- **Accuracy and safety:** answers are validated as a whole (no streaming); uncited or ungrounded sentences are dropped and citations renumbered; safe Markdown subset, never HTML; question and history passed as data (prompt-injection defence). Retrieval with pgvector embeddings, or Postgres keyword search when they aren't there (hint shown).
- **Subject page:** the Ask your notes tile is now a link with "N questions left today".
- **Database:** migration `20261018000002_step3_chat.sql` (not yet applied to the live project): `chat_messages` with RLS (read-only to students), composite foreign keys, caps (1,000 per subject), a full-text index on passages, and `match_chunks` / `search_chunks` pinned to the signed-in student. Grant and RLS tests in `supabase/tests/05_grants.sql` and `10_rls.sql`. The `embed` Edge Function now also embeds a question and backfills a subject; it needs redeploying.
- **Privacy page:** mentions chat history, feedback and embeddings.
- **Tests:** unit tests for grounding, the Markdown subset, retrieval rules, suggestions, day labels, the local generator, prompt injection and the chat actions (idempotency, quota, cache, not covered, prune, ownership); e2e `e2e/step3-chat.spec.ts` (asking, citation preview and source link, not covered, history and clear, quiz me, feedback, copy, daily limit, no sources, keyboard, 375 px).

## 2026-10-18 · Step 3 part 1: quizzes and weak topics
- **Quizzes** for each subject (`/subjects/[id]/quizzes`): make one from a note, a page range of a lecture file (up to 50 pages, same page fields as flashcards), everything in the subject, or your weak topics. Multiple choice, fill in the blank or mixed; 5, 10 or 15 questions. Titles are built by the server ("Lecture 3.pdf · pages 1–20 · Mixed"). 3 quizzes a day (9 tries); retaking is free; the same settings again reuse the quiz.
- **Taking a quiz** (`/subjects/[id]/quizzes/[quizId]`): one question at a time, Check → feedback with the explanation, the quote from your notes and a link to the passage (new tab), read aloud, "I don't know", "I think my answer is right" for typed answers, "Report a problem", keyboard shortcuts (1–4/A–D, Enter, R, Esc, ?), streak tag, resume where you left off, end early. Correct: ✓ pop and a paper burst; wrong: a gentle shake (both off with reduced motion or focus mode).
- **Results:** score sticker by band (confetti and `cheer` at 70 % or more), weak-topic line, "Practise what I missed", retake (reshuffled), answer list with All/Missed, "Why?", edit question and remove from quiz.
- **Weak topics** (`/subjects/[id]/weak-topics`): what you missed, with recent tries, where it's from, Practise, Mark as got it (with Undo), See the questions, and the Got it list. Cleared after 2 right answers in a row.
- **Subject page:** Quizzes tile, Ask your notes tile (disabled, "Coming soon" until part 2, since built), 2 × 2 tiles on phones, the weak-topics strip, and "Make a quiz" in note and file menus. Delete confirms now say "Flashcards and quizzes made from it stay, with their quotes."
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
