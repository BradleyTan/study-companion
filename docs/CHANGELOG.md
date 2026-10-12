# Changelog

## 2026-10-12 · Fixes after first deploy
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
