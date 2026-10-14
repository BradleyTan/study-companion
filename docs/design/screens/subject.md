# Screen: Subject page (`/subjects/[id]`)

**Header:** subject colour band with emoji + name (Permanent Marker), "Edit" and "Delete" buttons. Breadcrumb "← All subjects".

**Study tools row** (Step 2, between the header and the sections). Figma "Subject" frame. Sticker tiles, 2.5 px ink outline, 4 px offset shadow, slight alternating rotation (-1°/1°, none under reduced motion), hover lift:
- **Review** tile, only when cards are due: full width, `--highlight` fill, "Review · 12 due" in bold 20 px, sub-line "About 6 minutes" (due × 20 s, rounded up), whole tile is the link to `/subjects/[id]/review`.
- **Flashcards** tile: card-stack icon, "Flashcards", sub-line "48 cards" (or "Make your first cards"), links to `/subjects/[id]/flashcards`.
- **Mindmap** tile: branch icon, "Mindmap", sub-line "Updated 2 days ago" (or "Not made yet"), links to `/subjects/[id]/mindmap`.
- Layout: phone (375 px) Review full width, then Flashcards | Mindmap as two equal columns (min 160 px each, 96 px tall); tablet and laptop all in one row (Review 2fr, others 1fr). Step 3 adds Quiz and Ask-your-notes tiles to this row; no "coming soon" placeholders before that.
- Tiles are `<a>` elements with full accessible names ("Flashcards, 48 cards"); `click` sound on activation. Loading: grey tile skeletons; counts that fail to load show the tile without its sub-line.

**Two sections** (stacked on phone, side by side ≥ 900 px):
1. **Notes**: "New note" primary. List of note rows: title, first line preview, "edited 2 h ago". Empty: "No notes yet. Type your first one."
2. **Lecture files**: upload drop zone (dashed outline, "Drop a PDF or PowerPoint here, or choose a file", "PDF or PPTX, up to 25 MB"). File rows: type chip (PDF/PPTX), name, size, pages/slides, status chip.

**Upload states** (per file row)
- Uploading: progress bar in highlight yellow.
- Reading: chip "Reading text…" with gentle pulse.
- Ready: mint chip "Ready · 42 pages", `pop`.
- No text: coral chip "No text found (scanned?)" with help text "Handwritten and scanned files will be supported later."
- Rejected: inline error, `boop`: "Only PDF and PPTX files can be uploaded." / "That file is over 25 MB." / "That file looks damaged or isn't really a PDF."

**Row actions:** "Open" (signed URL, new tab), "Make flashcards" (Step 2, only on Ready files; opens the Make flashcards dialog with this file chosen, see flashcards.md), "Delete" with inline confirm. On phone the actions collapse into a "⋯" menu button (44 px).

**Note rows** (Step 2): "⋯" menu per row with "Make flashcards" and "Delete".

**Deleting a note or file that cards came from:** the confirm adds "Flashcards made from it stay in your deck, with their quotes." Mindmap nodes keep their labels; their passage panel shows "Source deleted".
