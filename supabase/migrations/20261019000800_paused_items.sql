-- Avvisi di pausa scartati: le voci `inactive` di un abbonamento in pausa.
--
-- Prova sandbox del 19/10: alla decorrenza della pausa Paddle manda
-- `subscription.paused` e `subscription.updated` con `status: paused` e ogni
-- voce `status: inactive`. billing_apply_event ignorava le voci inattive, non
-- trovava il piano e scartava gli avvisi (`invalid_plan_items`): l'abbonamento
-- restava `active` con la pausa programmata e «Riparti ora» non si poteva usare.
-- Ora per `paused` e `canceled` le voci inattive contano.
--
-- Copia integrale di billing_apply_event da 20261019000200_billing_refunds.sql
-- con il solo filtro cambiato; poi si rielaborano, in ordine, gli avvisi scartati
-- per questo motivo. La riga scartata lascia il posto all'esito nuovo.

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
     -- In pausa o disdetto Paddle segna le voci `inactive`: descrivono comunque
     -- il piano che l'abbonamento aveva, e senza di loro l'avviso si scartava.
     where (coalesce(i ->> 'status', 'active') <> 'inactive' or v_status in ('paused', 'canceled'))
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


do $$
declare
  r record;
begin
  for r in
    select environment, event_id, payload from private.billing_events
     where outcome = 'rejected' and error = 'invalid_plan_items'
       and payload #>> '{data,status}' in ('paused', 'canceled')
     order by occurred_at, received_at
  loop
    delete from private.billing_events where environment = r.environment and event_id = r.event_id;
    perform public.billing_apply_event(r.environment, r.payload);
  end loop;
end $$;
