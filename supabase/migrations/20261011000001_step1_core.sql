-- Step 1: profiles, subjects, notes, sources, chunks, AI usage/cache.
-- Every table: user_id references auth.users (cascade), RLS on, owner-only policies.
-- Child rows reference their subject with (subject_id, user_id) so a row can never
-- point at another student's subject, even if a policy were wrong.

create extension if not exists vector with schema extensions;

-- updated_at helper
create or replace function public.set_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- profiles ---------------------------------------------------------------
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  timezone text not null default 'UTC' check (char_length(timezone) <= 64),
  sound_on boolean not null default true,
  volume real not null default 0.35 check (volume >= 0 and volume <= 1),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id) values (new.id) on conflict do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- subjects ---------------------------------------------------------------
create table public.subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  colour text not null check (colour in ('sky','sun','coral','mint','lilac','peach','rose','sage')),
  emoji text not null check (char_length(emoji) between 1 and 16),
  exam_date date,                       -- Phase 2: exam countdown
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index subjects_user_idx on public.subjects (user_id, created_at);

-- notes ------------------------------------------------------------------
create table public.notes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  title text not null default '' check (char_length(title) <= 200),
  content_json jsonb not null default '{"type":"doc","content":[]}'::jsonb,
  content_text text not null default '' check (char_length(content_text) <= 200000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (id, user_id)
);
create index notes_subject_idx on public.notes (subject_id, updated_at desc);

-- sources (uploaded lecturer files) ---------------------------------------
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  file_name text not null check (char_length(file_name) between 1 and 255),
  kind text not null check (kind in ('pdf', 'pptx')),
  size_bytes integer not null check (size_bytes >= 0 and size_bytes <= 26214400),
  storage_path text not null,
  page_count integer,
  extract_status text not null default 'pending'
    check (extract_status in ('pending', 'reading', 'ready', 'no_text', 'failed')),
  extract_error text,
  origin text not null default 'upload' check (origin in ('upload', 'ocr')), -- Phase 2: OCR
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  unique (id, user_id),
  -- files must live under the owner's folder in Storage
  check (storage_path like user_id::text || '/%')
);
create index sources_subject_idx on public.sources (subject_id, created_at desc);

-- upload log: append-only, written by the server only, so deleting files can't reset the daily limit
create table public.upload_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  bytes integer not null check (bytes >= 0),
  created_at timestamptz not null default now()
);
create index upload_log_user_idx on public.upload_log (user_id, created_at);

-- chunks: searchable passages from notes and sources -----------------------
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  note_id uuid,
  source_id uuid,
  ordinal integer not null,
  page integer,
  text text not null check (char_length(text) <= 4000),
  content_hash text not null,
  embedding extensions.vector(384),
  created_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  foreign key (note_id, user_id) references public.notes (id, user_id) on delete cascade,
  foreign key (source_id, user_id) references public.sources (id, user_id) on delete cascade,
  check (num_nonnulls(note_id, source_id) = 1)
);
create index chunks_subject_idx on public.chunks (subject_id);
create index chunks_source_idx on public.chunks (source_id);
create index chunks_note_idx on public.chunks (note_id);

-- AI usage (daily quota) and cache ---------------------------------------
create table public.ai_usage (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  day date not null default current_date,
  kind text not null check (kind in ('flashcards', 'quiz', 'mindmap', 'chat')),
  count integer not null default 0 check (count >= 0),
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  primary key (user_id, day, kind)
);

create table public.ai_cache (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind text not null,
  input_hash text not null,
  model text not null,
  output_json jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, kind, input_hash)
);

-- updated_at triggers
create trigger profiles_updated before update on public.profiles for each row execute function public.set_updated_at();
create trigger subjects_updated before update on public.subjects for each row execute function public.set_updated_at();
create trigger notes_updated before update on public.notes for each row execute function public.set_updated_at();
create trigger sources_updated before update on public.sources for each row execute function public.set_updated_at();

-- Row Level Security ------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.subjects enable row level security;
alter table public.notes enable row level security;
alter table public.sources enable row level security;
alter table public.chunks enable row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_cache enable row level security;
alter table public.upload_log enable row level security;

create policy "own profile" on public.profiles for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own subjects" on public.subjects for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own notes" on public.notes for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- Sources and chunks are created and updated only by the server (secret key) after it has
-- checked limits and file contents. Students can read and delete their own.
create policy "read own sources" on public.sources for select to authenticated
  using (user_id = (select auth.uid()));
create policy "delete own sources" on public.sources for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "read own chunks" on public.chunks for select to authenticated
  using (user_id = (select auth.uid()));
create policy "delete own chunks" on public.chunks for delete to authenticated
  using (user_id = (select auth.uid()));
create policy "read own upload log" on public.upload_log for select to authenticated
  using (user_id = (select auth.uid()));
-- Quota rows are read-only to students; only the server (service role) writes them.
create policy "read own usage" on public.ai_usage for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own cache" on public.ai_cache for select to authenticated
  using (user_id = (select auth.uid()));

-- anon gets nothing
revoke all on all tables in schema public from anon;
