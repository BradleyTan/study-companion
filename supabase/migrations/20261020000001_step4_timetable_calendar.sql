-- Step 4, part 2: weekly timetable and the private calendar link
-- (docs/design/screens/timetable.md, settings.md, subject.md).
-- Same rules as Step 3 and the study timer: user_id on every row, RLS on, students can only
-- READ their slots; every write goes through a server action using the secret key pinned to
-- the student's id. The calendar link table is server-only: students can't read it at all.

-- Week start lives on the profile (settings.md "Timetable and calendar") ------------------
alter table public.profiles
  add column week_start text not null default 'mon' check (week_start in ('mon', 'sun'));

-- timetable_slots --------------------------------------------------------------------
-- A slot is wall-clock time in its own time zone (`tz`, the student's profile time zone when it
-- was saved): first date + start/end minutes after local midnight. Weekly slots repeat on the same
-- weekday at the same local time, so a 10:00 class stays at 10:00 across daylight-saving changes,
-- and skipped weeks (`skip_dates`, local dates) keep matching even if the device's time zone
-- changes later. No Google columns (PLAN decision 9).
create table public.timetable_slots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Deleting a subject keeps its slots as "No subject": only subject_id is cleared.
  subject_id uuid,
  kind text not null check (kind in ('class', 'study', 'other')),
  -- null: the default title ("Biology class", "Study: Biology", "Busy"), which follows subject renames.
  title text check (title is null or char_length(title) between 1 and 80),
  location text check (location is null or char_length(location) between 1 and 80),
  tz text not null check (char_length(tz) between 1 and 64),
  start_date date not null check (start_date between date '2000-01-01' and date '2100-12-31'),
  start_min smallint not null check (start_min between 0 and 1439),
  end_min smallint not null check (end_min between 1 and 1440),          -- 1440 = midnight at the end of the day
  recurrence text not null check (recurrence in ('none', 'weekly')),
  repeat_until date,                                                     -- last date it may happen (inclusive)
  skip_dates date[] not null default '{}'
    check (cardinality(skip_dates) <= 60 and array_position(skip_dates, null) is null),
  source text not null default 'manual' check (source in ('manual', 'import')),
  -- Imported classes: a stable key per class from the file (src/lib/timetable/import.ts), so a
  -- re-import updates them, and the import they came from (Undo deletes that batch).
  import_uid text check (char_length(import_uid) between 1 and 64),
  import_batch uuid,
  -- What a re-import changed or removed, so its 6-second Undo can put it back (server-written).
  import_prev jsonb check (import_prev is null or (jsonb_typeof(import_prev) = 'object' and octet_length(import_prev::text) <= 8000)),
  -- Soft delete for Undo; purged a few minutes later by the server.
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete set null (subject_id),
  check (end_min > start_min),
  check (end_min - start_min <= 720),                                     -- up to 12 hours, never past midnight
  check (recurrence = 'weekly' or (repeat_until is null and cardinality(skip_dates) = 0)),
  check (repeat_until is null or repeat_until >= start_date),
  check ((source = 'import') = (import_uid is not null and import_batch is not null)),
  unique (id, user_id)
);
create index timetable_slots_user_idx on public.timetable_slots (user_id, start_date);
create index timetable_slots_subject_idx on public.timetable_slots (subject_id);
create index timetable_slots_batch_idx on public.timetable_slots (user_id, import_batch) where import_batch is not null;
-- One live slot per imported class key (a deleted one may wait for its Undo beside a new import).
create unique index timetable_slots_import_uid_idx on public.timetable_slots (user_id, import_uid)
  where import_uid is not null and deleted_at is null;
create trigger timetable_slots_updated before update on public.timetable_slots for each row execute function public.set_updated_at();

-- Cap: 300 slots per student (timetable.md), counted on insert and when Undo brings one back.
-- Soft-deleted rows don't count towards the 300 but are capped too, as a backstop.
create or replace function public.enforce_timetable_slot_cap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is null and (tg_op = 'INSERT' or old.deleted_at is not null) then
    if (select count(*) from public.timetable_slots where user_id = new.user_id and deleted_at is null and id <> new.id) >= 300 then
      raise exception 'timetable slot limit reached' using errcode = 'check_violation';
    end if;
  end if;
  if tg_op = 'INSERT' and (select count(*) from public.timetable_slots where user_id = new.user_id) >= 600 then
    raise exception 'timetable slot limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_timetable_slot_cap() from public, anon, authenticated;
create trigger timetable_slots_cap before insert or update of deleted_at on public.timetable_slots
  for each row execute function public.enforce_timetable_slot_cap();

alter table public.timetable_slots enable row level security;
create policy "read own timetable slots" on public.timetable_slots for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.timetable_slots from authenticated;
revoke all on public.timetable_slots from anon;

-- calendar_links -----------------------------------------------------------------------
-- One private calendar link per student (timetable.md "Calendar link panel"). The token is 32
-- random bytes (base64url, 43 characters) made on request. It is kept so the panel can show the
-- link again whenever it is opened, and the public feed route looks it up by its SHA-256 hash
-- (unique index), never by comparing the token itself. Server-only: no student or anon access at
-- all (no policies, every privilege revoked), so the token never reaches the browser through
-- PostgREST and isn't in the data export. Resetting replaces the row; turning off deletes it;
-- deleting the account removes it (cascade).
create table public.calendar_links (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token text not null check (token ~ '^[A-Za-z0-9_-]{43}$'),
  token_hash text not null unique check (token_hash = encode(sha256(convert_to(token, 'UTF8')), 'hex')),
  created_at timestamptz not null default now(),
  -- When a calendar last fetched the feed (updated at most every 15 minutes, to keep the route cheap).
  last_fetched_at timestamptz
);
alter table public.calendar_links enable row level security;
revoke all on public.calendar_links from anon, authenticated;
