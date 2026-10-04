-- Con il metodo Manuale il turno concluso vale come base delle ore lavorate;
-- chi gestisce può correggere worked_hours. La fonte conserva il metodo storico.
alter table public.shift_assignments
  add column hours_source text check (hours_source in ('manual', 'clock', 'manual_auto', 'clock_expected'));

update public.shift_assignments a
   set hours_source = case
     when a.attendance_reviewed_at is not null then 'clock'
     when coalesce(vm.clock_method, v.clock_method) = 'manual' then 'manual'
     else null
   end
  from public.venue_members vm, public.venues v
 where vm.id = a.venue_member_id and v.id = a.venue_id
   and a.worked_hours is not null;

-- I turni già conclusi senza correzioni usano il metodo che risulta al rollout.
update public.shift_assignments a
   set hours_source = case when coalesce(vm.clock_method, v.clock_method) = 'manual'
                           then 'manual_auto' else 'clock_expected' end
  from public.venue_members vm, public.venues v, public.shifts s
 where vm.id = a.venue_member_id and v.id = a.venue_id and s.id = a.shift_id
   and a.worked_hours is null and a.hours_source is null
   and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();

-- Prima di cambiare metodo, fissare quello dei turni già conclusi. I turni
-- futuri adotteranno invece la nuova impostazione.
create or replace function public.set_venue_clock_method(
  p_venue uuid, p_method public.clock_method
)
returns public.venues language plpgsql security definer set search_path = '' as $$
declare v_row public.venues;
begin
  if not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_assignments a
     set hours_source = case when v.clock_method = 'manual'
                             then 'manual_auto' else 'clock_expected' end
    from public.shifts s, public.venue_members vm, public.venues v
   where a.shift_id = s.id and a.venue_member_id = vm.id
     and v.id = p_venue and a.venue_id = p_venue
     and vm.clock_method is null and a.worked_hours is null
     and a.hours_source is null
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
  update public.venues set clock_method = p_method where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

create or replace function public.set_member_clock_method(
  p_venue_member uuid, p_method public.clock_method default null
)
returns public.venue_members language plpgsql security definer set search_path = '' as $$
declare
  v_row    public.venue_members;
  v_member uuid;
  v_venue  uuid;
  v_old_method public.clock_method;
begin
  select vm.member_id, vm.venue_id, coalesce(vm.clock_method, v.clock_method)
    into v_member, v_venue, v_old_method
    from public.venue_members vm join public.venues v on v.id = vm.venue_id
   where vm.id = p_venue_member;
  if v_venue is null or not private.can(v_venue, 'hours')
     or private.is_restricted_self(v_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_assignments a
     set hours_source = case when v_old_method = 'manual'
                             then 'manual_auto' else 'clock_expected' end
    from public.shifts s
   where a.shift_id = s.id and a.venue_member_id = p_venue_member
     and a.worked_hours is null and a.hours_source is null
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
  update public.venue_members set clock_method = p_method where id = p_venue_member
  returning * into v_row;
  return v_row;
end;
$$;

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
  select x.id, x.venue_id, x.status, x.confirmed_at, vm.member_id,
         coalesce(vm.clock_method, v.clock_method) as effective_clock_method
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
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
    hours_source = case when p_patch ? 'worked_hours' then
      case when p_patch ->> 'worked_hours' is null then null
           when a.effective_clock_method = 'manual' then 'manual'
           else null end
      else x.hours_source end,
    attendance_reviewed_at = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_at end,
    attendance_reviewed_by = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_by end
   where x.id = p_assignment
  returning * into v_row;
  return v_row;
end;
$$;

-- La revisione della timbratura identifica anche la fonte delle ore.
create or replace function public.approve_clock_record(p_assignment uuid)
returns public.shift_assignments language plpgsql security definer set search_path = '' as $$
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
    hours_source = 'clock',
    attendance_reviewed_at = now(),
    attendance_reviewed_by = (select auth.uid())
  where x.id = a.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.get_workspace_hours_summary(p_workspace uuid, p_from date, p_to date)
returns table (
  member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean,
  roles text, shifts_count integer, hours numeric, approved_hours numeric,
  to_review_count integer, proposed_hours numeric, untracked_hours numeric
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(array_agg(v.id), '{}'::uuid[]) as venue_ids from public.venues v
    where v.workspace_id = p_workspace and v.id in (select private.venues_where('hours'))
  ), rows as (
    select a.*, s.date, v.name as venue_name, v.closed_at,
           coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
           vm.member_id, m.display_name,
           r.id as clock_record_id, t.clock_in_at, t.clock_out_at,
           private.effective_assignment_hours(a.id, scope.venue_ids) as legacy_hours
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      cross join scope
      left join public.shift_clock_records r on r.assignment_id = a.id and r.voided_at is null
      left join lateral private.clock_record_times(r.id) t on true
     where s.venue_id = any(scope.venue_ids) and s.status <> 'cancelled'
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
  ), per_venue as (
    select r.member_id, r.display_name as member_name, r.venue_id, r.venue_name,
           r.closed_at, r.venue_member_id,
           count(*) filter (where (r.worked_hours is not null and
             (r.hours_source = 'manual' or (r.clock_record_id is not null
               and r.attendance_reviewed_at is not null and r.clock_out_at is not null)))
             or (r.worked_hours is null and r.clock_record_id is null and
               (r.hours_source = 'manual_auto' or
                 (r.hours_source is null and r.effective_clock_method = 'manual'))))::integer as shifts_count,
           coalesce(sum(r.legacy_hours), 0) as hours,
           coalesce(sum(case
             when r.worked_hours is not null and
               (r.hours_source = 'manual' or (r.clock_record_id is not null
                 and r.attendance_reviewed_at is not null and r.clock_out_at is not null))
               then r.worked_hours
             when r.worked_hours is null and r.clock_record_id is null and
               (r.hours_source = 'manual_auto' or
                 (r.hours_source is null and r.effective_clock_method = 'manual'))
               then r.legacy_hours
             else 0 end), 0) as approved_hours,
           count(*) filter (where r.clock_record_id is not null and r.attendance_reviewed_at is null)::integer as to_review_count,
           coalesce(sum(round((extract(epoch from (r.clock_out_at - r.clock_in_at)) / 3600.0) * 4) / 4)
             filter (where r.clock_record_id is not null and r.attendance_reviewed_at is null
               and r.clock_out_at is not null), 0) as proposed_hours,
           coalesce(sum(r.worked_hours) filter (where r.worked_hours is not null
             and r.hours_source is distinct from 'manual'
             and (r.clock_record_id is null or r.attendance_reviewed_at is null
               or r.clock_out_at is null)), 0) as untracked_hours
      from rows r
     group by r.member_id, r.display_name, r.venue_id, r.venue_name, r.closed_at, r.venue_member_id
  )
  select r.member_id, r.member_name, r.venue_id, r.venue_name, r.closed_at is not null,
         (select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
            from public.venue_member_roles x join public.venue_roles vr on vr.id = x.role_id
           where x.venue_member_id = r.venue_member_id and vr.archived_at is null),
         r.shifts_count, r.hours, r.approved_hours, r.to_review_count,
         r.proposed_hours, r.untracked_hours
    from per_venue r
   order by sum(r.approved_hours) over (partition by r.member_id) desc, r.member_name, r.venue_name;
$$;

-- Lo stesso lavoro manuale va considerato nel controllo di conflitto assenza.
create or replace function private.absence_credit_conflict(p_member uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    join public.venue_members vm on vm.id = sa.venue_member_id
    join public.venues v on v.id = s.venue_id
    left join public.shift_clock_records r on r.assignment_id = sa.id and r.voided_at is null
    left join lateral private.clock_record_times(r.id) t on true
    where vm.member_id = p_member and s.status <> 'cancelled'
      and sa.status not in ('declined', 'no_show')
      and ((sa.worked_hours > 0 and sa.hours_source = 'manual' and
            (s.date = p_date or (s.end_time <= s.start_time and s.date + 1 = p_date)))
        or (sa.worked_hours is null and r.id is null and
          (sa.hours_source = 'manual_auto' or
            (sa.hours_source is null and coalesce(vm.clock_method, v.clock_method) = 'manual'))
          and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
          and private.effective_assignment_hours(sa.id, null) > 0
          and (s.date = p_date or (s.end_time <= s.start_time and s.date + 1 = p_date)))
        or (sa.worked_hours > 0 and r.id is not null and sa.attendance_reviewed_at is not null
          and t.clock_out_at is not null
          and t.clock_in_at < ((p_date + 1)::timestamp at time zone 'Europe/Rome')
          and t.clock_out_at > (p_date::timestamp at time zone 'Europe/Rome')))
  );
$$;
