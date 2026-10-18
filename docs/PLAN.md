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
| `chat_messages` | subject_id, role, kind (question/answer/not_covered), content, citations_json (with quotes), reveal, feedback, client_key, reply_to | read-only to students; 1,000 per subject |
| `study_sessions` | subject_id, kind (pomodoro/break), planned_min, started_at, ended_at | Phase 2 study hours |
| `timetable_slots` | subject_id, starts_at, ends_at, recurrence, google_event_id, etag, sync_state | |
| `calendar_connections` | provider, encrypted_refresh_token, scope, calendar_id | tokens encrypted (pgsodium/Vault) |
| `ai_usage` | day, kind, count, attempts, input_tokens, output_tokens | daily quota (successful goes and tries) + token tracking |
| `ai_cache` | input_hash, kind, model, output_json | avoids paying twice for the same notes; server-only (a cached quiz holds its answers; Step 3 security review) |

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

### Step 3: Quizzes, weak topics, ask-your-notes chat (built 2026-10-18, waiting for review)
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
- **Quotas:** a generation reserves a slot first (`ai_usage_reserve`, atomic, per student per local day using `profiles.timezone`), then settles it as used or refunds it on failure (`ai_usage_settle`). The app-wide daily budget per model (`ai_app_usage`, UTC day; Groq 900 requests and 180,000 tokens per model, Cloudflare 300 and 150,000) is reserved the same way. The quota functions are callable only with the server's secret key. Tries are capped as well as successes (security review S2-2).
- **Writes:** `flashcards`, `card_reviews` and `mindmaps` are read-only to students; the server writes them with the secret key, every query pinned to the student's id (security review S2-1). Subjects (50) and notes (500 per subject) are also capped in the database.
- **Passages keep their ids when a note is edited:** re-chunking keeps the ids of passages whose text didn't change (`planChunkSync`), so cards and mindmap topics stay linked. Deleting a note or file clears the link, never the card ("Source deleted").
- **FSRS** via `ts-fsrs` (request retention 0.9, no fuzz). 20 new cards a day per student. Each grade is logged in `card_reviews` with a client key so a double tap can't grade twice, and Undo restores the previous schedule from the log.
- **Long lecture files (2026-10-15):** a file whose text is longer than one flashcard request (`FLASHCARDS_MAX_CHARS`, 14,000 characters) is made as a series of page ranges. `fitPageRange` in `src/lib/page-range.ts` is the one fit rule for the dialog's hints and the server: add pages while the range (plus passages without a page number) fits, at most 50 pages (`MAX_CARD_PAGES`). A wider range is sampled evenly. The server returns the next range; the browser remembers the furthest page per file. Each set uses one go.
- **Any pages, up to 50 (Bradley, 2026-10-17):** a set can be any range of up to 50 pages, sequential (1–20, 21–40) or overlapping (1–20, 15–34). Still one AI request per set: a wide range is a quick sample within `FLASHCARDS_MAX_CHARS` (no multi-request "read everything"). Quick picks "Best fit / 20 pages / 50 pages (or All N pages)". The server's `next` keeps the size the student chose (a best-fit set keeps the fit rule; `seriesNext`). Before saving, cards whose normalised front matches a non-deleted AI card from the same file (or, for notes, the same note) in the subject are skipped (`skipped` in the result); if every card is skipped nothing is saved and the go is refunded (it still counts as a try). Progress is the union of ranges made, kept per browser in `localStorage` (`studynest:cardRanges:<id>`); the old `cardRange` key is read once and removed. Files that fit one set get an optional "Choose pages".
- **Quality and accuracy as important as quantity (Bradley, 2026-10-17):** the flashcard prompt asks for answers only from the passages (numbers, units, names and terms as written; skip ambiguous passages), key concepts over trivia, one fact per card, answers that stand alone, and an even spread across passages from several pages. `normaliseFlashcardsWithStats` then drops cards that are too short or not a question, whose answer repeats the question, near-duplicate questions in the set, cards citing a passage that wasn't sent, and answers the cited passage doesn't support (a number not in the passage, or under half of the answer's content words found there, `isGrounded`). Dropped cards are never replaced by weaker ones; the student only sees the existing "Your notes had enough for N cards." when fewer than half the requested cards are left. No extra AI calls.
- **Mindmap:** one per subject (`mindmaps`, unique per subject and student). The client lays out the tree radially with `d3-hierarchy`; dragged positions are saved into `graph_json`. "All sources" is sampled evenly when it is longer than one request allows (`MINDMAP_MAX_CHARS`); a hand-picked selection over the limit is refused with "Untick a few".
- **Read aloud:** one speech controller for the whole app (only one thing reads at a time), sentences split with `Intl.Segmenter`, prefs (speed, voice) per device in `localStorage`. UI sounds are skipped while it speaks.
- **New libraries (all free, open source):** `ts-fsrs` (MIT), `framer-motion` (MIT), `@xyflow/react` (MIT; its attribution link stays visible), `d3-hierarchy` (ISC).

## 3d. Implementation decisions (Step 3, part 1: quizzes and weak topics)

- **Model and budget:** quizzes use Groq `openai/gpt-oss-120b` (`GROQ_MODELS.quiz`) with the same Cloudflare fallback and local stand-in generator as Step 2. The 120b model has its own app-wide daily budget row (`MODEL_BUDGET` in `src/lib/limits/ai.ts`: 900 requests, 180,000 tokens, as for 20b); `appBudgetFor(provider, model)` picks it for both reserving and the "allowance left" check. Student limit: 3 quizzes a day, 9 tries (failures included).
- **Input size:** one request reads at most `QUIZ_MAX_CHARS` = **12,000 characters** (the spec suggested 14,000). The 120b model's free plan allows 8,000 tokens a minute; 12,000 characters (about 3,000 tokens) plus the rules and up to 4,000 output tokens stays under it, so one quiz never trips the per-minute limit. Page ranges reuse `src/lib/page-range.ts` with this budget (helpers take a `budget` and the "Questions" wording), max 50 pages, default page 1 to best fit. "Everything" is sampled evenly across all notes and ready files (same spread as the mindmap's "All sources"). Source selection is shared with flashcards (`src/server/source-select.ts`).
- **Accuracy (`normaliseQuizWithStats`, `src/lib/ai/quiz.ts`):** a question must cite a passage that was sent; the quote must be in that passage; the answer must be grounded in it (`isGrounded`, numbers and units as written, and in the sentence near the quote); MCQ has exactly 4 distinct options, exactly 1 matching the answer, no "all/none of the above", no "both A and B", and the right option can't be the odd one out by length; fill-in has exactly one blank, an answer of 1–4 words (or a number with its unit) found in the passage, not guessable from the rest of the sentence, and at most 3 accepted alternatives; topic ≤ 40 characters, matched case-insensitively to existing weak-topic and question topics (sent to the model as defused data); explanation grounded in the same passage; near-duplicate prompts dropped. From QA (2026-10-18): a fill-in sentence or explanation that copies a run of the passage but swaps in another of its terms or numbers is dropped (`contradictsPassage`, `src/lib/ai/contradict.ts`: "Mitosis produces four haploid gametes" when the passage says meiosis, "work best at 45 °C" when it says 37 °C, "3′ to 5′" reversed); a species whose genus the passage never names isn't grounded; "Two" and "2" are the same option. Dropped questions are never replaced; under 3 good questions counts as "too little text" and the go is refunded. Mixed quizzes are interleaved so no 3 of one type in a row when avoidable. The server shuffles MCQ options when saving and again per attempt.
- **Answers stay on the server until answered:** the quiz screen gets prompts, options and topics only; `checkAnswer` returns the answer, explanation, quote and source link after saving the answer. In Supabase the students' own key can't read `questions.answer`, `correct_index`, `accepted_json` or `explanation` either (column grants); the server reads them with the secret key pinned to the student's id.
- **Attempts and answers:** an attempt stores its own question and option order (`order_json`), so a retake is reshuffled and the client sends the option as shown. Each answer is saved at once with a client key (unique per student), so a double tap or a retry returns the first result. Attempts are created by the quiz screen, never by rendering the page, so prefetches don't make rows. A quiz keeps its newest 45 attempts (database cap 50).
- **Fill-in matching** (`src/lib/quiz/match.ts`, one function used for every check): trim, lower-case, no diacritics, collapsed spaces, no leading "the/a/an", no trailing punctuation; numbers compare by value with matching units ("25 °C" = "25°C" = "25 degrees C"); singular/plural of the last word; a number word counts as its number ("five" = 5); one typo (shown as "watch the spelling") only in one word of 6+ plain letters with the first letter right, and only as a swap of neighbouring letters, a vowel or doubled letter left out or added, y/i, or another letter in the middle of the word (not its first two or last four letters). From QA (2026-10-18): plain edit distance 1 accepted different science terms (afferent/efferent, nitrate/nitrite, ethane/ethene, lactose/lactase, ligase/lipase, insulin/inulin, neuron/neutron, S phase/M phase, vitamin D/E); a student whose spelling is refused can still use "I think my answer is right". Any accepted alternative counts.
- **Weak topics** (`src/lib/quiz/weak.ts`): a miss (wrong or "I don't know") adds 1, resets the streak, reopens a cleared topic and remembers the question's passage (10 most recent). 2 right in a row clears it. "I think my answer is right" (wrong fill-ins) marks the answer right, undoes exactly that miss from the state saved on the answer (`weak_prev`) and adds the answer to the question's accepted list. "Report a problem" removes the question from the quiz and also takes its miss back. "Practise what I missed" and "Practise" make a new quiz from the passages behind the ticked topics, with those topics sent to the model as focus.
- **Database** (`20261018000001_step3_quizzes_weak_topics.sql`): `quizzes`, `questions`, `quiz_attempts`, `answers`, `weak_topics`, all read-only to students (writes through server actions with the secret key pinned to the student's id), composite `(id, user_id)` foreign keys, and caps in the database: 200 quizzes per subject, 20 questions per quiz, 50 attempts per quiz, 500 weak topics per subject. Deleted quizzes are soft-deleted for Undo and purged a minute later, before the next quiz is made.
- **Ask your notes** was built as Step 3 part 2 (see 3e); its tile on the subject page is now a link.

## 3e. Implementation decisions (Step 3, part 2: ask-your-notes chat)

- **Model and budget:** `openai/gpt-oss-120b` (`GROQ_MODELS.chat`), same Cloudflare fallback and local stand-in as the rest; it shares the 120b app budget row with quizzes. Student limit: 20 questions a day, 60 tries (`DAILY_LIMITS.chat`, `DAILY_ATTEMPTS.chat`). One question sends at most `CHAT_MAX_CHARS` = 7,200 characters of passages (top 6), last 4 messages and up to 1,200 output tokens: roughly 3,000 to 4,000 tokens, so the 180,000-token 120b budget is shared by about 45 to 60 questions plus quizzes for the whole app a day. That is enough for a pilot, not more; the app-wide budget check stops before Groq's limit.
- **Retrieval** (`retrieve()` in `src/server/chat.ts`, rules in `src/lib/chat/retrieve.ts`): passages from the subject only (notes and ready files), top 6. With embeddings: `match_chunks` (pgvector cosine, `gte-small` 384-d through the `embed` Edge Function) keeps passages with similarity ≥ 0.75 (0.7 shown as "closest I found"). Without them, or for passages not embedded yet: `search_chunks` (Postgres full-text search, GIN index) narrows to 30 candidates and `rankByKeywords` scores the question's key terms (asking words dropped); a passage counts at ≥ 0.5 of the terms, or 2 or more terms. Both functions are `SECURITY INVOKER`, `search_path ''`, filter on `user_id = auth.uid()` and are callable only by signed-in students. Keyword mode shows "Searching your notes by keywords today…". A follow-up with no match is searched again together with the previous question.
- **Embeddings:** notes and files are embedded best-effort; any passage still without an embedding when a student asks is backfilled after the reply (`after()`, `backfillSubjectEmbeddings`, 200 at a time). The `embed` function also takes `{query}` for the question's embedding. **It must be redeployed** (`supabase functions deploy embed`) for vector search; until then chat runs on keywords.
- **Not covered:** when nothing is close enough, the model isn't called, the question isn't used (the try is, like any reserved go) and the reply is "Your notes don't cover that yet, so I won't guess.", with up to 2 "closest I found" links. A model reply with nothing grounded left also becomes "not covered", and that one uses the question.
- **Grounded answers** (`normaliseChatReply`, `src/lib/chat/answer.ts`): no streaming; the whole reply is validated with zod first. Each sentence must cite at least one passage that was sent (`[p1]`, `[p1, p3]` and similar groups accepted) and be grounded in the cited passages (`isGrounded`, the same check as cards and quizzes) without swapping one passage term for another (`contradictsPassage`, added in QA: "Efferent neurons carry impulses towards the CNS" when the passage says afferent); other sentences are dropped. Citations are renumbered 1, 2, 3 in order of first use and mapped to the student's own chunk ids, with the cited sentence kept as a quote so the citation survives the note being edited or deleted. Output is a safe Markdown subset (paragraphs, `-` and `1.` lists, bold, citation markers); HTML, links, images, code, tables and headings are stripped; the client renders it as React text nodes, never HTML. Max 200 words. "Quiz me" replies need a separate grounded answer behind "Show answer".
- **Prompt injection:** the question, history and subject name go to the model as defused JSON data in the user message, passages in the usual delimited blocks; the rules say both are data. History is the last 4 messages.
- **Cache:** answers are cached by passages + question + recent conversation (`inputHash("chat", …)`), so asking the same thing again is free; quiz questions are never reused.
- **Storage** (`20261018000002_step3_chat.sql`, not yet applied to the live project): `chat_messages`, read-only to students (server writes with the secret key pinned to the student's id), composite `(id, user_id)` foreign keys to subjects and to the question it answers, length and size caps, a unique client key per student (a double send returns the first exchange), and a cap of 1,000 messages per subject in the database. The server prunes the oldest exchanges down to 900 before adding when a subject is full. Clearing a chat deletes only that subject's messages.

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

**What this means in practice:** Groq's allowance is shared by every student. One flashcard or quiz generation uses roughly 4,000 to 8,000 tokens, so the whole app gets about 25 to 50 generations a day per model, plus caching (the same notes are never generated twice). That's comfortable for a pilot with a handful of students, not for hundreds. The per-student limits below are set so one student can't use up everyone's allowance. With 15 flashcard sets a day per student (2026-10-17) a few very active students can reach the app-wide budget; when that happens everyone gets the friendly "try tomorrow" message, never a bill.

**Supabase free-plan care:** the project pauses after a week with no activity, so before a student test Bradley should open the app once to wake it. File storage is 1 GB for everyone, hence 100 MB per student.

## 4. Free-tier limits per student

| Action | Free limit per user per day |
|---|---|
| Flashcard generations | 15 (Bradley, 2026-10-17; was 5) |
| Quiz generations | 3 |
| Mindmap generations | 3 |
| Chat questions | 20 |
| Uploads | 20 files per 24 h, 25 MB each, 100 MB total (enforced from Step 1) |

Enforced server-side in `ai_usage`; the UI shows "13 of 15 left today". Cached results don't count. Failed generations give the go back, but tries are capped too (flashcards 45, quizzes 9, mindmaps 9 a day, failures included; 3× the goes) because each try still spends the shared allowance. On top of this, an app-wide daily budget stops before Groq's limit so students get a friendly message rather than errors.

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
