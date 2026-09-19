-- Foto profilo.
--
-- `profiles.avatar_url` esisteva da sempre e veniva già mostrata ovunque
-- (organico, candidature, chat, scheda pubblica), ma non c'era modo di
-- caricarne una: l'unico bucket era `certifications`, privato, per i documenti
-- dell'onboarding. Da qui il "Caricamento foto presto disponibile" dell'app.
--
-- Bucket **pubblico**: un avatar lo vede chiunque possa vedere la persona — il
-- locale che riceve la candidatura, chi chatta, chi legge la scheda pubblica.
-- Con un bucket privato servirebbe una signed URL a ogni riga di ogni elenco.
-- Dentro non ci va nient'altro che la foto scelta apposta per essere vista.
--
-- Limiti sul bucket e non solo nel client: il client si può aggirare.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  5242880,                                    -- 5 MB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
  set public            = excluded.public,
      file_size_limit   = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Lettura aperta: è il senso di un bucket pubblico, e serve anche ad `anon`
-- (il sito delle recensioni mostra la foto di chi si sta recensendo).
drop policy if exists "avatars: public read" on storage.objects;
create policy "avatars: public read" on storage.objects for select
  using (bucket_id = 'avatars');

-- Scrittura solo nella propria cartella: `<uid>/<file>`. Stessa forma delle
-- policy di `certifications` (20260705140000), con `(select auth.uid())` per
-- non rivalutare la funzione riga per riga (20260910120000).
drop policy if exists "avatars: owner insert" on storage.objects;
create policy "avatars: owner insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: owner update" on storage.objects;
create policy "avatars: owner update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "avatars: owner delete" on storage.objects;
create policy "avatars: owner delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
