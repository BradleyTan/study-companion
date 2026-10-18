-- Step 3 security review (docs/security/step-3-review.md).

-- S3-2: the AI cache is server-only. It holds the model's raw replies, and a cached quiz reply
-- has every right answer, accepted answer and explanation in it, so a student could read a quiz's
-- answers with their own session before taking it (QA step 3). Only the server reads and writes
-- it now, with the secret key, every query pinned to the student's id (src/server/repo/supabase.ts).
drop policy if exists "own cache" on public.ai_cache;
revoke all on public.ai_cache from anon, authenticated;

-- S3-3: a question's source quote usually contains its answer ("ATP is the energy currency of
-- the cell"), so it is hidden until answered like the answer, accepted answers and explanation.
-- The server sends it with the feedback for an answered question (quiz.md "Data the screen needs").
revoke select (source_quote) on public.questions from authenticated;
