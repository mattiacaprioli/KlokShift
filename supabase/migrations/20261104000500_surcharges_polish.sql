-- Rifiniture delle maggiorazioni e dei codici per il consulente (2026-11-04),
-- dopo la revisione finale del punto 3.
--
-- - `workspace_surcharge_rows`: le ore «di cui» stanno sulle ore della riga
--   **come le vede chi legge** (il suo perimetro), non su quelle calcolate con
--   tutte le sedi: `definitive_manual_hours` toglie i turni sovrapposti delle
--   sedi nel perimetro, e chi ha «Ore» su una sede sola vedeva un «di cui»
--   calcolato su ore diverse dalle sue. La soglia dello straordinario resta su
--   tutte le sedi. Le righe fuori dal perimetro non si classificano più (si
--   contano solo per lo straordinario), e l'intervallo nullo si salta dopo aver
--   contato le ore.
-- - `save_export_codes`: tocca solo le chiavi mandate (vuoto = cancella), così
--   un modulo vecchio che non conosce le chiavi delle maggiorazioni non le
--   cancella.
-- - `save_surcharge_rules`: rifiuta chiavi sconosciute e «24:00».
-- - `save_venue_patron`: `private.can` invece di `not in (select …)`, che con
--   una sede inesistente non dava errore da sé.

CREATE OR REPLACE FUNCTION private.workspace_surcharge_rows(p_workspace uuid, p_from date, p_to date)
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
  v_ratio_out numeric;
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
    select h.*, hr.contract_hours, hr.contract_period, sc.approved_hours as scoped_hours,
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
      -- Le ore della riga come le vede chi legge (il suo perimetro): la base
      -- delle maggiorazioni che vede. Null = fuori dal suo perimetro.
      left join private.workspace_hour_rows(p_workspace, v_from, v_to) sc
        on sc.assignment_id = h.assignment_id and sc.counted
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
    v_counted := r.approved_hours * 60;

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
    continue when r.scoped_hours is null or r.scoped_hours <= 0;
    v_gross := extract(epoch from (r.t_out - r.t_in)) / 60;
    continue when v_gross <= 0;
    -- `v_ratio` sulle ore di tutte le sedi (la coda dello straordinario),
    -- `v_ratio_out` su quelle che vede chi legge (le ore in uscita).
    v_ratio := v_counted / v_gross;
    v_ratio_out := r.scoped_hours * 60 / v_gross;
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

    h_night := round(m_night * v_ratio_out / 60, 2);
    h_sunday := round(m_sunday * v_ratio_out / 60, 2);
    h_holiday := round(m_holiday * v_ratio_out / 60, 2);
    h_overtime := round(m_overtime * v_ratio_out / 60, 2);
    v_excess := h_night + h_sunday + h_holiday + h_overtime - r.scoped_hours;
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


CREATE OR REPLACE FUNCTION public.save_export_codes(p_workspace uuid, p_codes jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_key text;
  v_code text;
begin
  perform private.assert_workspace_operational(p_workspace);
  if not private.can_workspace_hours(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_codes, '{}'::jsonb)) <> 'object' then
    raise exception 'invalid_code' using errcode = '22023';
  end if;
  for v_key, v_code in select k, btrim(coalesce(v #>> '{}', '')) from jsonb_each(coalesce(p_codes, '{}'::jsonb)) as e(k, v) loop
    if v_key not in ('company', 'work', 'ferie', 'permesso', 'malattia', 'night', 'sunday', 'holiday', 'overtime')
       or length(v_code) > 20 then
      raise exception 'invalid_code' using errcode = '22023';
    end if;
  end loop;

  -- Solo le chiavi mandate: vuota = cancellata, le altre restano.
  delete from public.workspace_export_codes c
   where c.workspace_id = p_workspace
     and c.key in (select k from jsonb_object_keys(coalesce(p_codes, '{}'::jsonb)) as k);
  insert into public.workspace_export_codes (workspace_id, key, code)
  select p_workspace, e.k, btrim(e.v #>> '{}')
    from jsonb_each(coalesce(p_codes, '{}'::jsonb)) as e(k, v)
   where btrim(coalesce(e.v #>> '{}', '')) <> '';
end;
$$;

CREATE OR REPLACE FUNCTION public.save_surcharge_rules(p_workspace uuid, p_valid_from date, p_rules jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb := coalesce(p_rules, '{}'::jsonb);
  v_key text;
  v_pct numeric;
  v_start text;
  v_end text;
begin
  perform private.assert_workspace_operational(p_workspace);
  if not private.can_workspace_hours(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(v_rules) <> 'object' or p_valid_from is null
     or extract(day from p_valid_from) <> 1
     or p_valid_from < date '2020-01-01' or p_valid_from > date_trunc('month', now()) + interval '1 year'
     or exists (select 1 from jsonb_object_keys(v_rules) k
                 where k not in ('night_pct', 'night_start', 'night_end', 'sunday_pct', 'holiday_pct', 'overtime_pct')) then
    raise exception 'invalid_surcharge' using errcode = '22023';
  end if;
  foreach v_key in array array['night_pct', 'sunday_pct', 'holiday_pct', 'overtime_pct'] loop
    if v_rules ? v_key and jsonb_typeof(v_rules -> v_key) <> 'null' then
      if jsonb_typeof(v_rules -> v_key) <> 'number' then
        raise exception 'invalid_surcharge' using errcode = '22023';
      end if;
      v_pct := (v_rules ->> v_key)::numeric;
      if v_pct <= 0 or v_pct > 300 or v_pct <> round(v_pct, 1) then
        raise exception 'invalid_surcharge' using errcode = '22023';
      end if;
    end if;
  end loop;
  -- Al quarto d'ora, da 00:00 a 23:45: niente «24:00».
  v_start := coalesce(nullif(v_rules ->> 'night_start', ''), '22:00');
  v_end := coalesce(nullif(v_rules ->> 'night_end', ''), '06:00');
  if v_start !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$' or v_end !~ '^([01][0-9]|2[0-3]):(00|15|30|45)$'
     or v_start = v_end then
    raise exception 'invalid_surcharge' using errcode = '22023';
  end if;

  insert into public.workspace_surcharge_rules
    (workspace_id, valid_from, night_pct, night_start, night_end, sunday_pct, holiday_pct, overtime_pct)
  values (p_workspace, p_valid_from,
          (v_rules ->> 'night_pct')::numeric, v_start::time, v_end::time,
          (v_rules ->> 'sunday_pct')::numeric, (v_rules ->> 'holiday_pct')::numeric,
          (v_rules ->> 'overtime_pct')::numeric)
  on conflict (workspace_id, valid_from) do update
    set night_pct = excluded.night_pct, night_start = excluded.night_start, night_end = excluded.night_end,
        sunday_pct = excluded.sunday_pct, holiday_pct = excluded.holiday_pct,
        overtime_pct = excluded.overtime_pct, updated_at = now();
end;
$$;

CREATE OR REPLACE FUNCTION public.save_venue_patron(p_venue uuid, p_day int, p_month int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
begin
  select v.workspace_id into v_workspace from public.venues v where v.id = p_venue;
  if v_workspace is null or not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(v_workspace);
  if (p_day is null) <> (p_month is null)
     or (p_month is not null and (p_month not between 1 and 12 or p_day < 1 or p_day >
           extract(day from (make_date(2024, p_month, 1) + interval '1 month - 1 day'))::int)) then
    raise exception 'invalid_patron' using errcode = '22023';
  end if;
  update public.venues v set patron_day = p_day, patron_month = p_month where v.id = p_venue;
end;
$$;
