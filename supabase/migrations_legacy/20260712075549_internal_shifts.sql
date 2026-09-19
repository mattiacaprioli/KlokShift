-- Turni interni: assegnazione diretta allo staff del locale (modalità "Chiamo il mio
-- staff"). I turni internal non entrano nel feed marketplace del cameriere.

create type public.shift_kind as enum ('marketplace', 'internal');
alter table public.shifts
  add column kind public.shift_kind not null default 'marketplace';

create type public.assignment_status as enum ('assigned', 'confirmed', 'declined');

create table public.shift_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.shifts(id) on delete cascade,
  staff_member_id uuid not null references public.staff_members(id) on delete cascade,
  status public.assignment_status not null default 'assigned',
  created_at timestamptz not null default now(),
  unique (shift_id, staff_member_id)
);

create index shift_assignments_shift_idx on public.shift_assignments (shift_id);
create index shift_assignments_staff_idx on public.shift_assignments (staff_member_id);

alter table public.shift_assignments enable row level security;

-- Il ristoratore (owner del locale del turno) gestisce le assegnazioni.
create policy "shift_assignments: owner all"
  on public.shift_assignments for all
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
      join public.venues v on v.id = s.venue_id
      where s.id = shift_assignments.shift_id and v.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
      join public.venues v on v.id = s.venue_id
      where s.id = shift_assignments.shift_id and v.owner_id = (select auth.uid())
    )
  );

-- Il cameriere collegato vede le proprie assegnazioni...
create policy "shift_assignments: linked waiter read"
  on public.shift_assignments for select
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
      where sm.id = shift_assignments.staff_member_id
        and sm.waiter_id = (select auth.uid())
    )
  );

-- ...e può confermarle/rifiutarle (aggiornare lo status).
create policy "shift_assignments: linked waiter update"
  on public.shift_assignments for update
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
      where sm.id = shift_assignments.staff_member_id
        and sm.waiter_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1 from public.staff_members sm
      where sm.id = shift_assignments.staff_member_id
        and sm.waiter_id = (select auth.uid())
    )
  );

-- Notifica al cameriere collegato quando viene assegnato a un turno.
-- SECURITY DEFINER (RLS 'notifications: own only' vieta l'insert cross-user dal client).
create or replace function public.notify_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter uuid;
  v_title  text;
  v_venue  text;
begin
  select sm.waiter_id into v_waiter
    from public.staff_members sm where sm.id = new.staff_member_id;
  if v_waiter is null then
    return new;
  end if;

  select s.title, ve.name into v_title, v_venue
    from public.shifts s
    join public.venues ve on ve.id = s.venue_id
    where s.id = new.shift_id;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_waiter,
    'shift_assigned',
    'Nuovo turno assegnato',
    'Sei stato assegnato a «' || coalesce(v_title, 'un turno') || '» da '
      || coalesce(v_venue, 'un locale'),
    new.shift_id
  );
  return new;
end;
$$;

drop trigger if exists shift_assignments_notify on public.shift_assignments;
create trigger shift_assignments_notify
  after insert on public.shift_assignments
  for each row execute function public.notify_on_assignment();

revoke execute on function public.notify_on_assignment() from anon, authenticated, public;
