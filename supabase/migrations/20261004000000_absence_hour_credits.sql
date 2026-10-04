-- Le assenze restano giorni finché chi gestisce le ore non attribuisce
-- esplicitamente un credito al singolo giorno. Mai scrivere worked_hours.
create table public.absence_hour_credits (
  absence_id uuid not null references public.staff_absences(id) on delete cascade,
  date date not null,
  minutes integer not null check (minutes > 0 and minutes <= 1440),
  created_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (absence_id, date)
);
create index absence_hour_credits_date_idx on public.absence_hour_credits(date);
alter table public.absence_hour_credits enable row level security;
grant select on public.absence_hour_credits to authenticated;
create function private.can_read_absence_credit(p_absence uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff_absences a
    where a.id = p_absence and private.can_person(a.member_id, 'hours'));
$$;
create policy "absence_hour_credits: hours managers read" on public.absence_hour_credits
  for select to authenticated using (private.can_read_absence_credit(absence_id));

create function public.set_absence_hour_credit(
  p_absence uuid, p_date date, p_minutes integer default null
) returns void language plpgsql security definer set search_path = '' as $$
declare a public.staff_absences;
begin
  select * into a from public.staff_absences where id = p_absence for update;
  if a.id is null or a.status <> 'approved' or a.start_time is not null
     or p_date is null or p_date < a.start_date or p_date > a.end_date
     or not private.can_person(a.member_id, 'hours')
     or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_minutes is not null and (p_minutes <= 0 or p_minutes > 1440) then
    raise exception 'invalid_hours';
  end if;
  if p_minutes is null then
    delete from public.absence_hour_credits where absence_id = p_absence and date = p_date;
  else
    insert into public.absence_hour_credits(absence_id, date, minutes, created_by)
    values (p_absence, p_date, p_minutes, (select auth.uid()))
    on conflict (absence_id, date) do update
      set minutes = excluded.minutes, created_by = excluded.created_by, updated_at = now();
  end if;
end;
$$;
grant execute on function public.set_absence_hour_credit(uuid, date, integer) to authenticated;

-- Una presenza approvata nello stesso giorno è un conflitto prudenziale:
-- potrebbe non sovrapporsi in orario, ma non sommiamo due quantità in silenzio.
create function private.absence_credit_conflict(p_member uuid, p_date date)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    join public.venue_members vm on vm.id = sa.venue_member_id
    join public.shift_clock_records r on r.assignment_id = sa.id and r.voided_at is null
    join lateral private.clock_record_times(r.id) t on true
    where vm.member_id = p_member and s.status <> 'cancelled'
      and sa.attendance_reviewed_at is not null and sa.worked_hours > 0
      and t.clock_out_at is not null
      and t.clock_in_at < ((p_date + 1)::timestamp at time zone 'Europe/Rome')
      and t.clock_out_at > (p_date::timestamp at time zone 'Europe/Rome')
  );
$$;

create function public.get_absence_hour_credits(p_absence uuid)
returns table(date date, minutes integer, conflict boolean)
language sql stable security definer set search_path = '' as $$
  select c.date, c.minutes, private.absence_credit_conflict(a.member_id, c.date)
    from public.absence_hour_credits c
    join public.staff_absences a on a.id = c.absence_id
   where c.absence_id = p_absence and private.can_person(a.member_id, 'hours')
   order by c.date;
$$;
grant execute on function public.get_absence_hour_credits(uuid) to authenticated;

-- Non esporre un aggregato ambiguo: lavoro timbrato approvato e assenza
-- riconosciuta sono grandezze distinte. Le presenze manuali legacy restano
-- nella colonna storica hours, ma non sono «Ore lavorate effettive».
drop function public.get_workspace_hours_summary(uuid, date, date);
create function public.get_workspace_hours_summary(p_workspace uuid, p_from date, p_to date)
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
           count(*) filter (where r.clock_record_id is not null and r.attendance_reviewed_at is not null)::integer as shifts_count,
           coalesce(sum(r.legacy_hours), 0) as hours,
           coalesce(sum(r.worked_hours) filter (where r.clock_record_id is not null
             and r.attendance_reviewed_at is not null and r.clock_out_at is not null), 0) as approved_hours,
           count(*) filter (where r.clock_record_id is not null and r.attendance_reviewed_at is null)::integer as to_review_count,
           coalesce(sum(round((extract(epoch from (r.clock_out_at - r.clock_in_at)) / 3600.0) * 4) / 4)
             filter (where r.clock_record_id is not null and r.attendance_reviewed_at is null
               and r.clock_out_at is not null), 0) as proposed_hours,
           coalesce(sum(r.worked_hours) filter (where r.worked_hours is not null
             and (r.clock_record_id is null or r.attendance_reviewed_at is null)), 0) as untracked_hours
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
grant execute on function public.get_workspace_hours_summary(uuid, date, date) to authenticated;

drop function public.get_workspace_absence_summary(uuid, date, date);
create function public.get_workspace_absence_summary(p_workspace uuid, p_from date, p_to date)
returns table (
  member_id uuid, member_name text, ferie_days integer, permesso_days integer,
  permesso_hours numeric, malattia_days integer, inps_protocols text,
  ferie_hours numeric, malattia_hours numeric, permesso_recognized_hours numeric,
  conflict_hours numeric
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select v.id from public.venues v where v.workspace_id = p_workspace
      and v.id in (select private.venues_where('hours'))
  ), clipped as (
    select a.*, (least(a.end_date, p_to - 1) - greatest(a.start_date, p_from) + 1) as days
      from public.staff_absences a
      join public.workspace_members m on m.id = a.member_id and m.workspace_id = p_workspace
     where a.status = 'approved' and a.start_date < p_to and a.end_date >= p_from
       and (p_workspace in (select private.my_workspace_ids('owner'))
         or exists (select 1 from public.venue_members vm
                     where vm.member_id = a.member_id and vm.venue_id in (select id from scope)))
  ), credit_rows as (
    select a.member_id, a.kind, c.minutes / 60.0 as hours,
           private.absence_credit_conflict(a.member_id, c.date) as conflict
      from clipped a join public.absence_hour_credits c on c.absence_id = a.id
     where c.date >= p_from and c.date < p_to
    union all
    select a.member_id, a.kind,
           extract(epoch from (a.end_time - a.start_time)) / 3600.0,
           private.absence_credit_conflict(a.member_id, a.start_date)
      from clipped a where a.start_time is not null
  ), credit_totals as (
    select c.member_id,
      coalesce(sum(c.hours) filter (where c.kind = 'ferie' and not c.conflict), 0) as ferie_hours,
      coalesce(sum(c.hours) filter (where c.kind = 'malattia' and not c.conflict), 0) as malattia_hours,
      coalesce(sum(c.hours) filter (where c.kind = 'permesso' and not c.conflict), 0) as permesso_hours,
      coalesce(sum(c.hours) filter (where c.conflict), 0) as conflict_hours
    from credit_rows c group by c.member_id
  )
  select m.id, m.display_name,
    coalesce(sum(a.days) filter (where a.kind = 'ferie'), 0)::integer,
    coalesce(sum(a.days) filter (where a.kind = 'permesso' and a.start_time is null), 0)::integer,
    round(coalesce(sum(extract(epoch from (a.end_time - a.start_time)) / 3600)
      filter (where a.kind = 'permesso' and a.start_time is not null), 0), 2),
    coalesce(sum(a.days) filter (where a.kind = 'malattia'), 0)::integer,
    string_agg(a.inps_protocol, ', ' order by a.inps_protocol)
      filter (where a.kind = 'malattia' and a.inps_protocol is not null),
    max(coalesce(c.ferie_hours, 0)), max(coalesce(c.malattia_hours, 0)),
    max(coalesce(c.permesso_hours, 0)), max(coalesce(c.conflict_hours, 0))
    from clipped a join public.workspace_members m on m.id = a.member_id
    left join credit_totals c on c.member_id = a.member_id
   group by m.id, m.display_name order by m.display_name;
$$;
grant execute on function public.get_workspace_absence_summary(uuid, date, date) to authenticated;
