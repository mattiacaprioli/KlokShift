-- M09: abbonamenti Paddle → periodi di accesso. Solo eventi verificati passano
-- dal servizio; il client legge un riassunto e non tocca le tabelle.
begin;

create function tests.billing_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.billing_service() to public;

-- Un evento Paddle come lo inoltra la Edge Function dopo la firma.
create function tests.billing_event(
  p_event text, p_type text, p_at timestamptz, p_sub text, p_status text,
  p_items jsonb, p_starts timestamptz, p_ends timestamptz,
  p_checkout uuid default null, p_interval text default 'month', p_extra jsonb default '{}'
) returns jsonb language sql as $$
  select jsonb_build_object(
    'event_id', p_event, 'event_type', p_type, 'occurred_at', p_at,
    'data', jsonb_build_object(
      'id', p_sub, 'customer_id', 'ctm_01test', 'status', p_status,
      'items', p_items,
      'billing_cycle', jsonb_build_object('interval', p_interval, 'frequency', 1),
      'current_billing_period', case when p_starts is null then null
        else jsonb_build_object('starts_at', p_starts, 'ends_at', p_ends) end,
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', case when p_checkout is null then null
        else jsonb_build_object('klokshift_checkout', p_checkout) end
    ) || p_extra);  -- dentro `data`: completa l'abbonamento (canceled_at…)
$$;
create function tests.billing_items(p_plan_price text, p_extra_price text default null, p_extra integer default 0)
returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', p_plan_price),
           'quantity', 1, 'status', 'active', 'recurring', true))
    || case when p_extra > 0 then jsonb_build_array(jsonb_build_object(
           'price', jsonb_build_object('id', p_extra_price), 'quantity', p_extra,
           'status', 'active', 'recurring', true)) else '[]'::jsonb end;
$$;
grant execute on function tests.billing_event(text,text,timestamptz,text,text,jsonb,timestamptz,timestamptz,uuid,text,jsonb) to public;
grant execute on function tests.billing_items(text,text,integer) to public;

-- Superficie: tabelle chiuse, porte del servizio non eseguibili dal client.
do $$
begin
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_apply_event(text,jsonb)', 'EXECUTE'), false, 'il client non applica eventi Paddle');
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_prepare_checkout(text,uuid,uuid,text,text,integer)', 'EXECUTE'),
    false, 'il client non prepara acquisti scegliendo l''utente');
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_attach_checkout_transaction(uuid,text)', 'EXECUTE'), false,
    'il client non collega transazioni');
  perform tests.eq(has_function_privilege('authenticated',
    'private.billing_sync_periods(uuid,timestamp with time zone)', 'EXECUTE'), false,
    'il client non ricalcola i periodi');
  perform tests.eq(has_function_privilege('service_role',
    'public.billing_apply_event(text,jsonb)', 'EXECUTE'), true, 'il servizio applica gli eventi');

  perform tests.login('Ow');
  perform tests.raises('select * from public.billing_subscriptions', 'permission denied',
    'il titolare non legge la tabella degli abbonamenti');
  perform tests.raises('select * from public.billing_checkouts', 'permission denied',
    'il titolare non legge le richieste di acquisto');
  perform tests.raises('select * from private.billing_events', 'permission denied',
    'il titolare non legge il registro eventi');
  perform tests.raises(format(
    'insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason) values (%L, ''subscription'', ''team'', 9, now(), now() + interval ''1 year'', ''x'')',
    tests.id('W1')), 'permission denied', 'il titolare non si scrive un periodo pagato');
  perform tests.anon();
  perform tests.raises(format('select public.get_workspace_billing(%L)', tests.id('W1')),
    'permission denied', 'anon non legge l''abbonamento');
  perform tests.logout();
end $$;

-- Un periodo pagato non può esistere senza abbonamento, neanche dal servizio.
do $$
begin
  perform tests.raises(format(
    'insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason) values (%L, ''subscription'', ''team'', 1, now(), now() + interval ''1 month'', ''x'')',
    tests.id('W1')), 'workspace_access_periods_subscription_link',
    'nessun periodo pagato senza il suo abbonamento');
end $$;

-- Preparare un acquisto: solo il titolare, con capacità che contiene l'azienda.
do $$
declare
  ws uuid; r jsonb; co uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Billing: preparazione');
  perform public.create_venue(ws, 'Sede A');
  perform tests.logout();
  -- Una concessione a tempo con più sedi: non esclude l'acquisto, a differenza della gratuità a vita.
  perform tests.billing_service();
  perform public.grant_workspace_access(ws, 'complimentary_temporary', 'team', 3,
    now() - interval '1 hour', now() + interval '1 month', 'test billing');
  perform tests.login('Ow');
  perform public.create_venue(ws, 'Sede B');
  perform tests.logout();

  perform tests.billing_service();
  r := public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'year', 1);
  co := (r ->> 'checkout_id')::uuid;
  perform tests.eq(r #>> '{items,0,price_id}', 'pri_01m577wqj8atr0sjvy8xhybwf1', 'prezzo Team annuale della sandbox');
  perform tests.eq(r #>> '{items,1,price_id}', 'pri_01m577zzw0kv3c91yqttd0kk6k', 'sede aggiuntiva annuale');
  perform tests.eq((r #>> '{items,1,quantity}')::integer, 1, 'una sede in più');
  perform tests.raises(format(
    'select public.billing_prepare_checkout(''sandbox'', %L, %L, ''team'', ''month'', 0)',
    tests.id('Ow'), ws), 'workspace_venue_capacity', 'due sedi aperte non stanno in una sola');
  perform tests.raises(format(
    'select public.billing_prepare_checkout(''sandbox'', %L, %L, ''team'', ''month'', 1)',
    tests.id('Co'), tests.id('W1')), 'not_allowed', 'il collaboratore non acquista');
  perform tests.raises(format(
    'select public.billing_prepare_checkout(''sandbox'', %L, %L, ''team'', ''month'', 1)',
    tests.id('Str'), ws), 'not_allowed', 'un estraneo non acquista');
  perform tests.raises(format(
    'select public.billing_prepare_checkout(''live'', %L, %L, ''team'', ''month'', 1)',
    tests.id('Ow'), ws), 'billing_price_unavailable', 'nessun prezzo live finché non esiste');
  perform tests.raises(format(
    'select public.billing_prepare_checkout(''sandbox'', %L, %L, ''pro'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_invalid_selection', 'piani inventati rifiutati');

  perform public.billing_attach_checkout_transaction(co, 'txn_01abc');
  perform public.billing_attach_checkout_transaction(co, 'txn_01abc');
  perform tests.raises(format('select public.billing_attach_checkout_transaction(%L, ''txn_01other'')', co),
    'billing_checkout_conflict', 'una richiesta ha una sola transazione');
  perform tests.logout();
end $$;

-- Ciclo completo: acquisto, duplicato, evento vecchio, upgrade, rinnovo,
-- rinnovo fallito con 7 giorni, recupero, disdetta a fine periodo.
do $$
declare
  ws uuid; co uuid; r jsonb; a jsonb; sub_id uuid;
  t0 timestamptz := date_trunc('second', now()) - interval '2 days';
  e1 timestamptz;
  e2 timestamptz;
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
  extra_m text := 'pri_01m577z2zz69jyw4r3hm53warm';
begin
  e1 := t0 + interval '1 month';
  e2 := e1 + interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Billing: ciclo');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();

  perform tests.billing_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_01a', 'subscription.created',
    t0, 'sub_01cycle', 'active', tests.billing_items(base_m), t0, e1, co));
  perform tests.eq(r ->> 'outcome', 'applied', 'il primo evento collega e applica');
  sub_id := (r ->> 'subscription_id')::uuid;
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_01a', 'subscription.created',
    t0, 'sub_01cycle', 'active', tests.billing_items(base_m), t0, e1, co));
  perform tests.eq(r ->> 'outcome', 'duplicate', 'Paddle che ritenta non duplica nulla');
  perform tests.logout();

  a := private.workspace_access_at(ws, t0 + interval '1 day');
  perform tests.eq(a ->> 'source', 'subscription', 'il diritto viene dall''abbonamento');
  perform tests.eq(a ->> 'plan', 'base', 'piano comprato');
  perform tests.eq((a #>> '{limits,people}')::integer, 30, 'Base: 30 persone');
  perform tests.eq((a #>> '{limits,venues}')::integer, 1, 'una sede inclusa');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e1, 'operativo fino a fine periodo pagato');
  perform tests.eq((select status from public.billing_checkouts where id = co), 'completed', 'richiesta completata');
  perform tests.eq((select migration_review_required from public.workspace_commercial_state where workspace_id = ws),
    false, 'un acquisto verificato classifica l''azienda');

  -- Upgrade a Team con una sede in più, pagato a metà periodo.
  perform tests.billing_service();
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_01b', 'subscription.updated',
    t0 + interval '10 days', 'sub_01cycle', 'active', tests.billing_items(team_m, extra_m, 1), t0, e1));
  perform tests.eq(r ->> 'outcome', 'applied', 'upgrade applicato');
  -- Un evento più vecchio arrivato dopo non riporta indietro.
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_01c', 'subscription.updated',
    t0 + interval '5 days', 'sub_01cycle', 'active', tests.billing_items(base_m), t0, e1));
  perform tests.eq(r ->> 'outcome', 'stale', 'un evento fuori ordine non annulla l''upgrade');
  perform tests.logout();
  a := private.workspace_access_at(ws, t0 + interval '5 days');
  perform tests.eq(a ->> 'plan', 'base', 'prima dell''upgrade la storia resta Base');
  a := private.workspace_access_at(ws, t0 + interval '11 days');
  perform tests.eq(a ->> 'plan', 'team', 'dopo l''upgrade: Team');
  perform tests.eq((a #>> '{limits,venues}')::integer, 2, 'sede inclusa più una aggiuntiva');
  perform tests.eq(a #>> '{limits,people}', null, 'Team senza limite di persone');

  -- Rinnovo pagato.
  perform tests.billing_service();
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_01d', 'subscription.updated',
    e1, 'sub_01cycle', 'active', tests.billing_items(team_m, extra_m, 1), e1, e2));
  perform tests.logout();
  a := private.workspace_access_at(ws, e1 + interval '1 day');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e2, 'il rinnovo sposta la fine al nuovo periodo');

  -- Rinnovo successivo non riuscito: 7 giorni con la stessa capacità, una volta sola.
  perform tests.billing_service();
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_01e', 'subscription.past_due',
    e2, 'sub_01cycle', 'past_due', tests.billing_items(team_m, extra_m, 1), e2, e2 + interval '1 month'));
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_01f', 'subscription.updated',
    e2 + interval '3 days', 'sub_01cycle', 'past_due', tests.billing_items(team_m, extra_m, 1), e2, e2 + interval '1 month'));
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.workspace_access_periods
    where subscription_id = sub_id and kind = 'payment_grace'), 1, 'i tentativi non allungano la tolleranza');
  a := private.workspace_access_at(ws, e2 + interval '3 days');
  perform tests.eq(a ->> 'source', 'payment_grace', 'nei 7 giorni si lavora ancora');
  perform tests.eq(a ->> 'plan', 'team', 'con la capacità dell''ultimo periodo pagato');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e2 + interval '168 hours', 'tolleranza di 7 giorni');
  a := private.workspace_access_at(ws, e2 + interval '8 days');
  perform tests.eq(a ->> 'state', 'archive', 'dopo i 7 giorni: sola consultazione');
  perform tests.eq((a ->> 'can_complete_attendance')::boolean, true, 'con la finestra di rettifica');
  perform tests.login('Ow');
  r := public.get_workspace_billing(ws);
  perform tests.eq(r ->> 'status', 'past_due', 'il titolare vede il rinnovo in sospeso');
  perform tests.eq((r ->> 'past_due_since')::timestamptz, e2, 'dal primo errore, non dall''ultimo tentativo');
  perform tests.ok(r -> 'provider_subscription_id' is null, 'nessun identificativo Paddle al client');
  perform tests.login('Co');
  perform tests.raises(format('select public.get_workspace_billing(%L)', ws), 'not_allowed',
    'chi non è titolare non legge l''abbonamento');
  perform tests.logout();

  -- Pagamento recuperato al giorno 5: il periodo pagato riparte dalla sua data.
  perform tests.billing_service();
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_01g', 'subscription.updated',
    e2 + interval '5 days', 'sub_01cycle', 'active', tests.billing_items(team_m, extra_m, 1), e2, e2 + interval '1 month'));
  perform tests.logout();
  a := private.workspace_access_at(ws, e2 + interval '10 days');
  perform tests.eq(a ->> 'source', 'subscription', 'pagamento recuperato');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e2 + interval '1 month', 'stessa scadenza di Paddle');

  -- Disdetta a fine periodo: il periodo pagato resta intero.
  perform tests.billing_service();
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_01h', 'subscription.canceled',
    e2 + interval '1 month', 'sub_01cycle', 'canceled', tests.billing_items(team_m, extra_m, 1), null, null,
    null, 'month', jsonb_build_object('canceled_at', e2 + interval '1 month')));
  perform tests.logout();
  a := private.workspace_access_at(ws, e2 + interval '20 days');
  perform tests.eq(a ->> 'state', 'operational', 'fino alla fine si lavora');
  a := private.workspace_access_at(ws, e2 + interval '1 month' + interval '1 day');
  perform tests.eq(a ->> 'state', 'archive', 'poi archivio, senza cancellare nulla');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e2 + interval '1 month', 'fine operativa = fine del pagato');

  -- Dopo la disdetta si può ricomprare.
  perform tests.billing_service();
  perform public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 0);
  perform tests.logout();
end $$;

-- Rimborso con disdetta immediata: il periodo finisce all'evento.
-- Acquisto durante la prova: vale subito ciò che si è comprato.
do $$
declare
  ws uuid; co uuid; a jsonb;
  t0 timestamptz := date_trunc('second', now());
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Billing: prova e rimborso');
  perform public.create_venue(ws, 'Sede');
  perform public.start_workspace_trial(ws);
  perform tests.logout();

  perform tests.billing_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'year', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_02a', 'subscription.created',
    t0, 'sub_02refund', 'active', tests.billing_items('pri_01m577th8zt8x41cxk2p8m5n63'),
    t0, t0 + interval '1 year', co, 'year'));
  perform tests.logout();
  a := private.workspace_access_at(ws, t0 + interval '1 day');
  perform tests.eq(a ->> 'source', 'subscription', 'durante la prova prevale l''acquisto');
  perform tests.eq(a ->> 'plan', 'base', 'con il piano comprato, non quello di prova');

  perform tests.billing_service();
  perform public.billing_apply_event('sandbox', tests.billing_event('evt_02b', 'subscription.canceled',
    t0 + interval '3 days', 'sub_02refund', 'canceled', tests.billing_items('pri_01m577th8zt8x41cxk2p8m5n63'),
    null, null, null, 'year', jsonb_build_object('canceled_at', t0 + interval '3 days')));
  perform tests.logout();
  a := private.workspace_access_at(ws, t0 + interval '4 days');
  perform tests.eq(a ->> 'source', 'trial', 'il rimborso chiude l''annuale; resta la prova ancora in corso');
  a := private.workspace_access_at(ws, t0 + interval '31 days');
  perform tests.eq(a ->> 'state', 'archive', 'finita anche la prova: archivio');
end $$;

-- Dati che non concedono nulla.
do $$
declare
  ws uuid; co uuid; r jsonb;
  t0 timestamptz := date_trunc('second', now());
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Billing: scarti');
  perform public.create_venue(ws, 'Sede');
  perform tests.logout();
  perform tests.billing_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 0) ->> 'checkout_id')::uuid;

  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03a', 'subscription.created',
    t0, 'sub_03none', 'active', tests.billing_items('pri_01m577vzt1b6qkyyf80pnq4aj9'), t0, t0 + interval '1 month'));
  perform tests.eq(r ->> 'error', 'unlinked_subscription', 'senza richiesta del server non si collega');
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03b', 'subscription.created',
    t0, 'sub_03unknown', 'active', tests.billing_items('pri_01notours'), t0, t0 + interval '1 month', co));
  perform tests.eq(r ->> 'error', 'unknown_price', 'un prezzo fuori catalogo non dà capacità');
  r := public.billing_apply_event('live', tests.billing_event('evt_03c', 'subscription.created',
    t0, 'sub_03live', 'active', tests.billing_items('pri_01m577vzt1b6qkyyf80pnq4aj9'), t0, t0 + interval '1 month', co));
  perform tests.eq(r ->> 'error', 'unknown_price', 'i prezzi sandbox non valgono in live');
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03d', 'subscription.created',
    t0, 'sub_03trial', 'trialing', tests.billing_items('pri_01m577vzt1b6qkyyf80pnq4aj9'), t0, t0 + interval '1 month', co));
  perform tests.eq(r ->> 'error', 'unsupported_status', 'le prove di Paddle non sono le nostre');
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03e', 'subscription.created',
    t0, 'sub_03two', 'active', tests.billing_items('pri_01m577vzt1b6qkyyf80pnq4aj9')
      || tests.billing_items('pri_01m577s3dchg2ctcrenkderz05'), t0, t0 + interval '1 month', co));
  perform tests.eq(r ->> 'error', 'invalid_plan_items', 'due piani nello stesso abbonamento');
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03f', 'transaction.completed',
    t0, 'sub_03x', 'active', '[]'::jsonb, t0, t0 + interval '1 month'));
  perform tests.eq(r ->> 'outcome', 'ignored', 'le transazioni per ora si registrano soltanto');
  perform tests.logout();  -- il registro sta in `private`, fuori dalla portata del servizio
  perform tests.eq((select count(*)::integer from public.workspace_access_periods where workspace_id = ws),
    0, 'nessuno scarto ha creato periodi');
  perform tests.eq((select count(*)::integer from private.billing_events where event_id like 'evt_03%'),
    6, 'anche gli scarti restano nel registro');
  perform tests.billing_service();

  -- La richiesta è ancora aperta: il primo abbonamento valido la usa,
  -- un secondo aperto sulla stessa azienda è un'anomalia.
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03g', 'subscription.created',
    t0, 'sub_03ok', 'active', tests.billing_items('pri_01m577vzt1b6qkyyf80pnq4aj9'), t0, t0 + interval '1 month', co));
  perform tests.eq(r ->> 'outcome', 'applied', 'abbonamento valido applicato');
  r := public.billing_apply_event('sandbox', tests.billing_event('evt_03h', 'subscription.created',
    t0, 'sub_03again', 'active', tests.billing_items('pri_01m577vzt1b6qkyyf80pnq4aj9'), t0, t0 + interval '1 month', co));
  perform tests.eq(r ->> 'error', 'unlinked_subscription', 'la stessa richiesta non vale due volte');
  perform tests.raises(format(
    'select public.billing_prepare_checkout(''sandbox'', %L, %L, ''team'', ''month'', 0)', tests.id('Ow'), ws),
    'billing_subscription_exists', 'con un abbonamento aperto non si compra un secondo');
  perform tests.raises('select public.billing_apply_event(''sandbox'', ''{"event_id":"x"}''::jsonb)',
    'billing_invalid_event', 'evento malformato');
  perform tests.logout();
end $$;

rollback;
select 'billing: ok' as result;
