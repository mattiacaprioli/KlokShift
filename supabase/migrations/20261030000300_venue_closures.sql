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

create table public.venue_closures (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references public.venues (id) on delete cascade,
  start_date  date not null,
  end_date    date not null,
  reason      text check (reason is null or char_length(reason) <= 80),
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
  p_venue uuid, p_start date, p_end date, p_reason text default null
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
  insert into public.venue_closures (venue_id, start_date, end_date, reason, created_by)
  values (p_venue, p_start, p_end, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid()))
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

revoke all on function public.save_venue_closure(uuid, date, date, text),
  public.delete_venue_closure(uuid) from public, anon, authenticated;
grant execute on function public.save_venue_closure(uuid, date, date, text),
  public.delete_venue_closure(uuid) to authenticated;
