-- Onboarding del professionista (cameriere)
-- Aggiunge: flag di completamento onboarding, skill auto-dichiarate,
-- e il bucket Storage privato per le certificazioni.

-- Flag di onboarding sul profilo condiviso.
alter table public.profiles
  add column if not exists onboarding_complete boolean not null default false;

-- I profili esistenti precedono l'onboarding: non vanno forzati nel wizard.
update public.profiles set onboarding_complete = true where onboarding_complete = false;

-- Skill auto-dichiarate dal cameriere (poi "confermate" dalle recensioni verificate).
alter table public.waiter_profiles
  add column if not exists skills text[] not null default '{}'::text[];

-- Bucket privato per gli attestati/certificazioni caricati in onboarding.
insert into storage.buckets (id, name, public)
values ('certifications', 'certifications', false)
on conflict (id) do nothing;

-- RLS Storage: ogni utente gestisce SOLO la propria cartella {uid}/...
drop policy if exists "certs: owner read" on storage.objects;
drop policy if exists "certs: owner insert" on storage.objects;
drop policy if exists "certs: owner update" on storage.objects;
drop policy if exists "certs: owner delete" on storage.objects;

create policy "certs: owner read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "certs: owner insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "certs: owner update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "certs: owner delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
