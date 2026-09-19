-- Esperienze lavorative del cameriere (CV pubblica, stile LinkedIn). 1:many su profiles.
-- end_year NULL = lavoro in corso ("OGGI"). Lettura pubblica come le recensioni: i
-- ristoratori le vedono sul profilo del candidato.

create table public.waiter_experiences (
  id uuid primary key default gen_random_uuid(),
  waiter_id uuid not null references public.profiles(id) on delete cascade,
  company_name text not null,
  role text,
  start_year int,
  end_year int,                     -- null = OGGI / in corso
  detail text,
  created_at timestamptz not null default now(),
  constraint waiter_experiences_year_order_chk
    check (end_year is null or start_year is null or end_year >= start_year)
);

create index waiter_experiences_waiter_idx
  on public.waiter_experiences (waiter_id, start_year desc);

alter table public.waiter_experiences enable row level security;

-- Il cameriere gestisce le proprie esperienze.
create policy "waiter_experiences: own read/write"
  on public.waiter_experiences for all
  to authenticated
  using (waiter_id = (select auth.uid()))
  with check (waiter_id = (select auth.uid()));

-- Lettura pubblica (profilo candidato lato ristoratore), come reviews.
create policy "waiter_experiences: public read"
  on public.waiter_experiences for select
  to anon, authenticated
  using (true);
