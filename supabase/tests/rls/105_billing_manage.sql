-- M09d: gestione dell'abbonamento. Solo il titolare, solo aumenti, mai con un
-- rinnovo in sospeso o una disdetta programmata.
begin;

create function tests.manage_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.manage_service() to public;

-- Un abbonamento attivo applicato come lo farebbe l'avviso di Paddle.
create function tests.manage_event(p_seq integer, p_ws_checkout uuid, p_status text,
  p_plan_price text, p_extra integer, p_change jsonb default null)
returns jsonb language sql as $$
  -- Un secondo in più a ogni avviso: l'ordine conta per gli eventi fuori sequenza.
  select jsonb_build_object('event_id', 'evt_01manage' || p_seq, 'event_type', 'subscription.updated',
    'occurred_at', now() + make_interval(secs => p_seq),
    'data', jsonb_build_object('id', 'sub_01manage', 'customer_id', 'ctm_01manage', 'status', p_status,
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', p_plan_price),
          'quantity', 1, 'status', 'active', 'recurring', true))
        || case when p_extra > 0 then jsonb_build_array(jsonb_build_object(
          'price', jsonb_build_object('id', 'pri_01m577z2zz69jyw4r3hm53warm'), 'quantity', p_extra,
          'status', 'active', 'recurring', true)) else '[]'::jsonb end,
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now() - interval '1 day',
        'ends_at', now() + interval '29 days'),
      'scheduled_change', p_change, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', p_ws_checkout)));
$$;
grant execute on function tests.manage_event(integer, uuid, text, text, integer, jsonb) to public;

do $$
begin
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_manage_context(text,uuid,uuid)', 'EXECUTE'), false, 'il client non legge il contesto Paddle');
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_prepare_change(text,uuid,uuid,text,integer)', 'EXECUTE'), false,
    'il client non prepara cambi scegliendo l''utente');
  perform tests.eq(has_function_privilege('authenticated',
    'private.billing_owner_subscription(text,uuid,uuid)', 'EXECUTE'), false, 'nemmeno l''aiuto interno');
end $$;

do $$
declare
  ws uuid; co uuid; r jsonb;
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Manage: azienda');
  perform public.create_venue(ws, 'Sede');
  perform tests.logout();

  perform tests.manage_service();
  perform tests.raises(format('select public.billing_manage_context(''sandbox'', %L, %L)', tests.id('Ow'), ws),
    'billing_no_subscription', 'senza abbonamento non c''è niente da gestire');

  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.manage_event(1, co, 'active', base_m, 0));

  r := public.billing_manage_context('sandbox', tests.id('Ow'), ws);
  perform tests.eq(r ->> 'subscription_id', 'sub_01manage', 'il titolare ottiene l''abbonamento');
  perform tests.eq(r ->> 'customer_id', 'ctm_01manage', 'e il cliente Paddle per il portale');
  perform tests.raises(format('select public.billing_manage_context(''live'', %L, %L)', tests.id('Ow'), ws),
    'billing_no_subscription', 'un abbonamento sandbox non vale in live');
  perform tests.raises(format('select public.billing_manage_context(''sandbox'', %L, %L)', tests.id('Co'), ws),
    'not_allowed', 'un estraneo all''azienda non gestisce');
  perform tests.raises(format('select public.billing_manage_context(''sandbox'', %L, %L)', tests.id('Co'), tests.id('W1')),
    'not_allowed', 'il collaboratore non gestisce l''abbonamento');

  -- Aumenti.
  r := public.billing_prepare_change('sandbox', tests.id('Ow'), ws, 'team', 1);
  perform tests.eq(r ->> 'plan_price_id', team_m, 'Team mensile, stesso ciclo');
  perform tests.eq(r ->> 'extra_price_id', 'pri_01m577z2zz69jyw4r3hm53warm', 'sede aggiuntiva mensile');
  perform tests.eq(r #>> '{known_prices,pri_01m577s3dchg2ctcrenkderz05}', 'base', 'riconosce l''articolo attuale');
  r := public.billing_prepare_change('sandbox', tests.id('Ow'), ws, 'base', 2);
  perform tests.eq((r ->> 'extra_venues')::integer, 2, 'più sedi restando su Base');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''base'', 0)', tests.id('Ow'), ws),
    'billing_no_change', 'stessa capacità: niente da cambiare');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''pro'', 0)', tests.id('Ow'), ws),
    'billing_invalid_selection', 'piani inventati rifiutati');

  -- Dopo l'upgrade a Team con una sede in più, le riduzioni restano assistite.
  perform public.billing_apply_event('sandbox', tests.manage_event(2, co, 'active', team_m, 1));
  r := public.billing_prepare_lifecycle('sandbox', tests.id('Ow'), ws, 'pause');
  perform tests.eq(r ->> 'subscription_id', 'sub_01manage', 'abbonamento attivo: la pausa è ammessa');
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''resume'')', tests.id('Ow'), ws),
    'billing_not_paused', 'non si riparte da un abbonamento attivo');
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''pause'')', tests.id('Co'), ws),
    'not_allowed', 'solo il titolare mette in pausa');
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''stop'')', tests.id('Ow'), ws),
    'billing_invalid_selection', 'azioni inventate rifiutate');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''base'', 1)', tests.id('Ow'), ws),
    'billing_downgrade_unsupported', 'da Team a Base non dalla pagina');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 0)', tests.id('Ow'), ws),
    'billing_downgrade_unsupported', 'meno sedi non dalla pagina');

  -- Disdetta programmata: prima si riprendono i rinnovi.
  perform public.billing_apply_event('sandbox', tests.manage_event(3, co, 'active', team_m, 1,
    jsonb_build_object('action', 'cancel', 'effective_at', now() + interval '29 days')));
  perform tests.eq(public.billing_manage_context('sandbox', tests.id('Ow'), ws) ->> 'scheduled_change', 'cancel',
    'il contesto dice che la disdetta è programmata');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 2)', tests.id('Ow'), ws),
    'billing_change_scheduled', 'nessun aumento con la disdetta programmata');
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''pause'')', tests.id('Ow'), ws),
    'billing_change_scheduled', 'nessuna pausa sopra una disdetta programmata');

  -- Rinnovo in sospeso: niente cambi finché il pagamento non torna.
  perform public.billing_apply_event('sandbox', tests.manage_event(4, co, 'past_due', team_m, 1));
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 2)', tests.id('Ow'), ws),
    'billing_past_due', 'nessun aumento con il rinnovo in sospeso');
  perform tests.eq(public.billing_manage_context('sandbox', tests.id('Ow'), ws) ->> 'status', 'past_due',
    'ma il portale resta raggiungibile per aggiornare la carta');
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''pause'')', tests.id('Ow'), ws),
    'billing_past_due', 'nessuna pausa con il rinnovo in sospeso');

  -- Pausa effettiva: consultazione; poi la ripartenza apre un periodo nuovo.
  perform public.billing_apply_event('sandbox', tests.manage_event(5, co, 'paused', team_m, 1));
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''pause'')', tests.id('Ow'), ws),
    'billing_paused', 'già in pausa');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 2)', tests.id('Ow'), ws),
    'billing_paused', 'niente aumenti in pausa');
  r := public.billing_prepare_lifecycle('sandbox', tests.id('Ow'), ws, 'resume');
  perform tests.eq(r ->> 'subscription_id', 'sub_01manage', 'in pausa: la ripartenza è ammessa');
  perform tests.logout();
  perform tests.eq(private.workspace_access_at(ws, now() + interval '1 minute') ->> 'state', 'archive',
    'in pausa: consultazione ed export');
  perform tests.login('Ow');
  perform tests.eq(public.get_workspace_billing(ws) ->> 'status', 'paused', 'il titolare vede la pausa');
  perform tests.eq(public.get_workspace_billing(ws) ? 'paused_at', true, 'con la data di inizio (vuota senza Paddle)');
  perform tests.logout();

  perform tests.manage_service();
  perform public.billing_apply_event('sandbox', jsonb_set(jsonb_set(tests.manage_event(6, co, 'active', team_m, 1),
    '{data,current_billing_period,starts_at}', to_jsonb(now() + interval '6 seconds')),
    '{data,current_billing_period,ends_at}', to_jsonb(now() + interval '1 month')));
  perform tests.logout();
  perform tests.eq(private.workspace_access_at(ws, now() + interval '1 minute') ->> 'state', 'operational',
    'ripartita: di nuovo operativa');

  -- Con la gratuità a vita non si paga per ripartire.
  perform tests.manage_service();
  perform public.billing_apply_event('sandbox', tests.manage_event(7, co, 'paused', team_m, 1));
  perform tests.logout();
  insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason)
  values (ws, 'complimentary_lifetime', 'team', 2, now() - interval '1 minute', null, 'Fixture M11');
  perform tests.manage_service();
  perform tests.raises(format('select public.billing_prepare_lifecycle(''sandbox'', %L, %L, ''resume'')', tests.id('Ow'), ws),
    'billing_not_needed', 'gratuità a vita: niente checkout per ripartire');
  perform tests.logout();
end $$;

rollback;
select 'billing manage: ok' as result;
