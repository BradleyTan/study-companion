-- Private bucket for lecturer files. Objects live at "<user_id>/<source_id>/<file>".
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sources', 'sources', false, 26214400,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.presentationml.presentation']
)
on conflict (id) do nothing;

create policy "read own files" on storage.objects for select to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
-- No insert policy: students can only upload through a signed upload URL that the server
-- creates (with the secret key) after checking their limits.
create policy "delete own files" on storage.objects for delete to authenticated
  using (bucket_id = 'sources' and (storage.foldername(name))[1] = (select auth.uid())::text);
