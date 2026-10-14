-- Step 2 security review fixes (docs/security/step-2-review.md).

-- S2-1: flashcards, card reviews and mindmaps are written only by the server -------------
-- Students could insert and update these rows directly with the publishable key, skipping
-- the server's card cap, text validation and FSRS scheduling, and filling the shared free
-- database. Now they can only read them; every write goes through a server action, which
-- uses the secret key pinned to the student's id. The composite foreign keys still refuse a
-- row that points at another student's subject, note, file or passage.
drop policy "own flashcards" on public.flashcards;
drop policy "own card reviews" on public.card_reviews;
drop policy "own mindmaps" on public.mindmaps;
create policy "read own flashcards" on public.flashcards for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own card reviews" on public.card_reviews for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own mindmaps" on public.mindmaps for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.flashcards, public.card_reviews, public.mindmaps from authenticated;

-- S2-2: failed generations no longer give unlimited tries ---------------------------------
-- A failed generation gives the student's go back, but each try still spends the shared
-- app-wide allowance. A note written to make the model fail could be retried until the
-- whole app's AI allowance for the day was gone. Now every try is counted too.
alter table public.ai_usage add column attempts integer not null default 0 check (attempts >= 0);
update public.ai_usage set attempts = count;

drop function public.ai_usage_reserve(uuid, date, text, integer);
create function public.ai_usage_reserve(p_user_id uuid, p_day date, p_kind text, p_limit integer, p_max_attempts integer)
returns integer language plpgsql set search_path = '' as $$
declare n integer;
begin
  if p_limit <= 0 or p_max_attempts <= 0 then return null; end if;
  insert into public.ai_usage as u (user_id, day, kind, count, attempts)
  values (p_user_id, p_day, p_kind, 1, 1)
  on conflict (user_id, day, kind) do update set count = u.count + 1, attempts = u.attempts + 1
    where u.count < p_limit and u.attempts < p_max_attempts
  returning u.count into n;
  return n;
end $$;
revoke execute on function public.ai_usage_reserve(uuid, date, text, integer, integer) from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, date, text, integer, integer) to service_role;

-- S2-3: row caps in the database, not only in server actions ------------------------------
-- Subjects and notes are written by students directly (RLS keeps them to their own rows),
-- so the server's caps (50 subjects, 500 notes per subject) could be skipped to fill the
-- free database for everyone. The same caps now hold in the database.
create or replace function public.enforce_row_caps() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'subjects' then
    if (select count(*) from public.subjects where user_id = new.user_id) >= 50 then
      raise exception 'subject limit reached' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'notes' then
    if (select count(*) from public.notes where subject_id = new.subject_id and user_id = new.user_id) >= 500 then
      raise exception 'note limit reached' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.enforce_row_caps() from public, anon, authenticated;
create trigger subjects_cap before insert on public.subjects for each row execute function public.enforce_row_caps();
create trigger notes_cap before insert on public.notes for each row execute function public.enforce_row_caps();

-- Note JSON had a size check only in the server action (1,000,000 characters). jsonb's text
-- form adds spaces, hence the headroom. NOT VALID: existing rows are not re-checked.
alter table public.notes add constraint notes_content_json_size
  check (char_length(content_json::text) <= 2000000) not valid;
