-- Rinnovo non riuscito: il periodo aperto da Paddle prima dell'incasso non è pagato.
--
-- Prova sandbox del 19/10 (carta che rifiuta i rinnovi): Paddle manda prima
-- `subscription.updated` con `status: active` e il periodo nuovo, poi, 3 s dopo,
-- `subscription.past_due`. Il primo avviso apriva un mese pagato; la tolleranza
-- di 7 giorni partiva poi dalla fine di quel mese. Un cliente che non pagava
-- avrebbe avuto un mese e sette giorni invece di sette giorni.
--
-- Ora, con `past_due`, i periodi `subscription` dal nuovo inizio si annullano
-- (revoked_at = starts_at), la tolleranza parte dall'ultimo periodo pagato e
-- una tolleranza nata più avanti si annulla. Se il pagamento viene recuperato,
-- l'avviso `active` riapre lo stesso periodo invece di trovarlo occupato.
-- Prima dell'avviso `past_due` il periodo esiste per pochi secondi: come il
-- margine di rinnovo, non è un diritto in più.
--
-- Copia integrale di billing_sync_periods da 20261019000200_billing_refunds.sql.

create or replace function private.billing_sync_periods(p_subscription uuid, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.billing_subscriptions;
  last_paid public.workspace_access_periods;
  last_end timestamptz;
  v_limit integer;
  v_start timestamptz;
  v_cut timestamptz;
  v_reason text;
begin
  select * into strict s from public.billing_subscriptions where id = p_subscription;
  v_limit := 1 + s.extra_venues;
  v_reason := format('Abbonamento Paddle %s (%s)', s.provider_subscription_id, s.environment);

  select * into last_paid from public.workspace_access_periods p
   where p.subscription_id = p_subscription and p.kind = 'subscription'
     and (p.revoked_at is null or p.revoked_at > p.starts_at)
   order by p.starts_at desc, p.created_at desc, p.id desc limit 1;
  if last_paid.id is not null then
    last_end := least(last_paid.ends_at, coalesce(last_paid.revoked_at, last_paid.ends_at));
  end if;

  if s.status = 'active' then
    if s.refunded_until is not null and s.current_period_ends_at <= s.refunded_until then
      -- Periodo rimborsato: un avviso successivo dello stesso periodo (aumento,
      -- disdetta programmata, metodo di pagamento) non lo riapre. Un rinnovo
      -- pagato dopo il rimborso porta un periodo nuovo e passa dal ramo sotto.
      null;
    elsif last_paid.id is null or s.current_period_starts_at >= last_end then
      -- Primo pagamento, rinnovo o ripresa: un nuovo periodo pagato.
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do update
        set plan = excluded.plan, venue_limit = excluded.venue_limit,
            ends_at = excluded.ends_at, revoked_at = null
        -- Solo un periodo annullato da un rinnovo non riuscito: il pagamento è arrivato.
        where workspace_access_periods.revoked_at is not null
          and workspace_access_periods.revoked_at <= workspace_access_periods.starts_at;
    elsif s.current_period_starts_at > last_paid.starts_at then
      -- Nuovo ciclo prima della fine del precedente (es. da mensile ad annuale).
      update public.workspace_access_periods set revoked_at = s.current_period_starts_at
       where id = last_paid.id;
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do update
        set plan = excluded.plan, venue_limit = excluded.venue_limit,
            ends_at = excluded.ends_at, revoked_at = null
        -- Solo un periodo annullato da un rinnovo non riuscito: il pagamento è arrivato.
        where workspace_access_periods.revoked_at is not null
          and workspace_access_periods.revoked_at <= workspace_access_periods.starts_at;
    elsif (last_paid.plan, last_paid.venue_limit, last_paid.ends_at)
          is distinct from (s.plan, v_limit, s.current_period_ends_at) then
      -- Stesso ciclo, capacità cambiata (upgrade pagato, sede aggiunta): vale
      -- dall'evento, e il tratto precedente resta nella storia.
      v_start := greatest(p_at, last_paid.starts_at);
      if v_start = last_paid.starts_at then
        update public.workspace_access_periods
           set plan = s.plan, venue_limit = v_limit, ends_at = s.current_period_ends_at
         where id = last_paid.id;
      elsif v_start < s.current_period_ends_at then
        update public.workspace_access_periods set revoked_at = v_start where id = last_paid.id;
        insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
          starts_at, ends_at, reason, subscription_id)
        values (s.workspace_id, 'subscription', s.plan, v_limit,
          v_start, s.current_period_ends_at, v_reason, s.id)
        on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
      end if;
    end if;
    -- Pagamento recuperato: la tolleranza non serve più.
    update public.workspace_access_periods g
       set revoked_at = greatest(g.starts_at, p_at)
     where g.subscription_id = p_subscription and g.kind = 'payment_grace'
       and g.revoked_at is null and g.ends_at > p_at;

  elsif s.status = 'past_due' then
    -- Paddle apre il periodo nuovo (`subscription.updated`, `active`) prima di
    -- incassare: con il rinnovo non riuscito quel periodo non è pagato e si
    -- annulla dal suo inizio. Torna se il pagamento viene recuperato.
    update public.workspace_access_periods p set revoked_at = p.starts_at
     where p.subscription_id = p_subscription and p.kind = 'subscription'
       and p.starts_at >= s.current_period_starts_at
       and (p.revoked_at is null or p.revoked_at > p.starts_at);
    last_paid := null;
    last_end := null;
    select * into last_paid from public.workspace_access_periods p
     where p.subscription_id = p_subscription and p.kind = 'subscription'
       and (p.revoked_at is null or p.revoked_at > p.starts_at)
     order by p.starts_at desc, p.created_at desc, p.id desc limit 1;
    if last_paid.id is not null then
      last_end := least(last_paid.ends_at, coalesce(last_paid.revoked_at, last_paid.ends_at));
    end if;
    -- Una tolleranza nata dalla fine del periodo non pagato (prima di questa
    -- correzione) non vale: quella giusta parte dall'ultimo pagato.
    update public.workspace_access_periods g set revoked_at = g.starts_at
     where g.subscription_id = p_subscription and g.kind = 'payment_grace'
       and g.starts_at > last_end
       and (g.revoked_at is null or g.revoked_at > g.starts_at);
    -- Sette giorni dalla fine dell'ultimo periodo pagato, con la sua capacità.
    -- Niente tolleranza dopo un periodo rimborsato: non c'era un pagato da prolungare.
    if last_paid.id is not null and (s.refunded_until is null or last_end >= s.refunded_until) then
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'payment_grace', last_paid.plan, last_paid.venue_limit,
        last_end, last_end + interval '168 hours',
        'Tolleranza di 7 giorni per un rinnovo non riuscito', s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
    end if;

  else
    -- Disdetta o pausa effettive: niente oltre l'evento. Una disdetta a fine
    -- periodo arriva alla fine, quindi il periodo pagato resta intero.
    v_cut := greatest(p_at, coalesce(case s.status when 'canceled' then s.canceled_at
      else s.paused_at end, p_at));
    update public.workspace_access_periods p
       set revoked_at = greatest(p.starts_at, v_cut)
     where p.subscription_id = p_subscription and p.revoked_at is null and p.ends_at > v_cut;
  end if;
end;
$$;
revoke all on function private.billing_sync_periods(uuid, timestamptz)
  from public, anon, authenticated;


-- Abbonamenti rimasti nello stato sbagliato prima di questa correzione
-- (in sandbox: Hotel Tesoro, 19/10). `p_at` non conta nel ramo `past_due`.
do $$
declare
  r record;
begin
  for r in select id, workspace_id from public.billing_subscriptions where status = 'past_due' loop
    perform private.lock_commercial_workspace(r.workspace_id);
    perform private.billing_sync_periods(r.id, now());
  end loop;
end $$;
