-- Area fondatore: rimborsi e contestazioni da verificare. Solo il fondatore con
-- secondo fattore; una voce si chiude con una nota e non riappare.
begin;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000015',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000016',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture M09');

create function tests.ab_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.ab_admin(p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000015', 'aal', p_aal)::text, true);
end $$;
grant execute on function tests.ab_service(), tests.ab_admin(text) to public;

do $$
declare
  ws uuid; co uuid; r jsonb; t0 timestamptz := date_trunc('second', now()) - interval '2 days';
  e1 timestamptz;
  sub jsonb;
begin
  e1 := t0 + interval '1 month';
  perform tests.login('Ow');
  ws := public.create_workspace('Fondatore: pagamenti');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();

  perform tests.ab_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  sub := jsonb_build_object('event_id', 'evt_06aa', 'event_type', 'subscription.created', 'occurred_at', t0,
    'data', jsonb_build_object('id', 'sub_06admin', 'customer_id', 'ctm_06admin', 'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', 'pri_01m577s3dchg2ctcrenkderz05'),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', t0, 'ends_at', e1),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', co)));
  perform public.billing_apply_event('sandbox', sub);
  perform public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_06ab',
    'event_type', 'transaction.completed', 'occurred_at', t0,
    'data', jsonb_build_object('id', 'txn_06first', 'origin', 'api', 'subscription_id', 'sub_06admin',
      'billing_period', jsonb_build_object('starts_at', t0, 'ends_at', e1),
      'details', jsonb_build_object('totals', jsonb_build_object('grand_total', '3538')))));
  -- Rimborso totale: accesso chiuso, ma l'abbonamento resta aperto su Paddle.
  perform public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_06ac',
    'event_type', 'adjustment.updated', 'occurred_at', t0 + interval '1 day',
    'data', jsonb_build_object('id', 'adj_06full', 'action', 'refund', 'type', 'full', 'status', 'approved',
      'transaction_id', 'txn_06first', 'subscription_id', 'sub_06admin',
      'totals', jsonb_build_object('total', '3538', 'currency_code', 'EUR'))));
  -- Contestazione su un pagamento non nel registro.
  perform public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_06ad',
    'event_type', 'adjustment.created', 'occurred_at', t0 + interval '1 day',
    'data', jsonb_build_object('id', 'adj_06dispute', 'action', 'chargeback', 'type', 'full', 'status', 'approved',
      'transaction_id', 'txn_06other', 'subscription_id', 'sub_06admin',
      'totals', jsonb_build_object('total', '3538', 'currency_code', 'EUR'))));
  -- Rimborso parziale: solo registrato, nessuna azione.
  perform public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_06ae',
    'event_type', 'adjustment.updated', 'occurred_at', t0 + interval '1 day',
    'data', jsonb_build_object('id', 'adj_06partial', 'action', 'refund', 'type', 'partial', 'status', 'approved',
      'transaction_id', 'txn_06first', 'subscription_id', 'sub_06admin',
      'totals', jsonb_build_object('total', '500', 'currency_code', 'EUR'))));
  perform tests.logout();

  -- Senza secondo fattore e per un titolare cliente: niente.
  perform tests.ab_admin('aal1');
  perform tests.raises('select public.admin_list_billing_adjustments()', 'admin_mfa_required', 'serve il secondo fattore');
  perform tests.login('Ow');
  perform tests.raises('select public.admin_list_billing_adjustments()', 'admin_not_allowed', 'il titolare non è il fondatore');
  perform tests.raises(format('select public.admin_resolve_billing_adjustment(''sandbox'', ''adj_06full'', ''tentativo'')'),
    'admin_not_allowed', 'il titolare non chiude le voci');

  perform tests.ab_admin();
  r := public.admin_list_billing_adjustments();
  perform tests.eq((r ->> 'open_total')::integer, 2, 'due voci chiedono un''azione');
  perform tests.eq((select string_agg(i ->> 'attention', ',' order by i ->> 'attention') from jsonb_array_elements(r -> 'items') i),
    'cancel_on_paddle,chargeback', 'disdetta da fare su Paddle e contestazione');
  perform tests.eq((select i ->> 'workspace_name' from jsonb_array_elements(r -> 'items') i where i ->> 'adjustment_id' = 'adj_06full'),
    'Fondatore: pagamenti', 'con il nome dell''azienda');
  r := public.admin_list_billing_adjustments(ws, false);
  perform tests.eq((r ->> 'total')::integer, 3, 'lo storico dell''azienda ha anche il parziale');

  perform tests.raises('select public.admin_resolve_billing_adjustment(''sandbox'', ''adj_06dispute'', ''ok'')',
    'admin_review_note_required', 'serve una nota vera');
  perform tests.raises('select public.admin_resolve_billing_adjustment(''sandbox'', ''adj_06partial'', ''niente da fare'')',
    'admin_review_not_open', 'una voce senza azione non si chiude');
  r := public.admin_resolve_billing_adjustment('sandbox', 'adj_06dispute', 'Contestazione vinta, nessuna azione');
  perform tests.eq(r ->> 'attention', null, 'chiusa');
  perform tests.eq(r ->> 'review_note', 'Contestazione vinta, nessuna azione', 'nota salvata');
  perform tests.raises('select public.admin_resolve_billing_adjustment(''sandbox'', ''adj_06dispute'', ''di nuovo'')',
    'admin_review_not_open', 'non si chiude due volte');
  perform tests.eq((public.admin_list_billing_adjustments() ->> 'open_total')::integer, 1, 'resta la disdetta da fare');
  perform tests.logout();

  -- Disdetta su Paddle: la voce si chiude da sola.
  perform tests.ab_service();
  perform public.billing_apply_event('sandbox', jsonb_set(jsonb_set(jsonb_set(sub, '{event_id}', '"evt_06af"'),
    '{occurred_at}', to_jsonb(t0 + interval '1 day 1 hour')), '{data,status}', '"canceled"')
    || jsonb_build_object('event_type', 'subscription.canceled'));
  perform tests.logout();
  perform tests.ab_admin();
  perform tests.eq((public.admin_list_billing_adjustments() ->> 'open_total')::integer, 0, 'disdetto: niente da fare');
  perform tests.logout();
end $$;

-- Avvisi Paddle scartati: in elenco con l'azienda se si riconosce, chiusi con una nota.
do $$
declare
  ws uuid; co uuid; r jsonb; item jsonb;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Fondatore: avvisi');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();
  perform tests.ab_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  r := public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_06rj', 'event_type', 'subscription.created',
    'occurred_at', now(), 'data', jsonb_build_object('id', 'sub_06rej', 'customer_id', 'ctm_06rej', 'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', 'pri_01nonincatalogo'),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now(), 'ends_at', now() + interval '1 month'),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', co))));
  perform tests.eq(r ->> 'error', 'unknown_price', 'avviso scartato: prezzo non nel catalogo');
  perform tests.logout();

  perform tests.login('Ow');
  perform tests.raises('select public.admin_list_rejected_billing_events()', 'admin_not_allowed', 'il titolare non vede gli avvisi');
  perform tests.ab_admin();
  r := public.admin_list_rejected_billing_events();
  item := (select i from jsonb_array_elements(r -> 'items') i where i ->> 'event_id' = 'evt_06rj');
  perform tests.eq(item ->> 'error', 'unknown_price', 'in elenco con il motivo');
  perform tests.eq(item ->> 'workspace_name', 'Fondatore: avvisi', 'e l''azienda dalla richiesta d''acquisto');
  perform tests.raises('select public.admin_resolve_billing_event(''sandbox'', ''evt_06rj'', ''no'')',
    'admin_review_note_required', 'serve una nota');
  perform public.admin_resolve_billing_event('sandbox', 'evt_06rj', 'Prezzo aggiunto al catalogo, abbonamento riallineato');
  perform tests.eq((select count(*)::integer from jsonb_array_elements(public.admin_list_rejected_billing_events() -> 'items') i
    where i ->> 'event_id' = 'evt_06rj'), 0, 'verificato: esce dall''elenco aperto');
  perform tests.eq((select i ->> 'review_note' from jsonb_array_elements(public.admin_list_rejected_billing_events(false) -> 'items') i
    where i ->> 'event_id' = 'evt_06rj'), 'Prezzo aggiunto al catalogo, abbonamento riallineato', 'resta nello storico con la nota');
  perform tests.raises('select public.admin_resolve_billing_event(''sandbox'', ''evt_06rj'', ''di nuovo'')',
    'admin_review_not_open', 'non si chiude due volte');
  perform tests.logout();
end $$;

rollback;
select 'admin billing: ok' as result;
