# Plan: Study App Phase 1 MVP

Status: **approved 2026-10-11.** Bradley picked **Concept B, Sticker Notebook**. Open questions without an explicit answer use the defaults marked below; Bradley can change any of them.

## 1. Architecture

```
Browser (Next.js client, PWA)
  │  UI, animations, sounds (Web Audio), read-aloud (Web Speech), Pomodoro clock
  ▼
Next.js server (Vercel)
  │  Server actions + route handlers: validation (zod), auth check, quotas
  │  src/lib/ai  → Groq API, Cloudflare Workers AI fallback (keys server-side only, free plans)
  │  src/lib/extract → PDF/PPTX text extraction
  ▼
Supabase
  Postgres (+ pgvector) ── RLS on every table (user_id = auth.uid())
  Auth (email magic link + Google)
  Storage: private bucket "sources/{user_id}/..." (signed URLs only)
  Edge Function "embed": gte-small embeddings (free, runs inside Supabase)
```

Key flows:
- **Upload:** browser uploads to Storage with a signed upload URL → server action verifies type (magic bytes) and size → extracts text (`unpdf` for PDF, `jszip` + XML parse for PPTX) → splits into chunks with page/slide numbers → embeds chunks.
- **Generate (cards, quiz, mindmap):** server collects a subject's chunks → checks the daily quota → hashes the input; returns cached output if present → calls the AI model (Groq) with the chunks wrapped as untrusted data → validates JSON against a zod schema → saves items, each pointing at its source `chunk_id` and character range.
- **Ask your notes:** embed question → top-k chunks by cosine similarity, filtered to the subject and user → the model answers only from those chunks with numbered citations → UI links each citation to the passage. If similarity is low, it says the notes don't cover it.

## 2. Data model (Phase 1, with Phase 2 hooks)

All tables: `id uuid pk`, `user_id uuid not null`, `created_at`, `updated_at`, RLS `user_id = auth.uid()`.

| Table | Key columns | Notes |
|---|---|---|
| `profiles` | display_name, timezone, sound_on, volume, theme, reduced_motion | settings remembered per user |
| `subjects` | name, colour, emoji, exam_date (nullable), archived | `exam_date` ready for Phase 2 countdown |
| `notes` | subject_id, title, content_json (rich text), content_text | typed notes |
| `sources` | subject_id, file_name, mime, size_bytes, storage_path, page_count, extract_status, origin (`upload`/`ocr` later) | lecturer PDFs/slides |
| `chunks` | subject_id, note_id or source_id, ordinal, page, text, embedding vector(384), content_hash | shared by citations, cards, quizzes, chat |
| `flashcards` | subject_id, front, back, chunk_id, source_quote, edited, deleted_at | source passage always shown |
| `card_reviews` | flashcard_id, rating (1–4), reviewed_at, stability, difficulty, due_at, state | FSRS history |
| `mindmaps` | subject_id, graph_json, input_hash | nodes carry chunk_id |
| `quizzes` | subject_id, kind (mcq/fill/mixed), input_hash | |
| `questions` | quiz_id, subject_id, type, prompt, options_json, answer, explanation, chunk_id, topic | editable |
| `quiz_attempts` / `answers` | score, finished_at / question_id, given, correct | Phase 2 dashboard reads these |
| `weak_topics` | subject_id, topic, miss_count, last_missed_at, cleared_at | re-mixed into later quizzes |
| `chat_messages` | subject_id, role, content, citations_json | |
| `study_sessions` | subject_id, kind (pomodoro/break), planned_min, started_at, ended_at | Phase 2 study hours |
| `timetable_slots` | subject_id, starts_at, ends_at, recurrence, google_event_id, etag, sync_state | |
| `calendar_connections` | provider, encrypted_refresh_token, scope, calendar_id | tokens encrypted (pgsodium/Vault) |
| `ai_usage` | day, kind, count, attempts, input_tokens, output_tokens | daily quota (successful goes and tries) + token tracking |
| `ai_cache` | input_hash, kind, model, output_json | avoids paying twice for the same notes |

## 3. Build steps and tasks

### Step 1: Auth, subjects, notes, uploads (built 2026-10-11, waiting for review)
1. Designer: pick concept → design system (tokens, type, motion, sound set) → specs for sign-in, subjects home, subject page, note editor, upload, settings, privacy.
2. Dev: scaffold Next.js + Tailwind + shadcn + Vitest + Playwright; PWA manifest; theme + sound provider (`useSound`, toggle, volume).
3. Dev: Supabase migrations for profiles, subjects, notes, sources, chunks, ai_usage (with RLS).
4. Dev: auth (magic link + Google), protected routes.
5. Dev: subjects CRUD with colour + emoji picker.
6. Dev: rich-text note editor (Tiptap) with autosave.
7. Dev: uploads (PDF/PPTX ≤ 25 MB), text extraction, chunking, embeddings; extraction status UI.
8. Dev: privacy page + export-all (JSON + files zip) + delete-account.
9. QA: e2e for sign-in, subject CRUD, note autosave, upload + extraction, mobile; RLS cross-user test.
10. Security: threat model v1, RLS tests, upload validation review, `/security-review`.
11. Demo on Vercel preview → **stop for review.**

### Step 2: Flashcards, spaced repetition, mindmap, read-aloud (built 2026-10-14, waiting for review)
Card generation (Groq `gpt-oss-20b`, cached, quota) with source quote per card; card editor; FSRS review session with flip animation, page-turn sound, confetti at the end; due-today counts; mindmap (React Flow) with nodes linking to passages; read-aloud for notes and cards. QA: FSRS interval tests, generation edge cases. Security: prompt-injection tests with hostile PDFs. **Stop for review.**

### Step 3: Quizzes, weak topics, ask-your-notes chat
Quiz builder (MCQ / fill-in / mixed, N questions); feedback (celebration / gentle shake); weak-topic list per subject; re-mix of missed topics into new quizzes; chat with retrieval and clickable citations, refusing to answer beyond the notes. **Stop for review.**

### Step 4: Pomodoro, timetable, Google Calendar
Timer with custom durations, wall-clock based (accurate in background tabs), filling/draining ring, chime, focus mode, sessions logged per subject; weekly timetable with drag to create; a private calendar link (.ics feed) students add to Google, Apple or Outlook Calendar, plus import of the university timetable file (.ics). Full two-way Google sync was dropped (Bradley, 2026-10-14): without a paid verified domain Google caps it at 100 users with weekly re-logins. **Stop for review.**

### After step 4
Polish pass, `docs/user-testing.md` (tester access, 20-minute task script, feedback form). Bradley runs the student test and decides on Phase 2.

## 3a. Implementation decisions (Step 1)

- **Next.js 16** (current release). Cache Components is left off: nearly every page is per-student and dynamic, and the previous caching model is simpler to reason about for private data. Middleware is now called `proxy` (`src/proxy.ts`).
- **Demo mode.** Without Supabase settings the app runs on an in-memory store (`src/server/repo/demo.ts`) behind the same `Repo` interface as Supabase. It powers local development and the e2e tests in CI without secrets. It's disabled in production builds unless `DEMO_MODE=1`.
- **Uploads go straight from the browser to Supabase Storage** with a signed upload URL, because Vercel caps request bodies at 4.5 MB. The server then downloads the file, checks its real type from its bytes, extracts text and deletes anything it wouldn't accept.
- **Own UI primitives instead of shadcn/ui** for Step 1 (button, dialog via native `<dialog>`, inputs). The sticker style replaces almost everything shadcn provides, so this kept the bundle small. Framer Motion arrives in Step 2 for card flips; Step 1 motion is CSS only.
- **Sounds are synthesised** with the Web Audio API (no audio files, no licences, nothing to download).
- **Zero cost (Bradley, 2026-10-11): everything must be free.** See section 3b.
- **Embeddings** use an Edge Function (`supabase/functions/embed`) with Supabase's free `gte-small` model. Uploads call it best-effort; if it isn't deployed yet, nothing breaks. Chat needs it in Step 3.

## 3c. Implementation decisions (Step 2)

- **AI calls** live in `src/lib/ai/` and run only on the server. `runAiTask` tries Groq (`openai/gpt-oss-20b`, JSON mode) and falls back to Cloudflare Workers AI (`@cf/meta/llama-3.1-8b-instruct-fast`, OpenAI-compatible endpoint) on a rate limit (429/413), outage or unusable reply. Without `GROQ_API_KEY` a deterministic local generator stands in (demo mode, CI, local development); it returns the same JSON shape, so it passes through the same validation. A production build without a key never uses it: flashcards and mindmaps say "AI isn't set up yet" instead (`aiMode()` in `providers.ts`).
- **Prompt-injection defence:** student text goes in as numbered passages (`p1`, `p2`, …) inside delimited data blocks, with instructions to treat it as data; delimiter look-alikes in the text are defused. The model may only cite passage refs, which the server maps back to the student's own chunk ids, so a reply can never point at another student's passage. Every reply is validated with zod and normalised (lengths, counts, quotes must really appear in the passage, mindmap ≤ 40 nodes and depth ≤ 3).
- **Cache:** raw model output is stored per student in `ai_cache` under a hash of the passage hashes, task and options (`inputHash`). On reuse it is validated again against the current passages, so stale links are impossible. Cached results cost no quota.
- **Quotas:** a generation reserves a slot first (`ai_usage_reserve`, atomic, per student per local day using `profiles.timezone`), then settles it as used or refunds it on failure (`ai_usage_settle`). The app-wide daily budget per model (`ai_app_usage`, UTC day; Groq 900 requests and 180,000 tokens, Cloudflare 300 and 150,000) is reserved the same way. The quota functions are callable only with the server's secret key. Tries are capped as well as successes (security review S2-2).
- **Writes:** `flashcards`, `card_reviews` and `mindmaps` are read-only to students; the server writes them with the secret key, every query pinned to the student's id (security review S2-1). Subjects (50) and notes (500 per subject) are also capped in the database.
- **Passages keep their ids when a note is edited:** re-chunking keeps the ids of passages whose text didn't change (`planChunkSync`), so cards and mindmap topics stay linked. Deleting a note or file clears the link, never the card ("Source deleted").
- **FSRS** via `ts-fsrs` (request retention 0.9, no fuzz). 20 new cards a day per student. Each grade is logged in `card_reviews` with a client key so a double tap can't grade twice, and Undo restores the previous schedule from the log.
- **Mindmap:** one per subject (`mindmaps`, unique per subject and student). The client lays out the tree radially with `d3-hierarchy`; dragged positions are saved into `graph_json`. "All sources" is sampled evenly when it is longer than one request allows (`MINDMAP_MAX_CHARS`); a hand-picked selection over the limit is refused with "Untick a few".
- **Read aloud:** one speech controller for the whole app (only one thing reads at a time), sentences split with `Intl.Segmenter`, prefs (speed, voice) per device in `localStorage`. UI sounds are skipped while it speaks.
- **New libraries (all free, open source):** `ts-fsrs` (MIT), `framer-motion` (MIT), `@xyflow/react` (MIT; its attribution link stays visible), `d3-hierarchy` (ISC).

## 3b. Zero-cost stack

Bradley's rule: the app must cost nothing to run. Every service below is on a free plan that needs no credit card, so there is no way for a bill to arrive. When a free allowance runs out, the feature pauses until the next day; it never charges.

| Need | Service (free plan) | Free allowance | What happens at the limit |
|---|---|---|---|
| AI: flashcards, quizzes, mindmaps, chat | **Groq API** (open models `openai/gpt-oss-120b` for quizzes and chat, `openai/gpt-oss-20b` for flashcards and mindmaps) | Per model, for the whole app: about 1,000 requests and 200,000 tokens a day, 30 requests a minute | Groq returns "rate limited"; the app tries the fallback |
| AI fallback | **Cloudflare Workers AI** | 10,000 "neurons" a day (roughly 280,000 output tokens on a small Llama model) | App shows "Today's free AI allowance is used up. Try again tomorrow." |
| Embeddings for ask-your-notes | Supabase Edge Function with built-in `gte-small` | Inside Supabase's 500,000 function calls a month | Chat falls back to keyword search |
| Database, sign-in, file storage | **Supabase Free** | 500 MB database, 1 GB files, 5 GB transfer a month, 50,000 monthly users. Paused after 7 days without activity (one click to wake) | Writes are blocked until space is freed; never billed |
| Hosting | **Vercel Hobby** | Free for personal, non-commercial projects | If StudyNest ever charges students, it needs a paid plan (or another free host) |
| Read-aloud | Browser's built-in voices (Web Speech API) | Unlimited | — |
| Calendar | Private .ics feed served by the app (no Google API) | Unlimited | — |
| Sounds | Generated in the browser | Unlimited | — |

**Why Groq and not the Claude API or Gemini:** the Claude API has no free plan. Gemini's free plan allows Google to use prompts to improve its products, which would break the privacy promise that students' notes aren't used for training. Groq doesn't keep API inputs by default (only short-lived abuse logs, up to 30 days, which can be switched off in its data controls), and Cloudflare commits not to train on prompts.

**What this means in practice:** Groq's allowance is shared by every student. One flashcard or quiz generation uses roughly 4,000 to 8,000 tokens, so the whole app gets about 25 to 50 generations a day per model, plus caching (the same notes are never generated twice). That's comfortable for a pilot with a handful of students, not for hundreds. The per-student limits below are set so one student can't use up everyone's allowance.

**Supabase free-plan care:** the project pauses after a week with no activity, so before a student test Bradley should open the app once to wake it. File storage is 1 GB for everyone, hence 100 MB per student.

## 4. Free-tier limits per student

| Action | Free limit per user per day |
|---|---|
| Flashcard generations | 5 |
| Quiz generations | 3 |
| Mindmap generations | 3 |
| Chat questions | 20 |
| Uploads | 20 files per 24 h, 25 MB each, 100 MB total (enforced from Step 1) |

Enforced server-side in `ai_usage`; the UI shows "3 of 5 left today". Cached results don't count. Failed generations give the go back, but tries are capped too (flashcards 15, mindmaps 9 a day, failures included) because each try still spends the shared allowance. On top of this, an app-wide daily budget stops before Groq's limit so students get a friendly message rather than errors.

## 5. Decisions and open questions

1. **Design concept:** B, Sticker Notebook (Bradley, 2026-10-11).
2. **Embeddings:** Supabase's free built-in `gte-small` (no extra service).
3. **Sign-in methods:** default, email magic link + Google. Microsoft can be added later.
4. **App name:** default, keep the working name "StudyNest".
5. **Free-tier numbers:** default, section 4 as written.
6. **Accounts still needed from Bradley (all free, no card):** Supabase project (URL, publishable key, secret key), Groq API key (from Step 2), Cloudflare account ID + Workers AI token (from Step 2, fallback), Vercel Hobby account. No Google Calendar OAuth needed (calendar link instead).
8. **Zero cost:** Bradley, 2026-10-11: everything must be free. AI moved from the Claude API to Groq + Cloudflare free plans (section 3b).
9. **Calendar (Bradley, 2026-10-14):** calendar link (.ics) instead of two-way Google sync.
7. **Repository:** github.com/BradleyTan/study-companion; each build step lands as a pull request.
