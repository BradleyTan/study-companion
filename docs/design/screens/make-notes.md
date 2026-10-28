# Screen: "Make study notes" dialog (subject page)

From the student test (2026-10-28): "No auto make notes for them based on the slides, websites, notes, or PDF." The app reads a note, a lecture file (PDF slides or PPTX) or a public web page and writes tidy study notes, saved as a **new note** in the subject. Because it's an ordinary note, the student can edit it, and flashcards, the mindmap, quizzes and Ask your notes all work from it.

## Entry points
- Subject page, Notes header: **"✨ Make notes"** (plain button) beside "+ New note" (primary). Phone: the two buttons wrap onto one row under the "Notes" heading.
- Empty Notes box: copy "No notes yet. Type your first one, or let us make notes from your lecture files or a web page." with "+ Write a note" (primary) and "✨ Make notes".

## Dialog (`dialog.sheet`, same frame as Make flashcards)
**Step 1: Choose.** Title "Make study notes". One hint line: "We'll read it and write tidy notes: the key points under headings, plus the key terms. They're saved as a new note you can edit."
- Segmented control (`.seg`, `aria-label="Make notes from"`): **My notes & files** | **A web page**. Opens on "My notes & files", or on "A web page" when the subject has no notes and no files.
- **My notes & files:** the radio list from Make flashcards ("Notes", "Lecture files", disabled rows "Still reading text…" / "No text found"). A long file (more than one set's worth of text, `NOTES_MAX_CHARS` 10,000) shows the shared page-range fields and quick picks under the list, with the extra line "Long file: notes are made a few pages at a time." (slides for PPTX). Up to 50 pages a set; wider ranges are sampled evenly.
- **A web page:** text field labelled "Link to a web page" (placeholder `https://en.wikipedia.org/wiki/Osmosis`, `type="url"`, max 2,000 characters). Hint: "Public pages only, like an encyclopedia article or a reading your lecturer shared. Pages behind a sign-in can't be read." The `https://` can be left off. Empty on submit: inline error "Paste a link to a web page." (focus returns to the field, `boop`).
- Quota chip "5 of 5 left today" + hint "Making notes from the same text again is free."
- Buttons: "Cancel" (ghost), "Make notes" (primary; disabled until a source is picked on the first tab).

**Step 2: Making.** The shuffling index-card stack from Make flashcards. Rotating line (decorative): "Reading it through…" ("Reading pages 7–12…" for a range, "Opening the page…" for a link) → "Picking out what matters…" → "Writing your notes…" → "Nearly there…". Live region once: "Making study notes. This takes about 20 seconds." The dialog can be closed ("You can close this. We'll tell you when they're ready."); on completion a toast "Your Biology study notes are ready" with "Open notes".

**Step 3: Ready.** Title "Your notes are ready! ✨" (`pop`). Lines: the note title in bold ("Study notes: Cell respiration"); "14 key points and 6 key terms, saved as a new note."; when the source was sampled, "It was a lot of text, so the notes cover it evenly. For fuller notes, make them a few pages at a time."; "Check them against the original. Then turn them into flashcards or a mindmap." Quota chip. Buttons "Done" (ghost) and "Open notes" (primary link to the note editor).

## The new note
- Title: "Study notes: <title the AI gives>" (falls back to the note, file or page name).
- First paragraph: "✨ Study notes made from Lecture 3.pdf, pages 1–12. Check them against the original before you rely on them." For a link, the page address is written out in full (plain text; links are off in the editor).
- One `h2` per topic in teaching order, each with a bullet list of complete one-sentence points (definitions, how things work, steps in order, causes and effects, comparisons, examples, numbers and formulas).
- "Key terms" `h2` with a bullet per term: **term** (bold): definition.
- Accuracy: every point and term must be supported by the passage it came from (same checks as flashcard answers: numbers, formulas, charges, species names, at least half the words). Anything else is left out, never guessed.

## Messages (Step 1 swaps to a sticker message with an emoji, quota chip, "Close" and "Back"/"Try again")
| Case | Emoji | Copy |
|---|---|---|
| Daily limit | 🌙 | "You've made all 5 sets of study notes for today. More tomorrow!" |
| App allowance used | 🌙 | "Today's free AI allowance is used up. Try again tomorrow. Your notes are safe." |
| Note too short | ✏️ | "This note is a bit short for study notes. Add a paragraph or two and try again." |
| File too short | ✏️ | "This file doesn't have enough text for notes." |
| Page too short | ✏️ | "That page doesn't have enough text to make notes from. It may need a sign-in, or load its text in a way we can't read." |
| Not a link | 🔗 | "That doesn't look like a web link. Paste the full address, like https://en.wikipedia.org/wiki/Osmosis." |
| Local / private address | 🔗 | "That link can't be opened from StudyNest. Try a public web page." |
| Unreachable | 🔗 | "We couldn't open that page. Check the link works in your browser and try again." |
| HTTP error | 🔗 | "That page didn't open for us. It may need a sign-in, or it may have moved." |
| Not a web page | 🔗 | "That link isn't a web page we can read. Try a page with text on it." |
| A PDF link | 🔗 | "That link is a PDF. Download it and add it under Lecture files, then make notes from it there." |
| Too slow | 🔗 | "That page took too long to open. Try again, or try another page." |
| Failed | 🌀 | "The note maker got muddled. Try again. This one didn't use up a go." |
| Not configured | 🔌 | "AI isn't set up yet, so study notes can't be made right now." |

"Back" returns to Step 1 with the link or choice kept.

## Limits
5 sets of study notes per student per day (15 tries), on `openai/gpt-oss-120b`. Cached text is free. A link is read only after a go is reserved; if it can't be read, the go comes back (the try still counts).

## Sounds
`click` on the button, tabs and radios; `pop` when ready (only if the dialog is still open); `boop` on any message or inline error. No sound while making.

## Accessibility
Native `<dialog>` (focus trap, Esc). Tabs are buttons with `aria-pressed`. The URL field has a visible label, `aria-describedby` for the hint and the error, `aria-invalid` on error. The ready and message titles take focus. Everything works at 375 px with no sideways scroll.
