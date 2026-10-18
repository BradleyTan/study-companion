# Threat model

Last updated: 2026-10-14 (Step 2 review). Owner: security-engineer.

## What we protect
1. Students' notes, uploaded lecture files and extracted text (private, sometimes personal); from Step 2 their flashcards, review history and mindmaps.
2. Account identities (emails) and sessions.
3. Secrets: Supabase secret key, Groq and Cloudflare AI keys (Step 2+), Google OAuth tokens (Step 4).
4. The shared free AI allowance (Step 2+). No service has a card attached, so nothing can create a bill.

## Trust boundaries
Browser → Next.js server (Vercel) → Supabase (Postgres with RLS, Storage, Auth, Edge Functions) → Groq API, Cloudflare Workers AI fallback (Step 2+, free plans).
Every server action and route handler is a public endpoint. The browser only ever holds the publishable key and the student's own session.

## Threats and controls

| # | Threat | Control | Status |
|---|---|---|---|
| T1 | Student B reads or edits student A's notes/files | RLS `user_id = auth.uid()` on every table; sources, chunks and the upload log are read/delete-only for students, and flashcards, card reviews and mindmaps are read-only (only the server writes them, every query pinned to the student's id); Storage policies on `<user_id>/` folder; composite FKs `(subject_id, user_id)` so rows can't point at another student's subject; `storage_path` must start with owner id. Tested in `supabase/tests/10_rls.sql` and, through the server actions, in `src/server/actions/security.test.ts`. | Done |
| T2 | Forged or stale session | Pages use `auth.getUser()` (validated by Supabase Auth); the proxy only refreshes cookies and redirects. | Done |
| T3 | Malicious upload (executable, polyglot, macro deck, zip bomb) | Extension allow-list (pdf, pptx), magic-byte check, PPTX must contain `ppt/presentation.xml`, macro-enabled decks rejected, 25 MB cap (client, server action, bucket limit, DB check), 500 pages/slides cap, rejected files deleted, slide XML parsed in linear time (S2-16). Files are never rendered inline on our origin: Supabase signed URLs force download; demo route sends `attachment` + `nosniff`. | Done |
| T4 | Upload abuse / storage exhaustion | No Storage insert policy for students: the only way in is a one-path signed upload URL the server issues after limits pass. 20 uploads per 24 h counted from an append-only `upload_log` (deleting files doesn't reset it); 100 MB per student computed from the real stored size, not the size the browser claims. Files can't be downloaded until their contents are checked. | Done |
| T5 | Open redirect via sign-in callback | `next` must be a same-site relative path. | Done |
| T6 | Secret key exposure | Secret key only in `createSupabaseAdminClient` (server-only module, `server-only` import); every admin query is pinned to the student's id. Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key reach the browser. | Done |
| T7 | Demo mode enabled in production by accident | Demo mode needs both: no Supabase config, and non-production or explicit `DEMO_MODE=1`. With Supabase configured, demo mode is impossible. | Done |
| T8 | XSS via note content or file names | Tiptap renders a fixed schema (no raw HTML); React escapes text; no `dangerouslySetInnerHTML` except the constant theme script. | Done |
| T9 | Clickjacking, MIME sniffing, downgrade | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy, HSTS. | Done |
| T14 | Embedding function abused in a loop | Callable only with a server-held shared secret; pinned to one student's rows. | Done |
| T15 | Account deleted from an unattended laptop | Deletion needs a sign-in within the last 10 minutes plus typing DELETE. | Done |
| T16 | Sign-in links built from a spoofed Host header | `NEXT_PUBLIC_SITE_URL` required in production; Supabase redirect allow-list should list exact URLs only. | Done |
| T10 | Prompt injection from uploaded PDFs and notes | Text goes to the model only inside `<passage>` data blocks, with rules saying it is data, never instructions. Delimiters are defused, including look-alike, invisible-character and HTML-entity disguises, and the subject name is defused too. The model cites short refs (`p1`) only, which the server maps to the chunk ids it sent. Replies are validated with zod, clipped to the database limits, and quotes must appear in the cited passage. A successful injection can only affect the uploading student's own cards. Tested in `src/lib/ai/injection.test.ts`. | Done (Step 2 review) |
| T11 | AI allowance abuse (one student uses up the shared free AI allowance) | Server-side daily quotas per student in `ai_usage` (students can read, not write, their rows): successful goes (flashcards 15, mindmaps 3; flashcards raised from 5 by Bradley on 2026-10-17) and tries including failures (45 / 9). An app-wide daily budget per model below the free plan limit. Cache by content hash. Atomic reserve/settle functions callable only by `service_role`. A set where every card is already in the deck (`all_skipped`) gives the go back but keeps the try. No paid plan or card is attached anywhere, so abuse can't create a bill. Residual (S2-14): at 15 goes and 45 tries one student can use up most of the day's app-wide flashcard budget, so other students wait until tomorrow; needs a per-student token cap or throttle before more students join. | Done (Step 2 review); S2-14 open |
| T12 | Google OAuth token theft | Encrypted at rest (Vault), least scopes, revocable. | Step 4 |
| T17 | One student fills the shared free database with direct writes | Students can't write flashcards, reviews or mindmaps directly. Subject (50) and note (500 per subject) caps and the note size limits are enforced in the database as well as in server actions. Card text and quotes, mindmap JSON and sources JSON have size checks. | Done (Step 2 review) |
| T18 | Read-aloud text leaving the device | Web Speech with on-device voices first; online voices are labelled, with a hint that the browser's maker receives the text; stated on the privacy page. StudyNest sends nothing. | Done |
| T13 | Dependency vulnerabilities | `npm audit --omit=dev --audit-level=high` in CI. | Done |

## Step 1 security review (2026-10-11)
Reviewer: security-engineer. Verdict: no critical/high findings; cleared to merge after fixes.

| Finding | Severity | Status |
|---|---|---|
| Students could upload straight to Storage, skipping limits and type checks | Medium | Fixed: insert policy removed; server-issued signed URLs only |
| Upload size/count limits bypassable; unchecked files downloadable | Medium | Fixed: real size written back, append-only upload log, downloads only after checks |
| Open redirect via `next=/%09/evil.com` in sign-in callback | Low | Fixed: same-origin check with `new URL` |
| Sign-in links built from Host header if site URL unset | Low | Fixed: required in production |
| No CSP / HSTS | Low | HSTS added; CSP is a follow-up |
| Students could write processing fields (sources, chunks) | Low | Fixed: read/delete-only policies, RLS tests added |
| `embed` function had no rate limit | Low | Fixed: server-only shared secret |
| RLS tests run against a Supabase stub, not real Supabase | Low | Fixed 2026-10-12: two-student checks re-run on the live project (rolled back afterwards); Supabase security advisor clean after revoking API access to trigger functions |
| Account deletion had no re-authentication | Low | Fixed: sign-in within 10 minutes required |

## Step 2 security review (2026-10-14)
Reviewer: security-engineer. Verdict: no critical/high findings; cleared to merge after fixes. Details in `docs/security/step-2-review.md`.

| Finding | Severity | Status |
|---|---|---|
| S2-1 Students could write flashcards, reviews and mindmaps directly (QA A) | Medium | Fixed: read-only for students; server writes pinned to the student |
| S2-2 Failed AI generations retryable without limit, draining the shared allowance | Medium | Fixed: tries capped per student per day |
| S2-3 Subject and note caps only in server actions (from Step 1) | Medium | Fixed: enforced in the database |
| S2-4 Disguised prompt delimiters; subject name not defused | Low | Fixed |
| S2-5 Lone surrogates and control characters in AI text broke saves | Low | Fixed |
| S2-6 Time zone change shifts the per-student quota (QA B) | Low | Accepted: borrows adjacent days, doesn't raise the average |
| S2-7 Non-atomic note passage sync (QA C) | Low | Open (developer): own data only |
| S2-8 Privacy page out of date | Low | Fixed |
| S2-9 Make dialog read every file's full text per open, to count characters (long files) | Medium | Fixed: counts summed in the database (`source_page_chars`) |
| S2-10 makeFlashcards reads the whole file before the quota check | Low | Accepted: needs a general server-action rate limit |
| S2-11 Unbounded array from page numbers | Low | Fixed: capped at 10,000 |
| S2-12 Loose passages re-sent with every page range | Low | Accepted: own quota only |
| S2-13 Quadratic regex in `normaliseFront` (duplicate check) | Low | Fixed: linear trim, timing test |
| S2-14 15 goes / 45 tries per student can use most of the app-wide free AI budget | Medium | Accepted for the Phase 1 test; per-student token cap or 20 s throttle before more students |
| S2-15 defuse rewrite missed `</passageＸ>`-style tags; TAG quadratic on space runs | Medium | Fixed: unfolded pass restored, linear TAG |
| S2-16 Hostile PPTX: quadratic run parsing (minutes of CPU per deck) | Medium | Fixed: indexOf scanner, fuzz-checked |
| S2-17 Failed settle RPC can give a go back twice | Low | Accepted: tries still capped |
| S2-18 Read-aloud regexes quadratic on superscript runs (browser, own text) | Low | Accepted |

## Residual risks / follow-ups
- Clean up upload rows left `pending` (browser closed mid-upload) with a scheduled job, once Supabase is connected (free `pg_cron`).
- A Content-Security-Policy header is not set yet (Next inline scripts need nonces). Planned for the polish pass.
- Supabase Auth rate limits and email templates must be checked on the live project.
- Apply `20261014000002_step2_security_review.sql` to the live project, then run the Supabase security advisor and the two-student checks again.
- Prompt injection can't be fully prevented: a hostile lecture file can still make misleading cards for the student who uploaded it. Test against real Groq/Cloudflare replies in a preview deploy.
- Note passage sync should become one SQL transaction (S2-7, QA C).
- Apply `20261015000001_source_page_chars.sql` to the live project before deploying the long-files change.
- Add a per-student rate limit to server actions that aren't quota-gated (S2-10).
- Per-student AI token cap or per-minute throttle in `ai_usage_reserve`, or tries at 2× goes, before more students use the app (S2-14).
- Any new regex over passage or file text gets a timing test on a long adversarial run (S2-13, S2-15, S2-16).
- Account deletion relies on Supabase backups expiring (stated on the privacy page as 30 days).
