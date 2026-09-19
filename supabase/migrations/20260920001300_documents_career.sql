-- Baseline — 14/N: documenti dello staff, profilo professionale, storage.
--
-- Documenti (HACCP, contratti, scadenze): sulla PERSONA, non sulla sede. Li
-- leggono la persona stessa, il titolare e chi ha «Documenti» su una sede in cui
-- lavora. Scrittura diretta (il file lo carica il client su storage), gated dalla
-- stessa funzione della lettura.
--
-- Profilo professionale (`waiter_*`, `reviews`): il percorso di carriera è
-- dell'account e vale fra più aziende. Le recensioni restano sospese
-- (REVIEWS_ENABLED=false) ma la tabella c'è.

-- ---------------------------------------------------------------------------
-- Documenti
-- ---------------------------------------------------------------------------
create table public.staff_documents (
  id           uuid primary key default gen_random_uuid(),
  member_id    uuid not null references public.workspace_members (id) on delete cascade,
  name         text not null check (btrim(name) <> ''),
  storage_path text not null unique,
  mime_type    text,
  size_bytes   integer,
  expires_at   date,
  uploaded_by  uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  -- Il file sta sotto la cartella della persona: così le policy dello storage
  -- si decidono dal primo segmento del percorso.
  constraint staff_documents_path_owner_ck check (storage_path like member_id::text || '/%')
);
create index staff_documents_member_idx on public.staff_documents (member_id);
alter table public.staff_documents enable row level security;
create trigger staff_documents_updated_at before update on public.staff_documents
  for each row execute function public.update_updated_at();

create function public.staff_documents_set_uploader()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.uploaded_by := (select auth.uid());
  return new;
end;
$$;
create trigger staff_documents_uploader before insert on public.staff_documents
  for each row execute function public.staff_documents_set_uploader();

-- Chi accede ai documenti di una persona: lei, il titolare, chi ha «Documenti».
create function private.can_access_member_documents(p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_member in (select private.my_member_ids()) or private.can_person(p_member, 'documents');
$$;
grant execute on function private.can_access_member_documents(uuid) to authenticated;

create policy "staff_documents: person and document managers" on public.staff_documents
  for all to authenticated
  using (private.can_access_member_documents(member_id))
  with check (private.can_access_member_documents(member_id));
grant select, delete on public.staff_documents to authenticated;
grant insert (member_id, name, storage_path, mime_type, size_bytes, expires_at) on public.staff_documents to authenticated;
grant update (name, expires_at) on public.staff_documents to authenticated;

-- ---------------------------------------------------------------------------
-- Profilo professionale
-- ---------------------------------------------------------------------------
create table public.waiter_profiles (
  id                uuid primary key references public.profiles (id) on delete cascade,
  years_experience  integer default 0,
  availability_days text[] default '{}',
  hourly_rate_min   numeric(10,2),
  cv_url            text,
  documents         text[] default '{}',
  primary_role      text,
  languages         text[] not null default '{}',
  specializations   text,
  experience        text,
  rating_avg        numeric(3,2) not null default 0,
  rating_count      integer not null default 0
);
alter table public.waiter_profiles enable row level security;

create table public.waiter_experiences (
  id           uuid primary key default gen_random_uuid(),
  waiter_id    uuid not null references public.profiles (id) on delete cascade,
  company_name text not null,
  role         text,
  start_year   integer,
  end_year     integer,
  detail       text,
  created_at   timestamptz not null default now(),
  constraint waiter_experiences_year_order_chk check (end_year is null or start_year is null or end_year >= start_year)
);
create index waiter_experiences_waiter_idx on public.waiter_experiences (waiter_id);
alter table public.waiter_experiences enable row level security;

create table public.reviews (
  id            uuid primary key default gen_random_uuid(),
  waiter_id     uuid not null references public.profiles (id) on delete cascade,
  rating        integer not null check (rating between 1 and 5),
  comment       text,
  tags          text[] not null default '{}',
  reviewer_name text,
  shift_id      uuid references public.shifts (id) on delete set null,
  venue_id      uuid references public.venues (id) on delete set null,
  receipt_ref   text,
  verified      boolean not null default false,
  status        text not null default 'published',
  created_at    timestamptz not null default now()
);
create index reviews_waiter_idx on public.reviews (waiter_id);
alter table public.reviews enable row level security;

-- Il profilo professionale lo leggono il suo proprietario e chi lo ha in azienda
-- (via `visible_profile_ids`). Non è più pubblico: non c'è un marketplace in cui
-- essere cercati, e il percorso di carriera è un dato della persona.
create policy "waiter_profiles: self and visible read" on public.waiter_profiles
  for select to authenticated
  using (id = (select auth.uid()) or id in (select private.visible_profile_ids()));
create policy "waiter_profiles: self write" on public.waiter_profiles
  for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
-- Il rating lo tiene il trigger, mai il client: GRANT per colonna, senza rating_*.
grant select on public.waiter_profiles to authenticated;
grant insert (id, years_experience, availability_days, hourly_rate_min, cv_url, documents, primary_role,
              languages, specializations, experience) on public.waiter_profiles to authenticated;
grant update (years_experience, availability_days, hourly_rate_min, cv_url, documents, primary_role,
              languages, specializations, experience) on public.waiter_profiles to authenticated;

create policy "waiter_experiences: self and visible read" on public.waiter_experiences
  for select to authenticated
  using (waiter_id = (select auth.uid()) or waiter_id in (select private.visible_profile_ids()));
create policy "waiter_experiences: self write" on public.waiter_experiences
  for all to authenticated
  using (waiter_id = (select auth.uid())) with check (waiter_id = (select auth.uid()));
grant select, insert, update, delete on public.waiter_experiences to authenticated;

-- La carta pubblica di chi ha un profilo professionale: solo per chi ne ha uno.
create function private.waiter_public_cards_src()
returns table (
  id uuid, full_name text, avatar_url text, city text, primary_role text,
  rating_avg numeric, rating_count integer
) language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.avatar_url, p.city, wp.primary_role,
         coalesce(wp.rating_avg, 0)::numeric(3, 2), coalesce(wp.rating_count, 0)::integer
    from public.profiles p
    join public.waiter_profiles wp on wp.id = p.id
   where p.deleted_at is null;
$$;

-- La vista è security_invoker: chi la interroga (anche anon, per il QR delle
-- recensioni) deve poter eseguire la funzione. È l'unica funzione di `private`
-- aperta ad anon.
grant usage on schema private to anon;
grant execute on function private.waiter_public_cards_src() to anon, authenticated;

create view public.waiter_public_cards with (security_invoker = true) as
  select id, full_name, avatar_url, city, primary_role, rating_avg::numeric(3, 2) as rating_avg, rating_count
    from private.waiter_public_cards_src();

-- Un WHERE su `waiter_public_cards` è un full scan della funzione: per una sola
-- persona si usa questa.
create function public.get_waiter_public_card(p_waiter uuid)
returns table (
  id uuid, full_name text, avatar_url text, city text, primary_role text,
  rating_avg numeric, rating_count integer
) language sql stable security definer set search_path = '' as $$
  select p.id, p.full_name, p.avatar_url, p.city, wp.primary_role,
         coalesce(wp.rating_avg, 0)::numeric(3, 2), coalesce(wp.rating_count, 0)::integer
    from public.profiles p
    join public.waiter_profiles wp on wp.id = p.id
   where p.id = p_waiter and p.deleted_at is null;
$$;

create function public.get_rating_breakdown(p_waiter uuid)
returns table (rating integer, cnt bigint) language sql stable security definer set search_path = '' as $$
  select r.rating, count(*)::bigint from public.reviews r
   where r.waiter_id = p_waiter and r.status = 'published'
   group by r.rating order by r.rating desc;
$$;

-- Le recensioni sono l'unica scrittura anonima: chi le lascia non ha un account.
create policy "reviews: public read" on public.reviews for select to anon, authenticated using (true);
create policy "reviews: public insert" on public.reviews for insert to anon, authenticated
  with check (
    rating between 1 and 5 and char_length(coalesce(comment, '')) <= 500
    and exists (select 1 from public.get_waiter_public_card(reviews.waiter_id))
  );
grant select on public.reviews to anon, authenticated;
grant insert (waiter_id, rating, comment, tags, reviewer_name, shift_id, venue_id, receipt_ref) on public.reviews to anon, authenticated;
grant select on public.waiter_public_cards to anon, authenticated;
grant execute on function public.get_waiter_public_card(uuid), public.get_rating_breakdown(uuid) to anon, authenticated;

create function public.sync_waiter_rating()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_waiter uuid := coalesce(new.waiter_id, old.waiter_id);
begin
  insert into public.waiter_profiles (id) values (v_waiter) on conflict (id) do nothing;
  update public.waiter_profiles wp set
    rating_count = (select count(*) from public.reviews r where r.waiter_id = v_waiter and r.status = 'published'),
    rating_avg = coalesce((select round(avg(r.rating), 2) from public.reviews r
                            where r.waiter_id = v_waiter and r.status = 'published'), 0)
  where wp.id = v_waiter;
  return coalesce(new, old);
end;
$$;
create trigger reviews_sync_waiter_rating after insert or update or delete on public.reviews
  for each row execute function public.sync_waiter_rating();

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('avatars', 'avatars', true, 5242880, '{image/jpeg,image/png,image/webp}'),
  ('staff-documents', 'staff-documents', false, 10485760,
   '{application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif}')
on conflict (id) do nothing;

-- Avatar: pubblico in lettura (è fatto per essere visto), scrittura nella propria cartella.
create policy "avatars: public read" on storage.objects for select to public
  using (bucket_id = 'avatars');
create policy "avatars: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "avatars: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- Documenti: privati. Il primo segmento del percorso è l'id del membro.
create policy "staff documents: read" on storage.objects for select to authenticated
  using (bucket_id = 'staff-documents'
         and private.can_access_member_documents(((storage.foldername(name))[1])::uuid));
create policy "staff documents: insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'staff-documents'
              and private.can_access_member_documents(((storage.foldername(name))[1])::uuid));
create policy "staff documents: delete" on storage.objects for delete to authenticated
  using (bucket_id = 'staff-documents'
         and private.can_access_member_documents(((storage.foldername(name))[1])::uuid));

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'shifts', 'shift_assignments', 'messages', 'notifications',
      'workspace_members', 'venue_members', 'venue_roles', 'venue_member_roles'
    ] loop
      execute format('alter publication supabase_realtime add table public.%I', t);
    end loop;
  end if;
end $$;
