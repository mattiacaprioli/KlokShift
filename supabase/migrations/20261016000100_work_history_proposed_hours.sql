-- Lo storico del professionista porta le ore proposte da una timbratura ancora
-- da approvare, calcolate come le calcola l'approvazione
-- (private.clock_record_counted_hours): al netto della pausa non retribuita,
-- timbrata o pianificata. Il client non le ricostruisce più dagli orari, che
-- della pausa non sanno niente (plans/BREAKS.md).
--
-- Il tipo di ritorno cambia: si ricreano la funzione privata e le due letture
-- che ne restituiscono la riga intera.

drop function public.get_my_work_history_range(date, date);
drop function public.get_my_work_history_page(integer, date, text);
drop function private.my_work_history(uuid);

CREATE FUNCTION private.my_work_history(p_user uuid)
 RETURNS TABLE(key text, venue_name text, logo_url text, title text, date date, start_time time without time zone, end_time time without time zone, hours numeric, shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric, clock_in_at timestamp with time zone, clock_out_at timestamp with time zone, hours_source text, proposed_hours numeric)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select 'asg-' || a.id::text, v.name, v.logo_url, s.title, s.date, s.start_time, s.end_time,
         private.effective_assignment_hours(a.id, null),
         s.id, vr.name,
         public.shift_counted_hours(s.start_time, s.end_time, s.break_minutes, s.break_paid),
         a.worked_hours,
         t.clock_in_at, t.clock_out_at,
         case
           when a.worked_hours is not null and a.attendance_reviewed_at is not null then 'approved'
           when a.worked_hours is not null then 'adjusted'
           when r.id is not null then 'pending'
           else 'planned'
         end,
         case when r.id is not null and t.clock_out_at is not null
              then private.clock_record_counted_hours(r.id) end
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = a.shift_id
    left join public.venues v on v.id = s.venue_id
    left join public.venue_roles vr on vr.id = a.role_id
    left join public.shift_clock_records r
      on r.assignment_id = a.id and r.voided_at is null
    left join lateral private.clock_record_times(r.id) t on r.id is not null
   where m.workspace_id in (select private.commercial_readable_workspace_ids())
     and m.user_id = p_user
     and s.status <> 'cancelled'
     and a.status not in ('declined', 'no_show')
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$function$
;

create function public.get_my_work_history_range(p_from date, p_to date)
returns table (key text, venue_name text, logo_url text, title text, date date, start_time time, end_time time, hours numeric, shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric, clock_in_at timestamptz, clock_out_at timestamptz, hours_source text, proposed_hours numeric)
language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where h.date >= p_from and h.date <= least(p_to, p_from + 62)
   order by h.date desc, h.key desc;
$$;

create function public.get_my_work_history_page(
  p_limit integer default 20,
  p_before_date date default null,
  p_before_key text default null
)
returns table (key text, venue_name text, logo_url text, title text, date date, start_time time, end_time time, hours numeric, shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric, clock_in_at timestamptz, clock_out_at timestamptz, hours_source text, proposed_hours numeric)
language sql stable security definer set search_path = '' as $$
  select h.* from private.my_work_history((select auth.uid())) h
   where p_before_date is null
      or (h.date, h.key) < (p_before_date, p_before_key)
   order by h.date desc, h.key desc
   limit greatest(p_limit, 0);
$$;

revoke all on function private.my_work_history(uuid) from public, anon, authenticated;
grant execute on function
  public.get_my_work_history_range(date, date),
  public.get_my_work_history_page(integer, date, text)
to authenticated;
