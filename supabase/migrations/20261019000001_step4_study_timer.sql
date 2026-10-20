-- Step 4, part 1: study timer (docs/design/screens/timer.md, settings.md).
-- Same rules as Step 3: user_id on every row, RLS on, students can only READ their study
-- sessions; every write goes through a server action using the secret key pinned to the
-- student's id. The timetable and the calendar link come in part 2.

-- Timer preferences live on the profile ------------------------------------------------
-- They are per-student settings like sound and theme, read on every page with the profile and
-- written by the same "Saved" settings action, so they get columns on `profiles` (students
-- already update their own profile under the "own profile" policy). The checks keep a forged
-- update inside the ranges the steppers allow.
alter table public.profiles
  add column timer_focus_min smallint not null default 25 check (timer_focus_min between 5 and 120 and timer_focus_min % 5 = 0),
  add column timer_short_min smallint not null default 5 check (timer_short_min between 1 and 30),
  add column timer_long_min smallint not null default 15 check (timer_long_min between 5 and 60 and timer_long_min % 5 = 0),
  add column timer_long_every smallint not null default 4 check (timer_long_every between 2 and 8),
  add column timer_auto_start boolean not null default false,
  add column focus_quiet boolean not null default true;

-- study_sessions ------------------------------------------------------------------------
-- One row per timer phase that ended (completed, stopped, or ended while the tab was away),
-- written once by the tab that handled the end. Rounds under a minute are never saved.
create table public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Deleting a subject keeps its study time ("No subject"): only subject_id is cleared.
  subject_id uuid,
  kind text not null check (kind in ('focus', 'short_break', 'long_break')),
  planned_sec integer not null check (planned_sec between 60 and 10800),      -- up to 180 min with "+5 min"
  focused_sec integer not null check (focused_sec between 60 and 10800),      -- running time, pauses excluded
  completed boolean not null,                                                 -- ran to the end (not stopped)
  started_at timestamptz not null,
  ended_at timestamptz not null,
  client_key uuid not null,                                                   -- the timer's sessionId: a retried save logs once
  created_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete set null (subject_id),
  check (ended_at > started_at),
  check (ended_at - started_at <= interval '2 days'),
  check (focused_sec <= extract(epoch from (ended_at - started_at)) + 5),
  check (focused_sec <= planned_sec + 5),
  unique (id, user_id),
  unique (user_id, client_key)
);
create index study_sessions_user_idx on public.study_sessions (user_id, ended_at desc);
create index study_sessions_subject_idx on public.study_sessions (subject_id);

-- Row cap (the shared free database needs a hard limit): 10,000 phases is about 7 years of daily rounds.
create or replace function public.enforce_study_session_cap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.study_sessions where user_id = new.user_id) >= 10000 then
    raise exception 'study session limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_study_session_cap() from public, anon, authenticated;
create trigger study_sessions_cap before insert on public.study_sessions for each row execute function public.enforce_study_session_cap();

alter table public.study_sessions enable row level security;
create policy "read own study sessions" on public.study_sessions for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.study_sessions from authenticated;
revoke all on public.study_sessions from anon;
