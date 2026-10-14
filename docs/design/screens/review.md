# Screen: Review session (`/subjects/[id]/review` and `/review`) + due-today counts

Step 2. Spaced repetition with FSRS (`ts-fsrs`). `/subjects/[id]/review` reviews one subject; `/review` (from the Subjects page banner) mixes every subject's due cards, each card wearing its own subject chip and tape colour. Same component, optional subject filter.

The session is the calmest screen in the app: one card, four buttons, nothing else moving. The fun comes at the end.

## Scheduling rules the developer must match
- One `fsrs()` scheduler with default parameters, `request_retention: 0.9`, **`enable_fuzz: false`** so the interval shown on a button is exactly the one saved. (Fuzz can come later with server-side previews.)
- **Queue** at session start: cards due now (learning, relearning, review with `due_at ≤ now`), then review cards due later today (`due_at ≤` end of the local day in `profiles.timezone`), then new cards up to the daily new-card allowance (**20 new cards per student per day**, constant `NEW_CARDS_PER_DAY`). Order: due cards oldest-due first, new cards oldest first, never two cards from the same source quote back to back when avoidable.
- A card graded **Again** (or any grade whose next due is within 20 minutes) goes back into this session's queue and returns when due, or at the end of the queue if nothing else is left.
- **Due today** (used by every count in the app) = cards with `due_at ≤` end of today local time + new cards, capped at what's left of today's new-card allowance.
- Server is the source of truth: the client sends `{ flashcardId, rating }`; the server recomputes with its own clock and saves a `card_reviews` row (rating, reviewed_at, stability, difficulty, due_at, state). The response returns the card's new due time so the queue can update.
- **Undo** deletes the last `card_reviews` row for that card (card state comes from the previous row, or "new" if none) and puts the card back in front.

## Layout
**Top bar** (slim, not the full app bar): "✕ End" (left, ghost button), subject chip (single subject) or "All subjects", and on the right the progress: "7 done · 13 to go" + a 6 px progress bar (`--highlight` fill, ink outline) across the full width under the bar. The bar can move backwards a little when cards come back after Again; that's fine. Percentage is exposed to screen readers via `role="progressbar"` with `aria-valuetext="7 of 20 cards done"`.

**Card area:** one big index card, centred.
- Size: phone 100 % width (16 px gutter) × min 320 px tall; tablet 560 px wide; laptop 640 × 400 px. Text 20 px (front) / 18 px (back), centred vertically, left-aligned when longer than two lines, max 65ch, scrolls inside the card if very long.
- Behind it two decorative card edges (rotated -2° and 1.5°, `aria-hidden`) so it reads as a stack. They disappear on the last card.
- Subject-colour tape strip at the top edge with the emoji.
- Front face: the question + hint at the bottom in `--ink-soft`: "Tap or press Space to flip". Back face: the answer, a dashed divider, then the source quote (left border `--subject`, italic, 3 lines max with "Show more") and "From Cell structure" link (opens the passage in a new tab, so the session isn't lost).
- Small corner buttons on the card (44 px): "Read aloud" (see read-aloud.md) and "Edit card" (opens the same inline editor as the deck, in a dialog; saving keeps the session going).

**Grade row** (only after the flip; before the flip a single primary button "Show answer" sits in the same place, so the layout doesn't jump):
Four sticker buttons in one row on tablet/laptop, a 2 × 2 grid on phone (Again | Hard / Good | Easy). Each button: label (bold), next interval below it (14 px), and the shortcut number in a small key cap top-left (hidden on touch-only devices via `@media (hover: none)`).

| Button | Fill token | Example sub-line | Key |
|---|---|---|---|
| Again | `--grade-again` | in 1 min | 1 |
| Hard | `--grade-hard` | in 6 min | 2 |
| Good | `--grade-good` | in 1 day | 3 |
| Easy | `--grade-easy` | in 4 days | 4 |

All four use `--on-colour` text and ink outline, so they pass AA in both themes and never rely on colour (each has its word). Interval format: "in 1 min", "in 10 min", "in 3 h", "in 1 day", "in 4 days", "in 2 wk", "in 3 mo", "in 1 yr" (round to the nearest unit; never show seconds).

Under the grade row, small ghost button "Undo" (only after at least one grade).

## Motion (Framer Motion)
- **Flip:** `rotateY` 0 → 180°, 420 ms, `cubic-bezier(.3,1.3,.5,1)` (tiny overshoot, settles flat), `perspective: 1200px`, `backface-visibility: hidden` on both faces. The hidden face is `inert` and `aria-hidden`.
- **Grade → next card:** current card slides 24 px left and fades (200 ms), the next one rises from the stack (8 px up, 250 ms spring). Pressing a grade button uses the normal sticker press.
- **Reduced motion:** flip becomes a 150 ms crossfade; next card appears with a 150 ms fade; no stack wobble; confetti replaced (see below).
- **Focus mode** (timer running, Step 4): same as reduced motion, plus no confetti and no sounds except `chime`.

## Sounds
- Flip: `flip` (the page-turn).
- Grade button: `click`. The last grade of the session plays `cheer` instead of `click` (one sound per action, never both).
- Undo: `click`. Errors: `boop`.
- No `boop` for Again: forgetting a card is normal, not a mistake.
- When read-aloud is speaking, the flip sound still plays and speech starts 150 ms after it.

## Keyboard
| Key | Action |
|---|---|
| Space or Enter | Flip (front) |
| 1 / 2 / 3 / 4 | Again / Hard / Good / Easy (only after flip; before flip they do nothing) |
| U | Undo last grade |
| R | Read the visible side aloud |
| E | Edit this card |
| Esc | End session (progress is already saved, no confirm) |
| ? | Shortcuts dialog |

Shortcuts are ignored while focus is in a text field or a dialog is open. All actions are also buttons, so nothing needs the keyboard. The "?" dialog is also reachable by a "Keyboard shortcuts" ghost button in the top bar on laptop.

**Focus order:** after flipping, focus moves to "Good" (the most common answer) and the back face text is announced via a polite live region ("Answer: …"). After grading, focus moves to "Show answer" on the next card and the new front is announced ("Card 8. Question: …").

## End of session
When the queue is empty:
- Confetti burst from the top centre: 40 paper pieces (squares and strips) in the subject colour(s) + `--highlight`, 1.2 s, falling with slight spin, built in-house with Framer Motion (no library needed; nothing to pay for). `pointer-events: none`, `aria-hidden`. Reduced motion or focus mode: no confetti, a single star sticker pops in place (no movement under reduced motion, just appears).
- Summary sticker (tape on top): marker title "Deck done!" with sub-line "You reviewed 20 cards in 9 minutes." Then three small stat stickers in a row (stacked on phone): "Remembered: 16" (Good + Easy), "Tricky: 3" (Hard), "Again: 1". Line: "Next up: 14 cards tomorrow." (or "Nothing due for 3 days. Nice."). Encouraging sign-off chosen by how it went: mostly Good/Easy "You know this stuff!"; lots of Again "Tough deck. That's exactly how it sticks."
- Buttons: "Back to Biology" (primary) and, on `/review` or when other subjects have cards due, "Review Chemistry · 8 due".
- Live region announces "Session complete. You reviewed 20 cards."

**Ended early** (Esc / "End"): no confetti; small summary "Saved! You reviewed 7 cards. 13 are still waiting." with "Keep going" and "Back to Biology".

## States
- **Loading:** card skeleton + disabled "Show answer".
- **Nothing due:** marker line "All caught up!", sub-line "Nothing to review right now. Next: 6 cards tomorrow." (or "…on Friday"), buttons "Make more flashcards" and "Back to Biology". `/review` version: "Nothing due in any subject."
- **No cards at all:** "No flashcards yet" with "Make flashcards" (goes to the deck).
- **Saving a grade failed:** the card stays, toast "Couldn't save that answer. Trying again…" with retry (3 tries with backoff); after that: "You're offline. Answers will save when you're back." Grades are queued in memory and sent in order; the session can continue. Leaving the page with unsent grades warns.
- **Card deleted elsewhere / edited mid-session:** skip silently / show the new text.

## Due-today counts elsewhere
- **Subjects page banner** (above the grid, only when due > 0): sticker with tape, "📚 12 cards to review today", sub-line "Biology 8 · Chemistry 4" (top 3 subjects, then "+2 more"), primary "Start review" → `/review`. Phone: full width, button full width under the text. Hidden when nothing is due; when the student has reviewed today and nothing is left, show a slim line instead: "All caught up for today ✓" (dismissible for the day).
- **Subject stickers on the Subjects page:** a chip on the sticker "12 due" (`--highlight` fill, ink text), next to "3 notes · 2 files". No chip at 0.
- **Subject page:** the study tools row (see subject.md).
- Counts are computed server-side with the rule above and refreshed on navigation; no polling.

## Accessibility
- The card is a region (`aria-roledescription="flashcard"`), not a button, because it contains the Read aloud and Edit buttons. Tapping anywhere else on the front flips it (pointer convenience); the accessible control is the "Show answer" button, whose name includes the question ("Show answer. Question: …").
- Grade buttons are a `role="group"` labelled "How well did you remember it?"; each button's name includes the interval ("Good, next review in 1 day").
- Progress text is visible, not only the bar.
- Contrast: card text `--ink` on `--card` (≥ 12:1 light, ≥ 11:1 dark); grade fills with `--on-colour` ≥ 7:1.
