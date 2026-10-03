drop policy if exists "Ghielens Firebase admin uploads place photos" on storage.objects;

create policy "Ghielens Firebase admin uploads place photos"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'place-photos'
  and (storage.foldername(name))[1] = 'places'
  and auth.jwt() ->> 'iss' = 'https://securetoken.google.com/project-ghielens'
  and auth.jwt() ->> 'aud' = 'project-ghielens'
  and auth.jwt() ->> 'email' = 'juno.denis2008@gmail.com'
);

select id, name, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'place-photos';

select
  policyname,
  roles,
  cmd,
  with_check,
  roles && array['anon'::name, 'public'::name] as exposes_anonymous_role
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and cmd in ('INSERT', 'ALL')
order by policyname;