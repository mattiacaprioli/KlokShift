-- Il santo patrono esce dalle maggiorazioni (decisione del fondatore, 22/11).
--
-- Contava un giorno all'anno per sede, il consulente lo conosce già e lo
-- gestisce da sé, e — senza versioni — cambiarlo riscriveva le ore festive dei
-- mesi già consegnati. Nessuna sede l'aveva impostato. I festivi nazionali
-- restano automatici (`private.italian_holiday`).
--
-- `italian_holiday` tiene la firma `(date, uuid)`: la chiama
-- `private.workspace_surcharge_rows` per ogni riga, e la sede ora non conta.

CREATE OR REPLACE FUNCTION private.italian_holiday(p_date date, p_venue uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_md text := to_char(p_date, 'MM-DD');
  v_easter date := private.easter_date(extract(year from p_date)::int);
begin
  -- `p_venue` non serve più (era il patrono della sede): resta per la firma.
  return v_md in ('01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26')
     or (v_md = '10-04' and p_date >= date '2026-01-01')
     or p_date = v_easter or p_date = v_easter + 1;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_surcharge_rules(p_workspace uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.can_workspace_hours(p_workspace)
     or p_workspace not in (select private.commercial_readable_workspace_ids()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Niente più `patrons`: le app già installate lo leggono come lista vuota.
  return jsonb_build_object(
    'versions', coalesce((
      select jsonb_agg(jsonb_build_object(
               'valid_from', to_char(r.valid_from, 'YYYY-MM-DD'),
               'night_pct', r.night_pct,
               'night_start', to_char(r.night_start, 'HH24:MI'),
               'night_end', to_char(r.night_end, 'HH24:MI'),
               'sunday_pct', r.sunday_pct,
               'holiday_pct', r.holiday_pct,
               'overtime_pct', r.overtime_pct) order by r.valid_from)
        from public.workspace_surcharge_rules r where r.workspace_id = p_workspace), '[]'::jsonb)
  );
end;
$function$;

DROP FUNCTION public.save_venue_patron(uuid, int, int);

ALTER TABLE public.venues
  DROP CONSTRAINT venues_patron_ck,
  DROP COLUMN patron_day,
  DROP COLUMN patron_month;
