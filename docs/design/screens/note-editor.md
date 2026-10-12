# Screen: Note editor (`/subjects/[id]/notes/[noteId]`)

**Layout:** subject chip + "← Back to Biology". Title input (large, no outline until focus). Toolbar sticker strip: Bold, Italic, Heading, Bullet list, Numbered list, Quote, Code, Undo, Redo (icon buttons, 44 px, labelled). Writing surface: plain `--card` sheet with faint ruled lines, max 70ch, generous padding. Calm by design: no rotation, no decoration inside the sheet.

**Autosave:** 800 ms after typing stops. Status tag top-right: "Saving…" → "Saved ✓" (highlight sticker, no sound, typing should stay silent) → on error "Not saved. Retrying…" (danger) and retries with backoff; leaving the page with unsaved changes warns.

**States:** loading skeleton lines; empty note placeholder "Start typing your notes…"; delete note via menu with confirm.

**Keyboard:** standard shortcuts (Ctrl/Cmd+B, I, Z). Toolbar buttons expose `aria-pressed`.
