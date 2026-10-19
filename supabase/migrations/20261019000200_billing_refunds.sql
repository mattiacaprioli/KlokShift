-- M09: rimborsi e contestazioni Paddle (avvisi `adjustment.*`).
--
-- Regola (docs/MONETIZATION.md §6): dopo il rimborso il periodo coperto da
-- quell'addebito termina. Primo pagamento o rinnovo → archivio; upgrade o sede
-- → capacità precedente, senza cancellare nulla. Paddle non disdice
-- l'abbonamento quando rimborsa: chi rimborsa lo disdice o lo riduce a parte.
--
-- Cosa fa da sola questa migration:
--   - rimborso TOTALE APPROVATO del primo pagamento o di un rinnovo: chiude
--     subito i periodi di quell'addebito e segna `refunded_until`, così gli
--     avvisi successivi dello stesso periodo non lo riaprono;
--   - rimborso di un aumento/sede, contestazioni, rimborsi su pagamenti non
--     riconosciuti e rimborsi annullati: `manual_review`, nessun effetto
--     sull'accesso. La capacità torna indietro quando l'abbonamento viene
--     ridotto su Paddle (avviso `subscription.updated`);
--   - rimborsi parziali e accrediti: solo registrati.
-- Il pagamento rettificato si legge dal suo `transaction.completed` già
-- verificato nel registro: origine e periodo coperto vengono da lì.
--
-- Copie integrali: billing_sync_periods da 20261018000000 §7 (con il controllo
-- su `refunded_until`), billing_apply_event da 20261018000100 (con il ramo
-- `adjustment.*`). Stesse firme: CREATE OR REPLACE conserva i privilegi.

-- 1. Fin dove arriva un periodo rimborsato.
alter table public.billing_subscriptions add column refunded_until timestamptz;

-- 2. Una riga per rettifica Paddle, aggiornata a ogni avviso.
create table private.billing_adjustments (
  environment text not null check (environment in ('sandbox', 'live')),
  provider_adjustment_id text not null check (provider_adjustment_id ~ '^adj_[a-z0-9]+$'),
  subscription_id uuid not null references public.billing_subscriptions (id) on delete restrict,
  provider_transaction_id text not null check (provider_transaction_id ~ '^txn_[a-z0-9]+$'),
  action text not null,
  adjustment_type text not null check (adjustment_type in ('full', 'partial')),
  status text not null check (status in ('pending_approval', 'approved', 'rejected', 'reversed')),
  total_cents bigint,
  currency text,
  -- Dal pagamento rettificato; null se il suo avviso non è nel registro.
  transaction_origin text,
  covered_starts_at timestamptz,
  covered_ends_at timestamptz,
  -- Deciso alla prima approvazione e poi stabile; null finché è in attesa.
  effect text check (effect in ('none', 'access_cut', 'manual_review')),
  access_cut_at timestamptz,
  last_event_id text not null,
  last_event_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (environment, provider_adjustment_id)
);
create index billing_adjustments_subscription_idx
  on private.billing_adjustments (subscription_id, created_at desc);
create index billing_adjustments_review_idx
  on private.billing_adjustments (created_at desc) where effect = 'manual_review';
revoke all on private.billing_adjustments from public, anon, authenticated;

-- Il pagamento di una rettifica si cerca per id fra le transazioni ricevute.
create index billing_events_transaction_idx
  on private.billing_events (environment, (payload #>> '{data,id}'))
  where event_type = 'transaction.completed';

-- 3. Periodi: non riaprire un periodo rimborsato.
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
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
    elsif s.current_period_starts_at > last_paid.starts_at then
      -- Nuovo ciclo prima della fine del precedente (es. da mensile ad annuale).
      update public.workspace_access_periods set revoked_at = s.current_period_starts_at
       where id = last_paid.id;
      insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit,
        starts_at, ends_at, reason, subscription_id)
      values (s.workspace_id, 'subscription', s.plan, v_limit,
        s.current_period_starts_at, s.current_period_ends_at, v_reason, s.id)
      on conflict (subscription_id, kind, starts_at) where subscription_id is not null do nothing;
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

-- 4. Applicazione di una rettifica. Chiamata solo da billing_apply_event, dopo
--    il lock dell'evento e il controllo dei duplicati.
create function private.billing_apply_adjustment(p_environment text, p_event_id text,
  p_type text, p_occurred timestamptz, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  d jsonb := p_event -> 'data';
  v_error text;
  s public.billing_subscriptions;
  a private.billing_adjustments;
  v_found boolean;
  v_txn jsonb;
  v_type text := coalesce(d ->> 'type', 'partial');
  v_effect text;
  v_start timestamptz;
  v_end timestamptz;
  v_cut timestamptz;
  v_cut_at timestamptz;
begin
  if d ->> 'id' is null or d ->> 'id' !~ '^adj_[a-z0-9]+$'
     or d ->> 'transaction_id' is null or d ->> 'transaction_id' !~ '^txn_[a-z0-9]+$'
     or d ->> 'action' is null or v_type not in ('full', 'partial')
     or d ->> 'status' is null
     or d ->> 'status' not in ('pending_approval', 'approved', 'rejected', 'reversed') then
    v_error := 'invalid_adjustment';
  else
    select * into s from public.billing_subscriptions
     where environment = p_environment and provider_subscription_id = d ->> 'subscription_id';
    if not found then
      v_error := 'unknown_subscription';
    end if;
  end if;
  if v_error is not null then
    insert into private.billing_events (environment, event_id, event_type, occurred_at,
      payload, outcome, error, subscription_id)
    values (p_environment, p_event_id, p_type, p_occurred, p_event, 'rejected', v_error, s.id);
    return jsonb_build_object('outcome', 'rejected', 'error', v_error);
  end if;

  perform private.lock_commercial_workspace(s.workspace_id);
  select * into s from public.billing_subscriptions where id = s.id for update;
  select * into a from private.billing_adjustments
   where environment = p_environment and provider_adjustment_id = d ->> 'id' for update;
  v_found := found;
  -- Fuori ordine: un avviso più vecchio dell'ultimo non riporta indietro lo stato.
  if v_found and p_occurred < a.last_event_at then
    insert into private.billing_events (environment, event_id, event_type, occurred_at,
      payload, outcome, subscription_id)
    values (p_environment, p_event_id, p_type, p_occurred, p_event, 'stale', s.id);
    return jsonb_build_object('outcome', 'stale', 'subscription_id', s.id);
  end if;

  select e.payload -> 'data' into v_txn from private.billing_events e
   where e.environment = p_environment and e.event_type = 'transaction.completed'
     and e.payload #>> '{data,id}' = d ->> 'transaction_id'
   order by e.occurred_at desc limit 1;
  if v_txn is not null and v_txn ->> 'subscription_id' is distinct from d ->> 'subscription_id' then
    v_txn := null;  -- Pagamento di un altro abbonamento: non si usa il suo periodo.
  end if;
  v_start := (v_txn #>> '{billing_period,starts_at}')::timestamptz;
  v_end := (v_txn #>> '{billing_period,ends_at}')::timestamptz;

  v_effect := a.effect;
  v_cut_at := a.access_cut_at;
  if v_effect is null and d ->> 'status' = 'approved' then
    v_effect := case
      when d ->> 'action' = 'refund' and v_type = 'full'
           and v_txn ->> 'origin' in ('api', 'web', 'subscription_recurring')
           and v_start is not null and v_end > v_start then 'access_cut'
      -- Parziale: credito per disservizio o cortesia, l'accesso pagato resta.
      when d ->> 'action' = 'refund' and v_type = 'partial' then 'none'
      when d ->> 'action' in ('refund', 'chargeback', 'chargeback_warning') then 'manual_review'
      else 'none'
    end;
    if v_effect = 'access_cut' then
      -- Dall'approvazione (mai prima dell'inizio del periodo pagato): il tratto
      -- già goduto resta nella storia, quello rimborsato non si usa più.
      v_cut := greatest(p_occurred, v_start);
      update public.workspace_access_periods p
         set revoked_at = greatest(p.starts_at, v_cut)
       where p.subscription_id = s.id
         and (p.starts_at < v_end or (p.kind = 'payment_grace' and p.starts_at = v_end))
         and coalesce(least(p.ends_at, p.revoked_at), p.ends_at) > v_cut;
      update public.billing_subscriptions
         set refunded_until = greatest(coalesce(refunded_until, v_end), v_end)
       where id = s.id;
      v_cut_at := v_cut;
    end if;
  elsif v_effect = 'access_cut' and d ->> 'status' = 'reversed' then
    -- Rimborso annullato da Paddle: l'accesso non torna da solo, lo decide il fondatore.
    v_effect := 'manual_review';
  end if;

  insert into private.billing_adjustments (environment, provider_adjustment_id, subscription_id,
    provider_transaction_id, action, adjustment_type, status, total_cents, currency,
    transaction_origin, covered_starts_at, covered_ends_at, effect, access_cut_at,
    last_event_id, last_event_at)
  values (p_environment, d ->> 'id', s.id, d ->> 'transaction_id', d ->> 'action', v_type,
    d ->> 'status',
    case when d #>> '{totals,total}' ~ '^-?[0-9]{1,15}$' then (d #>> '{totals,total}')::bigint end,
    coalesce(d #>> '{totals,currency_code}', d ->> 'currency_code'),
    v_txn ->> 'origin', v_start, v_end, v_effect, v_cut_at, p_event_id, p_occurred)
  on conflict (environment, provider_adjustment_id) do update set
    status = excluded.status,
    adjustment_type = excluded.adjustment_type,
    total_cents = coalesce(excluded.total_cents, billing_adjustments.total_cents),
    currency = coalesce(excluded.currency, billing_adjustments.currency),
    transaction_origin = excluded.transaction_origin,
    covered_starts_at = excluded.covered_starts_at,
    covered_ends_at = excluded.covered_ends_at,
    effect = excluded.effect,
    access_cut_at = excluded.access_cut_at,
    last_event_id = excluded.last_event_id,
    last_event_at = excluded.last_event_at,
    updated_at = now();

  insert into private.billing_events (environment, event_id, event_type, occurred_at,
    payload, outcome, subscription_id)
  values (p_environment, p_event_id, p_type, p_occurred, p_event, 'applied', s.id);
  return jsonb_build_object('outcome', 'applied', 'subscription_id', s.id,
    'workspace_id', s.workspace_id, 'effect', v_effect);
end;
$$;
revoke all on function private.billing_apply_adjustment(text, text, text, timestamptz, jsonb)
  from public, anon, authenticated;


-- 5. Ingresso unico degli eventi, con il ramo delle rettifiche.
create or replace function public.billing_apply_event(p_environment text, p_event jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event_id text := p_event ->> 'event_id';
  v_type text := p_event ->> 'event_type';
  v_occurred timestamptz;
  d jsonb := p_event -> 'data';
  v_error text;
  v_status text;
  v_interval text;
  v_plan text;
  v_plan_items integer;
  v_plan_quantity integer;
  v_extra integer;
  v_unknown integer;
  v_intervals integer;
  v_checkout_ref text;
  v_checkout public.billing_checkouts;
  v_workspace uuid;
  s public.billing_subscriptions;
  v_existing boolean;
begin
  if p_environment is null or p_environment not in ('sandbox', 'live') then
    raise exception 'billing_invalid_environment' using errcode = '22023';
  end if;
  if v_event_id is null or v_event_id !~ '^evt_[a-z0-9]+$' or v_type is null
     or p_event ->> 'occurred_at' is null then
    raise exception 'billing_invalid_event' using errcode = '22023';
  end if;
  v_occurred := (p_event ->> 'occurred_at')::timestamptz;

  -- Due consegne simultanee dello stesso evento: la seconda attende la prima e
  -- la trova nel registro, invece di applicarlo due volte.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_environment || ':' || v_event_id, 202610180000));
  -- Stesso evento già ricevuto: nessun effetto, qualunque fosse l'esito.
  perform 1 from private.billing_events
   where environment = p_environment and event_id = v_event_id;
  if found then
    return jsonb_build_object('outcome', 'duplicate');
  end if;

  if v_type in ('adjustment.created', 'adjustment.updated') then
    return private.billing_apply_adjustment(p_environment, v_event_id, v_type, v_occurred, p_event);
  end if;
  if v_type not like 'subscription.%' then
    -- Le transazioni restano nel registro: i rimborsi le rileggono da qui.
    insert into private.billing_events (environment, event_id, event_type, occurred_at, payload, outcome)
    values (p_environment, v_event_id, v_type, v_occurred, p_event, 'ignored');
    return jsonb_build_object('outcome', 'ignored');
  end if;

  -- Forma dell'abbonamento. Un dato che non torna non concede nulla.
  v_status := d ->> 'status';
  v_interval := d #>> '{billing_cycle,interval}';
  if d ->> 'id' is null or d ->> 'id' !~ '^sub_[a-z0-9]+$'
     or d ->> 'customer_id' is null or d ->> 'customer_id' !~ '^ctm_[a-z0-9]+$' then
    v_error := 'invalid_subscription';
  elsif v_status is null or v_status not in ('active', 'past_due', 'paused', 'canceled') then
    -- `trialing` compreso: le prove le gestisce KlokShift, non Paddle.
    v_error := 'unsupported_status';
  elsif v_interval is null or v_interval not in ('month', 'year')
     or coalesce(d #>> '{billing_cycle,frequency}', '') <> '1' then
    v_error := 'unsupported_billing_cycle';
  elsif v_status in ('active', 'past_due') and (
     d #>> '{current_billing_period,starts_at}' is null
     or d #>> '{current_billing_period,ends_at}' is null
     or (d #>> '{current_billing_period,ends_at}')::timestamptz
        <= (d #>> '{current_billing_period,starts_at}')::timestamptz) then
    v_error := 'invalid_billing_period';
  elsif jsonb_typeof(d -> 'items') is distinct from 'array' then
    v_error := 'invalid_items';
  end if;

  if v_error is null then
    select count(*) filter (where bp.price_id is null),
           count(*) filter (where bp.item in ('base', 'team')),
           max(bp.item) filter (where bp.item in ('base', 'team')),
           max((i ->> 'quantity')::integer) filter (where bp.item in ('base', 'team')),
           coalesce(sum((i ->> 'quantity')::integer) filter (where bp.item = 'extra_venue'), 0),
           count(distinct bp.billing_interval)
             filter (where bp.billing_interval is distinct from v_interval)
      into v_unknown, v_plan_items, v_plan, v_plan_quantity, v_extra, v_intervals
      from jsonb_array_elements(d -> 'items') i
      left join private.billing_prices bp
        on bp.environment = p_environment and bp.price_id = i #>> '{price,id}'
     where coalesce(i ->> 'status', 'active') <> 'inactive'
       and coalesce(i ->> 'recurring', 'true') = 'true';
    if v_unknown > 0 then
      v_error := 'unknown_price';
    elsif v_plan_items <> 1 or v_plan_quantity <> 1 then
      v_error := 'invalid_plan_items';
    elsif v_intervals > 0 then
      v_error := 'mixed_billing_interval';
    elsif v_extra > 999 then
      v_error := 'invalid_items';
    end if;
  end if;

  if v_error is null then
    select * into s from public.billing_subscriptions
     where environment = p_environment and provider_subscription_id = d ->> 'id';
    v_existing := found;
    if v_existing then
      v_workspace := s.workspace_id;
    else
      -- Il primo evento collega l'abbonamento alla richiesta preparata dal server.
      v_checkout_ref := d #>> '{custom_data,klokshift_checkout}';
      if v_checkout_ref is null
         or v_checkout_ref !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        v_error := 'unlinked_subscription';
      else
        select * into v_checkout from public.billing_checkouts
         where id = v_checkout_ref::uuid and environment = p_environment;
        if not found or v_checkout.status <> 'open' then
          v_error := 'unlinked_subscription';
        else
          v_workspace := v_checkout.workspace_id;
        end if;
      end if;
    end if;
  end if;

  if v_error is not null then
    insert into private.billing_events (environment, event_id, event_type, occurred_at,
      payload, outcome, error, subscription_id)
    values (p_environment, v_event_id, v_type, v_occurred, p_event, 'rejected', v_error,
      case when v_existing then s.id end);
    return jsonb_build_object('outcome', 'rejected', 'error', v_error);
  end if;

  -- Stesso lock di capacità, prova e concessioni.
  perform private.lock_commercial_workspace(v_workspace);

  -- Paddle manda insieme `subscription.created` e `subscription.activated` dello
  -- stesso abbonamento: il gemello può averlo creato mentre si aspettava il lock.
  -- Senza questa rilettura il secondo risultava un «secondo abbonamento».
  if not v_existing then
    select * into s from public.billing_subscriptions
     where environment = p_environment and provider_subscription_id = d ->> 'id';
    v_existing := found;
  end if;

  if v_existing then
    select * into s from public.billing_subscriptions where id = s.id for update;
    -- Paddle non garantisce l'ordine: ogni evento porta lo stato completo,
    -- quindi uno più vecchio dell'ultimo applicato non aggiunge nulla.
    if v_occurred < s.last_event_at then
      insert into private.billing_events (environment, event_id, event_type, occurred_at,
        payload, outcome, subscription_id)
      values (p_environment, v_event_id, v_type, v_occurred, p_event, 'stale', s.id);
      return jsonb_build_object('outcome', 'stale', 'subscription_id', s.id);
    end if;
    update public.billing_subscriptions set
      provider_customer_id = d ->> 'customer_id',
      status = v_status,
      plan = v_plan,
      billing_interval = v_interval,
      extra_venues = v_extra,
      current_period_starts_at = (d #>> '{current_billing_period,starts_at}')::timestamptz,
      current_period_ends_at = (d #>> '{current_billing_period,ends_at}')::timestamptz,
      scheduled_change_action = d #>> '{scheduled_change,action}',
      scheduled_change_at = (d #>> '{scheduled_change,effective_at}')::timestamptz,
      past_due_since = case when v_status = 'past_due'
        then coalesce(past_due_since, v_occurred) end,
      canceled_at = (d ->> 'canceled_at')::timestamptz,
      paused_at = (d ->> 'paused_at')::timestamptz,
      last_event_id = v_event_id,
      last_event_at = v_occurred
     where id = s.id
    returning * into s;
  else
    if exists (select 1 from public.billing_subscriptions
                where workspace_id = v_workspace and status <> 'canceled')
       and v_status <> 'canceled' then
      -- Secondo abbonamento aperto: va rimborsato, non sommato.
      insert into private.billing_events (environment, event_id, event_type, occurred_at,
        payload, outcome, error)
      values (p_environment, v_event_id, v_type, v_occurred, p_event, 'rejected',
        'duplicate_subscription');
      return jsonb_build_object('outcome', 'rejected', 'error', 'duplicate_subscription');
    end if;
    insert into public.billing_subscriptions (workspace_id, environment,
      provider_subscription_id, provider_customer_id, status, plan, billing_interval,
      extra_venues, current_period_starts_at, current_period_ends_at,
      scheduled_change_action, scheduled_change_at, past_due_since, canceled_at, paused_at,
      last_event_id, last_event_at)
    values (v_workspace, p_environment, d ->> 'id', d ->> 'customer_id', v_status, v_plan,
      v_interval, v_extra,
      (d #>> '{current_billing_period,starts_at}')::timestamptz,
      (d #>> '{current_billing_period,ends_at}')::timestamptz,
      d #>> '{scheduled_change,action}',
      (d #>> '{scheduled_change,effective_at}')::timestamptz,
      case when v_status = 'past_due' then v_occurred end,
      (d ->> 'canceled_at')::timestamptz, (d ->> 'paused_at')::timestamptz,
      v_event_id, v_occurred)
    returning * into s;
    update public.billing_checkouts
       set status = 'completed', completed_at = v_occurred, subscription_id = s.id
     where id = v_checkout.id;
    -- Un acquisto verificato è una classificazione commerciale esplicita.
    update public.workspace_commercial_state set migration_review_required = false
     where workspace_id = v_workspace;
  end if;

  perform private.billing_sync_periods(s.id, v_occurred);
  insert into private.billing_events (environment, event_id, event_type, occurred_at,
    payload, outcome, subscription_id)
  values (p_environment, v_event_id, v_type, v_occurred, p_event, 'applied', s.id);
  return jsonb_build_object('outcome', 'applied', 'subscription_id', s.id,
    'workspace_id', v_workspace);
end;
$$;
revoke all on function public.billing_apply_event(text, jsonb) from public, anon, authenticated;
grant execute on function public.billing_apply_event(text, jsonb) to service_role;
