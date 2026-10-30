-- Chiusure che si ripetono (decisione del 30/10), come in Deputy e Skello:
-- - `repeat_yearly`: la stessa data ogni anno (Ferragosto, Natale, la chiusura
--   estiva). Si confronta per giorno e mese, anche a cavallo d'anno
--   (24/12 – 06/01). Gemello **manuale** di `closureCovers` in
--   src/features/venues/closures.ts.
-- - `venues.rest_days`: il riposo settimanale («chiuso il lunedì»), giorni ISO
--   1 = lunedì … 7 = domenica. Senza, andava inserito lunedì per lunedì.
--
-- In una migration a parte perché `20261030000300` era già uscita: una
-- migration applicata non si modifica (il remoto la salterebbe).

alter table public.venue_closures add column repeat_yearly boolean not null default false;

alter table public.venues add column rest_days smallint[] not null default '{}'
  check (rest_days <@ array[1,2,3,4,5,6,7]::smallint[]);

-- La firma cambia (un argomento in più): la vecchia va tolta, o PostgREST
-- avrebbe due funzioni con lo stesso nome.
drop function public.save_venue_closure(uuid, date, date, text);

create function public.save_venue_closure(
  p_venue uuid, p_start date, p_end date, p_reason text default null,
  p_repeat_yearly boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if not private.can_edit_closures(p_venue) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_start is null or p_end is null or p_end < p_start or p_end - p_start > 366
     or char_length(coalesce(p_reason, '')) > 80 then
    raise exception 'closure_invalid' using errcode = '22023';
  end if;
  -- Ogni anno: un periodo di un anno intero si ripeterebbe sopra sé stesso.
  if coalesce(p_repeat_yearly, false) and p_end - p_start >= 364 then
    raise exception 'closure_invalid' using errcode = '22023';
  end if;
  insert into public.venue_closures (venue_id, start_date, end_date, reason, repeat_yearly, created_by)
  values (p_venue, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''),
          coalesce(p_repeat_yearly, false), (select auth.uid()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Il riposo settimanale: un insieme di giorni ISO, sostituito per intero.
create function public.set_venue_rest_days(p_venue uuid, p_days smallint[])
returns public.venues language plpgsql security definer set search_path = '' as $$
declare v_row public.venues;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if not private.can_edit_closures(p_venue) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if not (coalesce(p_days, '{}') <@ array[1,2,3,4,5,6,7]::smallint[]) then
    raise exception 'closure_invalid' using errcode = '22023';
  end if;
  update public.venues
     set rest_days = array(select distinct d from unnest(coalesce(p_days, '{}')) d order by d)
   where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

revoke all on function public.save_venue_closure(uuid, date, date, text, boolean),
  public.set_venue_rest_days(uuid, smallint[]) from public, anon, authenticated;
grant execute on function public.save_venue_closure(uuid, date, date, text, boolean),
  public.set_venue_rest_days(uuid, smallint[]) to authenticated;
