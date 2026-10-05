-- Lettura distinta dall'operatività: archivio, setup e migrazione conservano
-- gli scope precedenti. Solo il termine effettivo dell'archivio li restringe.
create function private.commercial_readable_workspace_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select w.id from public.workspaces w join public.workspace_commercial_state c on c.workspace_id = w.id
  where exists (select 1 from public.workspace_members m where m.workspace_id=w.id and m.user_id=(select auth.uid()))
    and (w.deleted_at is not null or (private.workspace_access_at(w.id,now())->>'can_read')::boolean);
$$;
create function private.commercial_readable_venue_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select v.id from public.venues v where v.workspace_id in (select private.commercial_readable_workspace_ids());
$$;
create function private.commercial_readable_member_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.id from public.workspace_members m where m.workspace_id in (select private.commercial_readable_workspace_ids());
$$;
create function private.commercial_readable_absence_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select a.id from public.staff_absences a where a.member_id in (select private.commercial_readable_member_ids());
$$;
create function private.commercial_readable_conversation_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.conversations c where c.workspace_id in (select private.commercial_readable_workspace_ids());
$$;
create function private.commercial_readable_clock_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select r.id from public.shift_clock_records r where r.venue_id in (select private.commercial_readable_venue_ids());
$$;
create function private.commercial_readable_shift_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.shifts s where s.venue_id in (select private.commercial_readable_venue_ids());
$$;
grant execute on function private.commercial_readable_workspace_ids(),
  private.commercial_readable_venue_ids(),private.commercial_readable_member_ids(),
  private.commercial_readable_absence_ids(),private.commercial_readable_conversation_ids(),
  private.commercial_readable_clock_ids(),private.commercial_readable_shift_ids() to authenticated;

create policy "commercial archive read" on public.venues as restrictive for select to authenticated
using (workspace_id in (select private.commercial_readable_workspace_ids()));
create policy "commercial archive read" on public.venue_roles as restrictive for select to authenticated
using (venue_id in (select private.commercial_readable_venue_ids()));
create policy "commercial archive read" on public.workspace_members as restrictive for select to authenticated
using (id in (select private.commercial_readable_member_ids()));
create policy "commercial archive read" on public.venue_members as restrictive for select to authenticated
using (workspace_id in (select private.commercial_readable_workspace_ids()));
create policy "commercial archive read" on public.member_hr as restrictive for select to authenticated
using (member_id in (select private.commercial_readable_member_ids()));
create policy "commercial archive read" on public.member_scope as restrictive for select to authenticated
using (workspace_id in (select private.commercial_readable_workspace_ids()));
create policy "commercial archive read" on public.venue_member_roles as restrictive for select to authenticated
using (venue_id in (select private.commercial_readable_venue_ids()));
create policy "commercial archive read" on public.shifts as restrictive for select to authenticated
using (venue_id in (select private.commercial_readable_venue_ids()));
create policy "commercial archive read" on public.shift_assignments as restrictive for select to authenticated
using (venue_id in (select private.commercial_readable_venue_ids()));
create policy "commercial archive read" on public.shift_role_requirements as restrictive for select to authenticated
using (venue_id in (select private.commercial_readable_venue_ids()));
create policy "commercial archive read" on public.shift_change_requests as restrictive for select to authenticated
using (shift_id in (select private.commercial_readable_shift_ids()));
create policy "commercial archive read" on public.staff_absences as restrictive for select to authenticated
using (member_id in (select private.commercial_readable_member_ids()));
create policy "commercial archive read" on public.absence_hour_credits as restrictive for select to authenticated
using (absence_id in (select private.commercial_readable_absence_ids()));
create policy "commercial archive read" on public.staff_documents as restrictive for select to authenticated
using (member_id in (select private.commercial_readable_member_ids()));
create policy "commercial archive read" on public.shift_clock_records as restrictive for select to authenticated
using (venue_id in (select private.commercial_readable_venue_ids()));
create policy "commercial archive read" on public.shift_clock_corrections as restrictive for select to authenticated
using (clock_record_id in (select private.commercial_readable_clock_ids()));
create policy "commercial archive read" on public.conversations as restrictive for select to authenticated
using (workspace_id in (select private.commercial_readable_workspace_ids()));
create policy "commercial archive read" on public.messages as restrictive for select to authenticated
using (conversation_id in (select private.commercial_readable_conversation_ids()));
-- La comunicazione testuale rimane durante l'archivio; richieste operative
-- e conferme hanno guard dedicati nelle RPC. Non equivale a nuova operatività.
create policy "commercial archive text" on public.messages as restrictive for insert to authenticated
with check (conversation_id in (select private.commercial_readable_conversation_ids()));
create policy "commercial archive documents" on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'staff-documents' or ((storage.foldername(name))[1])::uuid in (select private.commercial_readable_member_ids()));

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION private.my_work_history(p_user uuid)
 RETURNS TABLE(key text, venue_name text, logo_url text, title text, date date, start_time time without time zone, end_time time without time zone, hours numeric, shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric, clock_in_at timestamp with time zone, clock_out_at timestamp with time zone, hours_source text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
   where m.workspace_id in (select private.commercial_readable_workspace_ids())
     and m.user_id = p_user
     and s.status <> 'cancelled'
     and a.status not in ('declined', 'no_show')
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION private.owner_past_shift_matches(p_shift shifts, p_venue_ids uuid[], p_from date, p_to date, p_status text, p_role_ids uuid[], p_query text, p_member_ids uuid[])
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    p_shift.venue_id = any(coalesce(p_venue_ids, '{}'::uuid[]))
    and p_shift.venue_id in (select private.commercial_readable_venue_ids())
    and p_shift.venue_id in (select private.venues_where('roster'))
    and public.shift_ends_at(
      p_shift.date,
      p_shift.start_time,
      p_shift.end_time
    ) <= public.local_now()
    and (p_from is null or p_shift.date >= p_from)
    and (p_to is null or p_shift.date <= p_to)
    and case coalesce(p_status, 'all')
          when 'cancelled' then p_shift.status = 'cancelled'
          when 'done' then p_shift.status <> 'cancelled'
          else true
        end
    and (
      coalesce(cardinality(p_role_ids), 0) = 0
      or exists (
        select 1
          from public.shift_role_requirements r
         where r.shift_id = p_shift.id
           and r.role_id = any(p_role_ids)
      )
    )
    and (
      coalesce(cardinality(p_member_ids), 0) = 0
      or exists (
        select 1
          from public.shift_assignments a
          join public.venue_members vm on vm.id = a.venue_member_id
         where a.shift_id = p_shift.id
           and a.status <> 'declined'
           and vm.member_id = any(p_member_ids)
      )
    )
    and (
      nullif(btrim(p_query), '') is null
      or p_shift.title ilike ('%' || btrim(p_query) || '%')
    );
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION public.get_workspace_hours_summary(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean, roles text, shifts_count integer, hours numeric, approved_hours numeric, to_review_count integer, proposed_hours numeric, untracked_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(array_agg(v.id), '{}'::uuid[]) as venue_ids from public.venues v
    where v.workspace_id in (select private.commercial_readable_workspace_ids()) and v.workspace_id = p_workspace and v.id in (select private.venues_where('hours'))
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
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION public.get_workspace_absence_summary(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, ferie_days integer, permesso_days integer, permesso_hours numeric, malattia_days integer, inps_protocols text, ferie_hours numeric, malattia_hours numeric, permesso_recognized_hours numeric, conflict_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select v.id from public.venues v where v.workspace_id = p_workspace
      and v.id in (select private.venues_where('hours'))
  ), clipped as (
    select a.*, (least(a.end_date, p_to - 1) - greatest(a.start_date, p_from) + 1) as days
      from public.staff_absences a
      join public.workspace_members m on m.id = a.member_id and m.workspace_id = p_workspace
     where m.workspace_id in (select private.commercial_readable_workspace_ids()) and a.status = 'approved' and a.start_date < p_to and a.end_date >= p_from
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
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION public.get_hours_summary(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean, roles text, shifts_count integer, hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where s.venue_id in (select private.commercial_readable_venue_ids()) and s.venue_id = any (scope.venue_ids)
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
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION public.get_member_worked_shifts(p_member uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, status assignment_status, worked_hours numeric, shift_id uuid, title text, date date, start_time time without time zone, end_time time without time zone, hours numeric, venue_id uuid, venue_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where s.venue_id in (select private.commercial_readable_venue_ids()) and vm.member_id = p_member
     and v.id = any (scope.venue_ids)
     and s.status <> 'cancelled'
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
     and a.status not in ('declined', 'no_show')
   order by s.date desc, s.start_time desc
   limit greatest(p_limit, 0);
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION public.get_member_performance(p_member uuid)
 RETURNS TABLE(past_total integer, worked_count integer, no_show_count integer, declined_count integer, total_hours numeric, month_shifts integer, month_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     where s.venue_id in (select private.commercial_readable_venue_ids()) and vm.member_id = p_member
       and s.venue_id = any (scope.venue_ids)
       and s.status <> 'cancelled'
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
$function$
;

-- SECURITY DEFINER: lo stesso confine anche senza SELECT via RLS.
CREATE OR REPLACE FUNCTION public.get_staff_planning(p_from date, p_to date)
 RETURNS TABLE(venue_id uuid, venue_name text, venue_logo_url text, shift_id uuid, title text, date date, start_time time without time zone, end_time time without time zone, venue_member_id uuid, member_name text, avatar_url text, role_name text, is_me boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where s.venue_id in (select private.commercial_readable_venue_ids()) and s.status <> 'cancelled'
     and s.date >= p_from and s.date <= least(p_to, p_from + 62)
   order by s.date, s.start_time, s.id, m.display_name;
$function$
;

CREATE OR REPLACE FUNCTION public.get_absence_hour_credits(p_absence uuid)
 RETURNS TABLE(date date, minutes integer, conflict boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.date, c.minutes, private.absence_credit_conflict(a.member_id, c.date)
    from public.absence_hour_credits c
    join public.staff_absences a on a.id = c.absence_id
   where a.member_id in (select private.commercial_readable_member_ids()) and c.absence_id = p_absence and private.can_person(a.member_id, 'hours')
   order by c.date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_absence_availability(p_from date, p_to date)
 RETURNS TABLE(id uuid, member_id uuid, start_date date, end_date date, start_time time without time zone, end_time time without time zone, status absence_status)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select a.id, a.member_id, a.start_date, a.end_date, a.start_time, a.end_time, a.status
    from public.staff_absences a
   where a.member_id in (select private.commercial_readable_member_ids()) and a.status in ('pending', 'approved')
     and a.start_date <= p_to and a.end_date >= p_from
     and a.member_id in (select private.visible_member_ids())
   order by a.start_date;
$function$
;

CREATE OR REPLACE FUNCTION public.get_absence_summary(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, ferie_days integer, permesso_days integer, permesso_hours numeric, malattia_days integer, inps_protocols text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with clipped as (
    select a.member_id, a.kind, a.start_time, a.end_time, a.inps_protocol,
           (least(a.end_date, p_to - 1) - greatest(a.start_date, p_from) + 1) as days
      from public.staff_absences a
     where a.member_id in (select private.commercial_readable_member_ids()) and a.status = 'approved' and a.start_date < p_to and a.end_date >= p_from
       and (
         a.member_id in (
           select w.id from public.workspace_members w
            where w.workspace_id in (select private.my_workspace_ids('owner'))
         )
         or exists (
           select 1 from public.venue_members vm
            where vm.member_id = a.member_id and vm.venue_id in (select private.venues_where('hours'))
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_counterparts(p_conversations uuid[])
 RETURNS TABLE(conversation_id uuid, name text, subtitle text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select c.id, cc.name, cc.subtitle, cc.avatar_url
    from public.conversations c
    left join lateral private.chat_counterpart(
      c.workspace_id,
      case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end,
      not private.speaks_for_workspace(c.workspace_id, (select auth.uid()))
    ) cc on true
   where c.id in (select private.commercial_readable_conversation_ids()) and c.id = any (p_conversations)
     and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()));
$function$
;

CREATE OR REPLACE FUNCTION public.get_workspace_contacts()
 RETURNS TABLE(member_id uuid, user_id uuid, workspace_id uuid, workspace_name text, name text, avatar_url text, venues text, is_manager boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with me as (
    select m.workspace_id, m.authority
      from public.workspace_members m
     where m.user_id = (select auth.uid()) and m.status = 'active'
  )
  select t.id, t.user_id, w.id, w.name,
         coalesce(nullif(btrim(t.display_name), ''), nullif(btrim(p.full_name), ''), 'Professionista'),
         p.avatar_url,
         (select string_agg(v.name, ', ' order by v.name)
            from public.venue_members vm
            join public.venues v on v.id = vm.venue_id
           where vm.member_id = t.id and vm.left_at is null and v.closed_at is null),
         t.authority <> 'none'
    from me
    join public.workspaces w on w.id = me.workspace_id and w.deleted_at is null
    join public.workspace_members t on t.workspace_id = me.workspace_id
   left join public.profiles p on p.id = t.user_id
   where t.workspace_id in (select private.commercial_readable_workspace_ids()) and t.status = 'active' and t.user_id is not null
     and t.user_id <> (select auth.uid())
     and (me.authority <> 'none' or t.authority <> 'none' or w.staff_can_chat)
   order by w.name, 5;
$function$
;

CREATE OR REPLACE FUNCTION public.get_chat_unread_count()
 RETURNS integer
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select count(*)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where c.id in (select private.commercial_readable_conversation_ids()) and m.read_at is null and m.sender_id <> (select auth.uid())
     and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()));
$function$
;

-- Anche aprire il thread richiede consultazione ancora valida; il testo
-- rimane consentito in archivio, senza generare thread dopo il termine.
create or replace function public.open_conversation(p_member uuid default null, p_workspace uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  v_them  record;
  v_mine  public.member_authority;
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_member is not null then
    select m.workspace_id, m.user_id, m.authority, m.status into v_them
      from public.workspace_members m where m.id = p_member;
    if v_them.workspace_id is null or v_them.user_id is null
       or v_them.status <> 'active' or v_them.user_id = v_me then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select m.authority into v_mine from public.workspace_members m
     where m.workspace_id = v_them.workspace_id and m.user_id = v_me and m.status = 'active';
    if v_mine is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    if v_mine = 'none' and v_them.authority = 'none'
       and not (select w.staff_can_chat from public.workspaces w where w.id = v_them.workspace_id) then
      raise exception 'chat_disabled' using errcode = '42501';
    end if;

    perform private.lock_commercial_workspace(v_them.workspace_id);
    if not (private.workspace_access_at(v_them.workspace_id,clock_timestamp())->>'can_read')::boolean then
      raise exception 'workspace_read_only' using errcode = '42501';
    end if;
    return private.conversation_for_pair(v_them.workspace_id, v_me, v_them.user_id);
  end if;

  if p_workspace is null or not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace and m.user_id = v_me and m.status = 'active'
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_owner := private.workspace_primary_owner(p_workspace);
  if v_owner is null or v_owner = v_me then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.lock_commercial_workspace(p_workspace);
  if not (private.workspace_access_at(p_workspace,clock_timestamp())->>'can_read')::boolean then
    raise exception 'workspace_read_only' using errcode = '42501';
  end if;
  return private.conversation_for_pair(p_workspace, v_me, v_owner);
end;
$$;
