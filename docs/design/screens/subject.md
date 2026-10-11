# Screen: Subject page (`/subjects/[id]`)

**Header:** subject colour band with emoji + name (Permanent Marker), "Edit" and "Delete" buttons. Breadcrumb "← All subjects".

**Two sections** (stacked on phone, side by side ≥ 900 px):
1. **Notes**: "New note" primary. List of note rows: title, first line preview, "edited 2 h ago". Empty: "No notes yet. Type your first one."
2. **Lecture files**: upload drop zone (dashed outline, "Drop a PDF or PowerPoint here, or choose a file", "PDF or PPTX, up to 25 MB"). File rows: type chip (PDF/PPTX), name, size, pages/slides, status chip.

**Upload states** (per file row)
- Uploading: progress bar in highlight yellow.
- Reading: chip "Reading text…" with gentle pulse.
- Ready: mint chip "Ready · 42 pages", `pop`.
- No text: coral chip "No text found (scanned?)" with help text "Handwritten and scanned files will be supported later."
- Rejected: inline error, `boop`: "Only PDF and PPTX files can be uploaded." / "That file is over 25 MB." / "That file looks damaged or isn't really a PDF."

**Row actions:** "Open" (signed URL, new tab), "Delete" with inline confirm.
