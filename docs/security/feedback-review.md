# Student feedback security review

Date: 2026-10-28. Reviewer: security-engineer. Branch `claude/feedback-ai-quality-kgmile`, reviewed against `main` (`git diff main...HEAD`, up to `5c16ae5`).
Scope: "Make study notes" from a note, a file's page range or a web link (`src/server/actions/study-notes.ts`, `src/lib/ai/notes.ts`, `src/lib/notes/doc.ts`, `src/components/notes/make-notes-dialog.tsx`), the server-side web fetch (`src/server/web-page.ts`, `src/lib/extract/html.ts`), mindmap node details (`src/lib/ai/schemas.ts` `nodeDetail`/`normaliseMindmap`/`mindmapGraph`, `src/components/mindmap/*`), exam-style flashcard checks (`src/lib/ai/prompts.ts`, `examFront`, `cardQualityIssue`), and the `notes` quota kind (`src/lib/limits/ai.ts`, `supabase/migrations/20261028000001_study_notes_quota.sql`).

**Verdict: the branch's own code is cleared. Merging is still blocked by CI's audit step (FB-0).** The branch has no critical or high findings. The one medium finding (FB-1, a compression bomb kept the server busy after the 2 MB cap) and four low findings are fixed in the working tree, each with a test. One low finding is accepted. FB-0 is a critical and a high advisory in `next` and `zod`. This branch didn't cause them: `package.json` is the same as on `main`, and `main` fails the same audit. CI runs `npm audit --omit=dev --audit-level=high`, so it fails on this branch and on `main` until Bradley approves the patch upgrades. Nothing was applied to the live database or any live service.

## Findings

| # | Severity | Finding | Where | Fix | Status |
|---|---|---|---|---|---|
| FB-0 | Critical (pre-existing, not from this branch) | **`npm audit --omit=dev` reports 1 critical and 1 high.** `next` 16.4.0 is in the range 16.0.0–16.4.0, which has three advisories: GHSA-2464-fhr4-w9xw (unauthenticated RCE in the Image Optimization API when SVG files are used; `/_next/image` is on by default and `public/icon.svg` exists), GHSA-p3m5-59mp-jv5r (DoS through Server Actions) and GHSA-673q-mjm6-r5xr (RCE in `use cache` functions; we don't use `use cache`). `zod` 4.6.5 has GHSA-mrhx-c7xc-m3w5 (memory exhaustion while validating oversized constrained collections). This one matters here because `serverActions.bodySizeLimit` is `26mb`, and several action inputs have `z.array(...).max(500)`. | `package.json:27`, `package.json:33`, `next.config.ts` | Pin `next` to `16.4.3`. This is a patch release, but `npm audit fix --force` calls it outside the range because the version is pinned exactly. Upgrade `zod` to `^4.6.6` (inside the current range). Then run the full test, e2e and build. I didn't change either one: this is a dependency change, so Bradley must approve it. | **Open** (needs Bradley) |
| FB-1 | Medium | **A compression bomb kept the server busy after the 2 MB cap.** When the decompressed body reached 2 MB, `requestOnce` destroyed the request but left the zlib stream running. The stream then decompressed all the compressed input it already held, in the libuv thread pool, after the action had returned and with no deadline. Measured: a 48 KB brotli body (256 MB of text) cost 650 ms of CPU *after* `readWebPage` resolved. A 3.2 KB brotli body unpacks to 4 GB, which is several seconds of thread-pool time per request. A few of these in parallel also stall DNS lookups and file reads for every other request on the instance (the pool has 4 threads). Anyone with an account can trigger it 15 times a day, and making accounts is free. | `src/server/web-page.ts:119-133` | At the cap (and at the end of the body) `finish()` now unpipes and destroys the decompressor before it destroys the request. A decompressor error also destroys the request. After the fix the same bomb costs 30 ms of CPU in total. | **Fixed**, test "stops unpacking a compression bomb at the cap, also in the background (FB-1)" counts the bytes decompressed (fails before the fix with 64 MB) |
| FB-2 | Low | **Unwanted response bodies were drained until the deadline.** For a redirect, an error status or a non-HTML reply, the code called `res.resume()`, which reads and throws away the body. A server can send that body forever. While the fetch moved on to the next hop, the old connection kept downloading until the 10 s timer fired: 16 MB in 2 s in the test. | `src/server/web-page.ts:111-116` | Resolve, then `req.destroy()` (with a no-op `res` error listener so the abort can't throw). | **Fixed**, test "closes a redirect's connection instead of reading its body (FB-2)" |
| FB-3 | Low | **The new "according to the notes" suffix regex backtracked cubically.** The pattern ended in `\s*([?.!]?)\s*$`, which is two `\s*` around an optional character, after an unanchored `,?\s+`. With a run of spaces, then "according to the notes", then more spaces and a "?" that isn't the last character, every start in the first run tried every split of the second run. One 500-character front (the clip limit) took about 20 ms, so a reply of 50 such fronts costs about 1 s of CPU. A 5,000-space version took 15 s. To get this, a student would have to steer the model with their own notes, and only their own request pays. The rule from T20 still applies. | `src/lib/ai/schemas.ts:85-93` | `examFront` trims first, and the pattern now ends in `\s*([?.!]?)$`, so the backtracking is linear for each start. Behaviour is the same, and `"…, according to the notes ?"` still becomes `"…?"`. | **Fixed**, test "stays fast when spaces surround 'according to the notes'…" (14.9 s before the fix, under 300 ms after) |
| FB-4 | Low | **Text offsets drifted on pages with "İ".** `htmlToText` found closing `</script>`-style tags in `html.toLowerCase()` but used those indexes on `html`. `"İ".toLowerCase()` is two UTF-16 units, so each "İ" before a script moved the index one place later. Text after the script was then silently dropped: 40 "İ"s and a `<script>` lost the rest of the page. This loses content and doesn't leak anything, because the indexes only ever move later. Turkish pages would come out empty, and a page could hide text from the notes. | `src/lib/extract/html.ts:63` | Lower-case ASCII only (`[A-Z]+`), so the copy is the same length. The tag names we look for are ASCII. | **Fixed**, test "keeps the text after a script when the page has characters whose lower case is longer (FB-4)" |
| FB-5 | Low | **The privacy page was wrong.** It said "We never fetch a web address for you", and its AI section didn't list study notes. | `src/app/privacy/page.tsx:40,45-51,69` | Added a "Study notes from a web page" section: our server opens the public page once, as StudyNest; the site sees our server, not the student; only the notes and the link are kept; private networks and sign-in pages are never opened. The timetable line now says "We never fetch a timetable from a web address". Study notes are added to the AI list. The ui-ux-designer may want to check the wording. | **Fixed** |
| FB-6 | Low | **The error code shows whether a name points at a private address.** A name that resolves to a private address gets `blocked`, and one that doesn't resolve or connect gets `unreachable`. A student can use this to learn whether a hostname resolves to an internal address. Vercel's resolver has no private zones of ours, ports are limited to 80/443, and nothing is ever connected to inside a private range. | `src/server/web-page.ts:81,152`, `make-notes-dialog.tsx:33` | None needed: the copy is generic ("That link can't be opened from StudyNest. Try a public web page.") and a separate code helps support. | **Accepted** |

## Checked, no finding

### SSRF (`src/server/web-page.ts`)
I checked each of these with the real rules (scratch tests, then removed; the main cases are now in `web-page.test.ts`):
- **IPv4 forms**: `2130706433`, `0x7f.1`, `0177.0.0.1`, `127.1`, `0`, and the full-width `①②⑦.0.0.1` are all normalised by WHATWG `URL` into dotted IPv4 before `isIP`, and all are `blocked`.
- **IPv6 forms**: these are `blocked`: `[::1]`, `[::]`, `[::ffff:127.0.0.1]` (normalised to `::ffff:7f00:1`), `[0:0:0:0:0:ffff:7f00:1]`, `[::ffff:0:7f00:1]` and `[::ffff:0:127.0.0.1]` (IPv4-translated), `[::127.0.0.1]` (IPv4-compatible), `[64:ff9b::7f00:1]` (NAT64), `[2002:7f00:1::]` (6to4), `[2001::1]` (Teredo), `fec0::1` (site-local), `fe80::/10`, `fc00::/7` (including AWS `fd00:ec2::254`) and `ff00::/8`. A zone id (`[fe80::1%25eth0]`) is `bad_url`. `3ffe::1` (the retired 6bone range) is allowed. That's harmless because it isn't routed.
- **Names**: `localhost`, `localhost.`, `LOCALHOST`, `metadata.google.internal`, `printer.local` and single-label names are refused before DNS. `127.0.0.1.nip.io` passes the URL rules but is refused in the guarded `lookup`. The test "checks the addresses a name resolves to…" now proves this end to end against `localhost`.
- **DNS rebinding**: the check runs inside the socket's own `lookup`, and the same answer is handed to `net.connect`, so no second resolution can swap in a private address. If any address in the answer is private, the whole name is refused.
- **Happy Eyeballs**: Node 22 sets `autoSelectFamily: true` by default and calls `lookup` with `all: true`. The guard always resolves with `all: true` and answers in whichever form was asked for. Tested on Node 22.22.
- **IP literals**: Node skips `lookup` for these, and `requestOnce` checks them before connecting on every hop.
- **Redirects**: at most 4. Each `Location` is resolved against the current URL and goes through `parseWebUrl` and the guarded `lookup` again. The tests cover redirects to `localhost` and to `169.254.169.254`, and a redirect loop.
- **Proxies**: with `agent: false`, `HTTP_PROXY` and `NODE_USE_ENV_PROXY=1` aren't used. I checked this on Node 22.22: the custom `lookup` was still called and the proxy got nothing. `agent: false` also means no keep-alive socket can be reused across hops.
- **TLS**: default verification (`rejectUnauthorized` true). The request sends no cookies and no auth headers.
- **Response data**: only a `WebError` code goes back to the browser, never the page, headers or the address.

### Resource limits
- One 10 s deadline covers the whole fetch, redirects included, and there's an idle socket timeout as well. A slow-drip page (1 byte every 50 ms) ends with `too_slow` at 10.0 s.
- The 2 MB cap is counted after decompression. Node's default 16 KB limit covers the headers. Only `text/html`, `application/xhtml+xml` and `text/plain` bodies are read.
- **`htmlToText`** is linear: it uses `indexOf` and a quote-aware tag scan capped at 8 KB per tag. Two quote types can keep at most two expensive scans open in any 8 KB stretch, so the total work is about 2n. I timed 21 hostile 2 MB inputs (unclosed quotes, `<` floods, entity floods, `<nav>`/`<li>`/`<main>` floods, comment and `<!` floods, `role=` floods, whitespace and list-dash runs), and the slowest took 307 ms. The new regexes over page text are short and anchored (`^<(\/?)([a-zA-Z]…)` on 40 characters, entity decoding with bounded quantifiers). The `tidy` passes run after whitespace is collapsed. Text is capped at 60,000 characters before chunking.
- **`charsetOf`**: the meta regex runs on the first 4 KB with `[^>]{0,200}?`. An unknown label falls back to UTF-8.

### Prompt injection
Web text goes through `chunkPages` → `toPassages` → `passagesBlock`, the same defused `<passage>` blocks as notes and files, with the same `DATA_RULES`. The page title never reaches the model; it's only the fallback note title (200, then 80 characters, rendered as text). Every note point and key term must pass `isGrounded`, `groundedNearQuote` and `contradictsPassage` against the passage it cites, and a key term must also appear in that passage. The web passages' ids are local (`web-0`…) and never stored. The new note gets its own chunks through `syncNoteChunks`. A hostile page can only shape the notes of the student who linked it, and the notes' first line says to check them against the original.

### `makeStudyNotes` and quota
- **Input validation**: zod checks the input: `subjectId` is a uuid, and `source` is a discriminated union of a note id, a file id with a page range of at most 50 pages, or a URL string of 1 to 2,000 characters.
- **Ownership**: the subject goes through `repo.getSubject` (RLS), and notes and files through `sourceChunks` (the same helper as flashcards). Another student's id gets "not found", as the existing test shows. The 500-notes-per-subject cap is checked before anything else.
- **Quota order**: `parseWebUrl` runs before the reserve, so a bad or blocked link costs nothing. Then `reserveAi(day, "notes", 5, 15)` runs before the fetch. Every exit after the reserve settles the go exactly once: a read error, too little text, an AI failure or a thrown error gives the go back in `finally`, and a cache hit after a read gives it back explicitly. Failed tries still count toward the 15 a day. Note and file cache hits don't reserve at all.
- **Cache key**: `inputHash("notes", contentHashes)` includes `PROMPT_VERSION`, which is now 3. That bump also stops mindmap and flashcard replies made with the old prompts or the old mindmap model from being reused. The cache is per student (`ai_cache` pinned with `user_id`, secret-key access only). A `local` reply is never reused once real AI is set up. A cached reply is checked again by `normaliseNotes` against the current passages.
- **Logging**: the new files don't log the URL, the page or the notes.

### Stored note shape
`notesDocument` builds only `doc`/`paragraph`/`heading` (level 2)/`bulletList`/`listItem`/`text` nodes with a `bold` mark. It writes no `link` marks, attributes or HTML. Its size is bounded: at most 12 sections × 10 points × 400 characters plus 15 terms, which is well under the 1 MB JSON and 200,000-character text limits. The source URL is plain text on the first line.

### XSS
No `dangerouslySetInnerHTML` or `innerHTML` appears in the diff. Mindmap details are rendered as React text in `mindmap-canvas.tsx`, `outline.tsx` and `passage-panel.tsx`. In the dialog, the only `href`s are built from the server's note uuid.

### Mindmap details
`detail` is clipped to 240 characters, and it's kept only if it's grounded in the passage the node cites and isn't just the label again. `mindmapGraph` allows 250 characters. `saveMindmapPositions` still takes only positions from the browser: the graph, details included, is always the server's copy.

### Flashcards
`YES_NO_FRONT`, `YES_NO_BACK`, `ABOUT_THE_LECTURE` and `SOURCE_PREFIX` are anchored or made of fixed words, with no nested quantifiers. Each takes under 0.1 ms on 500-character hostile fronts and under 60 ms on 100,000-character fronts. Fronts are clipped to 500 characters before any of them run. `SOURCE_SUFFIX` was the exception (FB-3).

### Migration
`20261028000001_study_notes_quota.sql` only swaps the `ai_usage.kind` check to add `'notes'`. The constraint name matches Postgres's automatic name for the original inline check. RLS, grants and the security-definer `ai_usage_reserve`/`ai_usage_settle` are unchanged. On local Postgres 16 with pgvector: `GRANT TESTS PASSED`, `ALL RLS TESTS PASSED`, and the constraint reads `kind = ANY (ARRAY['flashcards','quiz','mindmap','chat','notes'])`.

### Secrets and dependencies
No new environment variables and no new dependencies. The fetch's User-Agent names the app and its privacy page only.

## Tests added
- `src/server/web-page.test.ts`: compression bomb stopped at the cap, measured in decompressed bytes (FB-1); a redirect's endless body closed at once (FB-2); the guarded DNS `lookup` refuses `localhost` with the real address check; "İ" offsets (FB-4).
- `src/lib/ai/feedback.test.ts`: `examFront` timing on the cubic input, and the trailing-space behaviour kept (FB-3).

## Results
- `npx vitest run`: 38 files, 609 tests passed.
- `npm run typecheck` and `npx eslint src`: clean.
- `npm run test:db` (local Postgres 16 + pgvector, `studynest_test`): GRANT TESTS PASSED, ALL RLS TESTS PASSED.
- `npm audit --omit=dev`: 2 vulnerabilities (1 critical `next`, 1 high `zod`), FB-0. I didn't upgrade anything.
- I didn't run Playwright for this review.

## Before release
- Bradley decides on FB-0: `next@16.4.3` and `zod@^4.6.6`. After the upgrade, run the full unit, e2e and build again. CI's audit step fails until then, on `main` too.
- Apply `20261028000001_study_notes_quota.sql` to the live project before deploying. Without it, every `notes` reserve fails the kind check.
- On a preview deploy, try a few real pages (Wikipedia, a university reading, one gzip and one brotli site) and one link that redirects to a private address, to confirm `blocked` from Vercel's network.
- S2-14 and S3-4 (a per-student AI token cap) are still open from earlier steps. Study notes and mindmaps now also share the `gpt-oss-120b` app budget with quizzes and chat.
- I didn't use the `/security-review` command. This review was done by hand from `git diff main...HEAD`, with the experiments and benchmarks above.
