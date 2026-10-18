-- Step 3: quizzes, questions, attempts, answers, weak topics.
-- Same rules as Step 2 (after its security review): user_id on every row, RLS on, students
-- can only READ these rows; every write goes through a server action, which uses the secret
-- key pinned to the student's id. Composite foreign keys (x_id, user_id) mean a row can never
-- point at another student's subject, quiz, question, note, file or passage, even for the server.

-- quizzes -------------------------------------------------------------------
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  title text not null check (char_length(title) between 1 and 200),       -- built by the server, never the AI
  kind text not null check (kind in ('mcq', 'fill', 'mixed')),
  focus text not null default 'all' check (focus in ('all', 'weak')),
  requested smallint not null check (requested in (5, 10, 15)),
  -- What it was made from: notes/files (empty = everything), and the page range of a file.
  source_ids uuid[] not null default '{}' check (cardinality(source_ids) <= 50),
  page_from integer check (page_from is null or page_from > 0),
  page_to integer check (page_to is null or page_to >= page_from),
  input_hash text not null check (char_length(input_hash) <= 128),        -- cache key of the generation
  deleted_at timestamptz,                                                   -- soft delete (Undo)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index quizzes_subject_idx on public.quizzes (subject_id, created_at desc) where deleted_at is null;
create index quizzes_hash_idx on public.quizzes (user_id, subject_id, input_hash) where deleted_at is null;

-- questions -------------------------------------------------------------------
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quiz_id uuid not null,
  subject_id uuid not null,
  ordinal smallint not null check (ordinal between 0 and 19),
  type text not null check (type in ('mcq', 'fill')),
  prompt text not null check (char_length(prompt) between 1 and 500),
  -- Multiple choice: exactly 4 options and the index of the right one. Fill in: neither.
  options_json jsonb check (options_json is null or (jsonb_typeof(options_json) = 'array' and jsonb_array_length(options_json) = 4 and octet_length(options_json::text) <= 2000)),
  correct_index smallint check (correct_index between 0 and 3),
  answer text not null check (char_length(answer) between 1 and 300),
  -- Fill in: other answers that count (AI alternatives + "I was right" overrides).
  accepted_json jsonb not null default '[]'::jsonb check (jsonb_typeof(accepted_json) = 'array' and jsonb_array_length(accepted_json) <= 10 and octet_length(accepted_json::text) <= 2000),
  explanation text not null default '' check (char_length(explanation) <= 1000),
  topic text not null check (char_length(topic) between 1 and 60),
  topic_key text generated always as (lower(btrim(topic))) stored,
  source_quote text check (char_length(source_quote) <= 1000),
  -- Where it came from; cleared (not the question) when the note, file or passage is deleted.
  note_id uuid,
  source_id uuid,
  chunk_id uuid,
  page integer check (page is null or page > 0),
  edited boolean not null default false,
  removed_at timestamptz,                                                    -- "Report a problem" / "Remove from quiz"
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (quiz_id, user_id) references public.quizzes (id, user_id) on delete cascade,
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete set null (note_id),
  foreign key (source_id, user_id) references public.sources (id, user_id) on delete set null (source_id),
  foreign key (chunk_id, user_id) references public.chunks (id, user_id) on delete set null (chunk_id),
  check (num_nonnulls(note_id, source_id) <= 1),
  check ((type = 'mcq') = (options_json is not null and correct_index is not null)),
  unique (quiz_id, ordinal),
  unique (id, user_id)
);
create index questions_quiz_idx on public.questions (quiz_id, ordinal);
create index questions_topic_idx on public.questions (user_id, subject_id, topic_key);
create index questions_chunk_idx on public.questions (chunk_id);
create index questions_note_idx on public.questions (note_id);
create index questions_source_idx on public.questions (source_id);

-- quiz_attempts: one run through a quiz ------------------------------------------
create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  quiz_id uuid not null,
  subject_id uuid not null,
  -- This attempt's order: [{ "q": question id, "o": option order or null }]
  order_json jsonb not null check (jsonb_typeof(order_json) = 'array' and jsonb_array_length(order_json) <= 20 and octet_length(order_json::text) <= 10000),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score smallint check (score >= 0),
  total smallint check (total >= 0),
  foreign key (quiz_id, user_id) references public.quizzes (id, user_id) on delete cascade,
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  check (score is null or score <= total),
  unique (id, user_id)
);
create index quiz_attempts_quiz_idx on public.quiz_attempts (quiz_id, started_at desc);
create index quiz_attempts_subject_idx on public.quiz_attempts (subject_id, started_at desc);

-- answers: one per question per attempt, saved at once ----------------------------
create table public.answers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  attempt_id uuid not null,
  question_id uuid not null,
  subject_id uuid not null,
  client_key uuid not null,                         -- a double tap can't answer twice
  given text not null default '' check (char_length(given) <= 300),
  choice smallint check (choice between 0 and 3),   -- multiple choice: the option (in the question's own order)
  dont_know boolean not null default false,
  correct boolean not null,
  typo boolean not null default false,              -- accepted with one typo
  overridden boolean not null default false,        -- "I think my answer is right"
  -- The weak topic as it was before this miss, so an override can undo exactly that miss.
  weak_prev jsonb check (weak_prev is null or octet_length(weak_prev::text) <= 500),
  answered_at timestamptz not null default now(),
  foreign key (attempt_id, user_id) references public.quiz_attempts (id, user_id) on delete cascade,
  foreign key (question_id, user_id) references public.questions (id, user_id) on delete cascade,
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (attempt_id, question_id),
  unique (user_id, client_key)
);
create index answers_question_idx on public.answers (question_id);
create index answers_subject_idx on public.answers (user_id, subject_id, answered_at);

-- weak_topics: what to practise, per subject ---------------------------------------
create table public.weak_topics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  topic text not null check (char_length(topic) between 1 and 60),
  topic_key text generated always as (lower(btrim(topic))) stored,
  miss_count integer not null default 0 check (miss_count >= 0),
  right_streak integer not null default 0 check (right_streak >= 0),
  last_missed_at timestamptz,
  cleared_at timestamptz,
  -- The passages behind the most recent misses (at most 10), for practice quizzes. Not
  -- foreign keys: the server resolves them through the student's own passages and shows
  -- "Source deleted" for any that are gone.
  chunk_ids uuid[] not null default '{}' check (cardinality(chunk_ids) <= 10),
  recent boolean[] not null default '{}' check (cardinality(recent) <= 5),   -- last 5 tries, oldest first
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (subject_id, user_id, topic_key),
  unique (id, user_id)
);
create index weak_topics_open_idx on public.weak_topics (subject_id, last_missed_at desc) where cleared_at is null;

create trigger quizzes_updated before update on public.quizzes for each row execute function public.set_updated_at();
create trigger questions_updated before update on public.questions for each row execute function public.set_updated_at();
create trigger weak_topics_updated before update on public.weak_topics for each row execute function public.set_updated_at();

-- Row caps in the database too (the server checks first; this is the backstop) ----------
-- Quizzes are capped by the daily AI quota, but a cached quiz can be remade for free after a
-- delete, and every retake adds an attempt, so the shared free database needs hard limits.
create or replace function public.enforce_quiz_caps() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_table_name = 'quizzes' then
    if (select count(*) from public.quizzes where subject_id = new.subject_id and user_id = new.user_id) >= 200 then
      raise exception 'quiz limit reached' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'questions' then
    if (select count(*) from public.questions where quiz_id = new.quiz_id and user_id = new.user_id) >= 20 then
      raise exception 'question limit reached' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'quiz_attempts' then
    if (select count(*) from public.quiz_attempts where quiz_id = new.quiz_id and user_id = new.user_id) >= 50 then
      raise exception 'attempt limit reached' using errcode = 'check_violation';
    end if;
  elsif tg_table_name = 'weak_topics' then
    if (select count(*) from public.weak_topics where subject_id = new.subject_id and user_id = new.user_id) >= 500 then
      raise exception 'weak topic limit reached' using errcode = 'check_violation';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.enforce_quiz_caps() from public, anon, authenticated;
create trigger quizzes_cap before insert on public.quizzes for each row execute function public.enforce_quiz_caps();
create trigger questions_cap before insert on public.questions for each row execute function public.enforce_quiz_caps();
create trigger quiz_attempts_cap before insert on public.quiz_attempts for each row execute function public.enforce_quiz_caps();
create trigger weak_topics_cap before insert on public.weak_topics for each row execute function public.enforce_quiz_caps();

-- Row Level Security: read-only to students -----------------------------------------
alter table public.quizzes enable row level security;
alter table public.questions enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.answers enable row level security;
alter table public.weak_topics enable row level security;

create policy "read own quizzes" on public.quizzes for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own questions" on public.questions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own quiz attempts" on public.quiz_attempts for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own answers" on public.answers for select to authenticated
  using (user_id = (select auth.uid()));
create policy "read own weak topics" on public.weak_topics for select to authenticated
  using (user_id = (select auth.uid()));

revoke insert, update, delete, truncate on public.quizzes, public.questions, public.quiz_attempts, public.answers, public.weak_topics from authenticated;
revoke all on public.quizzes, public.questions, public.quiz_attempts, public.answers, public.weak_topics from anon;

-- Answers stay hidden until answered (quiz.md "Data the screen needs"): students can read a
-- question's prompt and options but not its answer, accepted answers or explanation, even with
-- the publishable key and their own session. The server reads those with the secret key,
-- pinned to the student's id, and sends them only after the student has answered.
revoke select on public.questions from authenticated;
grant select (id, user_id, quiz_id, subject_id, ordinal, type, prompt, options_json, topic, topic_key, source_quote,
  note_id, source_id, chunk_id, page, edited, removed_at, created_at, updated_at) on public.questions to authenticated;
