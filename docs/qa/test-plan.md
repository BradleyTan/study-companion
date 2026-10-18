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
- AI card quality (from 2026-10-17, Bradley: quantity and quality equally, captured information accurate): every change to the prompt, `isGrounded`, `cardQualityIssue`, `src/lib/ai/text.ts` or `src/lib/extract/` must keep `src/lib/ai/card-quality.qa.test.ts` green. It holds a labelled sample of realistic cards (good paraphrases vs wrong numbers, invented terms, outside knowledge) and a science sample run through the real path (PDF fixture → extraction → passages → filter). Update its expected false drops/keeps and the sign-off when the filter improves.
- Quiz and chat accuracy (from Step 3): every change to `normaliseQuizWithStats`, `normaliseChatReply`, `contradictsPassage`, `isGrounded` or the quiz/chat prompts must keep `src/lib/ai/quiz-chat-quality.qa.test.ts` green: a labelled sample of realistic questions and chat sentences on science notes (wrong keys, swapped terms, wrong numbers and formulas, species, two right options, uncited sentences, passages not sent). Update its expected counts and `docs/qa/step-3.md` when the filter improves.
- Fill-in matching: the typo allowance must never accept a different term one letter away (`src/lib/quiz/match.test.ts` "never accepts a different science term"); add any new minimal pair found in testing there.
- A screen that calls `router.refresh()` after an action must not be keyed on data that the refresh changes (it remounts and loses open panels, focus and pending saves; see the mindmap fix in `docs/qa/step-3.md`). `e2e/step2-qa.spec.ts` holds the refresh back 3 s to catch this.
- Science notation (formulas with sub/superscripts, equations, Greek letters, binomial names, gene names, units, signs) must survive extraction, grounding, display and read-aloud: `e2e/fixtures/science-lecture.pdf` (`python3 e2e/fixtures/make-science-lecture.py`) and `e2e/step2-science.spec.ts`.
- AI features: the local stand-in generator runs only in demo mode, tests and `npm run dev`; a production build without a key must say "AI isn't set up yet" (unit-tested).

Standing checklist for later steps (from the QA brief): FSRS interval maths, due-today across time zones, generation edge cases (empty notes, huge PDFs, scanned PDFs, non-English, prompt-injection text), double taps and retried requests (idempotency), timer accuracy in background tabs, calendar sync conflicts.

Sign-offs: `docs/qa/step-1.md`, `docs/qa/step-2.md`, `docs/qa/step-2-page-series.md`, `docs/qa/flashcard-pages-50.md`, `docs/qa/step-3.md`.
