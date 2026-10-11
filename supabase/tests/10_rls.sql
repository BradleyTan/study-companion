-- RLS tests: student B must never read or change student A's data.
-- Fails loudly (ON_ERROR_STOP) on the first broken expectation.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant select on all tables in schema public to anon;  -- prove RLS (not grants) blocks anon too

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

-- deleting a subject cascades to notes, sources, chunks
delete from public.subjects where id = '5a000000-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.notes) + (select count(*) from public.sources) + (select count(*) from public.chunks) = 0, 'subject delete cascades');

reset role;
-- deleting a user removes their profile
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
select pg_temp.check((select count(*) from public.profiles where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') = 0, 'account delete cascades');

select 'ALL RLS TESTS PASSED' as result;
