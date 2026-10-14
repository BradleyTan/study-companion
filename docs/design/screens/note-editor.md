# Screen: Note editor (`/subjects/[id]/notes/[noteId]`)

**Layout:** subject chip + "← Back to Biology". Title input (large, no outline until focus). Toolbar sticker strip: Bold, Italic, Heading, Bullet list, Numbered list, Quote, Code, Undo, Redo (icon buttons, 44 px, labelled). Writing surface: plain `--card` sheet with faint ruled lines, max 70ch, generous padding. Calm by design: no rotation, no decoration inside the sheet.

**Autosave:** 800 ms after typing stops. Status tag top-right: "Saving…" → "Saved ✓" (highlight sticker, no sound, typing should stay silent) → on error "Not saved. Retrying…" (danger) and retries with backoff; leaving the page with unsaved changes warns.

**States:** loading skeleton lines; empty note placeholder "Start typing your notes…"; delete note via menu with confirm.

**Keyboard:** standard shortcuts (Ctrl/Cmd+B, I, Z). Toolbar buttons expose `aria-pressed`.

## Step 2 additions

**Header actions** (right of the title on ≥ 640 px; on phone a row under the subject chip): "Make flashcards" plain button with a small card-stack icon. It opens the Make flashcards dialog (flashcards.md) with this note chosen. If there are unsaved changes it first saves ("Saving your note first…" on the button, disabled) and then opens. A note under 200 characters still opens the dialog, which shows the friendly "a bit short" message, so the reason is visible.

**Toolbar:** after a divider, "Read aloud" (speaker icon; label visible ≥ 640 px). It opens the read-aloud player bar under the toolbar. Full behaviour, states and keyboard (Alt+Shift+R) in read-aloud.md. The sentence highlight is an editor decoration and never changes the note or triggers autosave.

**Passage links:** the editor accepts `?quote=<chunkId>`: it scrolls to that passage and marks it (`--highlight` + `--on-colour`) for 4 s; if the passage can't be found any more, a banner says "This passage has changed since the card was made." and shows the original quote. Details in flashcards.md "Source links".

**Chunks:** to give cards and mindmap nodes something to point at, a note is split into chunks when flashcards or a mindmap are made from it (and the chunks are reused while their `content_hash` is unchanged). Typing never waits on this.
