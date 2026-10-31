-- Capacità futura di un cambio di piano in attesa: con una riga aperta
-- (in attesa o già inviata) sull'abbonamento aperto dell'azienda, le persone e
-- le sedi non possono crescere oltre ciò che entrerà al rinnovo. Uscire e
-- chiudere restano sempre possibili.

-- {people: 30|null, venues: 1 + sedi in più d'arrivo}, o null senza riga aperta.
create function private.billing_future_limits(p_workspace uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'people', case when c.target_plan = 'base' then 30 end,
    'venues', 1 + c.target_extra_venues)
  from public.billing_subscriptions s
  cross join lateral private.billing_open_scheduled_change(s.id) c
  where s.workspace_id = p_workspace and s.status <> 'canceled' and c.id is not null
  limit 1
$$;
revoke all on function private.billing_future_limits(uuid) from public, anon, authenticated;

-- Copia di private.check_commercial_capacity da 20261005000200_commercial_enforcement.sql
-- con i controlli sulla capacità futura aggiunti dopo quelli esistenti. Stesso
-- nome e firma: i trigger su venues e venue_members restano quelli di prima.
create or replace function private.check_commercial_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid; a jsonb; previous_people bigint; previous_venues bigint; future jsonb;
begin
  ws := new.workspace_id;
  if tg_when = 'BEFORE' then
    perform private.lock_commercial_workspace(ws);
    -- Il conteggio prima viene ricostruito nell'AFTER dalla riga OLD/NEW.
    return new;
  end if;
  a := private.workspace_access_at(ws, clock_timestamp());
  if a->>'state' = 'migration_pending' then return new; end if;
  previous_people := (a#>>'{usage,people}')::bigint;
  previous_venues := (a#>>'{usage,venues}')::bigint;
  if tg_table_name = 'venues' then
    if new.closed_at is not null or (tg_op = 'UPDATE' and old.closed_at is null) then return new; end if;
    previous_venues := previous_venues - 1;
    -- Persone che contano soltanto grazie alla sede appena riaperta.
    previous_people := previous_people - (select count(distinct m.id)
      from public.workspace_members m join public.venue_members vm on vm.member_id = m.id
      where vm.venue_id = new.id and vm.left_at is null and m.status in ('active','invited')
        and not exists (select 1 from public.venue_members other_vm join public.venues other_v on other_v.id = other_vm.venue_id
          where other_vm.member_id = m.id and other_vm.left_at is null and other_v.closed_at is null and other_v.id <> new.id));
    if a->>'state' = 'setup' and tg_op = 'INSERT' and previous_venues = 0
       and not exists (select 1 from public.workspace_access_periods where workspace_id = ws)
       and not exists (select 1 from public.workspace_commercial_state where workspace_id = ws and trial_started_at is not null) then
      return new; -- una sola prima sede, ancora nessuna operatività
    end if;
  else
    if new.left_at is not null or (tg_op = 'UPDATE' and old.left_at is null) then return new; end if;
    if not exists (select 1 from public.workspace_members m join public.venues v on v.id = new.venue_id
      where m.id = new.member_id and m.status in ('active','invited') and v.closed_at is null) then return new; end if;
    if not exists (select 1 from public.venue_members vm join public.venues v on v.id = vm.venue_id
      where vm.member_id = new.member_id and vm.left_at is null and v.closed_at is null and vm.id <> new.id) then
      previous_people := previous_people - 1;
    end if;
  end if;
  if not (a->>'can_operate')::boolean then raise exception 'workspace_read_only' using errcode = '42501'; end if;
  if (a#>>'{usage,venues}')::bigint > previous_venues
     and (a#>>'{usage,venues}')::bigint > (a#>>'{limits,venues}')::bigint then
    raise exception 'workspace_venue_capacity' using errcode = '23514';
  end if;
  if (a#>>'{usage,people}')::bigint > previous_people
     and a#>>'{limits,people}' is not null
     and (a#>>'{usage,people}')::bigint > (a#>>'{limits,people}')::bigint then
    raise exception 'workspace_people_capacity' using errcode = '23514';
  end if;
  -- Capacità futura: con un cambio di piano in attesa si cresce solo dentro
  -- ciò che entrerà al rinnovo, con la stessa regola «cresce e supera».
  future := private.billing_future_limits(ws);
  if future is not null then
    if (a#>>'{usage,venues}')::bigint > previous_venues
       and (a#>>'{usage,venues}')::bigint > (future->>'venues')::bigint then
      raise exception 'workspace_venue_capacity_scheduled' using errcode = '23514';
    end if;
    if (a#>>'{usage,people}')::bigint > previous_people
       and future->>'people' is not null
       and (a#>>'{usage,people}')::bigint > (future->>'people')::bigint then
      raise exception 'workspace_people_capacity_scheduled' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
