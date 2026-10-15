-- Per-page character counts of a subject's files, for the Make flashcards dialog (page ranges
-- for long files, docs/design/screens/flashcards.md "Long files"). Security review S2-9:
-- the dialog used to read every passage's full text of every file on each open, only to count
-- characters. This sums in the database and returns counts, never text.
--
-- SECURITY INVOKER: chunks RLS (user_id = auth.uid()) still applies, and the explicit user
-- filter keeps it to the caller's own rows even if it is ever called with a broader role.
create function public.source_page_chars(p_subject_id uuid)
returns table (source_id uuid, page integer, chars bigint)
language sql stable security invoker set search_path = ''
as $$
  select c.source_id, c.page, sum(char_length(c.text))::bigint
  from public.chunks c
  where c.subject_id = p_subject_id
    and c.source_id is not null
    and c.user_id = (select auth.uid())
  group by c.source_id, c.page
  order by c.source_id, c.page nulls first
$$;
revoke execute on function public.source_page_chars(uuid) from public, anon;
grant execute on function public.source_page_chars(uuid) to authenticated;
