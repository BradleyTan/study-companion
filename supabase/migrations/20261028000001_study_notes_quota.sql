-- Make study notes (docs/design/screens/make-notes.md): its own daily quota row in ai_usage.
-- Only the kind check changes; no new table, no data touched. RLS and grants on ai_usage stay as
-- they are (students read their own rows; only the security-definer quota functions write).
alter table public.ai_usage drop constraint ai_usage_kind_check;
alter table public.ai_usage add constraint ai_usage_kind_check
  check (kind in ('flashcards', 'quiz', 'mindmap', 'chat', 'notes'));
