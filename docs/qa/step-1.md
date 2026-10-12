# QA sign-off: Step 1 (auth, subjects, notes, uploads)

**Result: PASS** (2026-10-11), pending a run against a real Supabase project once Bradley adds the keys.

## Automated
| Suite | Result |
|---|---|
| Unit (Vitest) | 27 passed |
| E2E (Playwright, desktop + mobile) | 18 passed (9 journeys × 2 viewports) |
| Accessibility (axe, WCAG 2.1 AA) | 0 violations on landing, privacy, empty subjects, subject page, note editor, settings (light and dark) |
| RLS (Postgres 16 + pgvector) | All cross-student checks pass; verified the suite fails when RLS is removed from `notes` |
| Lint, typecheck, production build | Clean |

## What was covered
- Signed-out visitors are redirected from `/subjects` to `/login`.
- Subjects: create with colour + icon, edit, delete with cascade count, blank-name error.
- Notes: autosave ("Saved ✓"), bold formatting persists, survives reload, appears in the subject list.
- Uploads: real PDF read page by page ("Ready · 3 pages"); a renamed non-PDF is rejected; a PDF with no text is flagged as scanned; a .docx is refused before upload; delete a file.
- Extraction edge cases (unit): non-English text, 5,000-character unbroken text, empty pages, hyphenation, PPTX slide order past 10, speaker notes, macro-enabled PPTX rejected, zip that isn't a deck rejected.
- Isolation: a second student opening the first student's subject URL gets "not found" and the export contains none of the first student's data.
- Settings: sound off and dark theme persist across reload; export downloads as an attachment; delete account clears data and signs out.
- Mobile (412 px): no horizontal scroll on subjects, subject and note pages. Found and fixed a header overflow (68 px) during testing.

## Bugs found and fixed during QA
1. Mobile header overflowed by 68 px. Cause: component CSS was unlayered, so Tailwind's `hidden` couldn't override `.btn`. Fixed by moving component classes into `@layer components`.
2. Test race in the isolation journey (URL read before navigation finished). Test fixed; no app bug.

## Not yet tested (needs Bradley's accounts)
- Real Supabase sign-in (magic link, Google), signed upload URLs, Storage policies on the live project, account deletion via the admin API.
- Embeddings function on Supabase.
These are on the checklist for the Vercel preview demo.
