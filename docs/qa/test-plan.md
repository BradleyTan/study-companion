# Test plan

| Layer | Tool | Where | Runs in CI |
|---|---|---|---|
| Unit | Vitest | `src/**/*.test.ts` | `check` job |
| End-to-end + accessibility (axe, WCAG 2.1 AA) | Playwright, desktop Chrome + Pixel 7 | `e2e/` | `e2e` job (demo mode, no secrets) |
| Database access control | psql against Postgres 16 + pgvector with a Supabase stub | `supabase/tests/` | `db` job |

Rules
- Every feature adds unit tests for its pure logic and at least one e2e journey on both viewports.
- Every screen gets an axe check in light mode; settings is also checked in dark.
- Every new table gets cross-student tests in `supabase/tests/10_rls.sql`.
- Mobile: assert no horizontal scroll on each new screen at 412 px.

Standing checklist for later steps (from the QA brief): FSRS interval maths, generation edge cases (empty notes, huge PDFs, scanned PDFs, non-English, prompt-injection text), timer accuracy in background tabs, calendar sync conflicts.
