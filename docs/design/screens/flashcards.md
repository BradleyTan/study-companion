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

**Step 1: Choose source.** Title "Make flashcards". Radio list grouped "Notes" and "Lecture files" (each row: icon, title, "updated 2 days ago" or "42 pages"). Disabled rows with reasons: file still reading ("Still reading text…"), no text ("No text found"). For a long file (more text than one set can read), the page range fields and quick picks appear under the selected row; a file that fits in one set shows a "Choose pages" link instead (whole file by default). See "Long files: page ranges and series" below. Number of cards: segmented radio "About 10 / 15 / 20" (default 10). Quota line at the bottom: chip `3 of 5 left today` + hint "Making cards from the same text again is free." Button "Make flashcards" (primary).

**Step 2: Generating.** Dialog body swaps to a stack of three blank index-card stickers that gently shuffle (each card tilts ±2° and lifts 4 px in turn, 1.2 s loop). Line under it rotates every 3 s (for a file range the first line is "Reading pages 7–12…" instead): "Reading your notes…" → "Picking out the key ideas…" → "Writing questions…" → "Nearly there…". The rotating lines are decorative (`aria-hidden`); a polite live region announces "Making flashcards. This takes about 15 seconds." once. The dialog can be closed: copy under the animation "You can close this. We'll tell you when they're ready." If closed, a toast arrives on completion: "12 new Biology cards are ready" with a "See cards" link. No sound while generating.

**Step 3: Result.** Title "12 new cards! ✨" (`pop`). Cards are saved immediately (nothing lost if the student navigates away). The dialog shows a compact scrollable list of the new cards (front, back, quote first line) each with "Edit" and "Remove" (remove = soft delete, no confirm, Undo in the row). Buttons "Start reviewing" (primary, goes to review for this subject) and "Done" (closes, deck list shows the new cards with a "New" chip and a 1.5 s `--highlight` glow on the first one). Quota chip updates to "2 of 5 left today". For a set made from a page range, the result step also shows "Skipped N cards you already have." when some were skipped, the pages-covered progress and a "Next: pages 21–40" button (see below).

### Long files: page ranges and series
Goal: a student can pick exactly which pages become a set (up to 50 at a time), go through a long lecture PDF set after set ("pages 1–20, then 21–40…"), and overlap sets if they like ("1–20, then 15–34") without getting the same card twice. One set is **one AI request** that reads about 14,000 characters (`FLASHCARDS_MAX_CHARS`, the free AI plan's limit), roughly 5–8 dense pages. A wider range is a **quick sample**: the cards are spread evenly across all the pages chosen (the existing `fitPassages` even spread). There is no multi-request "read everything" mode.

**When the fields show.**
- File with `fitsOneSet = false` (more text than one set reads), whatever its page count: fields always shown, as before.
- File that fits one set and has 2 or more pages/slides: no fields by default (the whole file is sent, exactly as before), but a text button "Choose pages" (underlined, 44 px hit area, `click`) sits under the selected row. It reveals the same fields pre-filled with the whole file (`1` to page count) and turns into "Use the whole file", which hides them again and sends the file whole.
- PPTX files say "slides" instead of "pages" in every string below.

**Limits.** `MAX_CARD_PAGES` = **50** (was 20): the hard cap per set, in zod (`makeFlashcardsInput`), in `rangeError` and in the fit rule. Any `from`/`to` inside the file is allowed, including ranges that overlap sets already made.

**Fit rule** (unchanged, `fitPageRange(pageChars, looseChars, from, budget, maxPages)` in `src/lib/page-range.ts`, shared by dialog and server): from `from`, extend `to` page by page while `looseChars + sum(pageChars[from..to]) ≤ budget` and the range stays ≤ `MAX_CARD_PAGES`. Always at least one page; pages with no text cost nothing and are swallowed. A range is **covered** when its characters fit the budget, otherwise **sampled**.

**Step 1 layout** (under the selected file row, inside the form):
```
Pages  [  1 ]  to  [ 20 ]  of 42
[ Best fit ] [ 20 pages ] [ 50 pages ]        <- quick picks (.seg)
Cards will be spread across pages 1–20, a quick tour of the lot.
Want every passage? Use pages 1–6
```
- Legend "Pages" (`.label`), two `.input` number fields `w-24` (`inputmode="numeric"`, labels "First page" / "Last page", sr-only), then "of 42" in `--ink-soft`. At 375 px the row wraps after "to" only if it must; quick picks and hint are always full width below.
- **Quick picks**: one row in the existing `.seg` style (same look as the card-count control), wrapped in `role="group"` with `aria-label="Quick pick for pages"`. Three `<button type="button">` with `aria-pressed` (pressed = the fields currently equal that pick's range), each ≥ 44 px tall, `click` on press. They keep "First page" and only set "Last page", except "All":
  1. **"Best fit"**: `to` = fit rule from the current `from` (every passage covered). Hidden when there are no per-page counts.
  2. **"20 pages"**: `to = min(pageCount, from + 19)`.
  3. **"50 pages"**: `to = min(pageCount, from + 49)`. When the whole file is ≤ 50 pages this chip is instead **"All 42 pages"** (sets `from = 1`, `to = pageCount`).
  - A pick whose range equals an earlier pick's range is hidden (e.g. a 15-page file shows "Best fit" and "All 15 pages" only). If only one pick would remain, the row is not shown.
  - Accessible names say the range: "Best fit: pages 7 to 12", "20 pages: pages 7 to 26", "All 42 pages". At 375 px the three chips fit on one line (≈ 104 px each); if the text is zoomed they wrap, never scroll.
- **Default range** (unchanged rule): from the first page not yet made for this file (see "Remembering where you got to"), else page 1, up to the last page that still fits (the fit rule, so "Best fit" is pressed). Without per-page counts: `1` to `min(pageCount, 20)`, "20 pages" pressed. Coming from a Next button: the server's `next` range (see below). Changing "First page" re-fits "Last page" using the **currently pressed pick** (Best fit → fit rule, 20/50 → same size from the new first page; none pressed → keep the current size, clamped to the file). Editing "Last page" by hand is always respected, up to 50 pages.
- **Hint** (`.hint`, updates as the numbers change, linked to both inputs by `aria-describedby`). Never warning-coloured: a wide range is a good choice, not a mistake.
  - Covered: "Covers every passage on pages 1–6."
  - Sampled: "Cards will be spread across pages 1–20, a quick tour of the lot." On a second line, when a covered fit exists from the same first page: "Want every passage?" followed by the text button "Use pages 1–6" (underlined, 44 px tall hit area, `click`) that sets "Last page" to the fit (and presses "Best fit").
  - One page alone is over the budget: "Page 9 has lots of text, so cards will be spread across it." (no snap button; nothing smaller exists).
  - Range has very little text (under `MIN_SOURCE_CHARS`): "These pages don't have much text. Add a page or two." The button stays enabled; the server's "too little text" message still applies.
  - No per-page counts (`pageChars` missing, e.g. an older upload): "Cards will be spread across the pages you pick." No coverage claim.
  - Range overlaps pages already made (from the remembered coverage, see below) and adds new ones: extra line "Cards you already have will be skipped." Range entirely inside pages already made: "You've made cards from these pages before. Cards you already have will be skipped." Neither line blocks anything.
- **Quota line** for long files adds the cost: chip `3 of 5 left today` + hint "Each set of pages uses one go, however many pages. Making cards from the same pages again is free."
- **Validation** (inline under the fields, `aria-invalid` on the field, `boop` on submit, never while typing): "Pick a page between 1 and 42.", "The last page comes before the first.", "Up to 50 pages at a time." Submit does nothing until fixed; focus moves to the first invalid field.

**Generating.** Same animation. First rotating line "Reading pages 7–12…" (sampled range: "Skimming pages 1–50…"). Live region: "Making flashcards from pages 7–12. This takes about 15 seconds." Background toast: "12 new Biology cards from pages 7–12 are ready" + "See cards".

**Overlapping ranges: no duplicate cards.** Before saving, the server drops any generated card whose front matches a card already in this subject **from the same file** (not soft-deleted). Match = fronts equal after normalising: trim, lower-case, collapse runs of whitespace to one space, strip trailing `?.!:` and spaces. Cards written by hand or from other sources are never compared. Dropped cards are not saved and are reported as `skipped: number` in the `made` result (also `0` when nothing was skipped). If **every** generated card was skipped, nothing is saved, the go is given back (settled as failed, same as a failed generation; it still counts toward the daily tries cap) and the "All already in your deck" message below is shown.

**Result step additions** (for any set made from a page range; between the card list and the buttons):
- **Skipped line** (only when `skipped > 0`): hint under the title, `--ink-soft`, no icon, no sound: "Skipped 4 cards you already have." (singular "Skipped 1 card you already have."). When it shows, the "Your notes had enough for 6 cards." hint is not shown (the skip explains the shortfall).
- **Progress**: `ProgressBar` (8 px track `--grid` with 2 px `--ink` border, fill `--subject`, radius 999; fill animates width 400 ms ease-out from the previous value, none under reduced motion). The text above it is the accessible value; the bar is `aria-hidden`. It is based on **pages covered**: the union of every range made for this file (overlaps counted once; sampled ranges count all their pages; pages after the last page with text count as done once the last text page is in the union).
  - Union is one run starting at page 1: "Pages 1–34 of 42 done".
  - Anything else (gaps, or not starting at 1): "26 of 42 pages done".
  - Add " (some passages sampled)" when any range in the union was sampled.
  - Bar value = pages in the union / page count.
  - Everything covered: "All 42 pages done. Nice work!", bar full, no Next button.
- **Next button** (pages not yet in the union, goes left): "Next: pages 21–40" becomes the **primary** (yellow) button; "Start reviewing" drops to plain; "Done" stays ghost. Phone order (stacked, full width): Next, Start reviewing, Done. Under it: hint "Uses 1 of your 2 goes left today." ("Uses your last go for today." with 1 left). Clicking it (`click`) returns to Step 1 with the same file and card count, the source list collapsed ("From **Lecture 3.pdf**. Change source"), the range pre-filled with the server's `next` and the matching quick pick pressed. Fields and quick picks stay fully editable before making. Focus goes to the "Make flashcards" button so it is one more press. The cards just made stay in the deck.
- **Next follows the size the student chose** (server computes `next`, dialog never invents it when the server gave one):
  - The set was the **best fit** (its `to` equals `fitPageRange(from).to`): next = fit rule from the page after `to` (unchanged behaviour, e.g. 1–6 → 7–12).
  - Otherwise **same size**: `size = to − from + 1`; next = `{ from: to + 1, to: min(pageCount, to + size) }`. 1–20 → 21–40 → 41–42. 15–34 in a 42-page file → 35–42 (clamped to the last page).
  - `next` is `null` when no page after `to` has text (or `to = pageCount`).
  - Next continues from the end of the set just made, not from the first gap; the student can type any range to fill a gap.
- **Pages left, no goes left**: no Next button; hint: "That was today's last go. Pages 21–40 are next, tomorrow." "Start reviewing" stays primary.
- Progress text and the Next range can disagree (e.g. gap before the set just made): fine, the progress line is about the whole file, Next is about "carry on from here".

**Remembering where you got to.** The dialog stores the union of ranges made per file in `localStorage` at `studynest:cardRanges:<sourceId>` = JSON array of merged, sorted `[from, to]` pairs (every read and write in try/catch; invalid JSON = empty). One-time read of the old key `studynest:cardRange:<sourceId>` (a number `n`) as `[[1, n]]`, then it is removed. After each made set (and an "already" answer for a range) the range is merged in. Next time the student picks the file, the default range starts at the first page not in the union that has text (else page 1), and the hint gains a first line: "You've made cards from pages 1–20 so far." (one run from 1) or "You've made cards from 26 of 42 pages so far." With storage empty or blocked the default is page 1, the overlap lines are not shown and progress counts only this dialog's sets; nothing breaks. Coverage lives in the browser only (not shared across devices); that is accepted for now.

**Server must return** with `status: "made"` (and `"already"` for files): `range {from, to}`, `covered: boolean`, `pageCount`, `next: {from, to} | null` (rule above) and, for `made`, `skipped: number`.

**Messages** (each replaces the dialog body, ink text on a sticker, one illustration emoji, the matching button; never red walls of text):
| Case | Copy | Button | Sound |
|---|---|---|---|
| Too little text (source under `MIN_SOURCE_CHARS`, suggested 200) | "This note is a bit short for flashcards. Add a paragraph or two and try again." (file: "This file doesn't have enough text for flashcards.") | "Pick another source" | `boop` |
| Student's daily limit used (0 of 5) | "You've made all 5 sets of flashcards for today. More tomorrow! You can still add cards by hand." | "Add a card by hand", "Close" | `boop` |
| App-wide free allowance used up | "Today's free AI allowance is used up. Try again tomorrow. Your notes and cards are safe." | "Close" | `boop` |
| Already made from this exact text (cache hit and the cards are still in the deck) | "You already made cards from this version of the note. Change the note or pick another source." (file range: "You already made cards from pages 1–6. Try the next pages or another source.") Free, no quota used. | "Show those cards", "Pick another source"; for a file with pages left, "Next: pages 7–12" (primary, same size rule) is added first | none |
| Every card from an overlapping range is already in the deck (`skipped` = all) | "Every card from pages 15–34 is already in your deck. Try some new pages. This one didn't use up a go." | "Next: pages 35–42" (primary, if pages are left and goes remain), "Close" | none |
| AI failed / bad output / network | "The card maker got muddled. Try again. This one didn't use up a go." | "Try again" | `boop` |
| AI returned fewer cards than asked | Shown as a normal result with a hint: "Your notes had enough for 6 cards." (not shown when the "Skipped N cards you already have." line is shown) | | |

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
`click` on every button; `pop` when cards are made or a card is saved; `boop` on inline errors and the messages table; `tear` on delete. Nothing during generation. All silent in focus mode except `chime`. Long files: `click` on "Next: pages 21–40", "Use pages 1–6", "Choose pages" / "Use the whole file" and each quick pick; `boop` only when an invalid range is submitted; no sound when the hint switches between covered and sampled, when fields re-fit, or for the skipped line. The "all already in your deck" message has no sound (nothing went wrong).

## Accessibility
- Each card is an `<article>` with `aria-labelledby` its front text. Front/Back labels are real text, not just layout.
- Icon buttons have names that include the card ("Edit card: What does the mitochondria do?" truncated to 40 chars).
- Generating state: dialog keeps focus on its close button; the result title receives focus when it arrives.
- Quota chip text is the full sentence ("3 of 5 left today"), never colour alone.
- Subject emoji: `role="img"` + `aria-label` the subject name.
- Page range: the coverage hint sits in a polite live region, announced 600 ms after the last keystroke (not on every digit). Quick picks are a labelled group of `aria-pressed` buttons whose names include the range ("20 pages: pages 21 to 40"). The Next button's accessible name is "Make the next set: pages 21 to 40"; the progress text and the skipped line are plain text (the skipped line is inside the result region the title focus brings into reading order), never the bar alone. All page strings use an en dash visually; screen-reader names use "to".

## Changelog
- 2026-10-15: Long lecture files can be made into a series of sets. Page range shows whenever a file has more text than one set (not only > 20 pages), defaults to what fits, says whether the range is fully covered or sampled; the result step shows "Pages 1–6 of 42 done" and a "Next: pages 7–12" button. Files that fit in one set are unchanged.
- 2026-10-17: Bradley's request: pick any pages for a set, up to 50 (`MAX_CARD_PAGES` 20 → 50), overlaps allowed. Quick picks "Best fit / 20 pages / 50 pages (or All N pages)"; wide ranges are a quick sample with a positive hint ("Cards will be spread across…"). Next keeps the size the student chose (1–20 → 21–40; best fit keeps the fit rule). Overlapping sets skip cards already in the deck from the same file ("Skipped N cards you already have."); all skipped gives the go back. Progress counts pages covered (union of ranges, stored as `studynest:cardRanges:<id>`). Files that fit one set get an optional "Choose pages" link.
