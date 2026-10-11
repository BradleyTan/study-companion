# Study App (working name: "StudyNest")

## Product goal
One place for university students to keep notes and lecturer files per subject, turn them into flashcards, mindmaps, quizzes and an ask-your-notes chat, and plan and time their study. It should feel fun and motivating (playful visuals, micro-interactions, click sounds) without getting in the way of focus.

Owner: Bradley. Phase 1 MVP only. Phase 2 (dashboard, exam countdown, OCR, podcast audio) starts only after Bradley has a student test Phase 1 and gives the go-ahead. Obsidian-style backlinks/graph view is dropped.

## Stack
- Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui (restyled) + Framer Motion
- Supabase: Postgres, Auth, Storage, pgvector; RLS on every table
- Anthropic Claude API, server-side only (Haiku for bulk flashcards/mindmaps, Sonnet for quizzes and chat)
- React Flow (mindmap), FSRS via `ts-fsrs` (spaced repetition), Web Speech API (read-aloud), Web Audio API (sounds)
- Vitest (unit), Playwright (e2e), Vercel (preview deploys), PWA

## Folder structure
```
src/
  app/                  routes (App Router); (auth)/, (app)/subjects/[id]/...
  components/           ui/ (design-system primitives), feature folders
  lib/                  supabase/, ai/, srs/, sound/, limits/, extract/
  server/               server actions and data access
supabase/migrations/    SQL migrations (RLS included in the same migration)
e2e/                    Playwright specs
docs/                   PLAN.md, CHANGELOG.md, design/, qa/, security/
.claude/agents/         developer, ui-ux-designer, qa-engineer, security-engineer
```

## Conventions
- TypeScript strict. Server actions validate input with zod. No `any`.
- Data access only through `src/server/`; client components never call Supabase with elevated keys.
- AI calls only in server code under `src/lib/ai/`; outputs validated with zod; cached by content hash.
- Every table has `user_id uuid not null references auth.users` and RLS `user_id = auth.uid()`.
- Components use design tokens from `src/app/globals.css`; no hard-coded colours.
- Every interactive control plays its sound through `useSound()`; respects the global sound toggle, volume and focus mode.
- Small commits, one branch and PR per feature, update `docs/CHANGELOG.md`.

## Build order (each step stops for Bradley's review)
1. Auth + subject containers + typed notes + source uploads (with text extraction)
2. Flashcards (AI, source passages, editable) + spaced repetition + mindmap + read-aloud
3. Quizzes (MCQ, fill-in, mixed) + wrong-answer tracking + weak topics + ask-your-notes chat with citations
4. Pomodoro timer + timetable + Google Calendar sync
Then: polish pass and `docs/user-testing.md` student test kit.

## Team flow
Every feature passes through **Designer → Developer → QA → Security**, in that order:
1. `ui-ux-designer` writes `docs/design/screens/<screen>.md`
2. `developer` builds it with unit tests
3. `qa-engineer` tests and writes `docs/qa/<feature>.md`
4. `security-engineer` reviews; high/critical findings block merge

## Definition of done
- Designer spec exists and the screen matches it (sounds and empty/loading/error states included)
- Unit and Playwright e2e tests pass in CI
- QA sign-off file exists
- Security review has no high/critical findings; RLS policies are tested
- Works at mobile width (375 px)
- `CLAUDE.md` and `docs/PLAN.md` updated

## Ask Bradley before
Adding paid services, changing the stack, deleting data, or anything with per-use cost beyond the planned AI calls.
