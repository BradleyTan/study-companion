-- Step 2: flashcards, FSRS review log, mindmaps, AI quota helpers.
-- Same rules as Step 1: user_id on every row, RLS user_id = auth.uid(), and composite
-- foreign keys (x_id, user_id) so a row can never point at another student's data.

-- Flashcards and mindmap nodes point at passages; let other tables reference (id, user_id).
alter table public.chunks add constraint chunks_id_user_key unique (id, user_id);

-- flashcards ---------------------------------------------------------------
create table public.flashcards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  -- Where the card came from. All null = written by hand. When the note/file/passage is
  -- deleted the link is cleared but the card and its quote stay.
  note_id uuid,
  source_id uuid,
  chunk_id uuid,
  page integer check (page is null or page > 0),
  front text not null check (char_length(front) between 1 and 500),
  back text not null check (char_length(back) between 1 and 1500),
  source_quote text check (char_length(source_quote) <= 1000),
  origin text not null default 'manual' check (origin in ('ai', 'manual')),
  input_hash text check (char_length(input_hash) <= 128), -- which generation made it (cache key)
  edited boolean not null default false,
  deleted_at timestamptz,                                  -- soft delete (Undo)
  -- Current FSRS schedule. Mirrors the latest card_reviews row (or "new" when there is none).
  srs_state smallint not null default 0 check (srs_state between 0 and 3),
  due_at timestamptz not null default now(),
  stability double precision not null default 0 check (stability >= 0),
  difficulty double precision not null default 0 check (difficulty >= 0),
  elapsed_days integer not null default 0 check (elapsed_days >= 0),
  scheduled_days integer not null default 0 check (scheduled_days >= 0),
  learning_steps integer not null default 0 check (learning_steps >= 0),
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  last_review_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete set null (note_id),
  foreign key (source_id, user_id) references public.sources (id, user_id) on delete set null (source_id),
  foreign key (chunk_id, user_id) references public.chunks (id, user_id) on delete set null (chunk_id),
  check (num_nonnulls(note_id, source_id) <= 1),
  unique (id, user_id)
);
create index flashcards_subject_idx on public.flashcards (subject_id, created_at desc) where deleted_at is null;
create index flashcards_due_idx on public.flashcards (user_id, due_at) where deleted_at is null;
create index flashcards_hash_idx on public.flashcards (user_id, input_hash) where input_hash is not null;
create index flashcards_chunk_idx on public.flashcards (chunk_id);
create index flashcards_note_idx on public.flashcards (note_id);
create index flashcards_source_idx on public.flashcards (source_id);

-- card_reviews: FSRS history, one row per grade ----------------------------
create table public.card_reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  flashcard_id uuid not null,
  subject_id uuid not null,
  client_key uuid,                                   -- makes retried saves idempotent
  rating smallint not null check (rating between 1 and 4),
  prev_state smallint not null check (prev_state between 0 and 3), -- 0 = first time seen (counts towards the daily new-card allowance)
  reviewed_at timestamptz not null default now(),
  -- card state after this review
  srs_state smallint not null check (srs_state between 0 and 3),
  due_at timestamptz not null,
  stability double precision not null check (stability >= 0),
  difficulty double precision not null check (difficulty >= 0),
  elapsed_days integer not null default 0 check (elapsed_days >= 0),
  scheduled_days integer not null default 0 check (scheduled_days >= 0),
  learning_steps integer not null default 0 check (learning_steps >= 0),
  reps integer not null default 0 check (reps >= 0),
  lapses integer not null default 0 check (lapses >= 0),
  foreign key (flashcard_id, user_id) references public.flashcards (id, user_id) on delete cascade,
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (user_id, client_key)
);
create index card_reviews_card_idx on public.card_reviews (flashcard_id, reviewed_at desc);
create index card_reviews_user_idx on public.card_reviews (user_id, reviewed_at);

-- mindmaps: one per subject -------------------------------------------------
create table public.mindmaps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  -- { version, nodes: [{ id, label, parentId, chunkId, position? }] }
  graph_json jsonb not null check (octet_length(graph_json::text) <= 200000),
  input_hash text not null check (char_length(input_hash) <= 128),
  -- which sources it was made from: { all, noteIds, sourceIds }
  sources_json jsonb not null default '{"all": true, "noteIds": [], "sourceIds": []}'::jsonb
    check (octet_length(sources_json::text) <= 50000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (subject_id, user_id) -- (not just subject_id, so a foreign insert fails on the FK without revealing the row)
);

-- App-wide AI budget (all students together), kept under the free plan's daily limit.
-- Server only: RLS on, no policies.
create table public.ai_app_usage (
  day date not null,
  model text not null check (char_length(model) <= 100),
  requests integer not null default 0 check (requests >= 0),
  tokens integer not null default 0 check (tokens >= 0),
  primary key (day, model)
);

create trigger flashcards_updated before update on public.flashcards for each row execute function public.set_updated_at();
create trigger mindmaps_updated before update on public.mindmaps for each row execute function public.set_updated_at();

-- Row Level Security ------------------------------------------------------
alter table public.flashcards enable row level security;
alter table public.card_reviews enable row level security;
alter table public.mindmaps enable row level security;
alter table public.ai_app_usage enable row level security;

create policy "own flashcards" on public.flashcards for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own card reviews" on public.card_reviews for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own mindmaps" on public.mindmaps for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

revoke all on public.ai_app_usage from anon, authenticated;
revoke all on public.flashcards, public.card_reviews, public.mindmaps from anon;

-- Quota helpers, called by the server with the secret key only ---------------
-- Reserve one generation for a student before calling the AI. Returns the new count,
-- or null when the daily limit is already used (atomic, so parallel requests can't overshoot).
create or replace function public.ai_usage_reserve(p_user_id uuid, p_day date, p_kind text, p_limit integer)
returns integer language plpgsql set search_path = '' as $$
declare n integer;
begin
  if p_limit <= 0 then return null; end if;
  insert into public.ai_usage as u (user_id, day, kind, count)
  values (p_user_id, p_day, p_kind, 1)
  on conflict (user_id, day, kind) do update set count = u.count + 1
    where u.count < p_limit
  returning u.count into n;
  return n;
end $$;

-- Settle a reservation: failed generations give the go back; tokens are added for tracking.
create or replace function public.ai_usage_settle(p_user_id uuid, p_day date, p_kind text, p_ok boolean, p_input_tokens integer, p_output_tokens integer)
returns void language plpgsql set search_path = '' as $$
begin
  update public.ai_usage
     set count = case when p_ok then count else greatest(count - 1, 0) end,
         input_tokens = input_tokens + greatest(p_input_tokens, 0),
         output_tokens = output_tokens + greatest(p_output_tokens, 0)
   where user_id = p_user_id and day = p_day and kind = p_kind;
end $$;

-- Reserve one request against the app-wide daily budget for a model. False = budget used up.
create or replace function public.ai_app_reserve(p_day date, p_model text, p_max_requests integer, p_max_tokens integer)
returns boolean language plpgsql set search_path = '' as $$
declare ok boolean;
begin
  insert into public.ai_app_usage as a (day, model, requests)
  values (p_day, p_model, 1)
  on conflict (day, model) do update set requests = a.requests + 1
    where a.requests < p_max_requests and a.tokens < p_max_tokens
  returning true into ok;
  return coalesce(ok, false);
end $$;

create or replace function public.ai_app_add_tokens(p_day date, p_model text, p_tokens integer)
returns void language plpgsql set search_path = '' as $$
begin
  update public.ai_app_usage set tokens = tokens + greatest(p_tokens, 0) where day = p_day and model = p_model;
end $$;

revoke execute on function public.ai_usage_reserve(uuid, date, text, integer) from public, anon, authenticated;
revoke execute on function public.ai_usage_settle(uuid, date, text, boolean, integer, integer) from public, anon, authenticated;
revoke execute on function public.ai_app_reserve(date, text, integer, integer) from public, anon, authenticated;
revoke execute on function public.ai_app_add_tokens(date, text, integer) from public, anon, authenticated;
grant execute on function public.ai_usage_reserve(uuid, date, text, integer) to service_role;
grant execute on function public.ai_usage_settle(uuid, date, text, boolean, integer, integer) to service_role;
grant execute on function public.ai_app_reserve(date, text, integer, integer) to service_role;
grant execute on function public.ai_app_add_tokens(date, text, integer) to service_role;
