-- B03: un turno che non conta nelle ore definitive non può toglierne ad altri.
--
-- `private.effective_assignment_hours` divide le sovrapposizioni fra tutti i
-- turni conclusi senza ore esplicite: va bene per il programmato, ma nel
-- consuntivo un turno App senza timbratura approvata (che contribuisce zero)
-- toglieva al turno Manuale sovrapposto la parte in comune, fino ad azzerarlo e
-- a far sparire il conflitto con un credito di assenza.
--
-- L'helper storico resta com'è (programmato, storico, rendimento lo usano con
-- quel significato). Per le ore definitive ce n'è uno nuovo, uguale tranne per
-- l'insieme dei turni che possono sottrarre: solo quelli che a loro volta
-- contano come Manuale automatico. Fra due Manuali la deduplicazione resta
-- (09–17 + 13–19 = 10 h). Le ore esplicite — rettifiche e timbrature approvate —
-- non entrano nell'unione, come prima.

create function private.definitive_manual_hours(
  p_assignment uuid,
  p_venues uuid[] default null
)
returns numeric language sql stable set search_path = '' as $$
  with target as (
    select a.id, a.status, a.worked_hours, vm.member_id,
           s.status as shift_status,
           s.date + s.start_time as starts_at,
           public.shift_ends_at(s.date, s.start_time, s.end_time) as ends_at
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
     where a.id = p_assignment
  ), later_manual as (
    select pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) as span
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      cross join target t
     where a.id <> t.id
       and vm.member_id = t.member_id
       and s.status <> 'cancelled'
       and a.status not in ('declined', 'no_show')
       and a.worked_hours is null
       -- Solo chi conta a sua volta come Manuale automatico: stesso criterio
       -- del ramo «manual_auto» di get_workspace_hours_summary.
       and not exists (select 1 from public.shift_clock_records r
                        where r.assignment_id = a.id and r.voided_at is null)
       and (a.hours_source = 'manual_auto' or
            (a.hours_source is null and coalesce(vm.clock_method, v.clock_method) = 'manual'))
       and (p_venues is null or s.venue_id = any (p_venues))
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) && pg_catalog.tsrange(t.starts_at, t.ends_at, '[)')
       and (
         s.date + s.start_time > t.starts_at
         or (s.date + s.start_time = t.starts_at and a.id > t.id)
       )
  )
  select case
    when t.shift_status = 'cancelled' then 0
    when t.status in ('declined', 'no_show') then 0
    when t.worked_hours is not null then t.worked_hours
    else coalesce((
      select sum(
        extract(epoch from (pg_catalog.upper(piece) - pg_catalog.lower(piece)))
      ) / 3600.0
        from pg_catalog.unnest(
          pg_catalog.tsmultirange(
            pg_catalog.tsrange(t.starts_at, t.ends_at, '[)')
          ) - coalesce(
            (select pg_catalog.range_agg(l.span) from later_manual l),
            '{}'::pg_catalog.tsmultirange
          )
        ) as pieces(piece)
    ), 0)
  end
    from target t;
$$;

-- Il ramo Manuale automatico delle ore definitive usa il nuovo helper; `hours`
-- (programmato/fallback) resta sull'helper storico.
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
           private.effective_assignment_hours(a.id, scope.venue_ids) as legacy_hours,
           scope.venue_ids as scope_venue_ids
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
               then private.definitive_manual_hours(r.id, r.scope_venue_ids)
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

-- Il conflitto assenza usa lo stesso criterio delle ore definitive.
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
          and private.definitive_manual_hours(sa.id, null) > 0
          and (s.date = p_date or (s.end_time <= s.start_time and s.date + 1 = p_date)))
        or (sa.worked_hours > 0 and r.id is not null and sa.attendance_reviewed_at is not null
          and t.clock_out_at is not null
          and t.clock_in_at < ((p_date + 1)::timestamp at time zone 'Europe/Rome')
          and t.clock_out_at > (p_date::timestamp at time zone 'Europe/Rome')))
  );
$$;
