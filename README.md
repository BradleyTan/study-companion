# StudyNest (study-companion)

A study app for university students: notes and lecture files per subject, then AI flashcards, quizzes, an ask-your-notes chat, a Pomodoro timer and a timetable. Built step by step; see `docs/PLAN.md`.

**Status:** Step 1 of 4 (sign-in, subjects, notes, lecture-file uploads).

## Run it locally in 1 minute (demo mode)

```bash
npm install
npm run dev
```

Open http://localhost:3000 and choose **Try the demo**. Without Supabase settings the app runs in demo mode: data lives in memory and resets when the server restarts.

## Connect real accounts (all free, no card)

StudyNest runs entirely on free plans: Supabase Free, Vercel Hobby, Groq and Cloudflare Workers AI. See `docs/PLAN.md` section 3b for the limits.

1. Create a free project at [supabase.com](https://supabase.com).
2. Apply the database migrations: `npx supabase link --project-ref <ref>` then `npx supabase db push`.
3. In Supabase → Authentication → URL configuration, add your site URL and `<site>/auth/callback` as a redirect URL. To offer Google sign-in, enable the Google provider in Supabase → Authentication → Sign In / Providers (it needs a free Google OAuth client). The "Continue with Google" button appears by itself within a minute once the provider is on, and stays hidden while it is off.
4. (Optional, needed from Step 3) Deploy the embeddings function: `npx supabase functions deploy embed`.
5. Copy `.env.example` to `.env.local` and fill in the values. **Never commit `.env.local`.**
6. On Vercel, import the repo and add the same environment variables.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright, builds the app in demo mode) |
| `npm run test:db` | Applies migrations to a throwaway Postgres + pgvector and runs the RLS tests (`DATABASE_URL` required) |
| `npm run lint` / `npm run typecheck` | Static checks |

## Team

Work flows Designer → Developer → QA → Security; the agents live in `.claude/agents/`. See `CLAUDE.md`.
