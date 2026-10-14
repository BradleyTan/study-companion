# Study App (working name: "StudyNest")

## Product goal
One place for university students to keep notes and lecturer files per subject, turn them into flashcards, mindmaps, quizzes and an ask-your-notes chat, and plan and time their study. It should feel fun and motivating (playful visuals, micro-interactions, click sounds) without getting in the way of focus.

Owner: Bradley. Phase 1 MVP only. Phase 2 (dashboard, exam countdown, OCR, podcast audio) starts only after Bradley has a student test Phase 1 and gives the go-ahead. Obsidian-style backlinks/graph view is dropped.

## Stack
- Next.js 16 (App Router, `src/proxy.ts` instead of middleware) + TypeScript + Tailwind CSS v4 + own sticker-style UI primitives; Framer Motion from Step 2
- Supabase: Postgres, Auth, Storage, pgvector; RLS on every table
- AI: free Groq API, server-side only (`openai/gpt-oss-20b` for flashcards/mindmaps, `openai/gpt-oss-120b` for quizzes and chat), Cloudflare Workers AI free plan as fallback. **No paid services: everything must be free (Bradley's rule).** See docs/PLAN.md 3b.
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

## Running locally
`npm run dev` with no `.env.local` runs **demo mode** (in-memory data). `npm test`, `npm run test:e2e`, `npm run test:db` (needs `DATABASE_URL`). Next.js 16 differs from older versions: read `node_modules/next/dist/docs/` before using an unfamiliar API.

## Conventions
- TypeScript strict. Server actions validate input with zod. No `any`.
- Data access only through `src/server/`; client components never call Supabase with elevated keys.
- AI calls only in server code under `src/lib/ai/`; outputs validated with zod; cached by content hash.
- Every table has `user_id uuid not null references auth.users` and RLS `user_id = auth.uid()`.
- Components use design tokens from `src/app/globals.css`; no hard-coded colours. Component classes live in `@layer components` so Tailwind utilities can override them.
- All data access goes through the `Repo` interface (`src/server/repo/types.ts`), implemented for Supabase and demo mode. Get it with `getRepo()`.
- Server actions are public endpoints: validate every argument with zod and check ownership.
- Every interactive control plays its sound through `useSound()`; respects the global sound toggle, volume and focus mode.
- Small commits, one branch and PR per feature, update `docs/CHANGELOG.md`.

## Build order (each step stops for Bradley's review)
1. Auth + subject containers + typed notes + source uploads (with text extraction)
2. Flashcards (AI, source passages, editable) + spaced repetition + mindmap + read-aloud
3. Quizzes (MCQ, fill-in, mixed) + wrong-answer tracking + weak topics + ask-your-notes chat with citations
4. Pomodoro timer + timetable + calendar link (.ics feed and uni timetable import; no Google OAuth)
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
Changing the stack, deleting data, or anything that could cost money. The app must stay on free plans with no card attached.
