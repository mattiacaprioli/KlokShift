-- I report gestionali devono dichiarare l'azienda a cui appartengono. Un utente
-- può gestirne più di una: il solo insieme dei permessi non è un confine
-- sufficiente per una pagina o un export riferiti all'azienda corrente.

create function public.get_workspace_hours_summary(
  p_workspace uuid,
  p_from date,
  p_to date
)
returns table (
  member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean,
  roles text, shifts_count integer, hours numeric
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(pg_catalog.array_agg(v.id), '{}'::uuid[]) as venue_ids
      from public.venues v
     where v.workspace_id = p_workspace
       and v.id in (select private.venues_where('hours'))
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
       and s.status <> 'cancelled'
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

create function public.get_workspace_absence_summary(
  p_workspace uuid,
  p_from date,
  p_to date
)
returns table (
  member_id uuid, member_name text, ferie_days integer, permesso_days integer,
  permesso_hours numeric, malattia_days integer, inps_protocols text
) language sql stable security definer set search_path = '' as $$
  with scope as (
    select v.id
      from public.venues v
     where v.workspace_id = p_workspace
       and v.id in (select private.venues_where('hours'))
  ), clipped as (
    select a.member_id, a.kind, a.start_time, a.end_time, a.inps_protocol,
           (least(a.end_date, p_to - 1) - greatest(a.start_date, p_from) + 1) as days
      from public.staff_absences a
      join public.workspace_members m
        on m.id = a.member_id and m.workspace_id = p_workspace
     where a.status = 'approved' and a.start_date < p_to and a.end_date >= p_from
       and (
         p_workspace in (select private.my_workspace_ids('owner'))
         or exists (
           select 1 from public.venue_members vm
            where vm.member_id = a.member_id and vm.venue_id in (select id from scope)
         )
       )
  )
  select m.id, m.display_name,
    coalesce(sum(c.days) filter (where c.kind = 'ferie'), 0)::integer,
    coalesce(sum(c.days) filter (where c.kind = 'permesso' and c.start_time is null), 0)::integer,
    round(coalesce(sum(extract(epoch from (c.end_time - c.start_time)) / 3600)
             filter (where c.kind = 'permesso' and c.start_time is not null), 0), 2),
    coalesce(sum(c.days) filter (where c.kind = 'malattia'), 0)::integer,
    string_agg(c.inps_protocol, ', ' order by c.inps_protocol)
      filter (where c.kind = 'malattia' and c.inps_protocol is not null)
    from clipped c join public.workspace_members m on m.id = c.member_id
   group by m.id, m.display_name
   order by m.display_name;
$$;

grant execute on function
  public.get_workspace_hours_summary(uuid, date, date),
  public.get_workspace_absence_summary(uuid, date, date)
to authenticated;
