-- Ore da sistemare: i turni conclusi le cui ore non contano ancora, uno per
-- persona, con il perché.
--
-- Il riepilogo (`get_workspace_hours_summary`) le metteva da parte senza dire
-- dove fossero: «3 h escluse», «2 da verificare». E una categoria non la
-- contava proprio: chi timbra dall'app e non ha timbrato affatto non era né
-- approvato, né da verificare, né escluso — le sue ore sparivano. Questa lista
-- dà nome e turno a ciascuna riga, così la pagina Ore porta dritto al turno da
-- sistemare (inserisci orari, inserisci uscita, approva).
--
-- ⚠️ Gemello di `get_workspace_hours_summary`: stesso perimetro (Ore, aziende
-- leggibili, turni conclusi e non annullati, presenze attive) e il complemento
-- esatto della sua condizione «conta» (`shifts_count`). Se cambia lì, cambia
-- qui; il test SQL 037 controlla che le due tornino.
--
--   kind = 'missing_out'  timbratura senza uscita
--          'to_approve'   timbratura completa da approvare
--          'not_clocked'  doveva timbrare e non c'è nessuna timbratura (anche
--                         con ore scritte a mano, che con la timbratura non
--                         contano)

create function public.get_hours_to_fix(p_workspace uuid, p_from date, p_to date)
returns table (
  assignment_id uuid, shift_id uuid, date date, start_time time, end_time time,
  title text, venue_id uuid, venue_name text, member_id uuid, member_name text,
  kind text, hours numeric
)
language sql stable security definer set search_path = '' as $$
  with scope as (
    select coalesce(array_agg(v.id), '{}'::uuid[]) as venue_ids from public.venues v
    where v.workspace_id in (select private.commercial_readable_workspace_ids())
      and v.workspace_id = p_workspace and v.id in (select private.venues_where('hours'))
  ), rows as (
    select a.id, a.worked_hours, a.hours_source, a.attendance_reviewed_at,
           s.id as shift_id, s.date, s.start_time, s.end_time, s.title,
           s.break_minutes, s.break_paid,
           v.id as venue_id, v.name as venue_name,
           coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
           vm.member_id, m.display_name,
           r.id as clock_record_id, t.clock_out_at
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
  )
  select r.id, r.shift_id, r.date, r.start_time, r.end_time, r.title,
         r.venue_id, r.venue_name, r.member_id, r.display_name,
         case
           when r.clock_record_id is not null and r.clock_out_at is null then 'missing_out'
           when r.clock_record_id is not null then 'to_approve'
           else 'not_clocked'
         end,
         case
           when r.clock_record_id is not null and r.clock_out_at is not null
             then private.clock_record_counted_hours(r.clock_record_id)
           else public.shift_counted_hours(r.start_time, r.end_time, r.break_minutes, r.break_paid)
         end
    from rows r
   -- Il complemento della condizione «conta» del riepilogo (`shifts_count`).
   -- `is not true` e non `not`: con `hours_source` nullo la condizione vale
   -- NULL, che il `filter` del riepilogo legge come «non conta» e un `not`
   -- lascerebbe NULL, cioè fuori anche da qui.
   where (
     (r.worked_hours is not null and
       (r.hours_source = 'manual' or (r.clock_record_id is not null
         and r.attendance_reviewed_at is not null and r.clock_out_at is not null)))
     or (r.worked_hours is null and r.clock_record_id is null and
       (r.hours_source = 'manual_auto' or
         (r.hours_source is null and r.effective_clock_method = 'manual')))
   ) is not true
   order by r.date, r.start_time, r.display_name;
$$;

revoke all on function public.get_hours_to_fix(uuid, date, date) from public, anon;
grant execute on function public.get_hours_to_fix(uuid, date, date) to authenticated;
