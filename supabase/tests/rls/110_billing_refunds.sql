-- M09: rimborsi Paddle. Un rimborso totale approvato del primo pagamento o di un
-- rinnovo chiude il periodo di quell'addebito; gli altri restano da verificare.
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

rollback;
select 'billing refunds: ok' as result;
