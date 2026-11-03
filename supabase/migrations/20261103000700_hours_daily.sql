-- Le righe del giorno per il consulente (2026-11-03).
--
-- `get_workspace_hours_summary` e `get_workspace_hours_daily` leggono la stessa
-- `private.workspace_hour_rows`: una regola nuova su cosa conta va lì, non in
-- una delle due. Il riepilogo è il `group by` delle righe; il giornaliero ne
-- prende quelle che contano (`counted`), una per turno.
--
-- `private.workspace_hour_rows` è il CTE `rows` del riepilogo di
-- 20261103000100 con le espressioni per riga, senza cambiarne il perimetro:
-- solo le sedi dove chi legge ha «Ore», solo aziende leggibili, niente bozze
-- (`published_at is not null`, vedi «Bozza e pubblicazione» in AGENTS.md: la
-- funzione è DEFINER e scavalca la RLS, il filtro lo ripete lei), niente
-- annullati, solo turni finiti, niente `declined`/`no_show`. Ogni grandezza in
-- ore si arrotonda al centesimo per riga, così la somma delle righe che il
-- consulente fa in Excel è esattamente il totale del mensile. È l'unica
-- differenza del riepilogo rispetto a prima (stessa firma, colonne, ordine).
--
-- Il giornaliero dà anche:
-- - «Da verificare» (`to_fix`): le righe di `get_hours_to_fix` sullo stesso
--   periodo, con il loro motivo in `note` e le ore vuote;
-- - le assenze approvate, una riga per persona e giorno, nello stesso
--   perimetro di `get_workspace_absence_summary` (20261103000600) e con gli
--   stessi crediti arrotondati e gli stessi conflitti: per chi non ha ore
--   indicate o è in conflitto le ore sono vuote. ⚠️ Se cambia il riepilogo
--   delle assenze, cambia anche qui.

CREATE FUNCTION private.workspace_hour_rows(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(assignment_id uuid, member_id uuid, member_name text, venue_id uuid, venue_name text,
               venue_closed boolean, venue_member_id uuid, date date, title text,
               start_time time without time zone, end_time time without time zone,
               clock_in_at timestamptz, clock_out_at timestamptz, counted boolean,
               approved_hours numeric, legacy_hours numeric, to_review boolean,
               proposed_hours numeric, untracked_hours numeric, break_minutes integer,
               break_paid boolean, paid_break_hours numeric, unpaid_break_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(array_agg(v.id), '{}'::uuid[]) as venue_ids from public.venues v
    where v.workspace_id in (select private.commercial_readable_workspace_ids()) and v.workspace_id = p_workspace and v.id in (select private.venues_where('hours'))
  ), base as (
    select a.id, a.venue_id, a.venue_member_id, a.worked_hours, a.hours_source,
           a.attendance_reviewed_at,
           s.date, s.title, s.start_time, s.end_time, s.break_minutes, s.break_paid,
           v.name as venue_name, v.closed_at,
           b.minutes as clock_break_minutes,
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
      left join lateral private.clock_record_break(r.id) b on true
     where s.venue_id = any(scope.venue_ids) and s.status <> 'cancelled'
       and s.published_at is not null
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
  ), flags as (
    select r.*,
           -- Le ore contano: scritte a mano, da una timbratura approvata e
           -- chiusa, o dal turno concluso che conta da sé. `is true`: con
           -- `hours_source` nullo la condizione vale NULL, cioè «non conta»
           -- (il complemento è `get_hours_to_fix`, test 037).
           ((r.worked_hours is not null and
              (r.hours_source = 'manual' or (r.clock_record_id is not null
                and r.attendance_reviewed_at is not null and r.clock_out_at is not null)))
            or (r.worked_hours is null and r.clock_record_id is null and
              (r.hours_source = 'manual_auto' or
                (r.hours_source is null and r.effective_clock_method = 'manual')))) is true as counted,
           (r.worked_hours is not null and r.clock_record_id is not null
              and r.attendance_reviewed_at is not null and r.clock_out_at is not null) is true as clock_counted
      from base r
  )
  select r.id, r.member_id, r.display_name, r.venue_id, r.venue_name, r.closed_at is not null,
         r.venue_member_id, r.date, r.title, r.start_time, r.end_time,
         r.clock_in_at, r.clock_out_at, r.counted,
         case
           when not r.counted then 0
           when r.worked_hours is not null then round(r.worked_hours, 2)
           else round(private.definitive_manual_hours(r.id, r.scope_venue_ids), 2)
         end,
         round(r.legacy_hours, 2),
         r.clock_record_id is not null and r.attendance_reviewed_at is null,
         case when r.clock_record_id is not null and r.attendance_reviewed_at is null
                and r.clock_out_at is not null
              then round(private.clock_record_counted_hours(r.clock_record_id), 2)
              else 0 end,
         case when r.worked_hours is not null and r.hours_source is distinct from 'manual'
                and (r.clock_record_id is null or r.attendance_reviewed_at is null
                  or r.clock_out_at is null)
              then round(r.worked_hours, 2)
              else 0 end,
         -- La pausa che il riepilogo conta: quella della timbratura approvata,
         -- altrimenti la pianificata.
         case when r.clock_counted then coalesce(r.clock_break_minutes, 0)
              else r.break_minutes end,
         r.break_paid,
         case when r.counted and r.break_paid
              then round(case when r.clock_counted then coalesce(r.clock_break_minutes, 0)
                              else r.break_minutes end / 60.0, 2)
              else 0 end,
         case when r.counted and not r.break_paid
              then round(case when r.clock_counted then coalesce(r.clock_break_minutes, 0)
                              else r.break_minutes end / 60.0, 2)
              else 0 end
    from flags r;
$function$;

revoke all on function private.workspace_hour_rows(uuid, date, date) from public, anon;

CREATE OR REPLACE FUNCTION public.get_workspace_hours_summary(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean, roles text, shifts_count integer, hours numeric, approved_hours numeric, to_review_count integer, proposed_hours numeric, untracked_hours numeric, paid_break_hours numeric, unpaid_break_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  -- Le righe sono quelle di `private.workspace_hour_rows` (che applica già il
  -- perimetro): il controllo qui sotto ripete il confine commerciale nel corpo
  -- della lettura, come per le altre letture DEFINER (test 050).
  with per_venue as (
    select r.member_id, r.member_name, r.venue_id, r.venue_name, r.venue_closed, r.venue_member_id,
           count(*) filter (where r.counted)::integer as shifts_count,
           coalesce(sum(r.legacy_hours), 0) as hours,
           coalesce(sum(r.approved_hours), 0) as approved_hours,
           count(*) filter (where r.to_review)::integer as to_review_count,
           coalesce(sum(r.proposed_hours), 0) as proposed_hours,
           coalesce(sum(r.untracked_hours), 0) as untracked_hours,
           coalesce(sum(r.paid_break_hours), 0) as paid_break_hours,
           coalesce(sum(r.unpaid_break_hours), 0) as unpaid_break_hours
      from private.workspace_hour_rows(p_workspace, p_from, p_to) r
     where p_workspace in (select private.commercial_readable_workspace_ids())
     group by r.member_id, r.member_name, r.venue_id, r.venue_name, r.venue_closed, r.venue_member_id
  )
  select r.member_id, r.member_name, r.venue_id, r.venue_name, r.venue_closed,
         (select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
            from public.venue_member_roles x join public.venue_roles vr on vr.id = x.role_id
           where x.venue_member_id = r.venue_member_id and vr.archived_at is null),
         r.shifts_count, r.hours, r.approved_hours, r.to_review_count,
         r.proposed_hours, r.untracked_hours, r.paid_break_hours, r.unpaid_break_hours
    from per_venue r
   order by sum(r.approved_hours) over (partition by r.member_id) desc, r.member_name, r.venue_name;
$function$;

CREATE FUNCTION public.get_workspace_hours_daily(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, date date, kind text, venue_name text, title text,
               clock_in text, clock_out text, break_minutes integer, break_paid boolean,
               hours numeric, note text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with hour_rows as (
    select * from private.workspace_hour_rows(p_workspace, p_from, p_to) r
     where p_workspace in (select private.commercial_readable_workspace_ids())
  ),
  -- Le assenze: lo stesso perimetro di `get_workspace_absence_summary`.
  scope as (
    select v.id from public.venues v where v.workspace_id = p_workspace
      and v.id in (select private.venues_where('hours'))
  ), clipped as (
    select a.*
      from public.staff_absences a
      join public.workspace_members m on m.id = a.member_id and m.workspace_id = p_workspace
     where m.workspace_id in (select private.commercial_readable_workspace_ids()) and a.status = 'approved' and a.start_date < p_to and a.end_date >= p_from
       and (p_workspace in (select private.my_workspace_ids('owner'))
         or exists (select 1 from public.venue_members vm
                     where vm.member_id = a.member_id and vm.venue_id in (select id from scope)))
  ), absence_days as (
    select a.id, a.member_id, a.kind, a.start_time, a.end_time, g.day::date as date
      from clipped a
      cross join lateral generate_series(greatest(a.start_date, p_from)::timestamp,
                                         least(a.end_date, p_to - 1)::timestamp, interval '1 day') as g(day)
  ), absence_rows as (
    select x.member_id, x.kind, x.date, x.start_time, x.end_time,
           -- Un credito del giorno (ferie, malattia, permesso a giornata) o la
           -- durata del permesso a ore; il permesso a ore non ha crediti.
           case when x.start_time is not null
                  then round(extract(epoch from (x.end_time - x.start_time)) / 3600.0, 2)
                else round(c.minutes / 60.0, 2) end as hours,
           case when x.start_time is not null
                  then private.absence_hours_conflict(x.member_id, x.date, x.start_time, x.end_time)
                when c.absence_id is not null
                  then private.absence_credit_conflict(x.member_id, x.date)
                else false end as conflict
      from absence_days x
      left join public.absence_hour_credits c on c.absence_id = x.id and c.date = x.date
  ), daily as (
    select r.member_id, r.member_name, r.date, 'work'::text as kind, r.venue_name, r.title,
           -- Gli orari della timbratura che conta, altrimenti quelli del turno.
           case when r.clock_in_at is not null and not r.to_review and r.clock_out_at is not null
                then to_char(r.clock_in_at at time zone 'Europe/Rome', 'HH24:MI')
                else to_char(r.start_time, 'HH24:MI') end as clock_in,
           case when r.clock_in_at is not null and not r.to_review and r.clock_out_at is not null
                then to_char(r.clock_out_at at time zone 'Europe/Rome', 'HH24:MI')
                else to_char(r.end_time, 'HH24:MI') end as clock_out,
           r.break_minutes, r.break_paid, r.approved_hours as hours, null::text as note
      from hour_rows r where r.counted
    union all
    -- «Da verificare»: gli orari timbrati se ci sono (l'uscita può mancare),
    -- altrimenti quelli del turno; ore vuote, mai nei totali.
    select f.member_id, f.member_name, f.date, 'to_fix', f.venue_name, f.title,
           case when r.clock_in_at is not null
                then to_char(r.clock_in_at at time zone 'Europe/Rome', 'HH24:MI')
                else to_char(f.start_time, 'HH24:MI') end,
           case when r.clock_in_at is not null
                then to_char(r.clock_out_at at time zone 'Europe/Rome', 'HH24:MI')
                else to_char(f.end_time, 'HH24:MI') end,
           r.break_minutes, r.break_paid, null::numeric, f.kind
      from public.get_hours_to_fix(p_workspace, p_from, p_to) f
      left join hour_rows r on r.assignment_id = f.assignment_id
    union all
    select x.member_id, m.display_name, x.date, x.kind::text, null, null, null, null, null, null,
           case when x.conflict then null else x.hours end,
           case when x.conflict then 'conflict'
                when x.start_time is not null
                  then 'hourly:' || to_char(x.start_time, 'HH24:MI') || '-' || to_char(x.end_time, 'HH24:MI')
           end
      from absence_rows x join public.workspace_members m on m.id = x.member_id
  )
  select o.member_id, o.member_name, o.date, o.kind, o.venue_name, o.title,
         o.clock_in, o.clock_out, o.break_minutes, o.break_paid, o.hours, o.note
    from daily o
   order by o.member_name, o.member_id, o.date, o.clock_in nulls last, o.kind;
$function$;

revoke all on function public.get_workspace_hours_daily(uuid, date, date) from public, anon;

grant execute on function public.get_workspace_hours_daily(uuid, date, date) to authenticated;
