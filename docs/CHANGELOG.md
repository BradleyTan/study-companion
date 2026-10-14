# Changelog

## 2026-10-14 · Step 2 QA fixes
- A production build without an AI key says "AI isn't set up yet" for flashcards and mindmaps instead of making stand-in cards; stand-in output is never reused once real AI is set up.
- Review: Undo removes only the grade it was for (a retried undo could delete an older review); a double tap on a grade no longer flips the next card; a reused client key can't copy one card's schedule onto another; "Review X · N due" shares the new-card allowance like the banner.
- Same notes in two subjects: making cards in the second no longer says "already made".
- Mindmap: regenerating while a layout save was pending no longer moves the new map's nodes.
- Touch targets: small buttons, back links, the logo and the note title are 44 px on phones.
- QA sign-off `docs/qa/step-2.md`; new tests in `e2e/step2-qa.spec.ts` and `src/server/actions/*.test.ts`.

## 2026-10-14 · Step 2: flashcards, spaced repetition, mindmap, read aloud
- Make flashcards from a note or a lecture file (10, 15 or 20 cards; up to 20 pages of a file at a time). Each card keeps the quote it came from and links back to it. Edit, delete (with Undo) and add cards by hand.
- Review sessions with FSRS spaced repetition (`ts-fsrs`): flip, Again/Hard/Good/Easy with the next interval on each button, keyboard shortcuts, Undo, confetti at the end, 20 new cards a day. Due-today counts on the Subjects page, subject tiles and the subject page.
- Mindmap per subject (React Flow): radial layout, drag or arrow keys to move topics (saved), Map/Outline views, passage panel for each topic, Regenerate, Reset layout, Choose sources.
- Read aloud with the browser's own voices: note editor player bar (speed, voice), speaker buttons on cards, review and mindmap passages.
- Source passage links: notes scroll to and mark the passage; new read-only page for lecture files with the text page by page.
- AI on the free Groq API with Cloudflare Workers AI as fallback, server-side only; JSON validated with zod; results cached by a hash of the source text; per-student daily limits (flashcards 5, mindmaps 3) and an app-wide daily budget; a deterministic local generator when no AI key is set (demo mode, CI).
- Migration `20261014000001_step2_flashcards_mindmaps.sql`: `flashcards`, `card_reviews`, `mindmaps`, `ai_app_usage`, quota functions callable only by the server; RLS tests extended.
- New `cheer` sound for the end of a review session.

## 2026-10-14 · Google button follows Supabase
- "Continue with Google" now shows only while the Google provider is switched on in Supabase (checked live, cached for a minute), replacing the `NEXT_PUBLIC_GOOGLE_SIGNIN` flag that could get out of step.

## 2026-10-12 · Fixes after first deploy
- Sign-in links that land on the home page (Supabase falling back to its Site URL) now finish signing in.
- Google sign-in button hidden until `NEXT_PUBLIC_GOOGLE_SIGNIN=1` (it showed a raw Supabase error while the provider was off).
- `vercel.json` pins the Next.js framework.
- Trigger functions can no longer be called through the API.

## 2026-10-11 · Step 1: sign-in, subjects, notes, uploads
- Sticker Notebook design system, synthesised sound set, screen specs (`docs/design/`).
- Sign-in with email magic link or Google (Supabase Auth); demo mode when Supabase isn't configured.
- Subjects with colour and icon: create, edit, delete.
- Rich-text notes with autosave.
- PDF and PPTX uploads (25 MB) with type checks by content, text extraction per page/slide, passages saved for later AI features; scanned PDFs flagged.
- Settings: sound on/off and volume, theme, download everything, delete account. Privacy page.
- Database migrations with RLS on every table and Storage; RLS test suite.
- CI: lint, types, unit, build, audit, Playwright e2e with axe accessibility checks, RLS tests.

## 2026-10-11 · Step 0
- Added team agents: developer, ui-ux-designer, qa-engineer, security-engineer (`.claude/agents/`).
- Added `CLAUDE.md` and `docs/PLAN.md` (architecture, data model, build steps, open questions).
- Added three playable design concepts with generated sounds (`docs/design/concepts.html`).
- Moved to the GitHub repo; each step is a pull request.
- Bradley picked Concept B (Sticker Notebook); plan approved with default answers to open questions.
