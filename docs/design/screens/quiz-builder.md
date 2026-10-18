# Screen: Quizzes (`/subjects/[id]/quizzes`) and "Make a quiz"

Step 3. The subject's quiz shelf plus the "Make a quiz" dialog. Taking a quiz and the results are in quiz.md; weak topics in weak-topics.md. Same Sticker Notebook look as the flashcards deck: quiz stickers on graph paper, subject-colour washi tape, calm text surfaces.

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900. Every state below works at 375 px.

## Data the screen needs
- Subject `name`, `colour`, `emoji` (sets `--subject`).
- Quizzes for the subject, newest first, 20 per page: `id`, `title` (built by the server, see below), `kind` (`mcq` / `fill` / `mixed`), `question_count`, `created_at`, `focus` (`all` / `weak`), source summary (ids + titles + page range), best score, number of attempts, and an unfinished attempt if one exists (`answered`, `total`).
- Weak topics count (open ones, see weak-topics.md) and the top 3 names.
- Quota for kind `quiz` (**3 per student per day**, PLAN section 4; tries cap 9, 3× the goes, same as mindmaps) + app allowance flag.
- Pickable sources: notes (title, `content_text` length, updated_at) and ready files (name, page count, `pageChars`, `looseChars`, `fitsOneSet` computed against `QUIZ_MAX_CHARS`). Same server-side shape as flashcards.md "Data the screen needs".

Suggested schema additions for the developer (Step 3 migration owns the final names): `quizzes.title`, `quizzes.question_count`, `quizzes.focus`, `quizzes.source_ids uuid[]`, `quizzes.page_from/page_to`; `questions.source_quote`, `questions.accepted_json` (extra accepted fill-in answers), `questions.removed_at`.

**Quiz title** (server builds it, never the AI): source title + range + kind, e.g. "Lecture 3.pdf · pages 1–20 · Mixed", "Cell structure · Multiple choice", "All of Biology · Fill in the blank", "Weak topics · Mixed".

## Layout
**Header** (same as flashcards): "← Biology", subject chip, title "Quizzes" (Permanent Marker), summary line in `--ink-soft`: "4 quizzes · best 9/10 · 3 weak topics".

**Action row** (phone: full-width buttons stacked in this order):
1. "Make a quiz" primary (yellow) + quota chip `2 of 3 left today` beside it (phone: chip under the button, left-aligned). At 0 the chip turns `--danger` "0 of 3 left today"; the button stays enabled and the dialog opens on the limit message.
2. "Practise weak topics · 3" plain, only when open weak topics exist. Opens the dialog with **Focus: Weak topics** chosen.

**Resume banner** (only when an attempt is unfinished, above the list): sticker with tape, "Pick up where you left off: **Lecture 3.pdf** quiz, question 4 of 10", buttons "Keep going" (primary) and "Start over" (ghost, asks "Start this quiz again from question 1? Your answers so far are kept in your weak topics." inline).

**Quiz list:** one sticker per quiz (radius 8, 4 px offset shadow, 10 px subject tape top-left rotated -3°, `aria-hidden`). Single column, max 880 px, centred.
- Line 1: title (bold 18 px). Line 2 in `--ink-soft` 14 px: "10 questions · made Tuesday".
- Score chips: "Best 8/10" (`--success` fill when ≥ 70 %, otherwise plain `--card` chip; always the number, never colour alone), "Tried 2 times". Never tried: chip "New".
- Actions: "Take quiz" (primary small) / "Retake" when tried, and "⋯" menu (44 px): "See last results", "Delete quiz". Retaking is free (no AI); questions and options are reshuffled.
- Delete: inline confirm inside the sticker "Delete this quiz? Your weak topics stay." with "Delete" (danger) / "Keep"; `tear`; toast "Quiz deleted" with Undo (6 s).
- After 20: "Show 20 more".

## "Make a quiz" dialog
`dialog.sheet`, max 560 px; phone full width with 16 px gutter, scrolls inside, buttons sticky at the bottom. Also opened from a ready file row and a note row "⋯" menu on the subject page (source pre-chosen, "Change source" link shown), from the results screen ("Practise what I missed") and from weak-topics.md.

**Step 1: Set up.** Title "Make a quiz". Four fieldsets, top to bottom:

1. **Focus** (segmented `.seg`, `role="radiogroup"`, only when open weak topics exist): "Anything" (default) | "Weak topics · 3". Weak topics hides the source list and shows instead a checkbox list of open weak topics (all ticked; each row: topic, "missed 3 times") with a hint "Questions come from the passages behind these topics." At least one must be ticked ("Tick at least one topic.").
2. **Source** (radio list, same rows as flashcards.md Step 1, grouped):
   - First row: **"Everything in Biology"** ("4 notes and 2 files, a quick sample"). The server spreads passages evenly across all notes and ready files within `QUIZ_MAX_CHARS` (same even spread as the mindmap's "All sources").
   - "Notes" group, then "Lecture files" group. Disabled rows with reasons: "Still reading text…", "No text found".
   - **Page ranges:** a chosen file uses exactly the flashcards page-range pattern (flashcards.md "Long files": fields "Pages [1] to [20] of 42", quick picks "Best fit / 20 pages / 50 pages (or All N pages)", covered/sampled hints, "Choose pages" link for files that fit one set, validation copy, live-region timing). Same `fitPageRange` and **max 50 pages** (`MAX_QUIZ_PAGES = 50`), with the budget `QUIZ_MAX_CHARS` (suggested 14,000, same as flashcards; the developer can tune it to the 120b model's free per-minute token limit). Hint wording swaps "cards" for "questions": "Questions will be spread across pages 1–20, a quick tour of the lot.", "Covers every passage on pages 1–6." Default range: page 1 to best fit (quizzes don't remember coverage; there's no duplicate problem because each quiz is its own set).
3. **Question type** (segmented): "Multiple choice" | "Fill in the blank" | "Mixed" (default **Mixed**). One-line hint under it that changes with the choice: "Pick the right answer from four." / "Type the missing word or number." / "A bit of both."
4. **How many** (segmented): "5" | "10" | "15" (default **10**). Hint: "We only ask what your notes can answer, so you might get fewer."

Footer: quota chip `2 of 3 left today` + hint "Each quiz uses one go. Retaking a quiz is free." Button "Make quiz" (primary, full width on phone).

**Step 2: Generating.** Same structure as flashcards Step 2. Animation: a quiz sheet sticker with three answer bubbles that tick in one by one (a pencil-tick stroke draws in each, 1.6 s loop). Rotating lines (decorative, `aria-hidden`, every 3 s): "Reading your notes…" (file range: "Reading pages 7–12…"; sampled: "Skimming pages 1–50…") → "Picking what matters…" → "Writing questions…" → "Checking every answer against your notes…" → "Nearly there…". Live region once: "Making your quiz. This takes about 20 seconds." Close allowed ("You can close this. We'll tell you when it's ready."); toast on completion "Your Biology quiz is ready" + "Start quiz". Reduced motion / focus mode: static sheet + the same text. No sound while generating.

**Step 3: Ready.** Title "Quiz ready! 10 questions" (`pop`). Summary line: "From **Lecture 3.pdf**, pages 1–20 · Mixed". If fewer than asked: hint "Your notes had enough for 7 good questions." (shown whenever fewer, because the student chose the number). Buttons "Start quiz" (primary, goes to quiz.md) and "Later" (ghost, closes; the quiz is already saved on the shelf with a "New" chip and a 1.5 s `--highlight` glow). No preview of questions here (it would spoil the quiz).

## Quality rules the developer must match
Bradley: accuracy matters as much as quantity. The prompt and the server's normaliser (same approach as `normaliseFlashcardsWithStats`) enforce:
- Every question cites one passage ref; the server maps it to the student's chunk id and keeps a short `source_quote` that must really appear in that passage. Questions citing an unsent ref are dropped.
- The answer must be supported by the cited passage (`isGrounded` rule: numbers, units and names as written; most content words found). Dropped otherwise.
- **MCQ:** exactly 4 options, exactly 1 correct, options distinct after normalising, similar length and form; no "all/none of the above", no "both A and B", no joke options. Options are shuffled by the server (the model's order is never trusted, so the answer isn't always B).
- **Fill in the blank:** the prompt is a sentence with exactly one blank (`____`); the answer is 1–4 words or a number with unit, taken from the passage; up to 3 accepted alternatives (synonym, abbreviation, singular/plural). The blank must not be guessable from the sentence itself (answer word not elsewhere in the prompt).
- Each question has a `topic` (≤ 40 chars). The prompt receives the subject's existing weak-topic and topic names and must reuse one when it fits, so the same idea keeps one name across quizzes; the server matches case-insensitively and trims.
- Each question has a 1–2 sentence `explanation` grounded in the same passage.
- No near-duplicate prompts in a quiz; spread across passages and pages; key concepts over trivia.
- Dropped questions are never replaced with weaker ones. Fewer than asked shows the "enough for 7 good questions" hint; fewer than 3 left counts as "too little text" (go refunded).
- Mixed = about half each, interleaved, never 3 of one type in a row when avoidable.

## Messages
Replace the dialog body (sticker, one illustration emoji, matching button), same pattern as flashcards.md:

| Case | Copy | Button | Sound |
|---|---|---|---|
| Too little text (or under 3 good questions) | "There isn't enough here for a good quiz yet. Add a bit more to your notes or pick more pages." | "Pick another source" | `boop` |
| Daily limit used (0 of 3) | "You've made 3 quizzes today. More tomorrow! You can still retake any quiz on your shelf." | "See my quizzes", "Close" | `boop` |
| App-wide allowance used | "Today's free AI allowance is used up. Try again tomorrow. Your notes and quizzes are safe." | "Close" | `boop` |
| Same source, range, type and count already made (cache hit, quiz still on the shelf) | "You already have this quiz. Take it again for free, or pick different pages or a question type." No go used. | "Take that quiz" (primary), "Change settings" | none |
| AI failed / bad output / network | "The quiz maker got muddled. Try again. This one didn't use up a go." | "Try again" | `boop` |
| Weak topics chosen but their passages were deleted | "The notes behind these topics are gone, so we can't quiz them. Untick them or mark them as got it." | "Back" | `boop` |

## States (shelf page)
- **Loading:** header, then three quiz-sticker skeletons (`--grid` blocks, no shimmer under reduced motion).
- **Empty, has sources:** marker line "No quizzes yet", sub-line "Test yourself on your notes. Wrong answers just show what to look at next.", primary "Make a quiz" + quota chip.
- **Empty, nothing to quiz:** "Add a note or a lecture file first, then we can quiz you on it." + "Back to Biology".
- **Load error:** sticker "We couldn't load your quizzes." + "Try again".

## Sounds
`click` on buttons, segmented choices and quick picks; `pop` when a quiz is ready; `boop` on the messages table and invalid page ranges; `tear` on delete. Silent while generating. Focus mode: only `chime`.

## Accessibility
- Each quiz sticker is an `<article>` labelled by its title; the score chips are text ("Best score 8 out of 10").
- Segmented controls are radio groups with visible legends ("Focus", "Question type", "How many questions"). The changing hints are linked with `aria-describedby`.
- Page range: identical accessibility to flashcards.md (polite live region 600 ms after typing, names with "to" instead of en dash).
- Generating: focus stays on the dialog's close button; the "Quiz ready!" title receives focus.
- Quota chip is a full sentence. Emoji `role="img"` with the subject name.
- Contrast: all text `--ink` on `--card`/`--paper`, `--on-colour` on fills (≥ 7:1 both themes).
