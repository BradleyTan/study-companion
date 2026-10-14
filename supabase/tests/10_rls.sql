-- RLS tests: student B must never read or change student A's data.
-- Fails loudly (ON_ERROR_STOP) on the first broken expectation.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;  -- prove RLS (not grants) blocks anon too
grant all on all tables in schema public to service_role; -- Supabase grants this by default

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@uni.test'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'b@uni.test');

create function pg_temp.check(cond boolean, msg text) returns void language plpgsql as $$
begin if not cond then raise exception 'RLS TEST FAILED: %', msg; end if; end $$;

-- profile trigger created rows
select pg_temp.check((select count(*) from public.profiles) = 2, 'profiles created by trigger');

-- ===== as student A: create data
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
insert into public.subjects (id, name, colour, emoji) values ('5a000000-0000-0000-0000-000000000001', 'Biology', 'sky', '🧬');
insert into public.notes (id, subject_id, title, content_text) values ('5a000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-000000000001', 'Cells', 'Mitochondria make ATP');
select pg_temp.check((select count(*) from public.subjects) = 1, 'A sees own subject');

-- Students can't create or alter sources/chunks/files themselves: only the server can.
do $$ begin
  insert into public.sources (subject_id, file_name, kind, size_bytes, storage_path)
    values ('5a000000-0000-0000-0000-000000000001', 'x.pdf', 'pdf', 1, 'aaaaaaaa-0000-0000-0000-000000000001/x.pdf');
  raise exception 'RLS TEST FAILED: student inserted a source';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.chunks (subject_id, note_id, ordinal, text, content_hash) values ('5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000a1', 0, 'x', 'h');
  raise exception 'RLS TEST FAILED: student inserted a chunk';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into storage.objects (bucket_id, name) values ('sources', 'aaaaaaaa-0000-0000-0000-000000000001/direct.pdf');
  raise exception 'RLS TEST FAILED: student uploaded directly to storage';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.upload_log (user_id, bytes) values ('aaaaaaaa-0000-0000-0000-000000000001', 1);
  raise exception 'RLS TEST FAILED: student wrote upload_log';
exception when insufficient_privilege then null; end $$;

-- server (secret key, bypasses RLS) creates A's file rows
reset role;
insert into public.sources (id, user_id, subject_id, file_name, kind, size_bytes, storage_path)
  values ('5a000000-0000-0000-0000-0000000000b1', 'aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'week1.pdf', 'pdf', 1000, 'aaaaaaaa-0000-0000-0000-000000000001/x/week1.pdf');
insert into public.chunks (user_id, subject_id, note_id, ordinal, text, content_hash) values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000a1', 0, 'Mitochondria make ATP', 'h');
insert into storage.objects (bucket_id, name) values ('sources', 'aaaaaaaa-0000-0000-0000-000000000001/x/week1.pdf');
set role authenticated;

-- A can't tamper with processing fields
update public.sources set extract_status = 'ready', size_bytes = 1;
select pg_temp.check((select size_bytes from public.sources) = 1000, 'student cannot rewrite size_bytes');
-- A cannot write a quota row (server only)
do $$ begin
  insert into public.ai_usage (kind, count) values ('chat', 0);
  raise exception 'RLS TEST FAILED: student wrote ai_usage';
exception when insufficient_privilege then null; end $$;

-- Even the server can't record a source stored outside the owner's folder
reset role;
do $$ begin
  insert into public.sources (user_id, subject_id, file_name, kind, size_bytes, storage_path)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'evil.pdf', 'pdf', 10, 'bbbbbbbb-0000-0000-0000-000000000002/evil.pdf');
  raise exception 'RLS TEST FAILED: source path outside own folder accepted';
exception when check_violation then null; end $$;
set role authenticated;

-- ===== as student B: everything of A's is invisible and untouchable
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.subjects) = 0, 'B cannot see A subjects');
select pg_temp.check((select count(*) from public.notes) = 0, 'B cannot see A notes');
select pg_temp.check((select count(*) from public.sources) = 0, 'B cannot see A sources');
select pg_temp.check((select count(*) from public.chunks) = 0, 'B cannot see A chunks');
select pg_temp.check((select count(*) from public.profiles) = 1, 'B sees only own profile');
select pg_temp.check((select count(*) from storage.objects) = 0, 'B cannot see A files');

update public.notes set title = 'hacked' where id = '5a000000-0000-0000-0000-0000000000a1';
delete from public.subjects where id = '5a000000-0000-0000-0000-000000000001';
delete from storage.objects where name like 'aaaaaaaa%';

-- B cannot claim A's rows by inserting with A's user_id
do $$ begin
  insert into public.subjects (user_id, name, colour, emoji) values ('aaaaaaaa-0000-0000-0000-000000000001', 'x', 'sky', 'x');
  raise exception 'RLS TEST FAILED: B inserted a row owned by A';
exception when insufficient_privilege then null; end $$;

-- B cannot attach a note to A's subject (composite FK)
do $$ begin
  insert into public.notes (subject_id, title) values ('5a000000-0000-0000-0000-000000000001', 'sneaky');
  raise exception 'RLS TEST FAILED: B attached a note to A subject';
exception when foreign_key_violation then null; end $$;


-- ===== Step 2: flashcards, reviews, mindmaps, AI quota
-- server adds a passage for A's note
reset role;
insert into public.chunks (id, user_id, subject_id, note_id, ordinal, text, content_hash)
  values ('5a000000-0000-0000-0000-0000000000c1', 'aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000a1', 1, 'ATP is the energy currency of the cell', 'h2');
-- Flashcards, reviews and mindmaps are written only by the server (secret key, pinned to the
-- student's id), so the card cap, validation and scheduling can't be skipped.
set role service_role;
insert into public.flashcards (id, user_id, subject_id, note_id, chunk_id, front, back, source_quote, origin)
  values ('5a000000-0000-0000-0000-0000000000f1', 'aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000a1', '5a000000-0000-0000-0000-0000000000c1', 'What is ATP?', 'The energy currency of the cell', 'ATP is the energy currency', 'ai');
insert into public.card_reviews (user_id, flashcard_id, subject_id, rating, prev_state, srs_state, due_at, stability, difficulty)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000f1', '5a000000-0000-0000-0000-000000000001', 3, 0, 1, now() + interval '10 minutes', 2.3, 5.1);
insert into public.mindmaps (user_id, subject_id, graph_json, input_hash) values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '{"version":1,"nodes":[]}', 'h');
update public.flashcards set back = 'Energy currency', edited = true where id = '5a000000-0000-0000-0000-0000000000f1' and user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$ begin
  insert into public.flashcards (user_id, subject_id, front, back) values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '', 'x');
  raise exception 'RLS TEST FAILED: empty card front accepted';
exception when check_violation then null; end $$;
do $$ begin
  insert into public.mindmaps (user_id, subject_id, graph_json, input_hash) values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', '{}', 'again');
  raise exception 'RLS TEST FAILED: second mindmap for one subject accepted';
exception when unique_violation then null; end $$;
-- Even the server can't attach A's card to B's subject or point B's card at A's passage (composite FKs).
do $$ begin
  insert into public.flashcards (user_id, subject_id, chunk_id, front, back) values ('bbbbbbbb-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-000000000001', null, 'q', 'a');
  raise exception 'RLS TEST FAILED: server put a B card in A subject';
exception when foreign_key_violation then null; end $$;
reset role;
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.flashcards) = 1, 'A sees own flashcard');
select pg_temp.check((select edited from public.flashcards where id = '5a000000-0000-0000-0000-0000000000f1'), 'A reads server edit');
select pg_temp.check((select count(*) from public.card_reviews) = 1, 'A sees own review');
select pg_temp.check((select count(*) from public.mindmaps) = 1, 'A sees own mindmap');
-- A can't write them directly (the test granted every table privilege, so this is RLS alone).
do $$ begin
  insert into public.flashcards (subject_id, front, back) values ('5a000000-0000-0000-0000-000000000001', 'q', 'a');
  raise exception 'RLS TEST FAILED: student inserted a flashcard directly';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.card_reviews (flashcard_id, subject_id, rating, prev_state, srs_state, due_at, stability, difficulty)
    values ('5a000000-0000-0000-0000-0000000000f1', '5a000000-0000-0000-0000-000000000001', 4, 2, 2, now() + interval '100 years', 1e9, 1);
  raise exception 'RLS TEST FAILED: student inserted a review directly';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.mindmaps (subject_id, graph_json, input_hash) values ('5a000000-0000-0000-0000-000000000001', '{}', 'x');
  raise exception 'RLS TEST FAILED: student inserted a mindmap directly';
exception when insufficient_privilege then null; end $$;
update public.flashcards set front = 'self-edit', srs_state = 2, due_at = now() + interval '100 years';
update public.card_reviews set rating = 1;
update public.mindmaps set graph_json = '{"bad":true}';
delete from public.card_reviews;
delete from public.flashcards;
delete from public.mindmaps;
select pg_temp.check((select front from public.flashcards) = 'What is ATP?', 'student cannot update own flashcard directly');
select pg_temp.check((select rating from public.card_reviews) = 3, 'student cannot update own review directly');
select pg_temp.check((select graph_json from public.mindmaps) = '{"version":1,"nodes":[]}'::jsonb, 'student cannot update own mindmap directly');
select pg_temp.check((select count(*) from public.flashcards) + (select count(*) from public.card_reviews) + (select count(*) from public.mindmaps) = 3, 'student cannot delete Step 2 rows directly');
-- Quotas and the app-wide budget are server-only.
do $$ begin
  insert into public.ai_usage (kind, count) values ('flashcards', 0);
  raise exception 'RLS TEST FAILED: student wrote ai_usage';
exception when insufficient_privilege then null; end $$;
do $$ begin
  update public.ai_usage set count = 0;
  insert into public.ai_cache (kind, input_hash, model, output_json) values ('flashcards', 'x', 'm', '{}');
  raise exception 'RLS TEST FAILED: student wrote ai_cache';
exception when insufficient_privilege then null; end $$;
-- (the test grants table privileges to everyone above, so this proves RLS alone blocks it)
do $$ begin
  insert into public.ai_app_usage (day, model) values (current_date, 'm');
  raise exception 'RLS TEST FAILED: student wrote ai_app_usage';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'flashcards', 1000, 1000);
  raise exception 'RLS TEST FAILED: student called ai_usage_reserve';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.ai_usage_settle('aaaaaaaa-0000-0000-0000-000000000001', current_date, 'flashcards', false, 0, 0);
  raise exception 'RLS TEST FAILED: student called ai_usage_settle';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.ai_app_reserve(current_date, 'm', 1000, 1000);
  raise exception 'RLS TEST FAILED: student called ai_app_reserve';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.ai_app_add_tokens(current_date, 'm', -1000000);
  raise exception 'RLS TEST FAILED: student called ai_app_add_tokens';
exception when insufficient_privilege then null; end $$;
do $$ begin
  perform public.enforce_row_caps();
  raise exception 'RLS TEST FAILED: student called enforce_row_caps';
exception when insufficient_privilege or feature_not_supported then null; end $$;

-- B: none of A's Step 2 rows are visible or changeable
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.flashcards) = 0, 'B cannot see A flashcards');
select pg_temp.check((select count(*) from public.card_reviews) = 0, 'B cannot see A reviews');
select pg_temp.check((select count(*) from public.mindmaps) = 0, 'B cannot see A mindmaps');
update public.flashcards set front = 'hacked';
update public.mindmaps set graph_json = '{"hacked":true}';
delete from public.card_reviews;
delete from public.flashcards;
insert into public.subjects (id, name, colour, emoji) values ('5b000000-0000-0000-0000-000000000001', 'B subject', 'mint', '🧪');
do $$ begin
  insert into public.flashcards (subject_id, front, back) values ('5a000000-0000-0000-0000-000000000001', 'q', 'a');
  raise exception 'RLS TEST FAILED: B added a card to A subject';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.flashcards (subject_id, chunk_id, front, back) values ('5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000c1', 'q', 'a');
  raise exception 'RLS TEST FAILED: B linked a card to A passage';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.flashcards (subject_id, note_id, front, back) values ('5b000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000a1', 'q', 'a');
  raise exception 'RLS TEST FAILED: B linked a card to A note';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.card_reviews (flashcard_id, subject_id, rating, prev_state, srs_state, due_at, stability, difficulty)
    values ('5a000000-0000-0000-0000-0000000000f1', '5b000000-0000-0000-0000-000000000001', 1, 0, 1, now(), 1, 1);
  raise exception 'RLS TEST FAILED: B reviewed A card';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.mindmaps (subject_id, graph_json, input_hash) values ('5a000000-0000-0000-0000-000000000001', '{}', 'x');
  raise exception 'RLS TEST FAILED: B made a mindmap in A subject';
exception when insufficient_privilege then null; end $$;
do $$ begin
  insert into public.flashcards (user_id, subject_id, front, back) values ('aaaaaaaa-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-000000000001', 'q', 'a');
  raise exception 'RLS TEST FAILED: B inserted a card owned by A';
exception when insufficient_privilege then null; end $$;
delete from public.subjects where id = '5b000000-0000-0000-0000-000000000001';

-- server: quota reservations are atomic and capped; failed generations give the go back
reset role;
set role service_role;
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'flashcards', 2, 10) = 1, 'first reservation');
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'flashcards', 2, 10) = 2, 'second reservation');
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'flashcards', 2, 10) is null, 'third reservation refused at limit');
select public.ai_usage_settle('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'flashcards', false, 100, 0);
select pg_temp.check((select count from public.ai_usage where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'flashcards') = 1, 'failed generation refunded');
select pg_temp.check((select input_tokens from public.ai_usage where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and kind = 'flashcards') = 100, 'tokens tracked');
select pg_temp.check(public.ai_usage_reserve('bbbbbbbb-0000-0000-0000-000000000002', '2026-10-14', 'flashcards', 2, 10) = 1, 'quota is per student');
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'mindmap', 0, 10) is null, 'zero limit refuses');
-- failed tries give the go back but still count as tries
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'chat', 5, 2) = 1, 'try 1');
select public.ai_usage_settle('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'chat', false, 0, 0);
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'chat', 5, 2) = 1, 'try 2 (first was refunded)');
select public.ai_usage_settle('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'chat', false, 0, 0);
select pg_temp.check(public.ai_usage_reserve('aaaaaaaa-0000-0000-0000-000000000001', '2026-10-14', 'chat', 5, 2) is null, 'tries capped even though no go was used');
select pg_temp.check(public.ai_app_reserve('2026-10-14', 'm', 2, 1000), 'app budget 1');
select pg_temp.check(public.ai_app_reserve('2026-10-14', 'm', 2, 1000), 'app budget 2');
select pg_temp.check(not public.ai_app_reserve('2026-10-14', 'm', 2, 1000), 'app budget request cap');
select public.ai_app_add_tokens('2026-10-14', 'n', 5);
select pg_temp.check(public.ai_app_reserve('2026-10-14', 'n', 10, 1000), 'app budget other model');
select public.ai_app_add_tokens('2026-10-14', 'n', 1000);
select pg_temp.check(not public.ai_app_reserve('2026-10-14', 'n', 10, 1000), 'app budget token cap');
reset role;
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
select pg_temp.check((select count(*) from public.ai_usage) = 1, 'B sees only own usage');


-- ===== row caps hold in the database, not only in server actions
set role authenticated;
set request.jwt.claim.sub = 'bbbbbbbb-0000-0000-0000-000000000002';
insert into public.subjects (name, colour, emoji) select 'S' || g, 'sky', '📘' from generate_series(1, 50) g;
do $$ begin
  insert into public.subjects (name, colour, emoji) values ('One too many', 'sky', '📘');
  raise exception 'RLS TEST FAILED: 51st subject accepted';
exception when check_violation then null; end $$;
insert into public.notes (subject_id, title) select (select id from public.subjects where name = 'S1'), 'n' || g from generate_series(1, 500) g;
do $$ begin
  insert into public.notes (subject_id, title) values ((select id from public.subjects where name = 'S1'), 'One too many');
  raise exception 'RLS TEST FAILED: 501st note accepted';
exception when check_violation then null; end $$;
insert into public.notes (subject_id, title) values ((select id from public.subjects where name = 'S2'), 'other subject is fine');
do $$ begin
  insert into public.notes (subject_id, content_json) values ((select id from public.subjects where name = 'S2'), jsonb_build_object('t', repeat('x', 2000001)));
  raise exception 'RLS TEST FAILED: oversized note JSON accepted';
exception when check_violation then null; end $$;
delete from public.subjects;
reset role;

-- ===== anon sees nothing
reset request.jwt.claim.sub;
set role anon;
select pg_temp.check((select count(*) from public.subjects) = 0, 'anon cannot see subjects');

-- ===== back to A: data untouched
set role authenticated;
set request.jwt.claim.sub = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.check((select title from public.notes) = 'Cells', 'A note unchanged by B');
select pg_temp.check((select count(*) from public.subjects) = 1, 'A subject not deleted by B');
select pg_temp.check((select count(*) from storage.objects) = 1, 'A file not deleted by B');
select pg_temp.check((select front from public.flashcards where id = '5a000000-0000-0000-0000-0000000000f1') = 'What is ATP?', 'A card unchanged by B');
select pg_temp.check((select count(*) from public.card_reviews) = 1, 'A review not deleted by B');
select pg_temp.check((select graph_json from public.mindmaps) = '{"version":1,"nodes":[]}'::jsonb, 'A mindmap unchanged by B');

-- deleting the note keeps the card and its quote, clearing the links
delete from public.notes where id = '5a000000-0000-0000-0000-0000000000a1';
select pg_temp.check((select note_id is null and chunk_id is null and source_quote is not null from public.flashcards where id = '5a000000-0000-0000-0000-0000000000f1'), 'card survives note delete');

-- deleting a subject cascades to notes, sources, chunks
delete from public.subjects where id = '5a000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.notes) + (select count(*) from public.sources) + (select count(*) from public.chunks)
  + (select count(*) from public.flashcards) + (select count(*) from public.card_reviews) + (select count(*) from public.mindmaps) = 0, 'subject delete cascades');

reset role;
-- deleting a user removes their profile
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'account delete cascades');

select 'ALL RLS TESTS PASSED' as result;
