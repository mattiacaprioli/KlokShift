-- M09: rimborsi Paddle. Un rimborso totale approvato del primo pagamento o di un
-- rinnovo chiude il periodo di quell'addebito; gli altri restano da verificare.
-- In fondo: il margine di un'ora fra fine periodo e avviso di rinnovo, e il
-- rinnovo non riuscito con la sequenza vera di Paddle.
begin;

create function tests.refund_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.refund_service() to public;

create function tests.refund_sub(p_event text, p_at timestamptz, p_sub text, p_plan_price text,
  p_extra integer, p_starts timestamptz, p_ends timestamptz, p_checkout uuid default null)
returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_event, 'event_type', 'subscription.updated', 'occurred_at', p_at,
    'data', jsonb_build_object('id', p_sub, 'customer_id', 'ctm_01refund', 'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', p_plan_price),
          'quantity', 1, 'status', 'active', 'recurring', true))
        || case when p_extra > 0 then jsonb_build_array(jsonb_build_object(
          'price', jsonb_build_object('id', 'pri_01m577z2zz69jyw4r3hm53warm'), 'quantity', p_extra,
          'status', 'active', 'recurring', true)) else '[]'::jsonb end,
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', p_starts, 'ends_at', p_ends),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', case when p_checkout is null then null
        else jsonb_build_object('klokshift_checkout', p_checkout) end));
$$;
create function tests.refund_txn(p_event text, p_at timestamptz, p_txn text, p_sub text,
  p_origin text, p_starts timestamptz, p_ends timestamptz)
returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_event, 'event_type', 'transaction.completed', 'occurred_at', p_at,
    'data', jsonb_build_object('id', p_txn, 'status', 'completed', 'origin', p_origin,
      'subscription_id', p_sub,
      'billing_period', jsonb_build_object('starts_at', p_starts, 'ends_at', p_ends)));
$$;
create function tests.refund_adj(p_event text, p_type text, p_at timestamptz, p_adj text, p_txn text,
  p_sub text, p_status text, p_kind text default 'full', p_action text default 'refund')
returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_event, 'event_type', p_type, 'occurred_at', p_at,
    'data', jsonb_build_object('id', p_adj, 'action', p_action, 'type', p_kind,
      'transaction_id', p_txn, 'subscription_id', p_sub, 'status', p_status,
      'currency_code', 'EUR', 'totals', jsonb_build_object('total', '3538', 'currency_code', 'EUR')));
$$;
grant execute on function tests.refund_sub(text,timestamptz,text,text,integer,timestamptz,timestamptz,uuid) to public;
grant execute on function tests.refund_txn(text,timestamptz,text,text,text,timestamptz,timestamptz) to public;
grant execute on function tests.refund_adj(text,text,timestamptz,text,text,text,text,text,text) to public;

do $$
begin
  perform tests.eq(has_function_privilege('authenticated',
    'private.billing_apply_adjustment(text,text,text,timestamp with time zone,jsonb)', 'EXECUTE'),
    false, 'il client non applica rettifiche');
end $$;

-- Rimborso totale del primo pagamento: archivio subito, e resta archivio.
do $$
declare
  ws uuid; co uuid; r jsonb; a jsonb; sub_id uuid;
  t0 timestamptz := date_trunc('second', now()) - interval '2 days';
  e1 timestamptz;
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
begin
  e1 := t0 + interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Rimborso: primo pagamento');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();

  perform tests.refund_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  r := public.billing_apply_event('sandbox', tests.refund_sub('evt_01ra', t0, 'sub_01refund', base_m, 0, t0, e1, co));
  sub_id := (r ->> 'subscription_id')::uuid;
  r := public.billing_apply_event('sandbox', tests.refund_txn('evt_01rb', t0, 'txn_01first', 'sub_01refund', 'api', t0, e1));
  perform tests.eq(r ->> 'outcome', 'ignored', 'il pagamento resta nel registro');

  -- In attesa di approvazione: nessun effetto.
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_01rc', 'adjustment.created',
    t0 + interval '1 day', 'adj_01first', 'txn_01first', 'sub_01refund', 'pending_approval'));
  perform tests.eq(r ->> 'outcome', 'applied', 'rettifica registrata');
  perform tests.eq(r ->> 'effect', null, 'in attesa non decide nulla');
  perform tests.logout();
  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'state', 'operational', 'un rimborso in attesa non tocca l''accesso');

  -- Approvato: il periodo pagato si chiude all'approvazione.
  perform tests.refund_service();
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_01rd', 'adjustment.updated',
    t0 + interval '1 day 1 hour', 'adj_01first', 'txn_01first', 'sub_01refund', 'approved'));
  perform tests.eq(r ->> 'effect', 'access_cut', 'rimborso totale del primo pagamento: accesso chiuso');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_01rd', 'adjustment.updated',
    t0 + interval '1 day 1 hour', 'adj_01first', 'txn_01first', 'sub_01refund', 'approved'));
  perform tests.eq(r ->> 'outcome', 'duplicate', 'Paddle che ritenta non rifà nulla');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_01re', 'adjustment.created',
    t0 + interval '1 day 30 minutes', 'adj_01first', 'txn_01first', 'sub_01refund', 'pending_approval'));
  perform tests.eq(r ->> 'outcome', 'stale', 'un avviso più vecchio non riporta in attesa');
  -- Un avviso dello stesso periodo arrivato dopo, anche con capacità diversa
  -- (sede aggiunta prima di disdire), non lo riapre.
  r := public.billing_apply_event('sandbox', tests.refund_sub('evt_01rf', t0 + interval '1 day 2 hours',
    'sub_01refund', base_m, 1, t0, e1));
  perform tests.eq(r ->> 'outcome', 'applied', 'avviso successivo applicato');
  perform tests.logout();

  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'state', 'archive', 'dopo il rimborso: consultazione ed export');
  perform tests.eq((a ->> 'operational_until')::timestamptz, t0 + interval '1 day 1 hour',
    'operativo fino all''approvazione del rimborso');
  a := private.workspace_access_at(ws, t0 + interval '12 hours');
  perform tests.eq(a ->> 'state', 'operational', 'il tratto prima del rimborso resta nella storia');
  perform tests.eq((select status || '/' || effect from private.billing_adjustments
    where provider_adjustment_id = 'adj_01first'), 'approved/access_cut', 'rettifica registrata e applicata');
  perform tests.eq((select refunded_until from public.billing_subscriptions where id = sub_id), e1,
    'il periodo rimborsato arriva a fine mese');

  -- Se Paddle rinnova comunque (abbonamento non disdetto), il mese nuovo è pagato.
  perform tests.refund_service();
  r := public.billing_apply_event('sandbox', tests.refund_txn('evt_01rg', e1, 'txn_01renew', 'sub_01refund',
    'subscription_recurring', e1, e1 + interval '1 month'));
  r := public.billing_apply_event('sandbox', tests.refund_sub('evt_01rh', e1, 'sub_01refund', base_m, 0,
    e1, e1 + interval '1 month'));
  perform tests.logout();
  a := private.workspace_access_at(ws, e1 + interval '1 day');
  perform tests.eq(a ->> 'state', 'operational', 'un rinnovo pagato dopo il rimborso vale');

  -- Rimborso totale del rinnovo: chiude anche quello.
  perform tests.refund_service();
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_01ri', 'adjustment.updated',
    e1 + interval '2 days', 'adj_01renew', 'txn_01renew', 'sub_01refund', 'approved'));
  perform tests.eq(r ->> 'effect', 'access_cut', 'rimborso totale del rinnovo: accesso chiuso');
  perform tests.logout();
  a := private.workspace_access_at(ws, e1 + interval '3 days');
  perform tests.eq(a ->> 'state', 'archive', 'rinnovo rimborsato: consultazione ed export');
end $$;

-- Aumento rimborsato, rimborso parziale, contestazione, rifiuto, pagamento sconosciuto.
do $$
declare
  ws uuid; co uuid; r jsonb; a jsonb;
  t0 timestamptz := date_trunc('second', now()) - interval '2 days';
  e1 timestamptz;
begin
  e1 := t0 + interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Rimborso: aumento');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();

  perform tests.refund_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_02ra', t0, 'sub_02refund',
    'pri_01m577s3dchg2ctcrenkderz05', 0, t0, e1, co));
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_02rb', t0 + interval '1 hour', 'sub_02refund',
    'pri_01m577vzt1b6qkyyf80pnq4aj9', 1, t0, e1));
  perform public.billing_apply_event('sandbox', tests.refund_txn('evt_02rc', t0 + interval '1 hour',
    'txn_02upgrade', 'sub_02refund', 'subscription_update', t0, e1));
  perform public.billing_apply_event('sandbox', tests.refund_txn('evt_02rd', t0,
    'txn_02first', 'sub_02refund', 'api', t0, e1));

  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02re', 'adjustment.updated',
    t0 + interval '1 day', 'adj_02upgrade', 'txn_02upgrade', 'sub_02refund', 'approved'));
  perform tests.eq(r ->> 'effect', 'manual_review', 'aumento rimborsato: da allineare su Paddle');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02rf', 'adjustment.updated',
    t0 + interval '1 day', 'adj_02partial', 'txn_02first', 'sub_02refund', 'approved', 'partial'));
  perform tests.eq(r ->> 'effect', 'none', 'rimborso parziale: solo registrato');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02rg', 'adjustment.created',
    t0 + interval '1 day', 'adj_02chargeback', 'txn_02first', 'sub_02refund', 'approved', 'full', 'chargeback'));
  perform tests.eq(r ->> 'effect', 'manual_review', 'contestazione: da verificare');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02rh', 'adjustment.updated',
    t0 + interval '1 day', 'adj_02rejected', 'txn_02first', 'sub_02refund', 'rejected'));
  perform tests.eq(r ->> 'effect', null, 'rimborso rifiutato: nessun effetto');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02ri', 'adjustment.updated',
    t0 + interval '1 day', 'adj_02unknown', 'txn_02missing', 'sub_02refund', 'approved'));
  perform tests.eq(r ->> 'effect', 'manual_review', 'pagamento non nel registro: da verificare, non si chiude');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02rj', 'adjustment.updated',
    t0 + interval '1 day', 'adj_02other', 'txn_02first', 'sub_99nessuno', 'approved'));
  perform tests.eq(r ->> 'error', 'unknown_subscription', 'rettifica di un abbonamento sconosciuto');
  r := public.billing_apply_event('sandbox', tests.refund_adj('evt_02rk', 'adjustment.updated',
    t0 + interval '1 day', 'adj_02bad', 'non-un-txn', 'sub_02refund', 'approved'));
  perform tests.eq(r ->> 'error', 'invalid_adjustment', 'rettifica malformata');
  perform tests.logout();

  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'state', 'operational', 'nessuno di questi chiude l''accesso');
  perform tests.eq((a #>> '{limits,venues}')::integer, 2, 'la capacità resta finché Paddle non la riduce');
  perform tests.eq((select count(*)::integer from private.billing_adjustments
    where effect = 'manual_review' and provider_adjustment_id like 'adj_02%'), 3, 'tre casi da verificare');
end $$;

-- Margine di rinnovo: un'ora dopo la fine del periodo, solo per chi rinnova.
do $$
declare
  ws uuid; ws2 uuid; co uuid; r jsonb; a jsonb;
  e1 timestamptz := date_trunc('second', now()) - interval '20 minutes';
  t0 timestamptz;
begin
  t0 := e1 - interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Margine: rinnova');
  perform public.create_venue(ws, 'Unica sede');
  ws2 := public.create_workspace('Margine: disdetta');
  perform public.create_venue(ws2, 'Unica sede');
  perform tests.logout();

  perform tests.refund_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_03ma', t0, 'sub_03margin',
    'pri_01m577s3dchg2ctcrenkderz05', 0, t0, e1, co));
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws2, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', jsonb_set(tests.refund_sub('evt_03mb', t0, 'sub_03cancel',
    'pri_01m577s3dchg2ctcrenkderz05', 0, t0, e1, co), '{data,scheduled_change}',
    jsonb_build_object('action', 'cancel', 'effective_at', e1)));
  perform tests.logout();

  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'state', 'operational', 'periodo finito da 20 minuti: in attesa del rinnovo si lavora');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e1 + interval '1 hour', 'il termine è quello del margine');
  perform tests.eq((a ->> 'attendance_until')::timestamptz, e1 + interval '168 hours', 'rettifiche dalla fine vera');
  perform tests.eq((a ->> 'archive_until')::timestamptz,
    ((e1 at time zone 'Europe/Rome') + interval '12 months') at time zone 'Europe/Rome', 'archivio dalla fine vera');
  a := private.workspace_access_at(ws, e1 + interval '61 minutes');
  perform tests.eq(a ->> 'state', 'archive', 'dopo l''ora senza avvisi: consultazione');
  a := private.workspace_access_at(ws2, now());
  perform tests.eq(a ->> 'state', 'archive', 'con la disdetta programmata nessun margine');

  -- Arriva il rinnovo: vale il periodo nuovo, contiguo.
  perform tests.refund_service();
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_03mc', e1 + interval '25 minutes',
    'sub_03margin', 'pri_01m577s3dchg2ctcrenkderz05', 0, e1, e1 + interval '1 month'));
  perform tests.logout();
  a := private.workspace_access_at(ws, now());
  perform tests.eq((a ->> 'operational_until')::timestamptz, e1 + interval '1 month', 'rinnovo arrivato: fine del mese nuovo');
  perform tests.eq((a ->> 'operational_from')::timestamptz, t0, 'stessa decorrenza');
end $$;

-- Rinnovo non riuscito come lo manda Paddle (sandbox 19/10): prima il periodo
-- nuovo con `active`, 3 secondi dopo `past_due`. Poi il pagamento recuperato.
do $$
declare
  ws uuid; co uuid; a jsonb; sub_id uuid;
  e1 timestamptz := date_trunc('second', now()) - interval '5 minutes';
  t0 timestamptz;
  ev jsonb;
begin
  t0 := e1 - interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Rinnovo non riuscito');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();

  perform tests.refund_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  sub_id := (public.billing_apply_event('sandbox', tests.refund_sub('evt_04pa', t0, 'sub_04pastdue',
    'pri_01m577s3dchg2ctcrenkderz05', 0, t0, e1, co)) ->> 'subscription_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_04pb', e1 + interval '41 seconds',
    'sub_04pastdue', 'pri_01m577s3dchg2ctcrenkderz05', 0, e1, e1 + interval '1 month'));
  ev := tests.refund_sub('evt_04pc', e1 + interval '44 seconds', 'sub_04pastdue',
    'pri_01m577s3dchg2ctcrenkderz05', 0, e1, e1 + interval '1 month');
  perform public.billing_apply_event('sandbox', jsonb_set(jsonb_set(ev, '{event_type}', '"subscription.past_due"'),
    '{data,status}', '"past_due"'));
  perform tests.logout();

  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'source', 'payment_grace', 'rinnovo non pagato: tolleranza, non un mese nuovo');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e1 + interval '168 hours',
    'sette giorni dalla fine dell''ultimo mese pagato');
  perform tests.eq((select count(*)::integer from public.workspace_access_periods
    where subscription_id = sub_id and kind = 'subscription' and starts_at = e1 and revoked_at = starts_at), 1,
    'il mese aperto prima dell''incasso è annullato');
  a := private.workspace_access_at(ws, e1 + interval '8 days');
  perform tests.eq(a ->> 'state', 'archive', 'senza pagamento, dopo i 7 giorni: consultazione');

  -- Pagamento recuperato: torna il mese intero, la tolleranza si chiude.
  perform tests.refund_service();
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_04pd', e1 + interval '2 minutes',
    'sub_04pastdue', 'pri_01m577s3dchg2ctcrenkderz05', 0, e1, e1 + interval '1 month'));
  perform tests.logout();
  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'source', 'subscription', 'pagato: di nuovo abbonamento');
  perform tests.eq((a ->> 'operational_until')::timestamptz, e1 + interval '1 month', 'fino a fine del mese pagato');
  a := private.workspace_access_at(ws, e1 + interval '8 days');
  perform tests.eq(a ->> 'state', 'operational', 'nessuna scadenza a 7 giorni dopo il recupero');
end $$;

-- Rimborso fatto dalla dashboard Paddle riga per riga (sandbox 19/10): arriva
-- `partial` anche quando copre tutto. Conta l'importo; una sola riga no.
do $$
declare
  ws uuid; co uuid; r jsonb; a jsonb; ev jsonb;
  t0 timestamptz := date_trunc('second', now()) - interval '2 days';
  e1 timestamptz;
begin
  e1 := t0 + interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Rimborso: riga per riga');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();

  perform tests.refund_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.refund_sub('evt_05ra', t0, 'sub_05lines',
    'pri_01m577vzt1b6qkyyf80pnq4aj9', 1, t0, e1, co));
  perform public.billing_apply_event('sandbox', jsonb_set(tests.refund_txn('evt_05rb', t0, 'txn_05lines',
    'sub_05lines', 'api', t0, e1), '{data,details}', '{"totals":{"grand_total":"9638"}}'));

  -- Una sola riga (la sede) rimborsata per intero: non è il rimborso del periodo.
  ev := tests.refund_adj('evt_05rc', 'adjustment.updated', t0 + interval '1 day', 'adj_05oneline',
    'txn_05lines', 'sub_05lines', 'approved', 'partial');
  ev := jsonb_set(jsonb_set(ev, '{data,totals,total}', '"3660"'), '{data,items}', '[{"type":"full"}]');
  r := public.billing_apply_event('sandbox', ev);
  perform tests.eq(r ->> 'effect', 'none', 'una riga intera non chiude l''accesso');

  -- Tutte le righe, importo pari al pagato: rimborso totale.
  ev := tests.refund_adj('evt_05rd', 'adjustment.updated', t0 + interval '1 day 1 hour', 'adj_05all',
    'txn_05lines', 'sub_05lines', 'approved', 'partial');
  ev := jsonb_set(jsonb_set(ev, '{data,totals,total}', '"9638"'), '{data,items}', '[{"type":"full"},{"type":"full"}]');
  r := public.billing_apply_event('sandbox', ev);
  perform tests.eq(r ->> 'effect', 'access_cut', 'importo pari al pagato: rimborso totale');
  perform tests.logout();
  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'state', 'archive', 'rimborsato riga per riga: consultazione ed export');
end $$;

rollback;
select 'billing refunds: ok' as result;
