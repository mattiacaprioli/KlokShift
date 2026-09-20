-- Baseline — 13/N: ore, performance, storico, planning condiviso.
--
-- Sono report: leggono più tabelle e devono dare un risultato anche a chi non
-- legge quelle tabelle direttamente (chi ha solo «Ore» non legge i turni). Per
-- questo sono `security definer` con il perimetro scritto ESPLICITO nel
-- predicato (`venues_where('hours')`): è quel predicato che guida l'indice, e la
-- RLS da sola non basterebbe. Le persone si identificano col membro dell'azienda.

-- Ore per persona e sede nel periodo [p_from, p_to). Ore effettive = worked_hours
-- se corretta a mano, altrimenti la durata pianificata; rifiutati e assenti non
-- contano; solo turni già conclusi (shift_ends_at, non la data: i turni notturni).
create function public.get_hours_summary(p_from date, p_to date)
returns table (
  member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean,
  roles text, shifts_count integer, hours numeric
) language sql stable security definer set search_path = '' as $$
  with per_venue as (
    select m.id as member_id, m.display_name as member_name,
           v.id as venue_id, v.name as venue_name, v.closed_at as venue_closed_at,
           vm.id as venue_member_id,
           count(*)::integer as shifts_count,
           sum(coalesce(a.worked_hours, public.shift_duration_hours(s.start_time, s.end_time))) as hours
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where v.id in (select private.venues_where('hours'))
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

create function public.get_member_performance(p_member uuid)
returns table (
  past_total integer, worked_count integer, no_show_count integer, declined_count integer,
  total_hours numeric, month_shifts integer, month_hours numeric
) language sql stable security definer set search_path = '' as $$
  with past as (
    select a.status,
           coalesce(a.worked_hours, public.shift_duration_hours(s.start_time, s.end_time)) as hours,
           s.date
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
     where vm.member_id = p_member
       and s.venue_id in (select private.venues_where('hours'))
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

-- `order by date desc, start_time desc` è già cronologico all'indietro anche coi
-- turni notturni, perché un turno appartiene al giorno in cui INIZIA.
create function public.get_member_worked_shifts(p_member uuid, p_limit integer default 6)
returns table (
  id uuid, status public.assignment_status, worked_hours numeric, shift_id uuid, title text,
  date date, start_time time, end_time time, hours numeric, venue_id uuid, venue_name text
) language sql stable security definer set search_path = '' as $$
  select a.id, a.status, a.worked_hours, s.id, s.title, s.date, s.start_time, s.end_time,
         coalesce(a.worked_hours, public.shift_duration_hours(s.start_time, s.end_time)),
         v.id, v.name
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.shifts s on s.id = a.shift_id
    join public.venues v on v.id = s.venue_id
   where vm.member_id = p_member
     and v.id in (select private.venues_where('hours'))
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
     and a.status not in ('declined', 'no_show')
   order by s.date desc, s.start_time desc
   limit greatest(p_limit, 0);
$$;

-- Il mio storico di lavoro, fra tutte le aziende in cui ho lavorato. `key` come
-- secondo criterio d'ordine: la paginazione non deve ripetere o saltare righe.
create function private.my_work_history(p_user uuid)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable set search_path = '' as $$
  select 'asg-' || a.id::text, v.name, v.logo_url, s.title, s.date, s.start_time, s.end_time,
         coalesce(a.worked_hours, public.shift_duration_hours(s.start_time, s.end_time))
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = a.shift_id
    left join public.venues v on v.id = s.venue_id
   where m.user_id = p_user
     and a.status not in ('declined', 'no_show')
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$$;

create function public.get_my_work_history(p_limit integer default 20, p_offset integer default 0)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable security definer set search_path = '' as $$
  select * from private.my_work_history((select auth.uid()))
   order by date desc, key desc
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

create function public.get_my_work_history_totals()
returns table (total_count integer, total_hours numeric)
language sql stable security definer set search_path = '' as $$
  select count(*)::integer, coalesce(sum(hours), 0)
    from private.my_work_history((select auth.uid()));
$$;

-- Il planning delle sedi in cui lavoro, con i colleghi. Le sedi lo mostrano solo
-- se `staff_sees_planning`. Conta solo chi è attivo: un invito non ancora
-- accettato non è organico, e mostrargli il planning farebbe leggere i nomi dello
-- staff a chiunque il titolare abbia solo invitato. Il tetto (62 giorni) è del
-- server: l'indice regge un intervallo di settimane, non dieci anni.
create function public.get_staff_planning(p_from date, p_to date)
returns table (
  venue_id uuid, venue_name text, venue_logo_url text, shift_id uuid, title text,
  date date, start_time time, end_time time, venue_member_id uuid, member_name text,
  avatar_url text, role_name text, is_me boolean
) language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid),
  my_venues as (
    select v.id, v.name, v.logo_url
      from public.venue_members vm
      join public.workspace_members m on m.id = vm.member_id
      join public.venues v on v.id = vm.venue_id
      cross join me
     where m.user_id = me.uid and m.status = 'active' and vm.left_at is null
       and v.staff_sees_planning and v.closed_at is null
  )
  select mv.id, mv.name, mv.logo_url, s.id, s.title, s.date, s.start_time, s.end_time,
         vm.id, m.display_name, p.avatar_url, r.name,
         m.user_id is not distinct from me.uid
    from public.shifts s
    join my_venues mv on mv.id = s.venue_id
    cross join me
    left join public.shift_assignments a on a.shift_id = s.id and a.status in ('assigned', 'confirmed')
    -- Chi è uscito dalla sede non lavorerà quel turno: il turno resta, la persona no.
    left join public.venue_members vm on vm.id = a.venue_member_id and vm.left_at is null
    left join public.workspace_members m on m.id = vm.member_id
    left join public.profiles p on p.id = m.user_id
    left join public.venue_roles r on r.id = a.role_id
   where s.status <> 'cancelled'
     and s.date >= p_from and s.date <= least(p_to, p_from + 62)
   order by s.date, s.start_time, s.id, m.display_name;
$$;

grant execute on function
  public.get_hours_summary(date, date), public.get_member_performance(uuid),
  public.get_member_worked_shifts(uuid, integer), public.get_my_work_history(integer, integer),
  public.get_my_work_history_totals(), public.get_staff_planning(date, date)
to authenticated;
