-- Regole delle maggiorazioni (2026-11-04), punto 3 dell'export per il consulente.
-- Spec: docs/superpowers/specs/2026-11-04-maggiorazioni-design.md.
--
-- Quattro voci per azienda — notturno (con la sua fascia), domenica, festivi,
-- straordinario — ciascuna spenta (null) o con la sua percentuale. Le regole
-- sono **versioni mensili**: un mese usa l'ultima versione con `valid_from`
-- uguale o precedente al suo primo giorno, così cambiare una percentuale a
-- dicembre non riscrive novembre (decisione del 24/09). La percentuale
-- applicata a una riga è quella della versione del suo mese: è lo «snapshot»,
-- senza copiarlo su ogni riga.
--
-- Le scrive chiunque abbia «Ore» sull'azienda, anche su una sede sola: stessa
-- regola dei codici per il consulente (`private.can_workspace_hours`), scelta
-- del fondatore del 04/11 («non aggiungiamo troppa roba»).
--
-- Il **patrono** è una colonna della sede, senza versioni (stessa scelta di
-- semplicità): scriverlo vale anche per i mesi passati. Lo scrive chi ha «Ore»
-- su quella sede.
--
-- I festivi nazionali li conosce `private.italian_holiday`, Pasqua compresa.
-- Il 4 ottobre (San Francesco) è festa nazionale dal 2026, legge 151/2025.

create table public.workspace_surcharge_rules (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  valid_from date not null check (extract(day from valid_from) = 1),
  night_pct numeric(4,1) check (night_pct > 0 and night_pct <= 300),
  night_start time not null default '22:00',
  night_end time not null default '06:00',
  sunday_pct numeric(4,1) check (sunday_pct > 0 and sunday_pct <= 300),
  holiday_pct numeric(4,1) check (holiday_pct > 0 and holiday_pct <= 300),
  overtime_pct numeric(4,1) check (overtime_pct > 0 and overtime_pct <= 300),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, valid_from),
  check (night_start <> night_end)
);
-- Solo RPC: nessuna policy, nessun grant.
alter table public.workspace_surcharge_rules enable row level security;

alter table public.venues
  add column patron_day smallint,
  add column patron_month smallint,
  add constraint venues_patron_ck check (
    (patron_day is null and patron_month is null)
    or (patron_month between 1 and 12 and patron_day between 1 and
          extract(day from (make_date(2024, patron_month, 1) + interval '1 month - 1 day'))::int)
  );

-- I codici per il consulente accolgono le quattro voci.
alter table public.workspace_export_codes drop constraint workspace_export_codes_key_check;
alter table public.workspace_export_codes add constraint workspace_export_codes_key_check
  check (key in ('company', 'work', 'ferie', 'permesso', 'malattia', 'night', 'sunday', 'holiday', 'overtime'));

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

  -- Il salvataggio sostituisce l'insieme: una chiave assente o vuota sparisce.
  delete from public.workspace_export_codes c where c.workspace_id = p_workspace;
  insert into public.workspace_export_codes (workspace_id, key, code)
  select p_workspace, e.k, btrim(e.v #>> '{}')
    from jsonb_each(coalesce(p_codes, '{}'::jsonb)) as e(k, v)
   where btrim(coalesce(e.v #>> '{}', '')) <> '';
end;
$$;

-- Pasqua (algoritmo anonimo gregoriano, Meeus/Jones/Butcher).
create function private.easter_date(p_year int)
returns date language plpgsql immutable set search_path = '' as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
begin
  return make_date(p_year, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end;
$$;

-- Festivo nazionale italiano, o il patrono della sede.
create function private.italian_holiday(p_date date, p_venue uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_md text := to_char(p_date, 'MM-DD');
  v_easter date := private.easter_date(extract(year from p_date)::int);
begin
  if v_md in ('01-01', '01-06', '04-25', '05-01', '06-02', '08-15', '11-01', '12-08', '12-25', '12-26')
     or (v_md = '10-04' and p_date >= date '2026-01-01')
     or p_date = v_easter or p_date = v_easter + 1 then
    return true;
  end if;
  return exists (select 1 from public.venues v
                  where v.id = p_venue and v.patron_month = extract(month from p_date)
                    and v.patron_day = extract(day from p_date));
end;
$$;

-- La versione delle regole valida per il mese di `p_date` (nessuna riga prima
-- della prima versione).
create function private.surcharge_rules_at(p_workspace uuid, p_date date)
returns setof public.workspace_surcharge_rules
language sql stable security definer set search_path = '' as $$
  select r.* from public.workspace_surcharge_rules r
   where r.workspace_id = p_workspace
     and r.valid_from <= date_trunc('month', p_date)::date
   order by r.valid_from desc
   limit 1;
$$;

revoke all on function private.easter_date(int), private.italian_holiday(date, uuid),
  private.surcharge_rules_at(uuid, date) from public, anon, authenticated;

create function public.save_surcharge_rules(p_workspace uuid, p_valid_from date, p_rules jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_rules jsonb := coalesce(p_rules, '{}'::jsonb);
  v_key text;
  v_pct numeric;
  v_start time;
  v_end time;
begin
  perform private.assert_workspace_operational(p_workspace);
  if not private.can_workspace_hours(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if jsonb_typeof(v_rules) <> 'object' or p_valid_from is null
     or extract(day from p_valid_from) <> 1
     or p_valid_from < date '2020-01-01' or p_valid_from > date_trunc('month', now()) + interval '1 year' then
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
  begin
    v_start := coalesce(nullif(v_rules ->> 'night_start', ''), '22:00')::time;
    v_end := coalesce(nullif(v_rules ->> 'night_end', ''), '06:00')::time;
  exception when others then
    raise exception 'invalid_surcharge' using errcode = '22023';
  end;
  if v_start = v_end or extract(minute from v_start)::int % 15 <> 0 or extract(minute from v_end)::int % 15 <> 0
     or extract(second from v_start) <> 0 or extract(second from v_end) <> 0 then
    raise exception 'invalid_surcharge' using errcode = '22023';
  end if;

  insert into public.workspace_surcharge_rules
    (workspace_id, valid_from, night_pct, night_start, night_end, sunday_pct, holiday_pct, overtime_pct)
  values (p_workspace, p_valid_from,
          (v_rules ->> 'night_pct')::numeric, v_start, v_end,
          (v_rules ->> 'sunday_pct')::numeric, (v_rules ->> 'holiday_pct')::numeric,
          (v_rules ->> 'overtime_pct')::numeric)
  on conflict (workspace_id, valid_from) do update
    set night_pct = excluded.night_pct, night_start = excluded.night_start, night_end = excluded.night_end,
        sunday_pct = excluded.sunday_pct, holiday_pct = excluded.holiday_pct,
        overtime_pct = excluded.overtime_pct, updated_at = now();
end;
$$;

create function public.save_venue_patron(p_venue uuid, p_day int, p_month int)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_workspace uuid;
begin
  select v.workspace_id into v_workspace from public.venues v where v.id = p_venue;
  perform private.assert_workspace_operational(v_workspace);
  if p_venue not in (select private.venues_where('hours')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if (p_day is null) <> (p_month is null)
     or (p_month is not null and (p_month not between 1 and 12 or p_day < 1 or p_day >
           extract(day from (make_date(2024, p_month, 1) + interval '1 month - 1 day'))::int)) then
    raise exception 'invalid_patron' using errcode = '22023';
  end if;
  update public.venues v set patron_day = p_day, patron_month = p_month where v.id = p_venue;
end;
$$;

create function public.get_surcharge_rules(p_workspace uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.can_workspace_hours(p_workspace)
     or p_workspace not in (select private.commercial_readable_workspace_ids()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
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
        from public.workspace_surcharge_rules r where r.workspace_id = p_workspace), '[]'::jsonb),
    'patrons', coalesce((
      select jsonb_agg(jsonb_build_object('venue_id', v.id, 'day', v.patron_day, 'month', v.patron_month)
                       order by v.name)
        from public.venues v
       where v.workspace_id = p_workspace and v.patron_day is not null
         and v.id in (select private.venues_where('hours'))), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.save_surcharge_rules(uuid, date, jsonb), public.save_venue_patron(uuid, int, int),
  public.get_surcharge_rules(uuid) from public, anon;
grant execute on function public.save_surcharge_rules(uuid, date, jsonb), public.save_venue_patron(uuid, int, int),
  public.get_surcharge_rules(uuid) to authenticated;
