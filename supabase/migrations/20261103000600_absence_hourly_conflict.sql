-- Il permesso a ore va in conflitto solo se si sovrappone al lavoro (2026-11-03).
--
-- Finora `private.absence_credit_conflict(member, date)` segnava da verificare
-- qualunque permesso a ore in un giorno in cui la persona aveva lavoro
-- approvato, anche senza sovrapposizione: un permesso 15-17 dopo un turno 9-15
-- non veniva riconosciuto. Il permesso orario ha un intervallo, e si confronta
-- come intervallo, non come data. I crediti a giornata (ferie, malattia,
-- permesso a giornata, in `absence_hour_credits`) restano sulla regola dei
-- giorni: `absence_credit_conflict` non cambia.
--
-- `private.absence_hours_conflict(member, date, start, end)` ha gli stessi tre
-- rami di `absence_credit_conflict` (ore manuali, turno concluso senza
-- timbratura, timbratura approvata) ma con gli intervalli: [inizio, fine) del
-- permesso contro [inizio, fine) del lavoro, ora di Roma; i bordi che si
-- toccano non sono un conflitto. ⚠️ È la gemella SQL di `shiftOverlapsAbsence`
-- (src/features/absences/conflicts.ts): cambiano insieme.
--
-- `shift_ends_at` restituisce un orario locale senza fuso: va convertito con
-- `at time zone 'Europe/Rome'` prima di confrontarlo con gli istanti.
--
-- Chiamanti: `get_workspace_absence_summary` (qui) e `get_workspace_hours_daily`
-- (un'altra migration, più avanti).
--
-- `get_workspace_absence_summary` ha stessa firma e colonne di
-- 20261031000000; cambia il ramo del permesso orario, e ogni credito si
-- arrotonda al centesimo per riga (470 minuti = 7,83 ore).

CREATE FUNCTION private.absence_hours_conflict(p_member uuid, p_date date, p_start time, p_end time)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with win as (
    select (p_date + p_start) at time zone 'Europe/Rome' as a,
           (p_date + p_end) at time zone 'Europe/Rome' as b
  )
  select exists (
    select 1 from win, public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    join public.venue_members vm on vm.id = sa.venue_member_id
    join public.venues v on v.id = s.venue_id
    left join public.shift_clock_records r on r.assignment_id = sa.id and r.voided_at is null
    left join lateral private.clock_record_times(r.id) t on true
    where vm.member_id = p_member and s.status <> 'cancelled'
      and s.published_at is not null
      and sa.status not in ('declined', 'no_show')
      and (
        -- ore scritte a mano: l'intervallo è quello del turno
        (sa.worked_hours > 0 and sa.hours_source = 'manual'
          and (s.date + s.start_time) at time zone 'Europe/Rome' < win.b
          and public.shift_ends_at(s.date, s.start_time, s.end_time) at time zone 'Europe/Rome' > win.a)
        -- turno concluso senza timbratura: conta da sé
        or (sa.worked_hours is null and r.id is null and
          (sa.hours_source = 'manual_auto' or
            (sa.hours_source is null and coalesce(vm.clock_method, v.clock_method) = 'manual'))
          and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
          and private.definitive_manual_hours(sa.id, null) > 0
          and (s.date + s.start_time) at time zone 'Europe/Rome' < win.b
          and public.shift_ends_at(s.date, s.start_time, s.end_time) at time zone 'Europe/Rome' > win.a)
        -- timbratura approvata: l'intervallo è quello timbrato
        or (sa.worked_hours > 0 and r.id is not null and sa.attendance_reviewed_at is not null
          and t.clock_out_at is not null
          and t.clock_in_at < win.b and t.clock_out_at > win.a)
      )
  );
$function$;

revoke all on function private.absence_hours_conflict(uuid, date, time, time) from public, anon;

CREATE OR REPLACE FUNCTION public.get_workspace_absence_summary(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, ferie_days integer, permesso_days integer, permesso_hours numeric, malattia_days integer, inps_protocols text, ferie_hours numeric, malattia_hours numeric, permesso_recognized_hours numeric, conflict_hours numeric, missing_certificates integer)
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
    select a.member_id, a.kind, round(c.minutes / 60.0, 2) as hours,
           private.absence_credit_conflict(a.member_id, c.date) as conflict
      from clipped a join public.absence_hour_credits c on c.absence_id = a.id
     where c.date >= p_from and c.date < p_to
    union all
    select a.member_id, a.kind,
           round(extract(epoch from (a.end_time - a.start_time)) / 3600.0, 2),
           private.absence_hours_conflict(a.member_id, a.start_date, a.start_time, a.end_time)
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
    max(coalesce(c.permesso_hours, 0)), max(coalesce(c.conflict_hours, 0)),
    (count(*) filter (where a.kind = 'malattia'
       and nullif(btrim(a.inps_protocol), '') is null))::integer
    from clipped a join public.workspace_members m on m.id = a.member_id
    left join credit_totals c on c.member_id = a.member_id
   group by m.id, m.display_name order by m.display_name;
$function$
;
