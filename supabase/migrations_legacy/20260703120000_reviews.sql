-- Recensioni dei clienti finali verso i camerieri — il fulcro del prodotto.
-- I clienti NON sono utenti dell'app: lasciano la recensione da un sito web
-- pubblico via anon key. La verifica "via scontrino" è rimandata → per ora
-- verified=false. Le colonne shift_id/venue_id/receipt_ref sono predisposte per
-- agganciarla in futuro senza riscrivere lo schema.
create table if not exists public.reviews (
  id uuid primary key default gen_random_uuid(),
  waiter_id uuid not null references public.profiles(id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  comment text,
  tags text[] not null default '{}',
  reviewer_name text,
  -- forward-compat per la verifica-scontrino (tutte opzionali per ora)
  shift_id uuid references public.shifts(id) on delete set null,
  venue_id uuid references public.venues(id) on delete set null,
  receipt_ref text,
  verified boolean not null default false,
  status text not null default 'published',
  created_at timestamptz not null default now()
);

create index if not exists reviews_waiter_created_idx
  on public.reviews (waiter_id, created_at desc);

alter table public.reviews enable row level security;

-- Reputazione pubblica: chiunque può leggere le recensioni.
drop policy if exists "reviews: public read" on public.reviews;
create policy "reviews: public read"
  on public.reviews for select
  to anon, authenticated
  using (true);

-- Il cliente (anonimo) inserisce dal sito web. Vincoli minimi: voto valido,
-- commento entro 500 caratteri, e il destinatario dev'essere un cameriere.
drop policy if exists "reviews: public insert" on public.reviews;
create policy "reviews: public insert"
  on public.reviews for insert
  to anon, authenticated
  with check (
    rating between 1 and 5
    and char_length(coalesce(comment, '')) <= 500
    and exists (
      select 1 from public.profiles p
      where p.id = waiter_id and p.role = 'waiter'
    )
  );

-- Nessuna policy UPDATE/DELETE lato client: le recensioni sono immutabili.
-- Moderazione/contestazioni arriveranno con la verifica-scontrino.

-- Aggregati denormalizzati sul cameriere per letture veloci e ordinamento nel
-- marketplace. Tenuti in sync da un trigger, come shifts.positions_filled.
alter table public.waiter_profiles
  add column if not exists rating_avg numeric(3,2) not null default 0,
  add column if not exists rating_count int not null default 0;

-- SECURITY DEFINER perché l'insert arriva da anon (nessun grant UPDATE su
-- waiter_profiles): il ricalcolo deve girare come owner. Garantisce anche la
-- riga waiter_profiles del recensito (potrebbe non aver ancora aperto il
-- proprio profilo).
create or replace function public.sync_waiter_rating()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_waiter uuid := coalesce(new.waiter_id, old.waiter_id);
begin
  insert into public.waiter_profiles (id)
  values (affected_waiter)
  on conflict (id) do nothing;

  update public.waiter_profiles wp
  set
    rating_count = (
      select count(*) from public.reviews r
      where r.waiter_id = affected_waiter and r.status = 'published'
    ),
    rating_avg = coalesce((
      select round(avg(r.rating), 2) from public.reviews r
      where r.waiter_id = affected_waiter and r.status = 'published'
    ), 0)
  where wp.id = affected_waiter;

  return coalesce(new, old);
end;
$$;

drop trigger if exists reviews_sync_waiter_rating on public.reviews;
create trigger reviews_sync_waiter_rating
after insert or update or delete on public.reviews
for each row execute function public.sync_waiter_rating();

-- Funzione di trigger: revoca EXECUTE così PostgREST non la espone come RPC
-- SECURITY DEFINER ad anon/authenticated.
revoke execute on function public.sync_waiter_rating() from anon, authenticated, public;
