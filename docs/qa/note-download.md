# QA sign-off: note download (PDF, Word), toolbar headings on save, mindmap banner, read-aloud voice picker

**Result: PASS** (2026-10-28), branch `claude/feedback-ai-quality-kgmile`, commits `09d3b94`, `2142674` and `60a6ea3`. No High or Critical bugs. I found 4 bugs (all Low) and fixed them, with tests. Each one only affects the student's own download, and none loses saved data. The security review's DL-1 is fixed by bug 2, and the optional DL-2 fix is included.

## Automated
| Suite | Result |
|---|---|
| Lint (`eslint src e2e`), typecheck (`tsc --noEmit`) | Clean |
| Unit (Vitest) | 637 passed in 40 files (635 before QA; 2 added in `src/lib/notes/docx.test.ts`, and the file-name test extended) |
| E2E (Playwright, desktop Chrome + Pixel 7) | Full run: 211 passed, 14 skipped (phone-only or desktop-only by design), 3 failed. Two of the failures are `polish.spec.ts:292` on both projects, which also fails on `main` (environment). The third is `feedback-qa.spec.ts:135` on desktop, a strict-mode miss: two `make-notes` buttons were on the page for a moment under full-suite load. Re-runs: `feedback-qa` × 3 gave 36 of 36, and `feedback` + `feedback-qa` + `note-download-qa` × 2 gave 77 passed, plus 1 different `feedback-qa` sounds flake on mobile that passed on re-run. Neither test touches code changed here. New: `e2e/note-download-qa.spec.ts`, 15 passed and 3 skipped (the wide read-aloud checks run on desktop only). |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations: Download dialog at 375 px in dark mode (new), plus the developer's light-mode check |

## What was covered
**Download dialog (note-editor.md "Download")**
- 375 px, dark mode, Pixel 7 (new e2e): the Download button is icon only and 44 × 44 px or larger. In the dialog, PDF and Word stack at full width, every button is 44 px tall or more, and everything stays inside the viewport. No sideways scroll. Axe is clean.
- Copy matches the spec: "Download this note", "Get a copy of “Untitled note” to print, share or keep." for an untitled note, and the hint line.
- Keyboard only (new e2e): Enter on Download opens the dialog. Tab stays inside it until Word has focus. Enter downloads the file and closes the dialog, and focus returns to Download. Esc closes the reopened dialog, and focus returns again.

**Word (.docx)**
- Built through the toolbar, then reloaded (new e2e): a heading, a numbered list with a nested numbered list, a bullet list with a nested bullet, and bold text with `café ß 日本語 עברית 🙂 a<b & c`. The file has `Heading2`, `ilvl` 1 for the nested items and 0 for "Militarism", bold runs, and escaped `&lt; &amp;`.
- Opened in LibreOffice 7 (by hand): the nested numbered list reads 1. Alliances, a. Triple Entente, b. Triple Alliance, 2. Militarism (numbering carries on after the nested list). Bullets go ● then ○, and the Title style wraps a long title.
- Long title (a 120-character title with `:`, `<>`, `/`, curly quotes and an emoji): the name is cut at 100 characters, reserved characters become " - ", and the full title is in the document.
- Empty, untitled note (new e2e): `Untitled note.docx`, with the title in Word's Title style.
- Unit: numbering restarts for each list, code blocks keep their lines, XML escaping and file names (developer), plus the new cases under Bugs.

**PDF (print)**
- Dark mode, print media (new e2e): white page, black title, heading and quote text, no lined-paper background. The header, toolbar, title field, Download, Delete note and save chip are hidden. The note starts at the top of the page.
- Rendered with `page.pdf()` in dark mode (by hand): one A4 page, only the title and the note, nested numbered and bullet lists and non-Latin text intact.
- The developer's e2e still passes: `window.print` is called once, the dialog closes first, and the menus are hidden in print.

**Headings survive a save**
- Toolbar heading, Enter, text, reload: `h2` is still there on desktop and on the phone, and so are lists and bold (new e2e and the developer's). There is no "Something went wrong" page in demo mode.

**Mindmap "Sources changed hint" (09d3b94)**
- New e2e: make a map, change the note, go back to the map. The banner reads "Your notes changed since this map was made. Tap ↻ above to update it." and has no button. Exactly one regenerate button is visible: "Regenerate" on desktop, "New map" on the phone. It opens the "Make new map" confirmation. No sideways scroll. Matches mindmap.md.

**Read aloud voice picker (2142674)**
- New e2e at 640, 900 and 1920 px with an online voice: the voice picker stays over 150 px wide and doesn't overlap the online-voice hint or the speed picker. The developer's test covers desktop at 1280 px and the phone.

**Regressions in the note editor**
- Full e2e run: typing, autosave, passage links, read-aloud, Make flashcards, Delete note and the polish specs all pass.

## Bugs
| # | Severity | Bug | Steps to reproduce | Fix |
|---|---|---|---|---|
| 1 | Low | **An empty note prints "Start typing your notes…".** The placeholder is a `::before` with its own colour, so the print rule `.print-note *` didn't reach it. In dark mode it printed in light grey. | New note, type nothing, Download → PDF. | `globals.css` print block: `.print-note .tiptap p.is-editor-empty::before { content: none; }`. e2e checks the computed `content` in print media. |
| 2 | Low | **Some characters make a Word file that won't open** (security DL-1). C0 control characters, U+FFFE/U+FFFF and lone surrogates went into `document.xml` and `core.xml`, which XML 1.0 doesn't allow. | Paste text with U+000C (a form feed, common in text copied from PDFs) or U+FFFE into a note, then Download → Word. Word reports the file as damaged. | `xmlSafe()` in `src/lib/notes/docx.ts` strips them from text runs, code blocks, the title and the file name. Unit test checks `document.xml` and `core.xml`. |
| 3 | Low | **A list item with two paragraphs got two numbers.** Each paragraph in a list item became its own list entry, so a numbered list read 1, 2, 3 for two items. This happens with lists pasted from Word or Google Docs. | Paste `<ol><li><p>one</p><p>more</p></li><li><p>two</p></li></ol>` into a note, then Download → Word. | Only the first paragraph of an item gets the bullet or number. Later paragraphs are indented to line up with its text. Unit test. |
| 4 | Low | **File name cut through an emoji, or left a dot before ".docx".** The 100-character cut counted UTF-16 units, and trailing dots and dashes were trimmed before the cut, not after. Bidi controls (U+202E) passed through (security DL-2, accepted). | Title "a" followed by 120 × 😀 gives a broken last character. A title of 99 × "a" then ". b" gives `aaa….docx`. | Cut by characters, trim after the cut, and strip bidi controls. Unit tests. |

## Notes, not bugs
- **Non-ASCII file names in this sandbox:** Chromium here runs with no UTF-8 locale (`LANG` is unset), so it saves any non-ASCII `download` name as "download". With `LANG=C.UTF-8`, the same names save as asked (checked by hand). The app is fine. The new e2e reads the link's `download` attribute instead of `suggestedFilename()`, so it passes in either locale.
- Headings deeper than H4 in the Word file become H4. The editor only makes H2, so this can't happen today.
- A code block inside a list item isn't indented in Word. The toolbar can't make one there.
- `polish.spec.ts:292` fails on `main` too. It comes from the preinstalled Chromium (see `docs/qa/feedback.md`).

## Files
- Fixes: `src/lib/notes/docx.ts`, `src/app/globals.css` (print block)
- Tests: `src/lib/notes/docx.test.ts` (2 new, 1 extended), `e2e/note-download-qa.spec.ts` (9 tests; 6 run on both projects and 3 on desktop only)
