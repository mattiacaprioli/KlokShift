-- Malattie senza certificato nel riepilogo assenze del mese (2026-10-31).
--
-- La pagina Assenze non ha più il riquadro «Da completare»: l'avviso sta nella
-- pagina Ore, prima dell'export, dove il certificato mancante serve davvero (al
-- consulente). La pagina Ore la apre anche chi ha solo il permesso Ore, che le
-- singole assenze non le legge: il conteggio lo dà questa funzione, che già
-- riassume le assenze per persona.
--
-- Il corpo è quello di 20261005000500_commercial_archive_reads (con il confine
-- commerciale), più la colonna `missing_certificates`. Cambia il tipo di
-- ritorno, quindi drop + create e la grant di nuovo.

drop function public.get_workspace_absence_summary(uuid, date, date);
CREATE FUNCTION public.get_workspace_absence_summary(p_workspace uuid, p_from date, p_to date)
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
    max(coalesce(c.permesso_hours, 0)), max(coalesce(c.conflict_hours, 0)),
    (count(*) filter (where a.kind = 'malattia'
       and nullif(btrim(a.inps_protocol), '') is null))::integer
    from clipped a join public.workspace_members m on m.id = a.member_id
    left join credit_totals c on c.member_id = a.member_id
   group by m.id, m.display_name order by m.display_name;
$function$
;
grant execute on function public.get_workspace_absence_summary(uuid, date, date) to authenticated;
