-- Timbrature, prima milestone: metodo manuale/app, audit append-only e
-- approvazione esplicita delle ore. QR e geolocalizzazione sono valori di
-- dominio già riservati, ma verranno accettati da clock_punch solo nelle
-- milestone dedicate.

create type public.clock_method as enum ('manual', 'app', 'qr', 'geolocation');

alter table public.venues
  add column clock_method public.clock_method not null default 'manual';

alter table public.venue_members
  add column clock_method public.clock_method;

alter table public.shift_assignments
  add column attendance_reviewed_at timestamptz,
  add column attendance_reviewed_by uuid references public.profiles (id) on delete set null,
  add constraint shift_assignments_attendance_review_ck check (
    (attendance_reviewed_at is null) = (attendance_reviewed_by is null)
  );

create table public.shift_clock_records (
  id              uuid primary key default gen_random_uuid(),
  assignment_id   uuid references public.shift_assignments (id) on delete set null,
  shift_id        uuid not null,
  venue_id        uuid not null,
  venue_member_id uuid not null,
  method          public.clock_method not null,
  clock_in_at     timestamptz not null,
  clock_out_at    timestamptz,
  voided_at       timestamptz,
  voided_by       uuid references public.profiles (id) on delete set null,
  void_reason     text,
  created_at      timestamptz not null default now(),
  constraint shift_clock_records_interval_ck check (
    clock_out_at is null or clock_out_at > clock_in_at
  ),
  constraint shift_clock_records_void_ck check (
    (voided_at is null and voided_by is null and void_reason is null)
    or
    (voided_at is not null and voided_by is not null and btrim(void_reason) <> '')
  )
);
create unique index shift_clock_records_active_assignment_uq
  on public.shift_clock_records (assignment_id)
  where assignment_id is not null and voided_at is null;
create index shift_clock_records_member_idx
  on public.shift_clock_records (venue_member_id, clock_in_at desc);
alter table public.shift_clock_records enable row level security;

create table public.shift_clock_corrections (
  id               uuid primary key default gen_random_uuid(),
  clock_record_id  uuid not null references public.shift_clock_records (id) on delete cascade,
  corrected_in_at  timestamptz,
  corrected_out_at timestamptz,
  reason           text not null check (btrim(reason) <> ''),
  corrected_by     uuid not null references public.profiles (id) on delete restrict,
  created_at       timestamptz not null default now(),
  constraint shift_clock_corrections_value_ck check (
    corrected_in_at is not null or corrected_out_at is not null
  )
);
create index shift_clock_corrections_record_idx
  on public.shift_clock_corrections (clock_record_id, created_at desc, id desc);
alter table public.shift_clock_corrections enable row level security;

-- Una policy non interroga direttamente un'altra tabella con RLS: l'insieme
-- leggibile delle timbrature vive nel solito oracolo SECURITY DEFINER.
create function private.visible_clock_record_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.id
    from public.shift_clock_records r
   where r.venue_member_id in (select private.my_venue_member_ids())
      or r.venue_id in (select private.venues_where('hours'))
      or r.venue_id in (select private.venues_where('shifts'));
$$;
grant execute on function private.visible_clock_record_ids() to authenticated;

grant select on public.shift_clock_records, public.shift_clock_corrections to authenticated;

create policy "shift_clock_records: self and managers read" on public.shift_clock_records
  for select to authenticated
  using (id in (select private.visible_clock_record_ids()));

create policy "shift_clock_corrections: clock readers read" on public.shift_clock_corrections
  for select to authenticated
  using (clock_record_id in (select private.visible_clock_record_ids()));

-- L'ultima correzione prevale campo per campo. L'originale resta immutato.
create function private.clock_record_times(p_record uuid)
returns table (clock_in_at timestamptz, clock_out_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select
    coalesce((select c.corrected_in_at
                from public.shift_clock_corrections c
               where c.clock_record_id = r.id and c.corrected_in_at is not null
               order by c.created_at desc, c.id desc limit 1), r.clock_in_at),
    coalesce((select c.corrected_out_at
                from public.shift_clock_corrections c
               where c.clock_record_id = r.id and c.corrected_out_at is not null
               order by c.created_at desc, c.id desc limit 1), r.clock_out_at)
    from public.shift_clock_records r
   where r.id = p_record;
$$;

-- Configurazione: «Ore» decide il metodo; un collaboratore non decide il
-- proprio override. I client non possono scrivere direttamente le colonne.
create function public.set_venue_clock_method(
  p_venue uuid,
  p_method public.clock_method
)
returns public.venues language plpgsql security definer set search_path = '' as $$
declare v_row public.venues;
begin
  if not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.venues set clock_method = p_method where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

create function public.set_member_clock_method(
  p_venue_member uuid,
  p_method public.clock_method default null
)
returns public.venue_members language plpgsql security definer set search_path = '' as $$
declare
  v_row    public.venue_members;
  v_member uuid;
  v_venue  uuid;
begin
  select vm.member_id, vm.venue_id into v_member, v_venue
    from public.venue_members vm where vm.id = p_venue_member;
  if v_venue is null or not private.can(v_venue, 'hours')
     or private.is_restricted_self(v_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.venue_members set clock_method = p_method where id = p_venue_member
  returning * into v_row;
  return v_row;
end;
$$;

-- Entrata/uscita del professionista. L'istante è sempre quello del server.
-- La stessa azione è idempotente, utile contro doppi tap e retry di rete.
create function public.clock_punch(
  p_assignment uuid,
  p_action text
)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  a        record;
  v_method public.clock_method;
  v_row    public.shift_clock_records;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('in', 'out') then
    raise exception 'invalid_clock_action' using errcode = '22023';
  end if;

  select x.id, x.shift_id, x.venue_id, x.venue_member_id, x.status,
         s.date, s.start_time, s.end_time, s.status as shift_status,
         coalesce(vm.clock_method, v.clock_method) as effective_method
    into a
    from public.shift_assignments x
    join public.shifts s on s.id = x.shift_id
    join public.venues v on v.id = x.venue_id
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members wm on wm.id = vm.member_id
   where x.id = p_assignment
     and wm.user_id = (select auth.uid())
     and wm.status = 'active'
     and vm.left_at is null
   for update of x;

  if a.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.shift_status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  if public.local_now()::date < a.date - 1
     or public.local_now()::date > public.shift_ends_at(a.date, a.start_time, a.end_time)::date + 1 then
    raise exception 'clock_wrong_day' using errcode = '23514';
  end if;

  v_method := a.effective_method;
  if v_method = 'manual' then
    raise exception 'clock_manual' using errcode = '42501';
  end if;
  if v_method <> 'app' then
    raise exception 'clock_method_unavailable' using errcode = '0A000';
  end if;

  select r.* into v_row
    from public.shift_clock_records r
   where r.assignment_id = p_assignment and r.voided_at is null
   for update;

  if p_action = 'in' then
    if v_row.id is not null then return v_row; end if;
    insert into public.shift_clock_records (
      assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at
    ) values (
      a.id, a.shift_id, a.venue_id, a.venue_member_id, v_method, clock_timestamp()
    ) returning * into v_row;
    return v_row;
  end if;

  if v_row.id is null then
    raise exception 'clock_in_required' using errcode = '23514';
  end if;
  if v_row.clock_out_at is not null then return v_row; end if;
  update public.shift_clock_records set clock_out_at = clock_timestamp() where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

create function public.correct_clock_record(
  p_record uuid,
  p_in timestamptz,
  p_out timestamptz,
  p_reason text
)
returns public.shift_clock_corrections
language plpgsql security definer set search_path = '' as $$
declare
  r public.shift_clock_records;
  t record;
  v_row public.shift_clock_corrections;
begin
  if p_in is null and p_out is null then
    raise exception 'clock_correction_required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select * into r from public.shift_clock_records where id = p_record for update;
  if r.id is null or r.voided_at is not null or not private.can(r.venue_id, 'hours')
     or private.is_restricted_self((select vm.member_id from public.venue_members vm where vm.id = r.venue_member_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into t from private.clock_record_times(r.id);
  if coalesce(p_out, t.clock_out_at) is not null
     and coalesce(p_out, t.clock_out_at) <= coalesce(p_in, t.clock_in_at) then
    raise exception 'invalid_clock_interval' using errcode = '23514';
  end if;
  insert into public.shift_clock_corrections (
    clock_record_id, corrected_in_at, corrected_out_at, reason, corrected_by
  ) values (r.id, p_in, p_out, btrim(p_reason), (select auth.uid()))
  returning * into v_row;

  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = r.assignment_id;
  return v_row;
end;
$$;

create function public.void_clock_record(
  p_assignment uuid,
  p_reason text
)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  r record;
  v_row public.shift_clock_records;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select x.*, vm.member_id into r
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.assignment_id = p_assignment and x.voided_at is null
   for update of x;
  if r.id is null or not private.can(r.venue_id, 'hours')
     or private.is_restricted_self(r.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_clock_records set
    voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = r.id returning * into v_row;
  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = p_assignment;
  return v_row;
end;
$$;

create function public.approve_clock_record(p_assignment uuid)
returns public.shift_assignments
language plpgsql security definer set search_path = '' as $$
declare
  a record;
  t record;
  v_row public.shift_assignments;
begin
  select x.id, x.venue_id, x.status, vm.member_id, r.id as record_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.shift_clock_records r on r.assignment_id = x.id and r.voided_at is null
   where x.id = p_assignment
   for update of x, r;
  if a.id is null or not private.can(a.venue_id, 'hours')
     or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  select * into t from private.clock_record_times(a.record_id);
  if t.clock_out_at is null then
    raise exception 'clock_out_required' using errcode = '23514';
  end if;
  update public.shift_assignments x set
    worked_hours = round((extract(epoch from (t.clock_out_at - t.clock_in_at)) / 3600.0) * 4) / 4,
    attendance_reviewed_at = now(),
    attendance_reviewed_by = (select auth.uid())
  where x.id = a.id returning * into v_row;
  return v_row;
end;
$$;

-- Una timbratura, anche già chiusa, rende immutabile l'identità
-- dell'assegnazione. Va annullata esplicitamente prima di delete/reassign/move.
create function public.guard_clocked_assignment_delete()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.shift_clock_records r
     where r.assignment_id = old.id and r.voided_at is null
  ) then
    raise exception 'attendance_started' using errcode = '42501';
  end if;
  return old;
end;
$$;
create trigger shift_assignments_clock_delete_guard
  before delete on public.shift_assignments
  for each row execute function public.guard_clocked_assignment_delete();

-- Una modifica manuale delle ore è già una revisione gestionale, ma non è
-- l'approvazione della timbratura: azzera il marcatore che lega le due cose.
create or replace function public.record_attendance(p_assignment uuid, p_patch jsonb)
returns public.shift_assignments language plpgsql security definer set search_path = '' as $$
declare
  a        record;
  v_row    public.shift_assignments;
  v_status public.assignment_status;
begin
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  if not (p_patch ?| array['status', 'worked_hours'])
     or exists (select 1 from jsonb_object_keys(p_patch) as key
                 where not (key = any (array['status', 'worked_hours']))) then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  select x.id, x.venue_id, x.status, x.confirmed_at, vm.member_id into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.id = p_assignment;
  if a.id is null or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' then
    if not private.can(a.venue_id, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_status := (p_patch ->> 'status')::public.assignment_status;
  end if;
  if p_patch ? 'worked_hours' and not private.can(a.venue_id, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_assignments x set
    status = coalesce(v_status, x.status),
    confirmed_at = case
      when v_status is null then x.confirmed_at
      when v_status in ('assigned', 'declined') then null
      else x.confirmed_at
    end,
    worked_hours = case when p_patch ? 'worked_hours'
      then (p_patch ->> 'worked_hours')::numeric else x.worked_hours end,
    attendance_reviewed_at = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_at end,
    attendance_reviewed_by = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_by end
   where x.id = p_assignment
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function
  public.set_venue_clock_method(uuid, public.clock_method),
  public.set_member_clock_method(uuid, public.clock_method),
  public.clock_punch(uuid, text),
  public.correct_clock_record(uuid, timestamptz, timestamptz, text),
  public.void_clock_record(uuid, text),
  public.approve_clock_record(uuid)
to authenticated;

-- Il report mensile espone solo ore esplicitamente approvate/inserite. Le
-- proposte da timbratura restano separate e non gonfiano il totale definitivo.
drop function public.get_workspace_hours_summary(uuid, date, date);
create function public.get_workspace_hours_summary(
  p_workspace uuid,
  p_from date,
  p_to date
)
returns table (
  member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean,
  roles text, shifts_count integer, hours numeric, approved_hours numeric, to_review_count integer,
  proposed_hours numeric
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(pg_catalog.array_agg(v.id), '{}'::uuid[]) as venue_ids
      from public.venues v
     where v.workspace_id = p_workspace
       and v.id in (select private.venues_where('hours'))
  ), rows as (
    select a.*, s.date, s.start_time, s.end_time, s.status as shift_status,
           v.name as venue_name, v.closed_at, vm.member_id, m.display_name,
           r.id as clock_record_id, t.clock_in_at, t.clock_out_at,
           private.effective_assignment_hours(a.id, scope.venue_ids) as legacy_hours
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      cross join scope
      left join public.shift_clock_records r
        on r.assignment_id = a.id and r.voided_at is null
      left join lateral private.clock_record_times(r.id) t on true
     where s.venue_id = any (scope.venue_ids)
       and s.status <> 'cancelled'
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
  ), per_venue as (
    select r.member_id, r.display_name as member_name, r.venue_id, r.venue_name,
           r.closed_at, r.venue_member_id,
           count(*) filter (where r.worked_hours is not null)::integer as shifts_count,
           coalesce(sum(r.legacy_hours), 0) as hours,
           coalesce(sum(r.worked_hours) filter (where r.worked_hours is not null), 0) as approved_hours,
           count(*) filter (where r.clock_record_id is not null
                              and r.attendance_reviewed_at is null)::integer as to_review_count,
           coalesce(sum(round((extract(epoch from (r.clock_out_at - r.clock_in_at)) / 3600.0) * 4) / 4)
             filter (where r.clock_record_id is not null
                       and r.attendance_reviewed_at is null
                       and r.clock_out_at is not null), 0) as proposed_hours
      from rows r
     group by r.member_id, r.display_name, r.venue_id, r.venue_name,
              r.closed_at, r.venue_member_id
  )
  select r.member_id, r.member_name, r.venue_id, r.venue_name, r.closed_at is not null,
         (select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
            from public.venue_member_roles x join public.venue_roles vr on vr.id = x.role_id
           where x.venue_member_id = r.venue_member_id and vr.archived_at is null),
         r.shifts_count, r.hours, r.approved_hours, r.to_review_count, r.proposed_hours
    from per_venue r
   order by sum(r.hours) over (partition by r.member_id) desc, r.member_name, r.venue_name;
$$;
grant execute on function public.get_workspace_hours_summary(uuid, date, date) to authenticated;

-- Realtime fa aggiornare la presenza aperta senza polling nelle viste turno.
alter publication supabase_realtime add table public.shift_clock_records;
