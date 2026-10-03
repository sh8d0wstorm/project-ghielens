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

select policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
order by policyname;