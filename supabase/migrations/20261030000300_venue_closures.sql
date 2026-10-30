-- Giorni di chiusura della sede (decisione del 30/10): Ferragosto, chiusura per
-- ferie, giorno di riposo straordinario, lavori. Si devono sapere da tutti —
-- chi pianifica i turni e chi li fa — e si vedono nei Turni di entrambi.
--
-- Un turno in un giorno di chiusura **non** è vietato: il form avvisa e lascia
-- fare, perché a volte si apre per un'eccezione (un evento privato,
-- l'inventario). È la stessa linea di «Già in turno»: avviso, mai blocco.
--
-- Per sede e per intervallo di date (estremi compresi). Le legge chi vede la
-- sede (stessa regola di `venues`); le scrive chi ha «Turni» o «Dati della
-- sede», solo dalle RPC.
--
-- Due modi di ripetersi, come in Deputy e Skello:
-- - `repeat_yearly`: la stessa data ogni anno (Ferragosto, Natale, la chiusura
--   estiva). Si confronta per giorno e mese, anche a cavallo d'anno
--   (24/12 – 06/01). Gemello **manuale** di `closureCovers` in
--   src/features/venues/closures.ts.
-- - `venues.rest_days`: il giorno di riposo settimanale («chiuso il lunedì»),
--   giorni ISO 1 = lunedì … 7 = domenica. Senza, andava inserito lunedì per
--   lunedì.

create table public.venue_closures (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      text check (reason is null or char_length(reason) <= 80),
  repeat_yearly boolean not null default false,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  check (end_date >= start_date and end_date - start_date <= 366)
);

create index venue_closures_venue_dates on public.venue_closures (venue_id, start_date, end_date);

alter table public.venue_closures enable row level security;
grant select on public.venue_closures to authenticated;

create policy "venue_closures: who sees the venue reads" on public.venue_closures
  for select to authenticated
  using (venue_id in (select private.venues_where('any'))
         or venue_id in (select private.my_work_venue_ids()));

create policy "commercial archive read" on public.venue_closures as restrictive
  for select to authenticated
  using (venue_id in (select private.commercial_readable_venue_ids()));

create function private.can_edit_closures(p_venue uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_venue is not null and (private.can(p_venue, 'shifts') or private.can(p_venue, 'venue'));
$$;
revoke all on function private.can_edit_closures(uuid) from public, anon, authenticated;

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
  -- Ogni anno: un periodo più lungo di un anno si ripeterebbe sopra sé stesso.
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

create function public.delete_venue_closure(p_closure uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_venue uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select c.venue_id into v_venue from public.venue_closures c where c.id = p_closure;
  -- Inesistente o di un'altra azienda: lo stesso errore.
  if v_venue is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(v_venue));
  if not private.can_edit_closures(v_venue) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  delete from public.venue_closures where id = p_closure;
end;
$$;

-- Il riposo settimanale: un insieme di giorni ISO, sostituito per intero.
alter table public.venues add column rest_days smallint[] not null default '{}'
  check (rest_days <@ array[1,2,3,4,5,6,7]::smallint[]);

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
  public.delete_venue_closure(uuid), public.set_venue_rest_days(uuid, smallint[])
  from public, anon, authenticated;
grant execute on function public.save_venue_closure(uuid, date, date, text, boolean),
  public.delete_venue_closure(uuid), public.set_venue_rest_days(uuid, smallint[])
  to authenticated;
