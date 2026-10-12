# Threat model

Last updated: 2026-10-11 (Step 1). Owner: security-engineer.

## What we protect
1. Students' notes, uploaded lecture files and extracted text (private, sometimes personal).
2. Account identities (emails) and sessions.
3. Secrets: Supabase secret key, Groq and Cloudflare AI keys (Step 2+), Google OAuth tokens (Step 4).
4. The shared free AI allowance (Step 2+). No service has a card attached, so nothing can create a bill.

## Trust boundaries
Browser → Next.js server (Vercel) → Supabase (Postgres with RLS, Storage, Auth, Edge Functions) → Groq API, Cloudflare Workers AI fallback (Step 2+, free plans).
Every server action and route handler is a public endpoint. The browser only ever holds the publishable key and the student's own session.

## Threats and controls

| # | Threat | Control | Status |
|---|---|---|---|
| T1 | Student B reads or edits student A's notes/files | RLS `user_id = auth.uid()` on every table; sources, chunks and the upload log are read/delete-only for students (only the server writes them); Storage policies on `<user_id>/` folder; composite FKs `(subject_id, user_id)` so rows can't point at another student's subject; `storage_path` must start with owner id. Tested in `supabase/tests/10_rls.sql`. | Done |
| T2 | Forged or stale session | Pages use `auth.getUser()` (validated by Supabase Auth); the proxy only refreshes cookies and redirects. | Done |
| T3 | Malicious upload (executable, polyglot, macro deck, zip bomb) | Extension allow-list (pdf, pptx), magic-byte check, PPTX must contain `ppt/presentation.xml`, macro-enabled decks rejected, 25 MB cap (client, server action, bucket limit, DB check), 500 pages/slides cap, rejected files deleted. Files are never rendered inline on our origin: Supabase signed URLs force download; demo route sends `attachment` + `nosniff`. | Done |
| T4 | Upload abuse / storage exhaustion | No Storage insert policy for students: the only way in is a one-path signed upload URL the server issues after limits pass. 20 uploads per 24 h counted from an append-only `upload_log` (deleting files doesn't reset it); 100 MB per student computed from the real stored size, not the size the browser claims. Files can't be downloaded until their contents are checked. | Done |
| T5 | Open redirect via sign-in callback | `next` must be a same-site relative path. | Done |
| T6 | Secret key exposure | Secret key only in `createSupabaseAdminClient` (server-only module, `server-only` import); every admin query is pinned to the student's id. Only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key reach the browser. | Done |
| T7 | Demo mode enabled in production by accident | Demo mode needs both: no Supabase config, and non-production or explicit `DEMO_MODE=1`. With Supabase configured, demo mode is impossible. | Done |
| T8 | XSS via note content or file names | Tiptap renders a fixed schema (no raw HTML); React escapes text; no `dangerouslySetInnerHTML` except the constant theme script. | Done |
| T9 | Clickjacking, MIME sniffing, downgrade | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, strict referrer policy, HSTS. | Done |
| T14 | Embedding function abused in a loop | Callable only with a server-held shared secret; pinned to one student's rows. | Done |
| T15 | Account deleted from an unattended laptop | Deletion needs a sign-in within the last 10 minutes plus typing DELETE. | Done |
| T16 | Sign-in links built from a spoofed Host header | `NEXT_PUBLIC_SITE_URL` required in production; Supabase redirect allow-list should list exact URLs only. | Done |
| T10 | Prompt injection from uploaded PDFs | Extracted text will be passed to the AI model only inside delimited data blocks with instructions to treat it as data; outputs validated with zod. | Step 2 |
| T11 | AI allowance abuse (one student uses up the shared free AI allowance) | Server-side daily quotas per student in `ai_usage` (students can read, not write, their rows), an app-wide daily budget below the free plan limit, cache by content hash. No paid plan or card is attached anywhere, so abuse can't create a bill. | Step 2 |
| T12 | Google OAuth token theft | Encrypted at rest (Vault), least scopes, revocable. | Step 4 |
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

## Residual risks / follow-ups
- Clean up upload rows left `pending` (browser closed mid-upload) with a scheduled job, once Supabase is connected (free `pg_cron`).
- A Content-Security-Policy header is not set yet (Next inline scripts need nonces). Planned for the polish pass.
- Supabase Auth rate limits and email templates must be checked on the live project.
- Account deletion relies on Supabase backups expiring (stated on the privacy page as 30 days).
