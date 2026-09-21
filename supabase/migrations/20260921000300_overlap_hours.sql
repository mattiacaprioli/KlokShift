-- Le ore sono tempo della persona, non numero di incarichi: due turni
-- 14:00–22:00 e 18:00–23:00 coprono 9 ore, non 13. I turni restano distinti
-- (ruolo, sede, copertura), ma il tratto comune entra una volta sola in Ore,
-- performance e storico.
--
-- `worked_hours` è una rettifica esplicita e resta autorevole. L'unione si
-- applica solo agli incarichi senza rettifica: se una sovrapposizione è stata
-- ripartita a mano (per esempio 4 h + 5 h), si sommano quei valori.

create function private.effective_assignment_hours(
  p_assignment uuid,
  p_venues uuid[] default null
)
returns numeric language sql stable set search_path = '' as $$
  with target as (
    select a.id, a.status, a.worked_hours, vm.member_id,
           s.date + s.start_time as starts_at,
           public.shift_ends_at(s.date, s.start_time, s.end_time) as ends_at
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
     where a.id = p_assignment
  ), later_planned as (
    select pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) as span
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
      cross join target t
     where a.id <> t.id
       and vm.member_id = t.member_id
       and a.status not in ('declined', 'no_show')
       and a.worked_hours is null
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
            (select pg_catalog.range_agg(l.span) from later_planned l),
            '{}'::pg_catalog.tsmultirange
          )
        ) as pieces(piece)
    ), 0)
  end
    from target t;
$$;

-- Pagina Ore, CSV e PDF. L'unione attraversa anche le sedi visibili: il totale
-- della persona è uno solo; la parte comune viene attribuita al turno che
-- comincia più tardi, così 14–22 + 18–23 diventa 4 h + 5 h.
create or replace function public.get_hours_summary(p_from date, p_to date)
returns table (
  member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean,
  roles text, shifts_count integer, hours numeric
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(pg_catalog.array_agg(allowed.venue_id), '{}'::uuid[]) as venue_ids
      from private.venues_where('hours') as allowed(venue_id)
  ), per_venue as (
    select m.id as member_id, m.display_name as member_name,
           v.id as venue_id, v.name as venue_name, v.closed_at as venue_closed_at,
           vm.id as venue_member_id,
           count(*)::integer as shifts_count,
           sum(private.effective_assignment_hours(a.id, scope.venue_ids)) as hours
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      cross join scope
     where s.venue_id = any (scope.venue_ids)
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
     group by m.id, m.display_name, v.id, v.name, v.closed_at, vm.id
  )
  select r.member_id, r.member_name, r.venue_id, r.venue_name, r.venue_closed_at is not null,
         (select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
            from public.venue_member_roles x join public.venue_roles vr on vr.id = x.role_id
           where x.venue_member_id = r.venue_member_id and vr.archived_at is null),
         r.shifts_count, r.hours
    from per_venue r
   order by sum(r.hours) over (partition by r.member_id) desc, r.member_name, r.venue_name;
$$;

create or replace function public.get_member_performance(p_member uuid)
returns table (
  past_total integer, worked_count integer, no_show_count integer, declined_count integer,
  total_hours numeric, month_shifts integer, month_hours numeric
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(pg_catalog.array_agg(allowed.venue_id), '{}'::uuid[]) as venue_ids
      from private.venues_where('hours') as allowed(venue_id)
  ), past as (
    select a.status, private.effective_assignment_hours(a.id, scope.venue_ids) as hours,
           s.date
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
      cross join scope
     where vm.member_id = p_member
       and s.venue_id = any (scope.venue_ids)
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
  )
  select count(*)::integer,
    count(*) filter (where status not in ('declined', 'no_show'))::integer,
    count(*) filter (where status = 'no_show')::integer,
    count(*) filter (where status = 'declined')::integer,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')), 0),
    count(*) filter (where status not in ('declined', 'no_show')
                       and date >= date_trunc('month', public.local_now())::date)::integer,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')
                                  and date >= date_trunc('month', public.local_now())::date), 0)
    from past;
$$;

create or replace function public.get_member_worked_shifts(p_member uuid, p_limit integer default 6)
returns table (
  id uuid, status public.assignment_status, worked_hours numeric, shift_id uuid, title text,
  date date, start_time time, end_time time, hours numeric, venue_id uuid, venue_name text
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(pg_catalog.array_agg(allowed.venue_id), '{}'::uuid[]) as venue_ids
      from private.venues_where('hours') as allowed(venue_id)
  )
  select a.id, a.status, a.worked_hours, s.id, s.title, s.date, s.start_time, s.end_time,
         private.effective_assignment_hours(a.id, scope.venue_ids), v.id, v.name
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.shifts s on s.id = a.shift_id
    join public.venues v on v.id = s.venue_id
    cross join scope
   where vm.member_id = p_member
     and v.id = any (scope.venue_ids)
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
     and a.status not in ('declined', 'no_show')
   order by s.date desc, s.start_time desc
   limit greatest(p_limit, 0);
$$;

create or replace function private.my_work_history(p_user uuid)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable set search_path = '' as $$
  select 'asg-' || a.id::text, v.name, v.logo_url, s.title, s.date, s.start_time, s.end_time,
         private.effective_assignment_hours(a.id, null)
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = a.shift_id
    left join public.venues v on v.id = s.venue_id
   where m.user_id = p_user
     and a.status not in ('declined', 'no_show')
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$$;
