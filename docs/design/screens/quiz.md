# Screen: Taking a quiz + results (`/subjects/[id]/quizzes/[quizId]`)

Step 3. Built like the review session (review.md): a slim top bar, one question sticker in the middle, one big button underneath, nothing else moving. The fun is in the feedback and the results. No timer: quizzes are for learning, not racing.

Widths: **phone** < 640 px (designed at 375), **tablet** 640–899, **laptop** ≥ 900.

## Data the screen needs
- Subject `name`, `colour`, `emoji`; quiz `title`, `kind`.
- Questions (not removed) in this attempt's order: `id`, `type` (`mcq` / `fill`), `prompt`, `options` (mcq, 4, already shuffled for this attempt), `topic`. The **answer, accepted alternatives and explanation are not sent until the student has answered that question** (the check is a server action), so the answers can't be read from the page.
- Attempt: `id`, answers so far (resume), `started_at`.
- After each check, the server returns `{ correct, answer, explanation, sourceQuote, sourceHref (passageHref), sourceLabel ("Lecture 3.pdf, page 12"), topic }`.

## Rules the developer must match
- **Attempt:** starting creates a `quiz_attempts` row; each check saves an `answers` row at once (`given`, `correct`) with a client key so a double tap can't answer twice. Leaving and coming back resumes at the first unanswered question. Retake = new attempt, questions and MCQ options reshuffled.
- **Fill-in matching** (server, shared function with unit tests): compare after normalising both sides: trim, lower-case, remove diacritics, collapse spaces, drop a leading "the/a/an", strip trailing punctuation; numbers compare by value and the unit must match if the answer has one ("25 °C" = "25°C" = "25 degrees C"); singular/plural of the last word accepted; for answers of 6+ letters, one typo (edit distance 1) is accepted and shown as "Correct! (watch the spelling: *mitochondria*)". Any accepted alternative counts.
- **"I was right" override** (accuracy safety net): on a wrong fill-in, a small text button "I think my answer is right" marks it correct after a confirm ("Count 'ATP synthase' as right?"). Saved on the answer (`overridden = true`), the miss is taken back out of weak topics, and the accepted alternative is added to the question for next time. Not offered for MCQ.
- **Weak topics** update on each wrong answer (weak-topics.md "Tracking rules").
- **"I don't know"** counts as a miss but shows the answer gently (see Feedback).

## Layout
**Top bar** (as review.md): "✕ End" ghost (left), subject chip, quiz title (truncated, full in `title`), right: "Question 4 of 10". Under it a 6 px progress bar (`--highlight` fill, ink outline, `role="progressbar"`, `aria-valuetext="3 of 10 answered"`). A streak tag appears beside the count after 3 correct in a row: sticker chip "3 in a row 🔥" (pops in 350 ms, no sound, gone on the next miss).

**Question sticker:** centred `--card` sticker, 10 px subject tape at the top with the emoji, topic chip top-left in `--ink-soft` 14 px ("Krebs cycle"). Size: phone 100 % width (16 px gutter); tablet 600 px; laptop 680 px, min 360 px tall. Prompt 20 px bold, max 65ch, left-aligned.

**Multiple choice:** four option stickers stacked vertically on every width (long answers read better in a column), each full width, min 56 px tall, 2.5 px ink outline, 3 px offset shadow, `--card` fill. Left: a key cap with A / B / C / D (hidden on touch-only devices via `@media (hover: none)`, the letter stays as text for everyone). Native radio group under the hood. Selected (before checking): `--highlight` fill, shadow presses to 1 px, `aria-checked`. Below: primary **"Check"** (disabled until one is chosen), and ghost text button "I don't know".

**Fill in the blank:** the sentence is shown with the blank as an inline sticker gap (`____` rendered as a 6 em underlined slot in `--subject` with "blank" as its screen-reader text). Under it a single `.input` (full width, 20 px text, `autocomplete="off"`, `autocapitalize="off"`, `spellcheck="false"`, `enterkeyhint="done"`), label "Your answer". Primary **"Check"** (disabled while empty) + "I don't know". As the student types, the inline gap mirrors the text (`aria-hidden`).

**Feedback panel** (replaces the Check button area in the same place, so nothing jumps; the question stays visible above):
- **Correct:** the chosen option (or the input) fills `--success` with a ✓ badge that pops on (350 ms spring); a small burst of 10 paper bits from it (600 ms, `--success`, `--highlight`, `--subject`; `pointer-events: none`, `aria-hidden`); `pop`. Panel heading: one of "Correct!", "Nailed it!", "Yes! That's it." (rotated, never the same twice in a row). Explanation (16 px) underneath.
- **Wrong:** the question sticker gives a gentle shake: `translateX` 0 → -6 → 6 → -4 → 4 → 0 px, 320 ms, ease-out; `boop`. The chosen option fills `--danger` with a ✗ badge and the label "Your answer"; the correct option fills `--success` with ✓ and "Right answer". Fill-in: the input (now read-only) fills `--danger` with `--on-colour` text and a ✗ badge, and "Right answer: **mitochondria**" appears below. Panel heading: "Not quite. You'll get it next time." (variants: "Close one. You'll get it next time.", "Not this time. Now you know!"). Then the explanation. Never red walls, never "Wrong!".
- **I don't know:** no shake, no `boop` (just `click`): heading "No worries. Here's the answer." and the correct option/answer marked as above. Counts as a miss.
- Every feedback panel ends with the **source block** (as `SourceQuote`): quote with 4 px `--subject` left border, italic `--ink-soft`, 3 lines max with "Show more", then "From **Lecture 3.pdf**, page 12" link built with `passageHref()`, opening in a **new tab** so the quiz isn't lost. Plus a small "Read aloud" icon button (reads question, the right answer and the explanation; read-aloud.md).
- Then primary **"Next question"** (last question: "See results"). On wrong fill-ins, the "I think my answer is right" text button sits above it.
- Small ghost "Report a problem" link at the panel's bottom-right: opens a tiny menu "The answer is wrong", "The question is unclear", "Not in my notes" → removes the question from this quiz (`removed_at`), not scored, toast "Thanks. We took that question out of this quiz." Feeds accuracy without a support system.

## Motion
- Next question: current sticker slides 24 px left and fades (200 ms), next rises 8 px (250 ms spring), as review.md.
- Correct: ✓ pop + 10-bit burst. Wrong: 320 ms shake. Under **reduced motion**: no shake, no burst, no slide; ✓ / ✗ badges and fills appear at once, next question fades 150 ms. **Focus mode:** same as reduced motion and silent except `chime`.
- Shake is small (6 px) and once only, never looping (vestibular-safe, and it's not a punishment).

## Results
Same URL, swaps to the results view when the last answer is saved (refresh shows the results; "Retake" starts a new attempt).

- **Score sticker** (tape on top, rotated -1°): marker title by band, big score "8 / 10" (40 px), sub-line "80 % · 6 minutes".
  - ≥ 90 %: "Brilliant!" + confetti (review.md confetti: 40 pieces, 1.2 s, subject colour + `--highlight`) + `cheer`.
  - 70–89 %: "Nicely done!" + confetti + `cheer`.
  - 50–69 %: "Getting there!" (no confetti) + `pop`.
  - < 50 %: "Good practice." sub-line "Every miss shows you exactly what to look at next." (no confetti) + `pop`. Never a sad sound on results.
  - Reduced motion / focus mode: no confetti; a single star sticker appears (no movement).
- **Weak topics line** (only if misses): "Added to your weak topics: **Krebs cycle**, **Osmosis**" and, for topics answered right that were weak, "Getting stronger: **Diffusion** (1 more right to clear it)". Link "See weak topics".
- **Buttons** (phone: stacked full width in this order):
  1. "Practise what I missed" (primary, only with misses): opens the Make a quiz dialog (quiz-builder.md) with Focus = Weak topics and only this quiz's missed topics ticked. Uses a go; the dialog shows the quota as usual.
  2. "Retake this quiz" (plain; free, reshuffled).
  3. "Back to quizzes" (ghost). With 0 misses, "Retake" and "Back to Biology" only, plus a line "Nothing to practise. Make a new quiz on other pages?" with "Make a quiz".
- **Answer list** under the buttons: heading "Your answers", filter segmented "All | Missed (2)" (default All; Missed when score < 70 %). One compact row per question: ✓/✗ badge (with text "Right"/"Missed"), prompt, "Your answer: …" / "Right answer: …", expandable "Why?" showing the explanation and source link (new tab). "⋯" per row: "Edit question" (inline: prompt, options, correct option or answer + alternatives, explanation; saves to the quiz, chip "Edited") and "Remove from quiz" (not scored next time).
- Live region announces "Quiz finished. You scored 8 out of 10."

**Ended early** ("✕ End" or Esc): no confirm, answers already saved; small sticker "Saved! You answered 4 of 10. Come back any time to finish." with "Keep going" and "Back to quizzes". Misses so far already count toward weak topics.

## Keyboard
| Key | Action |
|---|---|
| 1–4 or A–D | Choose an option (MCQ, before checking) |
| Enter | Check (when an option is chosen / text typed); then Next question |
| ? | Shortcuts dialog (also a "Keyboard shortcuts" ghost button in the top bar on laptop) |
| R | Read aloud (after checking) |
| Esc | End (saves, no confirm) |

Letter and number keys are ignored while the fill-in input has focus (Enter still checks). Arrow keys move within the option radio group natively.

**Focus order:** new question → focus on the prompt heading (announced "Question 4 of 10, Krebs cycle. …"), Tab to options or input. After Check → focus moves to the feedback heading, which is in a polite live region ("Correct! …" / "Not quite. You'll get it next time. Right answer: …"). After Next → focus on the new prompt.

## States
- **Loading:** top bar + question skeleton + disabled Check.
- **Quiz not found / deleted:** "This quiz isn't here any more." + "Back to quizzes".
- **All questions removed:** "Every question in this quiz was taken out. Make a fresh one?" + "Make a quiz".
- **Checking an answer failed:** answer stays selected, inline under the button "Couldn't check that. Trying again…" (3 tries with backoff), then "You're offline. Check again when you're back." with "Try again". No `boop` for network problems on a correct-or-not moment (avoid implying the answer was wrong).
- **Source deleted** since the quiz was made: source block shows the quote and a chip "Source deleted" instead of the link.

## Sounds
`click` on choosing an option, Check, I don't know, Next; `pop` on correct; `boop` on wrong (never on I don't know or network errors); results `cheer` (≥ 70 %) or `pop`, played by the "See results" press instead of its `click`. One sound per action: the Check press plays only the result sound, not `click` as well. Focus mode: only `chime`. Everything is also shown visually (✓/✗ badges, headings).

## Accessibility
- Options are a native `fieldset` radio group with the prompt as `legend`. After checking, the group is disabled and each option's name gains its state ("B, Mitochondria, your answer, right answer").
- Correct/wrong never by colour alone: ✓/✗ badges, "Your answer" / "Right answer" labels, heading text.
- The fill-in blank has a text alternative ("blank"); the input is labelled "Your answer" and described by the prompt.
- Progress text is visible; the bar is `role="progressbar"` with `aria-valuetext`.
- Contrast: prompt `--ink` on `--card`; option fills `--highlight` / `--success` / `--danger` carry `--on-colour` (≥ 7:1 both themes). Focus ring 3 px `--focus` on options, visible on filled states too (ring sits outside the outline with 3 px offset).
- Targets ≥ 44 px (options ≥ 56 px). Shake respects reduced motion.
