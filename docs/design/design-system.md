# Design system: Sticker Notebook

Chosen by Bradley on 2026-10-11 (Concept B). The app looks like a well-loved notebook: graph paper, thick ink outlines, offset "sticker" shadows, washi tape and sticker rewards. Bold and playful, but the reading surfaces (notes, cards) stay plain and calm.

Tokens live in `src/app/globals.css`. Components never use raw colours.

## Colour tokens

| Token | Light | Dark ("chalkboard notebook") | Use |
|---|---|---|---|
| `--paper` | `#fffdf5` | `#17172a` | page background |
| `--grid` | `#e7ecf7` | `#25253d` | graph-paper lines |
| `--card` | `#ffffff` | `#222238` | cards, inputs, editor |
| `--ink` | `#1b1b2f` | `#f3efe0` | text, outlines |
| `--ink-soft` | `#4a4a63` | `#c3bfd6` | secondary text (AA on paper and card) |
| `--shadow` | `#1b1b2f` | `#05050c` | offset sticker shadow |
| `--highlight` | `#ffe45c` | `#ffe45c` | primary actions, tape, "saved" |
| `--success` | `#7be0b0` | `#3fbf87` | correct, ready |
| `--danger` | `#ff9a8b` | `#ff8a7a` | wrong, delete |
| `--focus` | `#3d6bff` | `#8fb8ff` | focus ring |

Text on `--highlight`, `--success`, `--danger` and subject colours is always `#1b1b2f` (contrast ≥ 7:1).

### Subject colours
Eight pastels, each paired with ink text: sky `#8fb8ff`, sun `#ffe45c`, coral `#ff9a8b`, mint `#7be0b0`, lilac `#c9b6ff`, peach `#ffc48f`, rose `#ffb3d9`, sage `#b8d99a`. A subject keeps its colour and emoji everywhere: subject card, note header, upload chips and (later) flashcards, quizzes and timetable.

## Type
- **Display:** Permanent Marker. Page titles and big empty-state lines only. Never for body or buttons.
- **Body/UI:** Atkinson Hyperlegible (designed for legibility), 16 px base, 1.55 line height.
- Scale: 14 / 16 / 20 / 28 / 40 px. Running text max 65ch.

## Shape and depth
- Outline: 2.5 px `--ink` (3 px on primary buttons).
- Radius: 8 px (stickers are cut paper, not pills). Chips: 999 px.
- Sticker shadow: `4px 4px 0 var(--shadow)`. On press it shrinks to `1px 1px` and the element moves 3 px down-right, so buttons physically "press".
- Slight rotation (-1° to 1.5°) is allowed on decorative stickers and subject cards, never on inputs or text blocks.

## Motion
- Durations: 120 ms (press), 200 ms (hover lift), 350 ms (sticker pop, springy `cubic-bezier(.3,1.8,.5,1)`).
- `prefers-reduced-motion: reduce` turns off rotation, pop and lift; state changes still show (colour, text).
- Focus mode (Step 4) will mute decorative motion.

## Components (Step 1)
`Button` (primary yellow / plain / danger), `IconButton`, `Input`, `Textarea`, `Select`, `Dialog` (native `<dialog>`), `StickerCard`, `Chip`, `Tape` (decorative), `Toast` ("Saved", "Uploaded"), `EmptyState`.

## Accessibility
- WCAG 2.1 AA in both themes; outlines are ink, so components never depend on colour alone.
- Focus: 3 px `--focus` ring with 3 px offset on every interactive element.
- Touch targets ≥ 44 px.
- All icons have labels; emoji used as content get `role="img"` + `aria-label`.
- Everything works with sound off.

## Step 2 additions

### New tokens (add to `src/app/globals.css`, both themes)
| Token | Light | Dark | Use |
|---|---|---|---|
| `--subject` | set inline per page/card from `SUBJECT_COLOURS[subject.colour]` | same | subject tape, root node, quote border, tile fills |
| `--grade-again` | `var(--danger)` | `var(--danger)` | review "Again" |
| `--grade-hard` | `#ffc48f` (peach) | `#ffc48f` | review "Hard" |
| `--grade-good` | `var(--success)` | `var(--success)` | review "Good" |
| `--grade-easy` | `#8fb8ff` (sky) | `#8fb8ff` | review "Easy" |
| `--mark` | `var(--highlight)` | `var(--highlight)` | passage and read-aloud highlight; text inside is always `--on-colour` |

All fills above carry `--on-colour` text (≥ 7:1 in both themes) and an ink outline. A subject colour is never used for text on paper.

### Motion
- Card flip: `rotateY` 180°, 420 ms, `cubic-bezier(.3,1.3,.5,1)`, perspective 1200 px. Reduced motion / focus mode: 150 ms crossfade.
- Next card: out 200 ms (24 px left + fade), in 250 ms spring from the stack.
- Panel / bottom sheet: 250 ms ease-out slide; reduced motion: no slide, fade 120 ms.
- Confetti: 40 pieces, 1.2 s, Framer Motion, in-house (no library). Off under reduced motion and in focus mode (a static star sticker instead).
- Loading loops (card shuffle, branch drawing, chip pulse) stop under reduced motion and in focus mode; text still shows.

### Focus mode (applies from Step 4, specs in Step 2 already honour it)
While the Pomodoro timer runs: only `chime` plays, decorative motion follows reduced-motion rules, confetti is off. Read-aloud still works because the student asked for it.

### New components
`FlipCard`, `GradeButton`, `QuotaChip` ("3 of 5 left today"), `SourceQuote` (quote + passage link), `ProgressBar`, `BottomSheet` (phone) / `SidePanel` (≥ 640 px), `Confetti`, `ReadAloudBar`, `StudyToolTile`, `DueBanner`. All built on the existing sticker primitives and tokens.

### Breakpoints used by Step 2 specs
Phone < 640 px (designed at 375), tablet 640–899, laptop ≥ 900 (matches the 900 px split already used on the subject page).
