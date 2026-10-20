-- Voce 5: incassi nell'area fondatore. MRR dai prezzi degli abbonamenti,
-- pagamenti e rimborsi del mese dagli avvisi verificati; sandbox e live separati.
begin;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000035',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000036',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture finanza');
insert into private.billing_prices (environment, price_id, item, billing_interval) values
  ('live', 'pri_01livebase', 'base', 'month'), ('live', 'pri_01liveteamy', 'team', 'year'),
  ('live', 'pri_01liveextra', 'extra_venue', 'month');

create function tests.fin_admin() returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000035', 'aal', 'aal2')::text, true);
end $$;
create function tests.fin_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.fin_sub(p_env text, p_event text, p_sub text, p_status text, p_price text, p_amount int,
  p_interval text, p_checkout uuid) returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_event, 'event_type', 'subscription.created', 'occurred_at', now() - interval '1 day',
    'data', jsonb_build_object('id', p_sub, 'customer_id', 'ctm_01fin', 'status', p_status, 'currency_code', 'EUR',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', p_price,
          'unit_price', jsonb_build_object('amount', p_amount::text, 'currency_code', 'EUR')),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', p_interval, 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', now() + interval '20 days'),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', p_checkout)));
$$;
create function tests.fin_txn(p_env text, p_event text, p_txn text, p_sub text, p_origin text, p_gross int) returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_event, 'event_type', 'transaction.completed', 'occurred_at', now(),
    'data', jsonb_build_object('id', p_txn, 'origin', p_origin, 'subscription_id', p_sub, 'currency_code', 'EUR',
      'billed_at', now(), 'billing_period', jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', now() + interval '20 days'),
      'details', jsonb_build_object('totals', jsonb_build_object('grand_total', p_gross::text,
        'tax', round(p_gross * 0.18)::int::text, 'fee', round(p_gross * 0.06)::int::text,
        'earnings', (p_gross - round(p_gross * 0.18)::int - round(p_gross * 0.06)::int)::text))));
$$;
grant execute on function tests.fin_admin(), tests.fin_service(), tests.fin_sub(text,text,text,text,text,int,text,uuid),
  tests.fin_txn(text,text,text,text,text,int) to public;

do $$
declare
  w1 uuid := tests.id('W1'); w2 uuid := tests.id('W2'); co uuid; r jsonb; live jsonb; sb jsonb;
begin
  -- Le fixture hanno la gratuità a vita, che esclude un acquisto: la si chiude.
  perform tests.logout();
  update public.workspace_access_periods set starts_at = now() - interval '1 year',
    revoked_at = now() - interval '2 days' where workspace_id in (w1, w2);
  perform tests.fin_service();
  -- Live: W1 Base mensile 29 €, W2 Team annuale 490 € (MRR 40,83 €).
  co := (public.billing_prepare_checkout('live', tests.id('Ow'), w1, 'base', 'month', 1) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('live', tests.fin_sub('live', 'evt_07a', 'sub_07w1', 'active', 'pri_01livebase', 2900, 'month', co));
  co := (public.billing_prepare_checkout('live', tests.id('Emp'), w2, 'team', 'year', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('live', tests.fin_sub('live', 'evt_07b', 'sub_07w2', 'active', 'pri_01liveteamy', 49000, 'year', co));
  perform public.billing_apply_event('live', tests.fin_txn('live', 'evt_07c', 'txn_07w1', 'sub_07w1', 'api', 3538));
  perform public.billing_apply_event('live', tests.fin_txn('live', 'evt_07d', 'txn_07w2', 'sub_07w2', 'api', 59780));
  -- Il cambio carta (0 €) non è un pagamento.
  perform public.billing_apply_event('live', tests.fin_txn('live', 'evt_07e', 'txn_07card', 'sub_07w1', 'subscription_payment_method_change', 0));
  -- Rimborso totale del primo pagamento di W1.
  perform public.billing_apply_event('live', jsonb_build_object('event_id', 'evt_07f', 'event_type', 'adjustment.updated',
    'occurred_at', now(), 'data', jsonb_build_object('id', 'adj_07w1', 'action', 'refund', 'type', 'full', 'status', 'approved',
      'transaction_id', 'txn_07w1', 'subscription_id', 'sub_07w1', 'currency_code', 'EUR',
      'totals', jsonb_build_object('total', '3538', 'earnings', '2690', 'currency_code', 'EUR'))));
  perform tests.logout();

  perform tests.login('Ow');
  perform tests.raises('select public.admin_get_finance()', 'admin_not_allowed', 'il titolare non vede gli incassi');

  perform tests.fin_admin();
  r := public.admin_get_finance();
  live := (select e from jsonb_array_elements(r -> 'environments') e where e ->> 'environment' = 'live');
  perform tests.eq((live ->> 'mrr_cents')::numeric, round(2900 + 49000 / 12.0), 'MRR: mensile pieno più annuale diviso 12');
  perform tests.eq((live #>> '{payments,count}')::integer, 2, 'due pagamenti, il cambio carta no');
  perform tests.eq((live #>> '{payments,gross_cents}')::bigint, 63318::bigint, 'lordo con IVA');
  perform tests.eq((live #>> '{payments,first_purchases}')::integer, 2, 'due primi acquisti');
  perform tests.eq((live #>> '{refunds,count}')::integer, 1, 'un rimborso');
  perform tests.eq((live #>> '{refunds,earnings_cents}')::bigint, 2690::bigint, 'con il netto stornato');
  perform tests.eq(r -> 'payouts', 'null'::jsonb, 'payout non collegati, non zero');
  sb := (select e from jsonb_array_elements(r -> 'environments') e where e ->> 'environment' = 'sandbox');
  perform tests.eq(sb, null::jsonb, 'nessun dato sandbox in questo banco: niente somme miste');

  r := public.admin_get_finance(date '2026-01-01');
  perform tests.eq((select (e #>> '{payments,count}')::integer from jsonb_array_elements(r -> 'environments') e
    where e ->> 'environment' = 'live'), 0, 'un altro mese: nessun pagamento');

  r := public.admin_get_workspace_finance(w2);
  perform tests.eq((r #>> '{subscriptions,0,mrr_cents}')::numeric, round(49000 / 12.0), 'scheda azienda: MRR dell''annuale');
  perform tests.eq(jsonb_array_length(r -> 'payments'), 1, 'e il suo pagamento');
  perform tests.logout();

  -- In sospeso: fuori dall'MRR, dentro il ricavo a rischio.
  perform tests.fin_service();
  perform public.billing_apply_event('live', jsonb_set(jsonb_set(jsonb_set(
    tests.fin_sub('live', 'evt_07g', 'sub_07w2', 'past_due', 'pri_01liveteamy', 49000, 'year', null),
    '{event_type}', '"subscription.past_due"'), '{occurred_at}', to_jsonb(now())), '{data,custom_data}', 'null'));
  perform tests.fin_admin();
  live := (select e from jsonb_array_elements(public.admin_get_finance() -> 'environments') e where e ->> 'environment' = 'live');
  perform tests.eq((live ->> 'mrr_cents')::numeric, 2900::numeric, 'il rinnovo in sospeso esce dall''MRR');
  perform tests.eq((live ->> 'at_risk_mrr_cents')::numeric, round(49000 / 12.0), 'ed è ricavo a rischio');
  perform tests.eq((live #>> '{subscriptions,past_due}')::integer, 1, 'contato a parte');
  perform tests.logout();
end $$;

rollback;
select 'admin finance: ok' as result;
