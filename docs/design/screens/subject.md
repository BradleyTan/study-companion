# Screen: Subject page (`/subjects/[id]`)

**Header:** subject colour band with emoji + name (Permanent Marker), "Edit" and "Delete" buttons. Breadcrumb "← All subjects".

**Study tools row** (Step 2, between the header and the sections). Figma "Subject" frame. Sticker tiles, 2.5 px ink outline, 4 px offset shadow, slight alternating rotation (-1°/1°, none under reduced motion), hover lift:
- **Review** tile, only when cards are due: full width, `--highlight` fill, "Review · 12 due" in bold 20 px, sub-line "About 6 minutes" (due × 20 s, rounded up), whole tile is the link to `/subjects/[id]/review`.
- **Flashcards** tile: card-stack icon, "Flashcards", sub-line "48 cards" (or "Make your first cards"), links to `/subjects/[id]/flashcards`.
- **Mindmap** tile: branch icon, "Mindmap", sub-line "Updated 2 days ago" (or "Not made yet"), links to `/subjects/[id]/mindmap`.
- **Quizzes** tile (Step 3): tick-sheet icon, "Quizzes", sub-line "Best 8/10 · 4 quizzes" (or "Test yourself"; with an unfinished attempt "Finish your quiz · 4 of 10"), links to `/subjects/[id]/quizzes` (quiz-builder.md).
- **Ask your notes** tile (Step 3): speech-bubble icon, "Ask your notes", sub-line "18 questions left today" (or "Ask anything in your notes" before the first question), links to `/subjects/[id]/ask` (chat.md).
- Layout (Step 3, replaces the Step 2 one-row layout): the Review tile, when shown, is its own full-width row on every width. The other four tiles: **phone (375 px)** a 2 × 2 grid (Flashcards | Mindmap / Quizzes | Ask your notes), equal columns, min 96 px tall, labels may wrap to two lines ("Ask your / notes"), never truncate; **tablet and laptop** one row of four equal columns.
- Tiles are `<a>` elements with full accessible names ("Flashcards, 48 cards"; "Quizzes, best 8 out of 10, 4 quizzes"); `click` sound on activation. Loading: grey tile skeletons; counts that fail to load show the tile without its sub-line.

**Weak topics strip** (Step 3, directly under the tools row, only when the subject has open weak topics): slim sticker (`--card`, 6 px left band `--subject`, no rotation), target icon, text "**3 weak topics:** Krebs cycle, Osmosis +1" (top 2 names, then "+N"), and on the right a plain small button "Practise" → `/subjects/[id]/weak-topics` (weak-topics.md). Phone: text on one line (names truncate with ellipsis, full list in the accessible name), button on the right, 44 px. When every weak topic is cleared, the strip disappears (no "0 weak topics" line).

**Two sections** (stacked on phone, side by side ≥ 900 px):
1. **Notes**: "New note" primary. List of note rows: title, first line preview, "edited 2 h ago". Empty: "No notes yet. Type your first one."
2. **Lecture files**: upload drop zone (dashed outline, "Drop a PDF or PowerPoint here, or choose a file", "PDF or PPTX, up to 25 MB"). File rows: type chip (PDF/PPTX), name, size, pages/slides, status chip.

**Upload states** (per file row)
- Uploading: progress bar in highlight yellow.
- Reading: chip "Reading text…" with gentle pulse.
- Ready: mint chip "Ready · 42 pages", `pop`.
- No text: coral chip "No text found (scanned?)" with help text "Handwritten and scanned files will be supported later."
- Rejected: inline error, `boop`: "Only PDF and PPTX files can be uploaded." / "That file is over 25 MB." / "That file looks damaged or isn't really a PDF."

**Row actions:** "Open" (signed URL, new tab), "Make flashcards" (Step 2, only on Ready files; opens the Make flashcards dialog with this file chosen, see flashcards.md), "Make a quiz" (Step 3, only on Ready files; opens the Make a quiz dialog with this file chosen, see quiz-builder.md), "Delete" with inline confirm. On phone the actions collapse into a "⋯" menu button (44 px). On tablet/laptop, "Open" and "Make flashcards" stay visible and "Make a quiz" and "Delete" go into "⋯" so the row doesn't overflow.

**Note rows** (Step 2): "⋯" menu per row with "Make flashcards", "Make a quiz" (Step 3) and "Delete".

**Deleting a note or file that cards came from:** the confirm adds "Flashcards made from it stay in your deck, with their quotes." (Step 3: "Flashcards and quizzes made from it stay, with their quotes.") Mindmap nodes keep their labels; their passage panel shows "Source deleted". Quiz source blocks, weak-topic links and chat citations show the "Source deleted" chip the same way.
