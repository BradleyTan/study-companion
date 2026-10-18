# Screen: Weak topics (`/subjects/[id]/weak-topics`)

Step 3. A friendly "to practise" list per subject, built from wrong quiz answers. It should read like a sticky-note to-do list, not a report card: no red, no percentages of failure, every topic has a way forward.

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900.

## Tracking rules the developer must match
- A topic is the question's `topic` (quiz-builder.md "Quality rules"), matched case-insensitively and trimmed, per subject.
- **Miss** (wrong answer or "I don't know"): upsert `weak_topics` → `miss_count + 1`, `last_missed_at = now`, `right_streak = 0`, `cleared_at = null` (a cleared topic comes back). Also remember the missed question's `chunk_id` for the topic (suggested `weak_topic_chunks` or a `chunk_ids uuid[]` column, max 10 most recent) so practice quizzes can pull those passages.
- **Right** answer on an open weak topic: `right_streak + 1`. At **2 right in a row** (across any quizzes) the topic is cleared: `cleared_at = now`. One right is "getting stronger".
- A "I was right" override (quiz.md) undoes that miss: `miss_count - 1` (min 0; at 0 with no other misses the row is deleted), streak restored.
- **Mark as got it** (manual): sets `cleared_at`; a new miss reopens it.
- Order of the open list: most recent miss first, ties by higher `miss_count`.
- Suggested column added in the Step 3 migration: `weak_topics.right_streak int not null default 0`.

## Layout
**Header:** "← Biology", subject chip, title "Weak topics" (Permanent Marker), sub-line in `--ink-soft`: "Things to look at again. Answer each one right twice and it's cleared."

**Action row:** "Practise all · 5 topics" primary (opens Make a quiz with Focus = Weak topics, all ticked; quiz-builder.md) + quota chip `2 of 3 left today`. Phone: full width, chip under it.

**Open topics:** a list of sticky-note stickers (`--card`, 6 px left band in `--subject`, slight alternating rotation -0.5° / 0.5°, none under reduced motion). Single column, max 760 px, centred; tablet and laptop: 2 columns at ≥ 900 px.
Each topic sticker:
- Topic name (bold 18 px).
- Line in `--ink-soft` 14 px: "Missed 3 times · last on Tuesday" (today: "last today").
- **Recent tries** row: up to 5 small dots, oldest → newest, each a 14 px circle with an icon inside (✓ on `--success`, ✗ on `--danger`), text alternative "Last 5 tries: missed, missed, right, missed, right". Never colour alone.
- "Getting stronger" chip (`--highlight`) when `right_streak = 1`: "1 more right to clear it".
- **Where it's from:** up to 2 source links ("From **Lecture 3.pdf**, page 12", "From **Cell structure**") built with `passageHref()` from the remembered chunk ids, same tab; "+2 more" expands the rest. Source deleted: chip "Source deleted".
- Actions (44 px): "Practise" (plain small; opens Make a quiz with only this topic ticked) and "⋯" with "Mark as got it" and "See the questions" (expands the missed prompts with their right answers and explanation, read-only).
- Mark as got it: sticker shrinks and slides into the "Got it" section (250 ms; reduced motion: instant), `pop`, toast "Nice! Moved to Got it." with Undo (6 s).

**Got it section** (below, collapsed by default): disclosure button "Got it now (4)" (`aria-expanded`). Rows are plain (no rotation): topic, "Cleared Monday", ghost "Practise again". Cleared topics older than 60 days are hidden from this list (still in the database).

## Elsewhere
- **Subject page:** weak-topics strip (subject.md).
- **Quizzes shelf:** "Practise weak topics · 3" button and summary count (quiz-builder.md).
- **Quiz results:** "Added to your weak topics" line (quiz.md).

## States
- **Loading:** header + three sticky-note skeletons.
- **No quizzes taken yet:** marker line "Nothing tricky yet", sub-line "Take a quiz and we'll keep a list of anything you miss, so you know what to practise." + "Make a quiz" (or "Go to quizzes" when quizzes exist but none were taken).
- **All cleared:** marker line "All clear! 🎉", sub-line "You've got every topic you missed. Try a new quiz to keep it that way." + "Make a quiz". The "Got it" section is open by default here. On first arrival after the last topic clears: confetti (review.md rules; off under reduced motion / focus mode) + `cheer`, once.
- **Load error:** "We couldn't load your weak topics." + "Try again".
- **Mark as got it failed:** sticker returns, toast "Couldn't save that. Try again." `boop`.

## Sounds
`click` on buttons and the disclosure; `pop` on Mark as got it; `cheer` once on "All clear"; `boop` on save errors. Focus mode: only `chime`.

## Accessibility
- The open list is a `<ul>` with each topic an `<article>` labelled by the topic name; the action buttons include it ("Practise Krebs cycle", "More actions for Krebs cycle").
- Recent tries dots: one `role="img"` group with the full text alternative.
- After Mark as got it, focus moves to the next topic's "Practise" button, or the "Practise all" button if none left.
- Contrast: text `--ink` on `--card`; dots and chips carry `--on-colour` icons on fills (≥ 7:1). Left band is decorative.
