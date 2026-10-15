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
- Mobile: assert no horizontal scroll on each new screen at 412 px, and at 375 px with touch emulation assert every control is at least 44 × 44 px (`smallTargets` in `e2e/helpers.ts`).
- From Step 2: new screens are also checked with axe in dark mode with reduced motion.
- Server actions with quota, idempotency or ownership rules get action-level Vitest tests against the demo repo (`src/server/actions/*.test.ts`, `getRepo` mocked).
- e2e helpers never branch on an `isVisible()` snapshot of something still loading: wait for one of the candidates first (`createSubject`, `rowAction`). Before signing off, run the suite at least twice, once with `--workers=4`.
- AI features: the local stand-in generator runs only in demo mode, tests and `npm run dev`; a production build without a key must say "AI isn't set up yet" (unit-tested).

Standing checklist for later steps (from the QA brief): FSRS interval maths, due-today across time zones, generation edge cases (empty notes, huge PDFs, scanned PDFs, non-English, prompt-injection text), double taps and retried requests (idempotency), timer accuracy in background tabs, calendar sync conflicts.

Sign-offs: `docs/qa/step-1.md`, `docs/qa/step-2.md`, `docs/qa/step-2-page-series.md`.
