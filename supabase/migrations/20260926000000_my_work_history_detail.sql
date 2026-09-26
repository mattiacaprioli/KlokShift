-- «Le mie ore» diceva sede, data e un numero. Quando il numero non era la
-- durata del turno (9 h su un 14:00–22:00) il professionista non aveva modo di
-- capire perché: timbratura approvata, ore scritte a mano da chi gestisce o
-- semplicemente l'orario del turno, tutto sembrava uguale.
--
-- Lo storico porta ora anche da dove vengono le ore (`hours_source`), le ore
-- del turno per il confronto, la timbratura effettiva (correzioni comprese), il
-- ruolo e il turno per aprirne il dettaglio.
--
--   approved  worked_hours da una timbratura approvata
--   adjusted  worked_hours scritte da chi ha il permesso Ore
--   pending   c'è una timbratura, non ancora approvata: `hours` è ancora quella
--             del turno, e non va presentata come definitiva
--   planned   nessuna timbratura e nessuna rettifica: l'orario del turno
--
-- `hours` resta com'era (`effective_assignment_hours`): i totali non cambiano.
--
-- Il tipo di ritorno cambia, quindi si ricreano le funzioni che fanno
-- `select *` o espongono le colonne. `get_my_work_history` (OFFSET) resta per le
-- build vecchie, con le sue otto colonne scritte per esteso.

drop function public.get_my_work_history_page(integer, date, text);
drop function public.get_my_work_history_range(date, date);
drop function private.my_work_history(uuid);

create function private.my_work_history(p_user uuid)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric,
  shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric,
  clock_in_at timestamptz, clock_out_at timestamptz, hours_source text
) language sql stable set search_path = '' as $$
  select 'asg-' || a.id::text, v.name, v.logo_url, s.title, s.date, s.start_time, s.end_time,
         private.effective_assignment_hours(a.id, null),
         s.id, vr.name,
         public.shift_duration_hours(s.start_time, s.end_time),
         a.worked_hours,
         t.clock_in_at, t.clock_out_at,
         case
           when a.worked_hours is not null and a.attendance_reviewed_at is not null then 'approved'
           when a.worked_hours is not null then 'adjusted'
           when r.id is not null then 'pending'
           else 'planned'
         end
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = a.shift_id
    left join public.venues v on v.id = s.venue_id
    left join public.venue_roles vr on vr.id = a.role_id
    left join public.shift_clock_records r
      on r.assignment_id = a.id and r.voided_at is null
    left join lateral private.clock_record_times(r.id) t on r.id is not null
   where m.user_id = p_user
     and s.status <> 'cancelled'
     and a.status not in ('declined', 'no_show')
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$$;

create function public.get_my_work_history_page(
  p_limit integer default 20,
  p_before_date date default null,
  p_before_key text default null
)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric,
  shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric,
  clock_in_at timestamptz, clock_out_at timestamptz, hours_source text
) language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where p_before_date is null
      or (h.date, h.key) < (p_before_date, p_before_key)
   order by h.date desc, h.key desc
   limit greatest(p_limit, 0);
$$;

create function public.get_my_work_history_range(p_from date, p_to date)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric,
  shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric,
  clock_in_at timestamptz, clock_out_at timestamptz, hours_source text
) language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where h.date >= p_from and h.date <= least(p_to, p_from + 62)
   order by h.date desc, h.key desc;
$$;

create or replace function public.get_my_work_history(p_limit integer default 20, p_offset integer default 0)
returns table (
  key text, venue_name text, logo_url text, title text, date date,
  start_time time, end_time time, hours numeric
) language sql stable security definer set search_path = '' as $$
  select h.key, h.venue_name, h.logo_url, h.title, h.date, h.start_time, h.end_time, h.hours
    from private.my_work_history((select auth.uid())) h
   order by h.date desc, h.key desc
   limit greatest(p_limit, 0) offset greatest(p_offset, 0);
$$;

grant execute on function
  public.get_my_work_history_page(integer, date, text),
  public.get_my_work_history_range(date, date)
to authenticated;
