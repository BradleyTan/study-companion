-- Privilege checks that must run on the migrations' own grants, before 10_rls.sql grants
-- every table privilege to prove that RLS alone blocks cross-student access.
create function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'GRANT TEST FAILED: %', msg; end if; end $$;

-- Step 3: a question's answer, accepted answers and explanation are hidden from students.
select pg_temp.check(has_column_privilege('authenticated', 'public.questions', 'prompt', 'select'), 'students can read a question prompt');
select pg_temp.check(has_column_privilege('authenticated', 'public.questions', 'options_json', 'select'), 'students can read options');
select pg_temp.check(not has_column_privilege('authenticated', 'public.questions', 'answer', 'select'), 'students cannot read answers');
select pg_temp.check(not has_column_privilege('authenticated', 'public.questions', 'correct_index', 'select'), 'students cannot read the right option');
select pg_temp.check(not has_column_privilege('authenticated', 'public.questions', 'accepted_json', 'select'), 'students cannot read accepted answers');
select pg_temp.check(not has_column_privilege('authenticated', 'public.questions', 'explanation', 'select'), 'students cannot read explanations');
-- Step 3 tables are read-only to students and invisible to anon.
select pg_temp.check(not has_table_privilege('authenticated', 'public.' || t, 'insert') and not has_table_privilege('authenticated', 'public.' || t, 'update')
  and not has_table_privilege('authenticated', 'public.' || t, 'delete'), 'students cannot write ' || t)
  from unnest(array['quizzes', 'questions', 'quiz_attempts', 'answers', 'weak_topics']) t;
select pg_temp.check(not has_table_privilege('anon', 'public.' || t, 'select'), 'anon cannot read ' || t)
  from unnest(array['quizzes', 'questions', 'quiz_attempts', 'answers', 'weak_topics']) t;
-- Step 3 part 2: chat messages are read-only to students; retrieval functions are for signed-in students only.
select pg_temp.check(not has_table_privilege('authenticated', 'public.chat_messages', 'insert') and not has_table_privilege('authenticated', 'public.chat_messages', 'update')
  and not has_table_privilege('authenticated', 'public.chat_messages', 'delete'), 'students cannot write chat_messages');
select pg_temp.check(not has_table_privilege('anon', 'public.chat_messages', 'select'), 'anon cannot read chat_messages');
select pg_temp.check(has_function_privilege('authenticated', 'public.match_chunks(uuid, extensions.vector, integer)', 'execute'), 'students can call match_chunks');
select pg_temp.check(not has_function_privilege('anon', 'public.match_chunks(uuid, extensions.vector, integer)', 'execute'), 'anon cannot call match_chunks');
select pg_temp.check(has_function_privilege('authenticated', 'public.search_chunks(uuid, text, integer, boolean)', 'execute'), 'students can call search_chunks');
select pg_temp.check(not has_function_privilege('anon', 'public.search_chunks(uuid, text, integer, boolean)', 'execute'), 'anon cannot call search_chunks');
select pg_temp.check((select prosecdef = false from pg_proc where proname = 'match_chunks') and (select prosecdef = false from pg_proc where proname = 'search_chunks'), 'retrieval functions are SECURITY INVOKER');
select pg_temp.check(not has_function_privilege('authenticated', 'public.enforce_chat_cap()', 'execute'), 'students cannot call the chat cap trigger function');

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  perform answer from public.questions;
  raise exception 'GRANT TEST FAILED: student selected question answers';
exception when insufficient_privilege then null; end $$;
reset role;
reset request.jwt.claim.sub;
select 'GRANT TESTS PASSED' as result;
