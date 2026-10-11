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
