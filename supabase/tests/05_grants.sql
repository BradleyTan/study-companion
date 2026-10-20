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

-- Step 3 security review: the source quote (usually holds the answer) and the AI cache (a cached
-- quiz holds every answer) are server-only (S3-2, S3-3).
select pg_temp.check(not has_column_privilege('authenticated', 'public.questions', 'source_quote', 'select'), 'students cannot read source quotes');
select pg_temp.check(not has_table_privilege('authenticated', 'public.ai_cache', 'select') and not has_table_privilege('authenticated', 'public.ai_cache', 'insert')
  and not has_table_privilege('authenticated', 'public.ai_cache', 'update') and not has_table_privilege('authenticated', 'public.ai_cache', 'delete'), 'students cannot touch ai_cache');
select pg_temp.check(not exists (select from pg_policy where polrelid = 'public.ai_cache'::regclass), 'ai_cache has no student policy');
-- Step 4: study sessions are read-only to students (the server logs them, pinned to the student).
select pg_temp.check(has_table_privilege('authenticated', 'public.study_sessions', 'select'), 'students can read study_sessions');
select pg_temp.check(not has_table_privilege('authenticated', 'public.study_sessions', 'insert') and not has_table_privilege('authenticated', 'public.study_sessions', 'update')
  and not has_table_privilege('authenticated', 'public.study_sessions', 'delete') and not has_table_privilege('authenticated', 'public.study_sessions', 'truncate'), 'students cannot write study_sessions');
select pg_temp.check(not has_table_privilege('anon', 'public.study_sessions', 'select'), 'anon cannot read study_sessions');
select pg_temp.check(exists (select from pg_policy where polrelid = 'public.study_sessions'::regclass and polcmd = 'r')
  and not exists (select from pg_policy where polrelid = 'public.study_sessions'::regclass and polcmd <> 'r'), 'study_sessions has only a read policy');
select pg_temp.check(not has_function_privilege('authenticated', 'public.enforce_study_session_cap()', 'execute'), 'students cannot call the study session cap trigger function');
-- Timer settings are profile columns students may update (like sound and theme).
select pg_temp.check(has_column_privilege('authenticated', 'public.profiles', 'timer_focus_min', 'update') and has_column_privilege('authenticated', 'public.profiles', 'focus_quiet', 'update'), 'students can save timer settings');
-- Step 4 part 2: timetable slots are read-only to students; the calendar link is server-only
-- (no grants, no policy), so its token can never reach the browser through the data API.
select pg_temp.check(has_table_privilege('authenticated', 'public.timetable_slots', 'select'), 'students can read timetable_slots');
select pg_temp.check(not has_table_privilege('authenticated', 'public.timetable_slots', 'insert') and not has_table_privilege('authenticated', 'public.timetable_slots', 'update')
  and not has_table_privilege('authenticated', 'public.timetable_slots', 'delete') and not has_table_privilege('authenticated', 'public.timetable_slots', 'truncate'), 'students cannot write timetable_slots');
select pg_temp.check(exists (select from pg_policy where polrelid = 'public.timetable_slots'::regclass and polcmd = 'r')
  and not exists (select from pg_policy where polrelid = 'public.timetable_slots'::regclass and polcmd <> 'r'), 'timetable_slots has only a read policy');
select pg_temp.check(not has_table_privilege('authenticated', 'public.calendar_links', 'select') and not has_table_privilege('authenticated', 'public.calendar_links', 'insert')
  and not has_table_privilege('authenticated', 'public.calendar_links', 'update') and not has_table_privilege('authenticated', 'public.calendar_links', 'delete'), 'students cannot touch calendar_links');
select pg_temp.check(not has_column_privilege('authenticated', 'public.calendar_links', 'token', 'select'), 'students cannot read the calendar token');
select pg_temp.check(not exists (select from pg_policy where polrelid = 'public.calendar_links'::regclass), 'calendar_links has no student policy');
select pg_temp.check(not has_function_privilege('authenticated', 'public.enforce_timetable_slot_cap()', 'execute'), 'students cannot call the timetable slot cap trigger function');
select pg_temp.check(has_column_privilege('authenticated', 'public.profiles', 'week_start', 'update'), 'students can save the week start');
-- Every table in public has RLS on, and anon can't read or call anything there (the stub grants
-- like Supabase does by default, so this catches a table or function a migration forgot).
select pg_temp.check(c.relrowsecurity, 'RLS is on for ' || c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p');
select pg_temp.check(not has_table_privilege('anon', c.oid, 'select') and not has_table_privilege('anon', c.oid, 'insert'), 'anon has no access to ' || c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind in ('r', 'p');
select pg_temp.check(not has_function_privilege('anon', p.oid, 'execute'), 'anon cannot call ' || p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
-- Only the three read-only helpers are callable by students; the rest are for the server or triggers.
select pg_temp.check(not has_function_privilege('authenticated', p.oid, 'execute') or p.proname in ('match_chunks', 'search_chunks', 'source_page_chars'), 'students cannot call ' || p.proname)
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';
select pg_temp.check(p.proconfig is not null and 'search_path=""' = any(p.proconfig), p.proname || ' pins search_path')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public';

set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  perform answer from public.questions;
  raise exception 'GRANT TEST FAILED: student selected question answers';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform source_quote from public.questions;
  raise exception 'GRANT TEST FAILED: student selected question source quotes';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform output_json from public.ai_cache;
  raise exception 'GRANT TEST FAILED: student read the AI cache';
exception when insufficient_privilege then null; end $$;
-- What the quiz screen may read is still readable.
select count(*) from (select id, quiz_id, ordinal, type, prompt, options_json, topic, removed_at from public.questions) q;
reset role;
reset request.jwt.claim.sub;
select 'GRANT TESTS PASSED' as result;
