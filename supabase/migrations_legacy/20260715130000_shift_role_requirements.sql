-- Fabbisogno di personale per ruolo su un turno interno (es. 2 Cameriere + 1 Sommelier).
-- La copertura = assegnati attivi (assegnato/confermato) con quel ruolo vs count richiesto.
create table public.shift_role_requirements (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  role text not null,
  count integer not null default 1 check (count >= 1),
  created_at timestamptz not null default now(),
  unique (shift_id, role)
);

create index shift_role_requirements_shift_idx
  on public.shift_role_requirements (shift_id);

alter table public.shift_role_requirements enable row level security;

-- Il ristoratore (owner del locale del turno) gestisce i fabbisogni.
create policy "shift_role_requirements: owner all"
  on public.shift_role_requirements for all
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
      join public.venues v on v.id = s.venue_id
      where s.id = shift_role_requirements.shift_id
        and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
      join public.venues v on v.id = s.venue_id
      where s.id = shift_role_requirements.shift_id
        and v.owner_id = (select auth.uid())
    )
  );

-- Mantiene shifts.positions_filled per i turni INTERNI = numero di assegnazioni
-- attive (assegnato/confermato). Corregge l'incoerenza: prima positions_filled
-- veniva impostato solo alla creazione e non si aggiornava su cambi/cancellazioni.
create or replace function public.sync_internal_positions_filled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_shift uuid := coalesce(new.shift_id, old.shift_id);
begin
  update public.shifts s
  set positions_filled = (
    select count(*)
    from public.shift_assignments a
    where a.shift_id = affected_shift
      and a.status in ('assigned', 'confirmed')
  )
  where s.id = affected_shift
    and s.kind = 'internal';   -- non tocca mai i turni marketplace
  return coalesce(new, old);
end;
$$;

drop trigger if exists shift_assignments_sync_positions on public.shift_assignments;
create trigger shift_assignments_sync_positions
  after insert or update or delete on public.shift_assignments
  for each row execute function public.sync_internal_positions_filled();

revoke execute on function public.sync_internal_positions_filled()
  from anon, authenticated, public;

-- Backfill dei turni interni esistenti.
update public.shifts s
set positions_filled = (
  select count(*) from public.shift_assignments a
  where a.shift_id = s.id and a.status in ('assigned', 'confirmed')
)
where s.kind = 'internal';
