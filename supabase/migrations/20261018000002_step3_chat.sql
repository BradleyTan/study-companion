-- Step 3, part 2: Ask your notes (docs/design/screens/chat.md).
-- Same rules as the rest of Step 3: user_id on every row, RLS on, students can only READ their
-- chat; every write goes through a server action using the secret key pinned to the student's
-- id. Composite foreign keys (x_id, user_id) mean a message can never sit in another student's
-- subject or answer another student's question, even when written by the server.

-- chat_messages ---------------------------------------------------------------------
create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  subject_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  -- 'question' for the student's message; an answer, or the "your notes don't cover that" reply.
  kind text not null check (kind in ('question', 'answer', 'not_covered')),
  content text not null check (char_length(content) between 1 and 4000),
  -- [{ n, chunkId, noteId, sourceId, page, label, quote }]: where each [n] in the answer came
  -- from (for not_covered: the "Closest I found" passages). Not foreign keys: a deleted note or
  -- file shows "Source deleted" and the quote stays readable.
  citations_json jsonb not null default '[]'::jsonb
    check (jsonb_typeof(citations_json) = 'array' and jsonb_array_length(citations_json) <= 12 and octet_length(citations_json::text) <= 20000),
  reveal text check (char_length(reveal) <= 2000),          -- "Quiz me": the answer behind "Show answer"
  feedback text check (feedback in ('wrong', 'not_in_notes', 'too_long')),  -- "Not right?"
  client_key uuid,                                          -- the composer's key: a retried send answers once
  reply_to uuid,                                            -- an answer's question
  created_at timestamptz not null default now(),
  foreign key (subject_id, user_id) references public.subjects (id, user_id) on delete cascade,
  foreign key (reply_to, user_id) references public.chat_messages (id, user_id) on delete cascade,
  check ((role = 'user') = (kind = 'question')),
  check (role = 'assistant' or char_length(content) <= 500),               -- questions: 1-500 characters
  check ((role = 'user') = (reply_to is null)),
  check (role = 'user' or client_key is null),
  check (role = 'assistant' or (feedback is null and reveal is null and citations_json = '[]'::jsonb)),
  check (reveal is null or kind = 'answer'),
  unique (id, user_id),
  unique (user_id, client_key)
);
create index chat_messages_subject_idx on public.chat_messages (user_id, subject_id, created_at desc, id desc);
create index chat_messages_reply_idx on public.chat_messages (reply_to);

-- Row cap in the database too (the server prunes the oldest first; this is the backstop):
-- not-covered replies cost no AI go, so the shared free database needs a hard limit.
create or replace function public.enforce_chat_cap() returns trigger
language plpgsql set search_path = '' as $$
begin
  if (select count(*) from public.chat_messages where subject_id = new.subject_id and user_id = new.user_id) >= 1000 then
    raise exception 'chat message limit reached' using errcode = 'check_violation';
  end if;
  return new;
end $$;
revoke execute on function public.enforce_chat_cap() from public, anon, authenticated;
create trigger chat_messages_cap before insert on public.chat_messages for each row execute function public.enforce_chat_cap();

alter table public.chat_messages enable row level security;
create policy "read own chat messages" on public.chat_messages for select to authenticated
  using (user_id = (select auth.uid()));
revoke insert, update, delete, truncate on public.chat_messages from authenticated;
revoke all on public.chat_messages from anon;

-- Retrieval --------------------------------------------------------------------------
-- Both functions follow source_page_chars: SECURITY INVOKER, so chunks RLS (user_id = auth.uid())
-- applies, plus an explicit user filter that keeps them to the caller's own passages even if they
-- are ever called with a broader role. The server calls them with the student's own session.

-- Keyword search for when embeddings are missing or the embed function is down: passages sharing
-- any of the question's words (an OR of the plain query's lexemes), best first. The server scores
-- the candidates itself (src/lib/chat/retrieve.ts) before deciding anything is covered.
create index chunks_fts_idx on public.chunks using gin (to_tsvector('english', text));

create function public.search_chunks(p_subject_id uuid, p_query text, p_count integer default 30, p_unembedded_only boolean default false)
returns table (id uuid, subject_id uuid, note_id uuid, source_id uuid, ordinal integer, page integer, text text, content_hash text, rank real)
language sql stable security invoker set search_path = ''
as $$
  with q as (
    -- plainto_tsquery joins lexemes with &; any of them is enough here. Lexemes come out quoted,
    -- so the replace can't change their meaning. A query of only stop words gives no rows.
    select nullif(replace(plainto_tsquery('english', left(coalesce(p_query, ''), 1000))::text, ' & ', ' | '), '')::tsquery as tsq
  )
  select c.id, c.subject_id, c.note_id, c.source_id, c.ordinal, c.page, c.text, c.content_hash,
         ts_rank_cd(to_tsvector('english', c.text), q.tsq) as rank
  from public.chunks c, q
  where q.tsq is not null
    and c.subject_id = p_subject_id
    and c.user_id = (select auth.uid())
    and to_tsvector('english', c.text) @@ q.tsq
    and (not coalesce(p_unembedded_only, false) or c.embedding is null)
  order by rank desc, c.id
  limit least(greatest(coalesce(p_count, 30), 1), 50)
$$;
revoke execute on function public.search_chunks(uuid, text, integer, boolean) from public, anon;
grant execute on function public.search_chunks(uuid, text, integer, boolean) to authenticated;

-- Nearest passages to the question's embedding (gte-small, 384 dimensions, normalised), by
-- cosine similarity. Exact search within one subject (no ANN index): a subject holds at most a
-- few thousand passages, and an ANN index with a subject filter can return too few rows.
create function public.match_chunks(p_subject_id uuid, p_embedding extensions.vector(384), p_count integer default 6)
returns table (id uuid, subject_id uuid, note_id uuid, source_id uuid, ordinal integer, page integer, text text, content_hash text, similarity double precision)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.subject_id, c.note_id, c.source_id, c.ordinal, c.page, c.text, c.content_hash,
         1 - (c.embedding operator(extensions.<=>) p_embedding) as similarity
  from public.chunks c
  where c.subject_id = p_subject_id
    and c.user_id = (select auth.uid())
    and c.embedding is not null
  order by c.embedding operator(extensions.<=>) p_embedding, c.id
  limit least(greatest(coalesce(p_count, 6), 1), 20)
$$;
revoke execute on function public.match_chunks(uuid, extensions.vector, integer) from public, anon;
grant execute on function public.match_chunks(uuid, extensions.vector, integer) to authenticated;
