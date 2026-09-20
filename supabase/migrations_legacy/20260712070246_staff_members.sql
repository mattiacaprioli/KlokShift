-- Organico interno del locale ("Il mio staff"). Modello misto: ogni scheda ha un
-- display_name gestito dal ristoratore e può, opzionalmente, essere collegata a un
-- account cameriere dell'app tramite waiter_id.

create type public.employment_type as enum ('fisso', 'a_chiamata');

create table public.staff_members (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues(id) on delete cascade,
  display_name text not null,
  role text,
  employment_type public.employment_type not null default 'a_chiamata',
  waiter_id uuid references public.profiles(id) on delete set null,
  phone text,
  note text,
  created_at timestamptz not null default now()
);

-- Un cameriere può essere collegato all'organico di un locale al massimo una volta.
create unique index staff_members_venue_waiter_uq
  on public.staff_members (venue_id, waiter_id)
  where waiter_id is not null;

create index staff_members_venue_idx on public.staff_members (venue_id);
create index staff_members_waiter_idx on public.staff_members (waiter_id);

alter table public.staff_members enable row level security;

-- Il ristoratore (owner del locale) gestisce il proprio organico.
create policy "staff_members: owner all"
  on public.staff_members for all
  to authenticated
  using (
    exists (
      select 1 from public.venues v
      where v.id = staff_members.venue_id and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.venues v
      where v.id = staff_members.venue_id and v.owner_id = (select auth.uid())
    )
  );

-- Il cameriere collegato può vedere le righe che lo riguardano.
create policy "staff_members: linked waiter read"
  on public.staff_members for select
  to authenticated
  using (waiter_id = (select auth.uid()));
