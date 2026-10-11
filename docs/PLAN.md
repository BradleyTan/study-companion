# Plan: Study App Phase 1 MVP

Status: **approved 2026-10-11.** Bradley picked **Concept B, Sticker Notebook**. Open questions without an explicit answer use the defaults marked below; Bradley can change any of them.

## 1. Architecture

```
Browser (Next.js client, PWA)
  │  UI, animations, sounds (Web Audio), read-aloud (Web Speech), Pomodoro clock
  ▼
Next.js server (Vercel)
  │  Server actions + route handlers: validation (zod), auth check, quotas
  │  src/lib/ai  → Anthropic Claude API (key server-side only)
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
- **Generate (cards, quiz, mindmap):** server collects a subject's chunks → checks the daily quota → hashes the input; returns cached output if present → calls Claude with the chunks wrapped as untrusted data → validates JSON against a zod schema → saves items, each pointing at its source `chunk_id` and character range.
- **Ask your notes:** embed question → top-k chunks by cosine similarity, filtered to the subject and user → Claude answers only from those chunks with numbered citations → UI links each citation to the passage. If similarity is low, it says the notes don't cover it.

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
| `ai_usage` | day, kind, count, input_tokens, output_tokens | daily quota + cost tracking |
| `ai_cache` | input_hash, kind, model, output_json | avoids paying twice for the same notes |

## 3. Build steps and tasks

### Step 1: Auth, subjects, notes, uploads
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

### Step 2: Flashcards, spaced repetition, mindmap, read-aloud
Card generation (Haiku, cached, quota) with source quote per card; card editor; FSRS review session with flip animation, page-turn sound, confetti at the end; due-today counts; mindmap (React Flow) with nodes linking to passages; read-aloud for notes and cards. QA: FSRS interval tests, generation edge cases. Security: prompt-injection tests with hostile PDFs. **Stop for review.**

### Step 3: Quizzes, weak topics, ask-your-notes chat
Quiz builder (MCQ / fill-in / mixed, N questions); feedback (celebration / gentle shake); weak-topic list per subject; re-mix of missed topics into new quizzes; chat with retrieval and clickable citations, refusing to answer beyond the notes. **Stop for review.**

### Step 4: Pomodoro, timetable, Google Calendar
Timer with custom durations, wall-clock based (accurate in background tabs), filling/draining ring, chime, focus mode, sessions logged per subject; weekly timetable with drag to create; optional two-way Google Calendar sync (separate "Study" calendar, conflict rule: last edit wins with a visible notice). **Stop for review.**

### After step 4
Polish pass, `docs/user-testing.md` (tester access, 20-minute task script, feedback form). Bradley runs the student test and decides on Phase 2.

## 4. Proposed free-tier limits (for approval)

| Action | Free limit per user per day |
|---|---|
| Flashcard generations | 10 |
| Quiz generations | 5 |
| Mindmap generations | 5 |
| Chat questions | 30 |
| Uploads | 20 files, 25 MB each, 500 MB total |

Enforced server-side in `ai_usage`; the UI shows "7 of 10 left today". Cached results don't count.

## 5. Decisions and open questions

1. **Design concept:** B, Sticker Notebook (Bradley, 2026-10-11).
2. **Embeddings:** default, Supabase's free built-in `gte-small` (no extra service).
3. **Sign-in methods:** default, email magic link + Google. Microsoft can be added later.
4. **App name:** default, keep the working name "StudyNest".
5. **Free-tier numbers:** default, section 4 as written.
6. **Accounts still needed from Bradley:** Supabase project (URL, anon key, service-role key), Anthropic API key, Vercel account. Google Calendar OAuth waits until step 4.
7. **Repository:** github.com/BradleyTan/study-companion; each build step lands as a pull request.
