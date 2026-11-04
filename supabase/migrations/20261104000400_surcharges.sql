-- Maggiorazioni calcolate (2026-11-04), punto 3 dell'export per il consulente.
-- Spec: docs/superpowers/specs/2026-11-04-maggiorazioni-design.md.
--
-- `private.workspace_surcharge_rows` è la **fonte unica** delle maggiorazioni:
-- pagina Ore, CSV e PDF leggono `get_workspace_surcharges`, mai un calcolo
-- loro. Lavora sulle stesse righe delle ore (`workspace_hour_rows_in`): chi
-- cambia cosa conta lì cambia anche le maggiorazioni.
--
-- Per ogni riga che conta:
-- - l'intervallo è quello che il giornaliero mostra (timbratura che conta,
--   altrimenti il turno), in ora di Roma;
-- - le ore che contano possono essere meno dell'intervallo (pausa non
--   retribuita, correzione a mano) e la pausa non dice dove cade: ogni minuto
--   dell'intervallo vale `ore che contano / durata`, così le voci di una riga
--   non superano mai le sue ore;
-- - una voce per minuto, la più alta; a parità festivi > domenica >
--   straordinario > notturno;
-- - lo straordinario sono i minuti contati oltre le ore da contratto nel
--   periodo del contratto (giorno, settimana ISO, mese), gli ultimi in ordine di
--   tempo, su **tutte** le sedi dell'azienda: il contratto è della persona, e
--   chi ha «Ore» su una sede sola altrimenti vedrebbe un conto sbagliato. Chi
--   legge vede comunque solo le righe delle sue sedi;
-- - la versione delle regole è quella del mese della data del turno;
-- - ore al centesimo per riga e voce; il centesimo oltre le ore della riga si
--   toglie alla voce più grande.
--
-- `workspace_hour_rows` diventa `workspace_hour_rows_in` con il perimetro come
-- parametro: stesso corpo, stesse colonne, stessi risultati per chi legge.

CREATE FUNCTION private.workspace_hour_rows_in(p_workspace uuid, p_from date, p_to date, p_venue_ids uuid[])
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
    where v.workspace_id in (select private.commercial_readable_workspace_ids()) and v.workspace_id = p_workspace and v.id = any(p_venue_ids)
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


revoke all on function private.workspace_hour_rows_in(uuid, date, date, uuid[]) from public, anon;

CREATE OR REPLACE FUNCTION private.workspace_hour_rows(p_workspace uuid, p_from date, p_to date)
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
  select * from private.workspace_hour_rows_in(p_workspace, p_from, p_to,
    array(select private.venues_where('hours')));
$function$;

-- C'è almeno una voce accesa in una versione che vale prima di `p_to`? Senza,
-- la pagina Ore non rifà il conto delle ore (quasi tutte le aziende, oggi).
create function private.surcharges_active(p_workspace uuid, p_to date)
returns boolean language sql stable security definer set search_path = '' as $function$
  select exists (select 1 from public.workspace_surcharge_rules r
                  where r.workspace_id = p_workspace and r.valid_from < p_to
                    and coalesce(r.night_pct, r.sunday_pct, r.holiday_pct, r.overtime_pct) is not null);
$function$;
revoke all on function private.surcharges_active(uuid, date) from public, anon;

create function private.workspace_surcharge_rows(p_workspace uuid, p_from date, p_to date)
returns table(assignment_id uuid, member_id uuid, member_name text, venue_id uuid, venue_name text,
              date date, title text, clock_in text, clock_out text, kind text, percentage numeric,
              hours numeric)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
declare
  -- Periodi interi: lo straordinario di una settimana a cavallo di due mesi
  -- dipende anche dai giorni fuori dal periodo chiesto.
  v_from date := least(date_trunc('month', p_from)::date, date_trunc('week', p_from)::date);
  v_to date := greatest((date_trunc('month', p_to - 1) + interval '1 month')::date,
                        (date_trunc('week', p_to - 1) + interval '7 days')::date);
  r record;
  v_rules public.workspace_surcharge_rules;
  v_member uuid;
  v_key date;
  v_period date;
  v_cum numeric := 0;
  v_gross numeric;
  v_counted numeric;
  v_ratio numeric;
  v_ot numeric;
  v_ot_start timestamptz;
  v_points timestamptz[];
  v_day date;
  v_a timestamptz;
  v_b timestamptz;
  v_local timestamp;
  v_t time;
  v_best text;
  v_best_pct numeric;
  v_seg numeric;
  m_night numeric; m_sunday numeric; m_holiday numeric; m_overtime numeric;
  h_night numeric; h_sunday numeric; h_holiday numeric; h_overtime numeric;
  v_excess numeric;
  v_kind text;
begin
  if not private.surcharges_active(p_workspace, p_to) then
    return;
  end if;
  for r in
    select h.*, hr.contract_hours, hr.contract_period,
           case when h.clock_in_at is not null and not h.to_review and h.clock_out_at is not null
                then h.clock_in_at
                else (h.date + h.start_time) at time zone 'Europe/Rome' end as t_in,
           case when h.clock_in_at is not null and not h.to_review and h.clock_out_at is not null
                then h.clock_out_at
                else ((h.date + case when h.end_time <= h.start_time then 1 else 0 end) + h.end_time)
                       at time zone 'Europe/Rome' end as t_out,
           case when h.clock_in_at is not null and not h.to_review and h.clock_out_at is not null
                then to_char(h.clock_in_at at time zone 'Europe/Rome', 'HH24:MI')
                else to_char(h.start_time, 'HH24:MI') end as t_in_label,
           case when h.clock_in_at is not null and not h.to_review and h.clock_out_at is not null
                then to_char(h.clock_out_at at time zone 'Europe/Rome', 'HH24:MI')
                else to_char(h.end_time, 'HH24:MI') end as t_out_label
      from private.workspace_hour_rows_in(p_workspace, v_from, v_to,
             array(select v.id from public.venues v where v.workspace_id = p_workspace)) h
      left join public.member_hr hr on hr.member_id = h.member_id
     where h.counted and h.approved_hours > 0
     -- Per periodo del contratto e poi per inizio: un turno del giorno dopo
     -- timbrato prima della mezzanotte non deve azzerare il conto del giorno.
     order by h.member_id,
              case hr.contract_period
                when 'day' then h.date
                when 'week' then date_trunc('week', h.date)::date
                when 'month' then date_trunc('month', h.date)::date end,
              t_in, h.assignment_id
  loop
    v_gross := extract(epoch from (r.t_out - r.t_in)) / 60;
    continue when v_gross <= 0;
    v_counted := r.approved_hours * 60;
    v_ratio := v_counted / v_gross;

    -- Straordinario: i minuti contati oltre la soglia, in coda alla riga.
    v_ot := 0;
    if r.contract_hours is not null and r.contract_period is not null then
      v_period := case r.contract_period
                    when 'day' then r.date
                    when 'week' then date_trunc('week', r.date)::date
                    else date_trunc('month', r.date)::date end;
      if v_member is distinct from r.member_id or v_key is distinct from v_period then
        v_cum := 0;
      end if;
      v_member := r.member_id;
      v_key := v_period;
      v_ot := greatest(0, least(v_counted, v_cum + v_counted - r.contract_hours * 60));
      v_cum := v_cum + v_counted;
    end if;

    continue when r.date < p_from or r.date >= p_to;
    select * into v_rules from private.surcharge_rules_at(p_workspace, r.date);
    continue when not found;
    if v_rules.overtime_pct is null then
      v_ot := 0;
    end if;
    v_ot_start := r.t_out - make_interval(secs => (v_ot / v_ratio) * 60);

    -- Punti di rottura: mezzanotti, bordi della fascia notturna, inizio dello
    -- straordinario. Fra due punti le voci attive non cambiano.
    v_points := array[r.t_in, r.t_out];
    for v_day in
      select g::date from generate_series(((r.t_in at time zone 'Europe/Rome')::date - 1)::timestamp,
                                          (r.t_out at time zone 'Europe/Rome')::date::timestamp,
                                          interval '1 day') g
    loop
      v_points := v_points || (v_day::timestamp at time zone 'Europe/Rome');
      if v_rules.night_pct is not null then
        v_points := v_points || ((v_day + v_rules.night_start) at time zone 'Europe/Rome')
                             || ((v_day + v_rules.night_end) at time zone 'Europe/Rome');
      end if;
    end loop;
    if v_ot > 0 then
      v_points := v_points || v_ot_start;
    end if;

    m_night := 0; m_sunday := 0; m_holiday := 0; m_overtime := 0;
    v_a := null;
    for v_b in select distinct p from unnest(v_points) p where p >= r.t_in and p <= r.t_out order by p loop
      if v_a is not null and v_b > v_a then
        v_local := v_a at time zone 'Europe/Rome';
        v_t := v_local::time;
        v_best := null;
        v_best_pct := 0;
        -- In ordine di parità: a percentuale uguale resta la prima.
        if v_rules.holiday_pct is not null and private.italian_holiday(v_local::date, r.venue_id) then
          v_best := 'holiday'; v_best_pct := v_rules.holiday_pct;
        end if;
        if v_rules.sunday_pct is not null and extract(isodow from v_local) = 7
           and v_rules.sunday_pct > v_best_pct then
          v_best := 'sunday'; v_best_pct := v_rules.sunday_pct;
        end if;
        if v_ot > 0 and v_a >= v_ot_start and v_rules.overtime_pct > v_best_pct then
          v_best := 'overtime'; v_best_pct := v_rules.overtime_pct;
        end if;
        if v_rules.night_pct is not null and v_rules.night_pct > v_best_pct
           and (case when v_rules.night_start < v_rules.night_end
                     then v_t >= v_rules.night_start and v_t < v_rules.night_end
                     else v_t >= v_rules.night_start or v_t < v_rules.night_end end) then
          v_best := 'night'; v_best_pct := v_rules.night_pct;
        end if;
        v_seg := extract(epoch from (v_b - v_a)) / 60;
        case v_best
          when 'holiday' then m_holiday := m_holiday + v_seg;
          when 'sunday' then m_sunday := m_sunday + v_seg;
          when 'overtime' then m_overtime := m_overtime + v_seg;
          when 'night' then m_night := m_night + v_seg;
          else null;
        end case;
      end if;
      v_a := v_b;
    end loop;

    h_night := round(m_night * v_ratio / 60, 2);
    h_sunday := round(m_sunday * v_ratio / 60, 2);
    h_holiday := round(m_holiday * v_ratio / 60, 2);
    h_overtime := round(m_overtime * v_ratio / 60, 2);
    v_excess := h_night + h_sunday + h_holiday + h_overtime - r.approved_hours;
    if v_excess > 0 then
      -- Alla voce più grande; a parità nell'ordine festivi, domenica,
      -- straordinario, notturno.
      if h_holiday >= greatest(h_sunday, h_overtime, h_night) then h_holiday := h_holiday - v_excess;
      elsif h_sunday >= greatest(h_overtime, h_night) then h_sunday := h_sunday - v_excess;
      elsif h_overtime >= h_night then h_overtime := h_overtime - v_excess;
      else h_night := h_night - v_excess;
      end if;
    end if;

    assignment_id := r.assignment_id;
    member_id := r.member_id;
    member_name := r.member_name;
    venue_id := r.venue_id;
    venue_name := r.venue_name;
    date := r.date;
    title := r.title;
    clock_in := r.t_in_label;
    clock_out := r.t_out_label;
    foreach v_kind in array array['night', 'sunday', 'holiday', 'overtime'] loop
      kind := v_kind;
      percentage := case v_kind when 'night' then v_rules.night_pct when 'sunday' then v_rules.sunday_pct
                                when 'holiday' then v_rules.holiday_pct else v_rules.overtime_pct end;
      hours := case v_kind when 'night' then h_night when 'sunday' then h_sunday
                           when 'holiday' then h_holiday else h_overtime end;
      if hours > 0 then
        return next;
      end if;
    end loop;
  end loop;
end;
$function$;

revoke all on function private.workspace_surcharge_rows(uuid, date, date) from public, anon;

create function public.get_workspace_surcharges(p_workspace uuid, p_from date, p_to date)
returns table(member_id uuid, member_name text, date date, venue_name text, title text,
              clock_in text, clock_out text, kind text, percentage numeric, hours numeric)
language plpgsql stable security definer set search_path = '' as $function$
#variable_conflict use_column
begin
  if not private.can_workspace_hours(p_workspace)
     or p_workspace not in (select private.commercial_readable_workspace_ids()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not private.surcharges_active(p_workspace, p_to) then
    return;
  end if;
  return query
  select u.member_id, u.member_name, u.date, u.venue_name, u.title, u.clock_in, u.clock_out,
         u.kind, u.percentage, u.hours
    from (
      select s.member_id, s.member_name, s.date, s.venue_name, s.title, s.clock_in, s.clock_out,
             s.kind, s.percentage, s.hours
        from private.workspace_surcharge_rows(p_workspace, p_from, p_to) s
       where s.venue_id in (select private.venues_where('hours'))
      union all
      -- I dipendenti senza ore da contratto, quando lo straordinario è acceso
      -- in almeno un mese del periodo: per l'avviso della pagina Ore.
      select distinct h.member_id, h.member_name, null::date, null::text, null::text, null::text,
             null::text, 'no_contract'::text, null::numeric, null::numeric
        from private.workspace_hour_rows(p_workspace, p_from, p_to) h
        join public.workspace_members m on m.id = h.member_id
        left join public.member_hr hr on hr.member_id = h.member_id
       where h.counted and m.authority = 'none'
         and (hr.contract_hours is null or hr.contract_period is null)
         and exists (select 1 from generate_series(date_trunc('month', p_from), (p_to - 1)::timestamp,
                                                   interval '1 month') g
                      where exists (select 1 from private.surcharge_rules_at(p_workspace, g::date) x
                                     where x.overtime_pct is not null))
    ) u
   order by u.member_name, u.member_id, u.date nulls last, u.clock_in,
            array_position(array['night', 'sunday', 'holiday', 'overtime', 'no_contract'], u.kind), u.percentage;
end;
$function$;

revoke all on function public.get_workspace_surcharges(uuid, date, date) from public, anon;
grant execute on function public.get_workspace_surcharges(uuid, date, date) to authenticated;
