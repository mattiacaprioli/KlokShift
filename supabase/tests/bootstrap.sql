-- Allinea il Postgres locale (immagine supabase/postgres) a quello che GoTrue
-- e PostgREST forniscono sul progetto reale. Si esegue come supabase_admin,
-- una volta per ogni `run.sh reset`. Non fa parte delle migration.

-- Sul remoto auth.uid() legge il JSON `request.jwt.claims`; l'immagine locale
-- conserva il vecchio formato `request.jwt.claim.sub`.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif((nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')
  )::uuid
$$;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claims', true), ''),
    '{}'
  )::jsonb
$$;

-- Colonne di auth.users che il modello nuovo legge (aggancio inviti gated su
-- email_confirmed_at, come sul remoto).
alter table auth.users add column if not exists email_confirmed_at timestamptz;
alter table auth.users add column if not exists deleted_at timestamptz;
alter table auth.users add column if not exists is_anonymous boolean not null default false;

grant usage on schema auth to postgres;
grant select, insert, update, delete on auth.users to postgres;
grant execute on function auth.uid(), auth.jwt() to anon, authenticated, service_role, postgres;

-- ---------------------------------------------------------------------------
-- Storage: l'immagine locale ha lo schema ma non le tabelle. Le si ricrea a ogni
-- reset (così le policy della baseline non si duplicano).
-- ---------------------------------------------------------------------------
drop table if exists storage.objects cascade;
drop table if exists storage.buckets cascade;

create table storage.buckets (
  id text primary key, name text not null, owner uuid,
  public boolean default false, file_size_limit bigint, allowed_mime_types text[],
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
  name text, owner uuid, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now()
);
alter table storage.objects enable row level security;

create or replace function storage.foldername(name text) returns text[]
language plpgsql immutable as $$
declare _parts text[];
begin
  select string_to_array(name, '/') into _parts;
  return _parts[1:array_length(_parts, 1) - 1];
end $$;

alter table storage.buckets owner to postgres;
alter table storage.objects owner to postgres;
grant usage on schema storage to postgres, anon, authenticated, service_role;
grant all on storage.buckets, storage.objects to postgres, service_role;
grant select, insert, update, delete on storage.objects to authenticated;
grant select on storage.objects to anon;
grant execute on function storage.foldername(text) to public;

-- La publication di realtime esiste sul progetto reale.
do $$ begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;
