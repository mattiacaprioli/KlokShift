-- Ripristino dello storage: bucket `avatars` e `staff-documents` con le loro policy.
--
-- La sezione Storage di 20260920001300_documents_career era applicata, ma il 20/09
-- sera sul remoto non c'erano più né i bucket né le policy su `storage.objects`:
-- ripulendo dalla dashboard i file orfani sono stati eliminati i bucket interi, e
-- con un bucket se ne vanno anche le sue policy. Ogni upload tornava 400.
--
-- ⚠️ Per togliere file orfani si SVUOTA il bucket, non lo si elimina.
--
-- Idempotente: ripete la baseline e riallinea anche un bucket ricreato a mano.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, '{image/jpeg,image/png,image/webp}'),
  ('staff-documents', 'staff-documents', false, 10485760,
   '{application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif}')
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Avatar: pubblico in lettura (è fatto per essere visto), scrittura nella propria cartella.
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects for select to public
  using (bucket_id = 'avatars');
drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Documenti: privati. Il primo segmento del percorso è l'id del membro.
drop policy if exists "staff documents: read" on storage.objects;
create policy "staff documents: read" on storage.objects for select to authenticated
  using (bucket_id = 'staff-documents'
         and private.can_access_member_documents(((storage.foldername(name))[1])::uuid));
drop policy if exists "staff documents: insert" on storage.objects;
create policy "staff documents: insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-documents'
              and private.can_access_member_documents(((storage.foldername(name))[1])::uuid));
drop policy if exists "staff documents: delete" on storage.objects;
create policy "staff documents: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'staff-documents'
         and private.can_access_member_documents(((storage.foldername(name))[1])::uuid));
