# Screen: Flashcards deck (`/subjects/[id]/flashcards`) and "Make flashcards"

Step 2. Figma reference: "Flashcards" frame (Sticker Notebook). The deck is a stack of index-card stickers on graph paper. Cards themselves are calm reading surfaces: plain `--card`, no rotation inside the text, decoration only on the edges (washi tape in the subject colour).

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900. Every state below works at 375 px.

## Data the screen needs
- Subject: `name`, `colour`, `emoji` (sets `--subject` on the page wrapper, see design-system.md "Step 2 additions").
- Cards (not soft-deleted), newest first, 50 per page: `id`, `front`, `back`, `source_quote`, `edited`, `created_at`, plus the source: `chunk_id` → `note_id` or `source_id`, source title (note title or file name), `page` (files). `null` source = written by hand; source deleted = chunk gone but `source_quote` kept.
- Counts: total, due today, new (see review.md "Due today" for the exact definition).
- Quota: `{ used, limit, appAllowanceLeft: boolean }` for kind `flashcards` (limit 5 per day, PLAN section 4). Reset is midnight in `profiles.timezone`.
- Pickable sources for the subject: notes (title, `content_text` length, updated_at) and lecture files with `extract_status = ready` (name, page count).
- Per lecture file, for page ranges (see "Long files" below): `pageChars: number[]` (extracted characters on each page, index 0 = page 1), `looseChars` (characters in passages with no page number; they are sent with every range, so they count against every range's budget), and `fitsOneSet` (total characters ≤ `FLASHCARDS_MAX_CHARS`, currently 14,000). Computed on the server from the passages; the text itself is never sent to the dialog.

## Layout

**Header** (same pattern as the subject page): "← Biology" back link, subject chip (colour + emoji), title "Flashcards" in Permanent Marker, summary line in `--ink-soft`: "48 cards · 12 due today · 6 new".

**Action row** (wraps; on phone each button is full width, stacked in this order):
1. "Review now · 12 due" primary (yellow). With 0 due it becomes a plain button "Nothing due. Practise later" disabled, with hint "Next cards due tomorrow".
2. "Make flashcards" plain, with the quota chip next to it: `3 of 5 left today` (chip; `1 of 5 left today`; at 0 the chip turns `--danger` "0 of 5 left today").
3. "Add a card" plain.

**Card list**: one sticker per card (`.sticker`, radius 8, 4 px offset shadow). A 10 px strip of subject-colour washi tape across the top-left corner, rotated -3° (decorative, `aria-hidden`).
- Laptop/tablet: inside the card, two columns: **Front** | **Back**, each with a small label in `--ink-soft` (14 px, bold, uppercase-free: "Front", "Back"). Phone: stacked, Front then Back, with a dashed `--rule` divider.
- Below: the **source quote** block: left border 4 px `--subject`, `--ink-soft` italic text, max 3 lines with "Show more" (button, `aria-expanded`). Under it a source link: "From **Cell structure** (note)" or "From **Lecture 3.pdf**, page 12". Link opens the passage (see "Source links" below). Hand-made card: chip "Written by you", no quote block. Source deleted: quote still shown, link replaced by chip "Source deleted".
- Chips row: "Edited" (if `edited`), "New" (never reviewed), "Due" (due today).
- Card actions (top-right, 44 px icon buttons with labels "Read card aloud", "Edit card", "Delete card"). On phone the three icons sit in a row under the chips, not top-right, so they never squash the text.
- Laptop: list in a single column, max width 880 px, centred. No masonry: reading order is the visual order.
- After 50 cards: "Show 50 more" button (keeps focus on the first newly loaded card).

**Filter** (above the list, only when there are > 10 cards): select "Show: All cards / Due today / New / From one source…" (the last opens a second select of sources). Filter is remembered per subject in `localStorage`.

## Add a card / edit a card
- "Add a card" inserts an empty card in edit mode at the top of the list. Edit mode: Front textarea (required, ≤ 500 chars) and Back textarea (required, ≤ 1500 chars), both `.input`, auto-growing; live counter appears from 80 % of the limit. Buttons "Save card" (primary) and "Cancel". Ctrl/Cmd+Enter saves, Esc cancels (asks "Discard changes?" only if something was typed).
- Edit uses the same inline form on the existing card; the source quote stays visible but read-only. Saving sets `edited = true` and **does not reset the review schedule** (fixing a typo shouldn't send a card back to day one).
- Errors: empty side → inline "Add some text to the front." / "…to the back.", `aria-invalid`, `boop`. Server failure → "Couldn't save. Try again." on the card, typed text kept.
- Saved: card pops (350 ms spring), toast "Card saved", `pop`.

## Delete
- Delete icon → inline confirm inside the card (no dialog, keeps context): "Delete this card?" with "Delete" (danger) and "Keep". Confirm: card collapses (200 ms), `tear`, toast "Card deleted" with **Undo** (6 s, toast is focusable and announced). Soft delete via `deleted_at`; Undo clears it and restores the schedule.
- Focus after delete goes to the next card's first action, or the "Add a card" button if it was the last.

## "Make flashcards" flow
Opens as a dialog (`dialog.sheet`, max 520 px; phone: full width with 16 px gutter, scrolls inside). Also reachable from the note editor and from a ready file row on the subject page; those open the dialog with the source already chosen (step 1 skipped, but "Change source" link shown).

**Step 1: Choose source.** Title "Make flashcards". Radio list grouped "Notes" and "Lecture files" (each row: icon, title, "updated 2 days ago" or "42 pages"). Disabled rows with reasons: file still reading ("Still reading text…"), no text ("No text found"). For a long file (more text than one set can read), the page range fields appear under the selected row; see "Long files: page ranges and series" below. Files that fit in one set show no page fields, exactly as before. Number of cards: segmented radio "About 10 / 15 / 20" (default 10). Quota line at the bottom: chip `3 of 5 left today` + hint "Making cards from the same text again is free." Button "Make flashcards" (primary).

**Step 2: Generating.** Dialog body swaps to a stack of three blank index-card stickers that gently shuffle (each card tilts ±2° and lifts 4 px in turn, 1.2 s loop). Line under it rotates every 3 s (for a file range the first line is "Reading pages 7–12…" instead): "Reading your notes…" → "Picking out the key ideas…" → "Writing questions…" → "Nearly there…". The rotating lines are decorative (`aria-hidden`); a polite live region announces "Making flashcards. This takes about 15 seconds." once. The dialog can be closed: copy under the animation "You can close this. We'll tell you when they're ready." If closed, a toast arrives on completion: "12 new Biology cards are ready" with a "See cards" link. No sound while generating.

**Step 3: Result.** Title "12 new cards! ✨" (`pop`). Cards are saved immediately (nothing lost if the student navigates away). The dialog shows a compact scrollable list of the new cards (front, back, quote first line) each with "Edit" and "Remove" (remove = soft delete, no confirm, Undo in the row). Buttons "Start reviewing" (primary, goes to review for this subject) and "Done" (closes, deck list shows the new cards with a "New" chip and a 1.5 s `--highlight` glow on the first one). Quota chip updates to "2 of 5 left today". For a long file, the result step also shows the series progress and a "Next: pages 7–12" button (see below).

### Long files: page ranges and series
Goal: a student can turn a whole long lecture PDF into cards, one set after another, with every passage covered. One set can only read about 14,000 characters (`FLASHCARDS_MAX_CHARS`, the free AI plan's limit), roughly 5–8 dense pages.

**When the fields show.** Only when the selected file has `fitsOneSet = false` (its text is longer than one set's budget), whatever its page count. A 15-page dense file gets fields; a 40-page slide deck with little text that fits in one set does not. PPTX files say "slides" instead of "pages" in every string below.

**Fit rule** (one shared pure function, e.g. `fitPageRange(pageChars, looseChars, from, budget)` in `src/lib/`, used by the dialog for hints and by the server for the authoritative answer): starting at `from`, extend `to` page by page while `looseChars + sum(pageChars[from..to]) ≤ budget` and the range stays ≤ 20 pages (`MAX_CARD_PAGES`, still the hard cap). The range is always at least one page. Pages with no text cost nothing and are swallowed into the range. A range is **covered** when its characters fit the budget, otherwise **sampled** (the existing `fitPassages` even spread).

**Step 1 layout** (under the selected file row, inside the form):
```
Pages  [  1 ]  to  [  6 ]  of 42
Covers every passage on pages 1–6.
```
- Legend "Pages" (`.label`), two `.input` number fields `w-24` (`inputmode="numeric"`, labels "First page" / "Last page", sr-only), then "of 42" in `--ink-soft`. At 375 px the row wraps after "to" only if it must; the hint is always full width below.
- **Default range:** from the first page not yet made for this file (see "Remembering where you got to"), else page 1, up to the last page that still fits (the fit rule). Changing "First page" re-fits "Last page" automatically; editing "Last page" by hand is respected (it may go past the budget, up to 20 pages).
- **Hint** (`.hint`, updates as the numbers change, linked to both inputs by `aria-describedby`):
  - Covered: "Covers every passage on pages 1–6."
  - Sampled: "Long range: cards will come from across pages 1–20. Pick fewer pages to cover every passage." followed by a text button "Use pages 1–6" (underlined, 44 px tall hit area) that snaps "Last page" back to the fit. `click`.
  - One page alone is over the budget: "Page 9 is long: cards will come from across it." (no snap button; nothing smaller exists).
  - Range has very little text (under `MIN_SOURCE_CHARS`): "These pages don't have much text. Add a page or two." The button stays enabled; the server's "too little text" message still applies.
  - No per-page counts (`pageChars` missing, e.g. an older upload): fields show `1` to `min(pageCount, 20)` and the hint reads "Cards will come from across the pages you pick." No coverage claim is made.
- **Quota line** for long files adds the cost: chip `3 of 5 left today` + hint "Each set of pages uses one go. Making cards from the same pages again is free."
- **Validation** (inline under the fields, `aria-invalid` on the field, `boop` on submit, never while typing): "Pick a page between 1 and 42.", "The last page comes before the first.", "Up to 20 pages at a time." Submit does nothing until fixed; focus moves to the first invalid field.

**Generating.** Same animation. Live region: "Making flashcards from pages 7–12. This takes about 15 seconds." Background toast: "12 new Biology cards from pages 7–12 are ready" + "See cards".

**Result step additions** (only for a long file; between the card list and the buttons):
- Progress: `ProgressBar` (8 px track `--grid` with 2 px `--ink` border, fill `--subject`, radius 999; fill animates width 400 ms ease-out, none under reduced motion) with the text above it: "Pages 1–6 of 42 done". The text is the accessible value; the bar is `aria-hidden`. "Done" means the furthest page made so far in this series (a sampled range still counts as done up to its last page, and the line adds "(some passages sampled)").
- **Pages left, goes left:** button "Next: pages 7–12" becomes the **primary** (yellow) button; "Start reviewing" drops to plain; "Done" stays ghost. Phone order (stacked, full width): Next, Start reviewing, Done. Under the button: hint "Uses 1 of your 2 goes left today." Clicking it (`click`) returns to Step 1 with the same file and card count, the source list collapsed ("From **Lecture 3.pdf**. Change source"), and the range pre-filled with the server's `next` range (fit rule from the page after this one). Focus goes to the "Make flashcards" button so it is literally one more press. The cards just made stay in the deck.
- **Pages left, no goes left** (this set used the last one): no Next button; hint in its place: "That was today's last go. Pages 7–12 are next, tomorrow." "Start reviewing" stays primary.
- **Every page done:** progress reads "All 42 pages done. Nice work!" with the bar full; buttons as before ("Start reviewing" primary, "Done"). No extra sound (the result's `pop` already played).
- The trailing pages have no text: treated as done (the server's `next` is `null`).

**Remembering where you got to.** After each made set, the dialog stores the furthest page made for that file in `localStorage` (`studynest:cardRange:<sourceId>` = last page; every read and write in try/catch). Next time the student picks that file, the default range starts on the following page and the hint gains a first line: "Last time you got to page 6." With storage empty or blocked the default is page 1; nothing breaks. Changing the range by hand is always allowed (going back to pages 1–6 again is free if the text is unchanged, via the existing "already" rule).

**Server must return** with `status: "made"` (and `"already"` for files): `range {from, to}`, `covered: boolean`, `pageCount`, and `next: {from, to} | null` computed with the same fit rule. The dialog never invents the next range on its own when the server has given one.

**Messages** (each replaces the dialog body, ink text on a sticker, one illustration emoji, the matching button; never red walls of text):
| Case | Copy | Button | Sound |
|---|---|---|---|
| Too little text (source under `MIN_SOURCE_CHARS`, suggested 200) | "This note is a bit short for flashcards. Add a paragraph or two and try again." (file: "This file doesn't have enough text for flashcards.") | "Pick another source" | `boop` |
| Student's daily limit used (0 of 5) | "You've made all 5 sets of flashcards for today. More tomorrow! You can still add cards by hand." | "Add a card by hand", "Close" | `boop` |
| App-wide free allowance used up | "Today's free AI allowance is used up. Try again tomorrow. Your notes and cards are safe." | "Close" | `boop` |
| Already made from this exact text (cache hit and the cards are still in the deck) | "You already made cards from this version of the note. Change the note or pick another source." (file range: "You already made cards from pages 1–6. Try the next pages or another source.") Free, no quota used. | "Show those cards", "Pick another source"; for a file with pages left, "Next: pages 7–12" (primary) is added first | none |
| AI failed / bad output / network | "The card maker got muddled. Try again. This one didn't use up a go." | "Try again" | `boop` |
| AI returned fewer cards than asked | Shown as a normal result with a hint: "Your notes had enough for 6 cards." | | |

When the limit is already 0 before opening, the "Make flashcards" button stays enabled (so the reason is discoverable) and the dialog opens straight onto the limit message.

Quota rules the developer must match: only **successful, non-cached** generations count; failed ones don't. The chip always shows what the server says, refreshed after each generation.

## Source links
Every source link uses the shared passage view so cards, mindmap nodes (and Step 3 quiz and chat citations) behave the same:
- **Note:** `/subjects/[id]/notes/[noteId]?quote=<chunkId>`. The editor scrolls to the passage and marks it with `<mark>` styling (`--highlight` background, `--on-colour` text) for 4 s, then fades to nothing (reduced motion: mark stays until the first keypress). If the quote text can't be found any more (the note changed): banner at the top "This passage has changed since the card was made." with the original quote shown in the banner.
- **Lecture file:** `/subjects/[id]/sources/[sourceId]?quote=<chunkId>`: new read-only page showing the extracted text page by page ("Page 12" headings), scrolled to the marked passage, with "Open the original file" (signed URL, `#page=12` appended for PDFs, new tab). Same `<mark>` styling. Header: subject chip, file name, "← Biology".

## States
- **Loading:** header renders, then three card skeletons (`--grid` blocks, no shimmer under reduced motion).
- **Empty deck:** big marker line "No flashcards yet", sub-line "Make some from your notes in one tap, or write your own.", buttons "Make flashcards" (primary) and "Add a card". If the subject has no notes or ready files: sub-line "Add a note or a lecture file first, then make cards from it." with "Back to Biology".
- **Error loading:** sticker "We couldn't load your flashcards." + "Try again".
- **Filter with no results:** "No cards match this filter." + "Show all cards".

## Sounds
`click` on every button; `pop` when cards are made or a card is saved; `boop` on inline errors and the messages table; `tear` on delete. Nothing during generation. All silent in focus mode except `chime`. Long files: `click` on "Next: pages 7–12" and "Use pages 1–6"; `boop` only when an invalid range is submitted; no sound when the hint switches between covered and sampled or when fields re-fit.

## Accessibility
- Each card is an `<article>` with `aria-labelledby` its front text. Front/Back labels are real text, not just layout.
- Icon buttons have names that include the card ("Edit card: What does the mitochondria do?" truncated to 40 chars).
- Generating state: dialog keeps focus on its close button; the result title receives focus when it arrives.
- Quota chip text is the full sentence ("3 of 5 left today"), never colour alone.
- Subject emoji: `role="img"` + `aria-label` the subject name.
- Page range: the coverage hint sits in a polite live region, announced 600 ms after the last keystroke (not on every digit). The Next button's accessible name is "Make the next set: pages 7 to 12"; the progress text is plain text, never the bar alone. All page strings use an en dash visually; screen-reader names use "to".

## Changelog
- 2026-10-15: Long lecture files can be made into a series of sets. Page range shows whenever a file has more text than one set (not only > 20 pages), defaults to what fits, says whether the range is fully covered or sampled; the result step shows "Pages 1–6 of 42 done" and a "Next: pages 7–12" button. Files that fit in one set are unchanged.
