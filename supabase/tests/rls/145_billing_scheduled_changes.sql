-- Cambio piano al rinnovo: riduzioni e cambio di ciclo si programmano, non si
-- applicano. Solo il titolare, un solo cambio aperto per abbonamento, mai a
-- meno di 24 ore dal rinnovo né oltre la capacità futura.
begin;

create function tests.sched_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.sched_service() to public;

-- Abbonamento mensile applicato come lo farebbe l'avviso di Paddle; `p_ends`
-- è la fine del periodo, cioè il prossimo rinnovo.
create function tests.sched_event(p_seq integer, p_checkout uuid, p_plan_price text,
  p_extra integer, p_ends timestamptz, p_change jsonb default null, p_status text default 'active')
returns jsonb language sql as $$
  select jsonb_build_object('event_id', 'evt_01sched' || p_seq, 'event_type', 'subscription.updated',
    'occurred_at', now() + make_interval(secs => p_seq),
    'data', jsonb_build_object('id', 'sub_01sched', 'customer_id', 'ctm_01sched', 'status', p_status,
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', p_plan_price),
          'quantity', 1, 'status', 'active', 'recurring', true))
        || case when p_extra > 0 then jsonb_build_array(jsonb_build_object(
          'price', jsonb_build_object('id', 'pri_01m577z2zz69jyw4r3hm53warm'), 'quantity', p_extra,
          'status', 'active', 'recurring', true)) else '[]'::jsonb end,
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', p_ends),
      'scheduled_change', p_change, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', p_checkout)));
$$;
grant execute on function tests.sched_event(integer, uuid, text, integer, timestamptz, jsonb, text) to public;

-- Superficie: porte del servizio, tabella chiusa ai client.
do $$
begin
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_prepare_scheduled_change(text,uuid,uuid,text,text,integer)', 'EXECUTE'), false,
    'il client non prepara cambi programmati');
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_record_scheduled_change(text,uuid,uuid,text,text,integer,jsonb,jsonb,bigint,text)',
    'EXECUTE'), false, 'il client non registra cambi programmati');
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_cancel_scheduled_change(text,uuid,uuid)', 'EXECUTE'), false,
    'il client non annulla scegliendo l''utente');
  perform tests.eq(has_function_privilege('service_role',
    'public.billing_record_scheduled_change(text,uuid,uuid,text,text,integer,jsonb,jsonb,bigint,text)',
    'EXECUTE'), true, 'il servizio registra');
  perform tests.eq(has_function_privilege('authenticated',
    'private.billing_scheduled_rules_error(uuid,text,text,integer)', 'EXECUTE'), false,
    'nemmeno le regole interne');
  perform tests.eq(has_table_privilege('service_role', 'public.billing_scheduled_changes', 'UPDATE'), true,
    'il servizio aggiorna le righe');
  perform tests.eq(has_table_privilege('service_role', 'public.billing_scheduled_changes', 'INSERT'), false,
    'ma le crea solo la RPC');
  perform tests.login('Ow');
  perform tests.raises('select * from public.billing_scheduled_changes', 'permission denied',
    'il titolare non legge la tabella dei cambi');
  perform tests.logout();
end $$;

do $$
declare
  ws uuid; co uuid; va uuid; vb uuid; extra_one uuid; r jsonb; mid uuid; cid uuid;
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
  base_y text := 'pri_01m577th8zt8x41cxk2p8m5n63';
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
  team_y text := 'pri_01m577wqj8atr0sjvy8xhybwf1';
  extra_m text := 'pri_01m577z2zz69jyw4r3hm53warm';
  extra_y text := 'pri_01m577zzw0kv3c91yqttd0kk6k';
  from_items jsonb; base_items jsonb; people integer; row public.billing_scheduled_changes;
begin
  from_items := jsonb_build_array(jsonb_build_object('price_id', team_m, 'quantity', 1),
    jsonb_build_object('price_id', extra_m, 'quantity', 1));
  base_items := jsonb_build_array(jsonb_build_object('price_id', base_m, 'quantity', 1),
    jsonb_build_object('price_id', extra_m, 'quantity', 1));

  perform tests.login('Ow');
  ws := public.create_workspace('Cambio programmato: azienda');
  va := public.create_venue(ws, 'Sede A');
  perform tests.logout();

  -- Team mensile con una sede in più, rinnovo fra 29 giorni.
  perform tests.sched_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.sched_event(1, co, team_m, 1, now() + interval '29 days'));
  perform tests.raises(format('select public.billing_cancel_scheduled_change(''sandbox'', %L, %L)', tests.id('Ow'), ws),
    'billing_nothing_scheduled', 'niente da annullare senza un cambio');

  -- Due sedi aperte, un collaboratore, un dipendente e la squadra fino a 30 persone.
  perform tests.login('Ow');
  vb := public.create_venue(ws, 'Sede B');
  r := public.add_member(ws, '{"full_name":"Carlo","email":"co@t.test"}'::jsonb, 'collaborator',
    '{"shifts":true}'::jsonb, 'all', '[]'::jsonb);
  perform tests.login('Co'); perform public.respond_to_invite((r ->> 'member_id')::uuid, true);
  perform tests.login('Ow');
  r := public.add_member(ws, '{"full_name":"Emma","email":"emp@t.test"}'::jsonb, 'none', '{}'::jsonb, 'all',
    jsonb_build_array(jsonb_build_object('venue_id', va)));
  perform tests.login('Emp'); perform public.respond_to_invite((r ->> 'member_id')::uuid, true);
  perform tests.login('Ow');
  people := (public.get_workspace_access(ws) #>> '{usage,people}')::integer;
  for i in people + 1..30 loop
    perform public.add_member(ws, jsonb_build_object('full_name', 'Persona ' || i), 'none', '{}', 'all',
      jsonb_build_array(jsonb_build_object('venue_id', va)));
  end loop;
  perform tests.eq((public.get_workspace_access(ws) #>> '{usage,people}')::integer, 30, '30 persone uniche');
  perform tests.logout();

  -- Chi non è titolare non programma e non annulla.
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1)',
    tests.id('Co'), ws), 'not_allowed', 'il collaboratore non programma cambi');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1)',
    tests.id('Emp'), ws), 'not_allowed', 'il dipendente non programma cambi');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Co'), ws, from_items, base_items), 'not_allowed', 'il collaboratore non registra cambi');
  perform tests.raises(format('select public.billing_cancel_scheduled_change(''sandbox'', %L, %L)', tests.id('Emp'), ws),
    'not_allowed', 'il dipendente non annulla');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''live'', %L, %L, ''base'', ''month'', 1)',
    tests.id('Ow'), ws), 'billing_no_subscription', 'un abbonamento sandbox non vale in live');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''base'', ''week'', 1)',
    tests.id('Ow'), ws), 'billing_invalid_selection', 'cicli inventati rifiutati');

  -- Team→Base con 30 persone: ammesso, al prossimo rinnovo.
  r := public.billing_prepare_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 1);
  perform tests.eq(r ->> 'subscription_id', 'sub_01sched', 'l''abbonamento Paddle da modificare');
  perform tests.eq((r ->> 'effective_at')::timestamptz, now() + interval '29 days', 'effetto al rinnovo');
  perform tests.eq(r ->> 'current_plan', 'team', 'piano di oggi');
  perform tests.eq(r ->> 'current_interval', 'month', 'ciclo di oggi');
  perform tests.eq(r ->> 'plan_price_id', base_m, 'Base mensile');
  perform tests.eq(r ->> 'extra_price_id', extra_m, 'sede in più mensile');
  perform tests.eq(r -> 'known_prices' ->> team_m, 'team', 'riconosce l''articolo attuale');

  -- Con 31 persone Base non basta.
  perform tests.login('Ow');
  mid := (public.add_member(ws, '{"full_name":"Trentunesima"}', 'none', '{}', 'all',
    jsonb_build_array(jsonb_build_object('venue_id', vb))) ->> 'member_id')::uuid;
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1)',
    tests.id('Ow'), ws), 'billing_scheduled_people', 'Base con 31 persone rifiutato');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, base_items), 'billing_scheduled_people', 'e non si registra');
  perform tests.login('Ow');
  perform public.remove_member(mid);

  -- Meno sedi: solo se le sedi aperte stanno già nella capacità futura.
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_scheduled_venues', 'due sedi aperte non stanno in una');
  perform tests.login('Ow');
  perform public.set_venue_closed(vb, true);
  perform tests.sched_service();
  r := public.billing_prepare_scheduled_change('sandbox', tests.id('Ow'), ws, 'team', 'month', 0);
  perform tests.eq(r ->> 'extra_price_id', extra_m, 'chiusa la seconda sede, la riduzione è ammessa');

  -- Aumenti e niente di nuovo restano fuori.
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''month'', 2)',
    tests.id('Ow'), ws), 'billing_scheduled_not_reduction', 'più sedi passano dall''aumento immediato');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 2)',
    tests.id('Ow'), ws), 'billing_scheduled_not_reduction', 'anche insieme al cambio di ciclo');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''month'', 1)',
    tests.id('Ow'), ws), 'billing_no_change', 'la stessa scelta non è un cambio');

  -- Solo il ciclo: ammesso, con i prezzi annuali.
  r := public.billing_prepare_scheduled_change('sandbox', tests.id('Ow'), ws, 'team', 'year', 1);
  perform tests.eq(r ->> 'plan_price_id', team_y, 'Team annuale');
  perform tests.eq(r ->> 'extra_price_id', extra_y, 'sede in più annuale');

  -- Troppo vicino al rinnovo: il lavoro d'invio non farebbe in tempo.
  perform public.billing_apply_event('sandbox', tests.sched_event(2, co, team_m, 1, now() + interval '23 hours'));
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 1)',
    tests.id('Ow'), ws), 'billing_too_close_to_renewal', 'meno di 24 ore al rinnovo');

  -- Pausa programmata su Paddle: prima si riprende.
  perform public.billing_apply_event('sandbox', tests.sched_event(3, co, team_m, 1, now() + interval '25 hours',
    jsonb_build_object('action', 'pause', 'effective_at', now() + interval '25 hours')));
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 1)',
    tests.id('Ow'), ws), 'billing_change_scheduled', 'nessun cambio sopra una pausa programmata');

  -- Rinnovo in sospeso: niente cambi.
  perform public.billing_apply_event('sandbox', tests.sched_event(4, co, team_m, 1, now() + interval '25 hours',
    null, 'past_due'));
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 1)',
    tests.id('Ow'), ws), 'billing_past_due', 'nessun cambio con il rinnovo in sospeso');

  -- Registrazione a 25 ore dal rinnovo.
  perform public.billing_apply_event('sandbox', tests.sched_event(5, co, team_m, 1, now() + interval '25 hours'));

  -- Gli articoli d'arrivo devono descrivere esattamente il punto d'arrivo.
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, from_items), 'billing_invalid_selection', 'un articolo Team su un arrivo Base');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, jsonb_set(base_items, '{1,quantity}', '2')), 'billing_invalid_selection',
    'sedi in più diverse dalla scelta');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 0, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, base_items), 'billing_invalid_selection', 'una sede in più senza sedi in più');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, jsonb_set(base_items, '{1,price_id}', '"pri_01sconosciuto"')),
    'billing_invalid_selection', 'un prezzo sconosciuto');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, jsonb_set(base_items, '{1,price_id}', to_jsonb(extra_y))),
    'billing_invalid_selection', 'un prezzo di un altro ciclo');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, jsonb_set(base_items, '{0,quantity}', '"1"')),
    'billing_invalid_selection', 'una quantità che non è un numero');
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, '{}', base_items), 'billing_invalid_selection', 'articoli di oggi che non sono un elenco');

  -- Un prezzo non più proposto resta valido solo per l'articolo che c'era già.
  perform tests.logout();
  insert into private.billing_prices (environment, price_id, item, billing_interval, selectable)
  values ('sandbox', 'pri_01vecchiasede', 'extra_venue', 'month', false);
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 1, %L, %L, 2900, ''EUR'')',
    tests.id('Ow'), ws, from_items, jsonb_set(base_items, '{1,price_id}', '"pri_01vecchiasede"')),
    'billing_invalid_selection', 'un vecchio prezzo che oggi non c''è');
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 1,
    jsonb_set(from_items, '{1,price_id}', '"pri_01vecchiasede"'),
    jsonb_set(base_items, '{1,price_id}', '"pri_01vecchiasede"'), 2900, 'EUR');
  perform tests.ok(cid is not null, 'la sede in più invariata tiene il suo vecchio prezzo');
  perform public.billing_cancel_scheduled_change('sandbox', tests.id('Ow'), ws);

  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 1,
    from_items, base_items, 2900, 'EUR');
  perform tests.logout();
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status, 'pending', 'il cambio nasce in attesa');
  perform tests.eq(row.effective_at, now() + interval '25 hours', 'con la data del rinnovo');
  perform tests.eq(row.workspace_id, ws, 'dell''azienda');
  perform tests.eq(row.target_plan || '/' || row.target_interval || '/' || row.target_extra_venues,
    'base/month/1', 'il punto d''arrivo');
  perform tests.eq(row.from_items, from_items, 'gli articoli di oggi, per riconoscere un cambio nel frattempo');
  perform tests.eq(row.from_interval, 'month', 'e il ciclo di oggi, per riconoscere un cambio di ciclo');
  perform tests.eq(row.target_items, base_items, 'gli articoli d''arrivo dell''anteprima');
  perform tests.eq(row.renewal_cents || ' ' || row.currency, '2900 EUR', 'l''importo del rinnovo mostrato');
  perform tests.eq(row.requested_by, tests.id('Ow'), 'chi l''ha chiesto');
  perform tests.eq(row.attempts, 0, 'nessun tentativo d''invio');
  perform tests.raises(format(
    'insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, '
    'target_interval, target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, '
    'requested_by, from_interval) select subscription_id, workspace_id, environment, ''team'', ''year'', 1, from_items, '
    'target_items, 1, ''EUR'', effective_at, requested_by, from_interval from public.billing_scheduled_changes where id = %L', cid),
    'duplicate key', 'un solo cambio aperto per abbonamento, anche scrivendo a mano');

  -- Un cambio aperto blocca il secondo e gli aumenti immediati.
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_record_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 1, %L, %L, 29000, ''EUR'')',
    tests.id('Ow'), ws, from_items, base_items), 'billing_change_pending', 'un solo cambio in attesa');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 1)',
    tests.id('Ow'), ws), 'billing_change_pending', 'anche in anteprima');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 2)',
    tests.id('Ow'), ws), 'billing_change_pending', 'l''aumento chiede di annullare prima il cambio');

  -- Annullamento prima della finestra d'invio.
  perform public.billing_cancel_scheduled_change('sandbox', tests.id('Ow'), ws);
  perform tests.logout();
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason, 'canceled/owner', 'annullato dal titolare');
  perform tests.eq(row.closed_by, tests.id('Ow'), 'con l''autore');
  perform tests.ok(row.closed_at is not null, 'e l''istante');
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_cancel_scheduled_change(''sandbox'', %L, %L)', tests.id('Ow'), ws),
    'billing_nothing_scheduled', 'annullato una volta, non c''è altro da annullare');
  r := public.billing_prepare_change('sandbox', tests.id('Ow'), ws, 'team', 2);
  perform tests.eq(r ->> 'plan_price_id', team_m, 'annullato il cambio, l''aumento torna possibile');

  -- Dentro la finestra d'invio l'annullamento non è più del titolare.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'team', 'year', 1,
    from_items, jsonb_build_array(jsonb_build_object('price_id', team_y, 'quantity', 1),
      jsonb_build_object('price_id', extra_y, 'quantity', 1)), 29000, 'EUR');
  perform tests.logout();
  -- Il tempo passa: mancano 23 ore al rinnovo.
  update public.billing_scheduled_changes set effective_at = now() + interval '23 hours' where id = cid;
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_cancel_scheduled_change(''sandbox'', %L, %L)', tests.id('Ow'), ws),
    'billing_change_already_sent', 'a 23 ore dal rinnovo il cambio è già in invio');
  perform tests.logout();
  update public.billing_scheduled_changes set effective_at = now() + interval '25 hours',
    status = 'applied', applied_at = now() where id = cid;
  perform tests.sched_service();
  perform tests.raises(format('select public.billing_cancel_scheduled_change(''sandbox'', %L, %L)', tests.id('Ow'), ws),
    'billing_change_already_sent', 'già inviato a Paddle: non si annulla');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 2)',
    tests.id('Ow'), ws), 'billing_change_pending', 'né si aumenta');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;

  -- Da Base, Team è un aumento: non si programma.
  perform tests.sched_service();
  perform public.billing_apply_event('sandbox', tests.sched_event(6, co, base_m, 1, now() + interval '29 days'));
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''month'', 1)',
    tests.id('Ow'), ws), 'billing_scheduled_not_reduction', 'Base→Team passa dall''aumento immediato');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 1)',
    tests.id('Ow'), ws), 'billing_scheduled_not_reduction', 'anche insieme al cambio di ciclo');
  r := public.billing_prepare_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'year', 1);
  perform tests.eq(r ->> 'plan_price_id', base_y, 'Base mensile→annuale ammesso');
  perform tests.logout();

  perform tests.eq(private.billing_scheduled_rules_error(
    (select id from public.billing_subscriptions where workspace_id = ws), 'base', 'year', 1), null::text,
    'le regole, senza finestra né riga aperta, ammettono il cambio');
end $$;

-- Dopo la richiesta: gli avvisi di Paddle chiudono o confermano il cambio
-- aperto. Prosegue sull'abbonamento del blocco precedente, ora Base mensile
-- con una sede in più e rinnovo fra 29 giorni.
create function tests.sched_apply(p_event jsonb, p_starts timestamptz default null,
  p_interval text default null) returns void language plpgsql as $$
declare ev jsonb := p_event; r jsonb;
begin
  if p_starts is not null then
    ev := jsonb_set(ev, '{data,current_billing_period,starts_at}', to_jsonb(p_starts));
  end if;
  if p_interval is not null then
    ev := jsonb_set(ev, '{data,billing_cycle,interval}', to_jsonb(p_interval));
  end if;
  r := public.billing_apply_event('sandbox', ev);
  if r ->> 'outcome' is distinct from 'applied' then
    raise exception 'FAIL: avviso % non applicato: %', ev ->> 'event_id', r;
  end if;
end $$;
grant execute on function tests.sched_apply(jsonb, timestamptz, text) to public;

do $$
declare
  ws uuid; sid uuid; cid uuid; ends timestamptz; row public.billing_scheduled_changes;
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
  base_y text := 'pri_01m577th8zt8x41cxk2p8m5n63';
  extra_m text := 'pri_01m577z2zz69jyw4r3hm53warm';
  one_extra jsonb; no_extra jsonb; yearly jsonb;
begin
  one_extra := jsonb_build_array(jsonb_build_object('price_id', base_m, 'quantity', 1),
    jsonb_build_object('price_id', extra_m, 'quantity', 1));
  no_extra := jsonb_build_array(jsonb_build_object('price_id', base_m, 'quantity', 1));
  yearly := jsonb_build_array(jsonb_build_object('price_id', base_y, 'quantity', 1));
  select id into ws from public.workspaces where name = 'Cambio programmato: azienda';
  select id, current_period_ends_at into sid, ends from public.billing_subscriptions where workspace_id = ws;

  -- Un avviso che non tocca nessuna regola lascia il cambio in attesa.
  perform tests.sched_service();
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    one_extra, no_extra, 2900, 'EUR');
  perform tests.sched_apply(tests.sched_event(10, null, base_m, 1, ends));
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'pending',
    'un avviso qualunque non tocca il cambio in attesa');

  -- Pausa programmata dal portale: il cambio in attesa si annulla.
  perform tests.sched_apply(tests.sched_event(11, null, base_m, 1, ends,
    jsonb_build_object('action', 'pause', 'effective_at', ends)));
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason, 'canceled/paused', 'pausa programmata: annullato');
  perform tests.ok(row.closed_at is not null, 'con l''istante');
  perform tests.eq(row.closed_by, null::uuid, 'senza autore: l''ha chiuso Paddle');
  perform tests.eq(row.alert_kind, null::text, 'e senza allarme');

  -- Disdetta programmata.
  perform tests.sched_apply(tests.sched_event(12, null, base_m, 1, ends));
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    one_extra, no_extra, 2900, 'EUR');
  perform tests.sched_apply(tests.sched_event(13, null, base_m, 1, ends,
    jsonb_build_object('action', 'cancel', 'effective_at', ends)));
  perform tests.eq((select status || '/' || close_reason from public.billing_scheduled_changes where id = cid),
    'canceled/canceled', 'disdetta programmata: annullato');

  -- Rinnovo non riuscito.
  perform tests.sched_apply(tests.sched_event(14, null, base_m, 1, ends));
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    one_extra, no_extra, 2900, 'EUR');
  perform tests.sched_apply(tests.sched_event(15, null, base_m, 1, ends, null, 'past_due'));
  perform tests.eq((select status || '/' || close_reason from public.billing_scheduled_changes where id = cid),
    'canceled/past_due', 'rinnovo in sospeso: annullato');

  -- Pausa immediata.
  perform tests.sched_apply(tests.sched_event(16, null, base_m, 1, ends));
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    one_extra, no_extra, 2900, 'EUR');
  perform tests.sched_apply(tests.sched_event(17, null, base_m, 1, ends, null, 'paused'));
  perform tests.eq((select status || '/' || close_reason from public.billing_scheduled_changes where id = cid),
    'canceled/paused', 'abbonamento in pausa: annullato');
  perform tests.sched_apply(tests.sched_event(18, null, base_m, 1, ends));

  -- Inviato a Paddle: una pausa solo programmata non lo chiude (se il titolare
  -- la annulla, il rinnovo avviene col piano nuovo), la pausa vera sì.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    one_extra, no_extra, 2900, 'EUR');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() where id = cid;
  perform tests.sched_service();
  perform tests.sched_apply(tests.sched_event(19, null, base_m, 0, ends,
    jsonb_build_object('action', 'pause', 'effective_at', ends)));
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'applied',
    'inviato: la pausa programmata non lo chiude');
  perform tests.sched_apply(tests.sched_event(20, null, base_m, 0, ends, null, 'paused'));
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason, 'canceled/paused', 'inviato e poi in pausa: annullato');
  perform tests.ok(row.closed_at is not null, 'con l''istante');
  perform tests.sched_apply(tests.sched_event(21, null, base_m, 1, ends));

  -- Inviato, rinnovo non riuscito: resta inviato; al recupero è confermato.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    one_extra, no_extra, 2900, 'EUR');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() where id = cid;
  perform tests.sched_service();
  -- L'avviso della nostra PATCH: articoli nuovi, periodo di prima.
  perform tests.sched_apply(tests.sched_event(22, null, base_m, 0, ends));
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'applied',
    'prima del rinnovo resta inviato');
  perform tests.sched_apply(tests.sched_event(23, null, base_m, 0, ends + interval '1 month', null, 'past_due'),
    ends);
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'applied',
    'rinnovo in sospeso dopo l''invio: resta inviato');
  perform tests.sched_apply(tests.sched_event(24, null, base_m, 0, ends + interval '1 month'), ends);
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status, 'confirmed', 'recuperato il rinnovo col piano nuovo: confermato');
  perform tests.ok(row.confirmed_at is not null, 'con l''istante della conferma');
  perform tests.eq(row.close_reason, null::text, 'senza motivo di chiusura');
  ends := ends + interval '1 month';

  -- Rinnovo con articoli diversi dall'arrivo: da verificare.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'year', 0,
    no_extra, yearly, 29000, 'EUR');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() where id = cid;
  perform tests.sched_service();
  perform tests.sched_apply(tests.sched_event(25, null, base_m, 0, ends + interval '1 month'), ends);
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason, 'failed/renewal_mismatch',
    'rinnovato mensile invece che annuale: da verificare');
  perform tests.eq(row.alert_kind, 'renewal_mismatch', 'con l''allarme al fondatore');
  perform tests.ok(row.closed_at is not null, 'e l''istante');
  perform tests.eq(row.confirmed_at, null::timestamptz, 'mai confermato');
  ends := ends + interval '1 month';

  -- Rinnovo coerente, qualche minuto prima della data registrata: confermato.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'year', 0,
    no_extra, yearly, 29000, 'EUR');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() where id = cid;
  perform tests.sched_service();
  perform tests.sched_apply(tests.sched_event(26, null, base_y, 0, ends + interval '1 year'),
    ends - interval '2 minutes', 'year');
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'confirmed',
    'Base annuale come richiesto: confermato');
  ends := ends + interval '1 year';

  -- Mai inviato e rinnovato agli articoli di prima: da verificare, perché il
  -- rinnovo al prezzo vecchio non deve passare inosservato.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    yearly, no_extra, 2900, 'EUR');
  perform tests.sched_apply(tests.sched_event(27, null, base_y, 0, ends + interval '1 year'), ends, 'year');
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason, 'failed/renewal_mismatch',
    'mai inviato e rinnovato annuale: da verificare');
  perform tests.eq(row.alert_kind, 'renewal_mismatch', 'con l''allarme al fondatore');
  perform tests.ok(row.closed_at is not null, 'e l''istante');
  ends := ends + interval '1 year';

  -- Mai inviato ma rinnovato già al punto d'arrivo (cambiato a mano su Paddle):
  -- confermato, senza allarme a vuoto.
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    yearly, no_extra, 2900, 'EUR');
  perform tests.sched_apply(tests.sched_event(28, null, base_m, 0, ends + interval '1 month'), ends);
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status, 'confirmed', 'mai inviato ma già al punto d''arrivo: confermato');
  perform tests.eq(row.alert_kind, null::text, 'senza allarme');
  ends := ends + interval '1 month';

  -- Inviato e poi chiuso: annullato col motivo.
  perform tests.logout();
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment,
    target_plan, target_interval, target_extra_venues, from_items, target_items, renewal_cents,
    currency, effective_at, requested_by, status, applied_at, from_interval)
  values (sid, ws, 'sandbox', 'base', 'year', 0, no_extra, yearly, 29000, 'EUR', ends,
    tests.id('Ow'), 'applied', now(), 'month')
  returning id into cid;
  perform tests.sched_service();
  perform tests.sched_apply(tests.sched_event(29, null, base_m, 0, ends, null, 'canceled'));
  perform tests.eq((select status || '/' || close_reason from public.billing_scheduled_changes where id = cid),
    'canceled/canceled', 'inviato e poi chiuso: annullato');
  perform tests.logout();

  perform tests.eq(has_function_privilege('authenticated', 'private.billing_scheduled_reconcile()', 'EXECUTE'),
    false, 'il client non esegue la riconciliazione');
end $$;

-- Capacità futura: con un cambio aperto verso un piano più piccolo non si
-- cresce oltre ciò che entrerà al rinnovo; uscire e chiudere restano liberi.
do $$
declare
  ws uuid; co uuid; va uuid; vb uuid; sid uuid; cid uuid; r jsonb; mid uuid; people integer;
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
  ev jsonb;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Capacità futura: azienda');
  va := public.create_venue(ws, 'Sede A');
  perform tests.logout();
  perform tests.sched_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  ev := jsonb_set(jsonb_set(tests.sched_event(40, co, team_m, 1, now() + interval '29 days'),
    '{data,id}', '"sub_01capfut"'), '{data,customer_id}', '"ctm_01capfut"');
  r := public.billing_apply_event('sandbox', ev);
  perform tests.eq(r ->> 'outcome', 'applied', 'abbonamento Team con una sede in più');
  perform tests.logout();

  perform tests.login('Ow');
  vb := public.create_venue(ws, 'Sede B');
  people := (public.get_workspace_access(ws) #>> '{usage,people}')::integer;
  for i in people + 1..31 loop
    mid := (public.add_member(ws, jsonb_build_object('full_name', 'Futura ' || i), 'none', '{}', 'all',
      jsonb_build_array(jsonb_build_object('venue_id', va))) ->> 'member_id')::uuid;
  end loop;
  perform tests.eq((public.get_workspace_access(ws) #>> '{usage,people}')::integer, 31, '31 persone, Team non ha limite');
  perform tests.logout();

  -- Senza cambio aperto la capacità futura non esiste.
  select id into sid from public.billing_subscriptions where provider_subscription_id = 'sub_01capfut';
  perform tests.ok(private.billing_future_limits(ws) is null, 'senza riga aperta nessun limite futuro');

  -- Cambio aperto Team→Base senza sedi in più (la riga è scritta come farebbe l'invio).
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment,
    target_plan, target_interval, target_extra_venues, from_items, target_items, renewal_cents,
    currency, effective_at, requested_by, status, from_interval)
  values (sid, ws, 'sandbox', 'base', 'month', 0,
    '[{"price_id":"pri_01m577vzt1b6qkyyf80pnq4aj9","quantity":1},{"price_id":"pri_01m577z2zz69jyw4r3hm53warm","quantity":1}]'::jsonb,
    '[{"price_id":"pri_01m577s3dchg2ctcrenkderz05","quantity":1}]'::jsonb, 2900, 'EUR',
    now() + interval '29 days', tests.id('Ow'), 'pending', 'month')
  returning id into cid;
  perform tests.eq(private.billing_future_limits(ws), jsonb_build_object('people', 30, 'venues', 1),
    'limiti futuri di Base senza sedi in più');

  -- Uscire e chiudere si può sempre, anche oltre il limite futuro.
  perform tests.login('Ow');
  perform public.remove_member(mid);
  perform public.set_venue_closed(vb, true);
  perform tests.eq((public.get_workspace_access(ws) #>> '{usage,people}')::integer, 30, 'uscita sempre possibile');
  -- 30 è il tetto di Base: la trentunesima persona no.
  perform tests.raises(format('select public.add_member(%L,''{"full_name":"Oltre"}'',''none'',''{}'',''all'',%L)',
    ws, jsonb_build_array(jsonb_build_object('venue_id', va))), 'workspace_people_capacity_scheduled',
    'persona oltre il tetto del piano futuro');
  -- Riaprire la sede in più eccede la capacità futura (una sola sede).
  perform tests.raises(format('select public.set_venue_closed(%L,false)', vb),
    'workspace_venue_capacity_scheduled', 'sede riaperta oltre la capacità futura');
  perform tests.logout();

  -- Annullato il cambio, torna tutto come prima.
  update public.billing_scheduled_changes set status = 'canceled', close_reason = 'canceled',
    closed_at = now() where id = cid;
  perform tests.ok(private.billing_future_limits(ws) is null, 'annullato: nessun limite futuro');
  perform tests.login('Ow');
  perform public.add_member(ws, '{"full_name":"Dopo annullo"}', 'none', '{}', 'all',
    jsonb_build_array(jsonb_build_object('venue_id', va)));
  perform public.set_venue_closed(vb, false);
  perform tests.logout();
end $$;

-- La pagina Piano: get_workspace_billing mostra al titolare il cambio aperto,
-- con il termine per annullarlo (24 ore prima del rinnovo).
do $$
declare
  ws uuid; co uuid; sid uuid; cid uuid; r jsonb; ends timestamptz; ev jsonb;
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
  extra_m text := 'pri_01m577z2zz69jyw4r3hm53warm';
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Pagina Piano: azienda');
  perform public.create_venue(ws, 'Sede A');
  perform tests.logout();
  perform tests.sched_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  ends := now() + interval '29 days';
  ev := jsonb_set(jsonb_set(tests.sched_event(50, co, team_m, 1, ends),
    '{data,id}', '"sub_01pagpiano"'), '{data,customer_id}', '"ctm_01pagpiano"');
  perform tests.eq(public.billing_apply_event('sandbox', ev) ->> 'outcome', 'applied', 'abbonamento Team');
  select id into sid from public.billing_subscriptions where provider_subscription_id = 'sub_01pagpiano';

  perform tests.login('Ow');
  r := public.get_workspace_billing(ws);
  perform tests.ok(r ? 'pending_change', 'la risposta porta sempre pending_change');
  perform tests.eq(r -> 'pending_change', 'null'::jsonb, 'senza cambio aperto: null');
  perform tests.logout();

  perform tests.sched_service();
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'year', 0,
    jsonb_build_array(jsonb_build_object('price_id', team_m, 'quantity', 1),
      jsonb_build_object('price_id', extra_m, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('price_id', 'pri_01m577th8zt8x41cxk2p8m5n63', 'quantity', 1)),
    29000, 'EUR');
  perform tests.login('Ow');
  r := public.get_workspace_billing(ws) -> 'pending_change';
  perform tests.eq(r ->> 'plan', 'base', 'piano d''arrivo');
  perform tests.eq(r ->> 'billing_interval', 'year', 'ciclo d''arrivo');
  perform tests.eq((r ->> 'extra_venues')::integer, 0, 'sedi in più d''arrivo');
  perform tests.eq((r ->> 'effective_at')::timestamptz, ends, 'dal rinnovo');
  perform tests.eq((r ->> 'renewal_cents')::bigint, 29000::bigint, 'importo del rinnovo');
  perform tests.eq(r ->> 'currency', 'EUR', 'valuta');
  perform tests.eq(r ->> 'status', 'pending', 'in attesa');
  perform tests.eq((r ->> 'cancel_until')::timestamptz, ends - interval '24 hours',
    'annullabile fino a 24 ore prima del rinnovo');
  perform tests.login('Co');
  perform tests.raises(format('select public.get_workspace_billing(%L)', ws), 'not_allowed',
    'chi non è titolare non legge l''abbonamento');
  perform tests.logout();

  -- Inviato: resta visibile con lo stato.
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() where id = cid;
  perform tests.login('Ow');
  perform tests.eq(public.get_workspace_billing(ws) #>> '{pending_change,status}', 'applied',
    'inviato a Paddle: ancora in attesa del rinnovo');
  perform tests.logout();

  -- Concluso (confermato o annullato): non c'è più nulla in attesa.
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;
  perform tests.login('Ow');
  perform tests.eq(public.get_workspace_billing(ws) -> 'pending_change', 'null'::jsonb,
    'confermato: niente in attesa');
  perform tests.logout();

  -- Abbonamento chiuso: anche una riga rimasta aperta non si mostra.
  perform tests.sched_service();
  ev := jsonb_set(jsonb_set(tests.sched_event(51, null, base_m, 0, ends, null, 'canceled'),
    '{data,id}', '"sub_01pagpiano"'), '{data,customer_id}', '"ctm_01pagpiano"');
  perform tests.eq(public.billing_apply_event('sandbox', ev) ->> 'outcome', 'applied', 'abbonamento chiuso');
  perform tests.logout();
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment,
    target_plan, target_interval, target_extra_venues, from_items, target_items, renewal_cents,
    currency, effective_at, requested_by, status, from_interval)
  values (sid, ws, 'sandbox', 'base', 'month', 0,
    '[{"price_id":"pri_01m577s3dchg2ctcrenkderz05","quantity":1}]'::jsonb,
    '[{"price_id":"pri_01m577s3dchg2ctcrenkderz05","quantity":1}]'::jsonb, 2900, 'EUR',
    ends, tests.id('Ow'), 'pending', 'month');
  perform tests.login('Ow');
  r := public.get_workspace_billing(ws);
  perform tests.eq(r ->> 'status', 'canceled', 'l''abbonamento chiuso');
  perform tests.eq(r -> 'pending_change', 'null'::jsonb, 'chiuso: nessun cambio mostrato');
  perform tests.logout();
end $$;

-- Lavoro pianificato: promemoria al titolare, regole ricontrollate dentro la
-- finestra d'invio, allarme a 6 ore, presa in carico ed esiti dell'invio.
-- Dentro la transazione now() è fermo: le attese si confrontano esatte.
create function tests.sched_row(p_sub uuid, p_ws uuid, p_effective timestamptz)
returns uuid language sql as $$
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment,
    target_plan, target_interval, target_extra_venues, from_items, target_items, renewal_cents,
    currency, effective_at, requested_by, from_interval)
  values (p_sub, p_ws, 'sandbox', 'base', 'month', 0,
    '[{"price_id":"pri_01m577vzt1b6qkyyf80pnq4aj9","quantity":1},{"price_id":"pri_01m577z2zz69jyw4r3hm53warm","quantity":1}]',
    '[{"price_id":"pri_01m577s3dchg2ctcrenkderz05","quantity":1}]', 2900, 'EUR', p_effective, tests.id('Ow'), 'month')
  returning id;
$$;

-- Le notifiche «non si applica» di un'azienda a una persona (leggibile anche
-- mentre si impersona il servizio).
create function tests.sched_failed_count(p_ws uuid, p_user uuid)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.notifications
   where type = 'billing_change_reminder' and related_id = p_ws and user_id = p_user
     and title like '% non si applica'
$$;
grant execute on function tests.sched_failed_count(uuid, uuid) to public;

do $$
declare
  ws uuid; co uuid; va uuid; sid uuid; cid uuid; r jsonb; mid uuid; people integer; ends timestamptz;
  row public.billing_scheduled_changes; ev jsonb; n integer; waits text;
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
  base_m text := 'pri_01m577s3dchg2ctcrenkderz05';
  extra_m text := 'pri_01m577z2zz69jyw4r3hm53warm';
  from_items jsonb; base_items jsonb;
begin
  from_items := jsonb_build_array(jsonb_build_object('price_id', team_m, 'quantity', 1),
    jsonb_build_object('price_id', extra_m, 'quantity', 1));
  base_items := jsonb_build_array(jsonb_build_object('price_id', base_m, 'quantity', 1));

  -- Le soglie stanno in un posto solo, accanto alla finestra d'invio.
  perform tests.eq(private.billing_schedule_alert_lead(), interval '6 hours', 'allarme a 6 ore dal rinnovo');
  perform tests.eq(private.billing_schedule_reminder_lead(), interval '7 days', 'promemoria a 7 giorni');

  -- Privilegi: il lavoro è del database e della Edge Function, mai del client.
  perform tests.eq(has_function_privilege('authenticated', 'public.billing_scheduled_claim(text,integer)',
    'EXECUTE'), false, 'il client non prende in carico i cambi');
  perform tests.eq(has_function_privilege('authenticated',
    'public.billing_scheduled_result(uuid,boolean,text,boolean)', 'EXECUTE'), false,
    'il client non registra esiti dell''invio');
  perform tests.eq(has_function_privilege('authenticated', 'private.queue_scheduled_billing_work(timestamptz)',
    'EXECUTE'), false, 'il client non fa partire promemoria e allarmi');
  perform tests.eq(has_function_privilege('authenticated', 'private.run_scheduled_billing_changes()',
    'EXECUTE'), false, 'il client non fa partire il lavoro pianificato');
  perform tests.eq(has_function_privilege('service_role', 'public.billing_scheduled_claim(text,integer)',
    'EXECUTE'), true, 'il servizio prende in carico');
  perform tests.eq(has_function_privilege('service_role',
    'public.billing_scheduled_result(uuid,boolean,text,boolean)', 'EXECUTE'), true, 'e registra gli esiti');
  perform tests.eq(has_function_privilege('service_role', 'private.queue_scheduled_billing_work(timestamptz)',
    'EXECUTE'), false, 'la coda resta del database');

  perform tests.login('Ow');
  ws := public.create_workspace('Lavoro pianificato: azienda');
  va := public.create_venue(ws, 'Sede A');
  perform tests.logout();
  perform tests.sched_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  ends := now() + interval '10 days';
  ev := jsonb_set(jsonb_set(tests.sched_event(60, co, team_m, 1, ends),
    '{data,id}', '"sub_01runner"'), '{data,customer_id}', '"ctm_01runner"');
  perform tests.sched_apply(ev);
  select id into sid from public.billing_subscriptions where provider_subscription_id = 'sub_01runner';

  -- Un collaboratore: il promemoria è solo dei titolari.
  perform tests.login('Ow');
  r := public.add_member(ws, '{"full_name":"Carlo","email":"co@t.test"}'::jsonb, 'collaborator',
    '{"shifts":true}'::jsonb, 'all', '[]'::jsonb);
  perform tests.login('Co'); perform public.respond_to_invite((r ->> 'member_id')::uuid, true);

  -- Promemoria: chiesto 10 giorni prima del rinnovo.
  perform tests.sched_service();
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    from_items, base_items, 2900, 'EUR');
  perform tests.logout();
  perform tests.eq(private.queue_scheduled_billing_work(now() + interval '2 days'), 0,
    'a 8 giorni dal rinnovo: niente');
  perform tests.eq((select count(*)::integer from public.notifications
    where type = 'billing_change_reminder' and related_id = ws), 0, 'nessuna notifica a 8 giorni');
  perform tests.eq(private.queue_scheduled_billing_work(now() + interval '3 days'), 1,
    'a 7 giorni: il promemoria');
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.reminder_notified_at, now() + interval '3 days', 'segnato all''istante del lavoro');
  perform tests.eq(row.status, 'pending', 'il cambio resta in attesa');
  perform tests.eq((select count(*)::integer from public.notifications
    where type = 'billing_change_reminder' and related_id = ws and user_id = tests.id('Ow')), 1,
    'una notifica al titolare');
  perform tests.eq((select title from public.notifications
    where type = 'billing_change_reminder' and related_id = ws and user_id = tests.id('Ow')),
    'Cambia l''abbonamento di Lavoro pianificato: azienda', 'titolo con l''azienda');
  perform tests.eq((select body from public.notifications
    where type = 'billing_change_reminder' and related_id = ws and user_id = tests.id('Ow')),
    'Dal ' || private.rome_date(ends) || ' cambia il piano dell''azienda. I dettagli sono nella pagina Piano sul web.',
    'testo neutro con la data del rinnovo');
  perform tests.eq((select count(*)::integer from public.notifications
    where type = 'billing_change_reminder' and user_id = tests.id('Co')), 0, 'niente al collaboratore');
  perform tests.eq(private.queue_scheduled_billing_work(now() + interval '4 days'), 0, 'il giorno dopo non si ripete');
  perform tests.eq((select count(*)::integer from public.notifications
    where type = 'billing_change_reminder' and related_id = ws), 1, 'sempre una notifica sola');

  -- Chiesto 5 giorni prima del rinnovo: basta la conferma a schermo, mai un promemoria.
  perform tests.sched_service();
  perform public.billing_cancel_scheduled_change('sandbox', tests.id('Ow'), ws);
  ends := now() + interval '5 days';
  ev := jsonb_set(jsonb_set(tests.sched_event(61, null, team_m, 1, ends),
    '{data,id}', '"sub_01runner"'), '{data,customer_id}', '"ctm_01runner"');
  perform tests.sched_apply(ev);
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'base', 'month', 0,
    from_items, base_items, 2900, 'EUR');
  perform tests.logout();
  perform tests.eq(private.queue_scheduled_billing_work(now()), 0, 'chiesto a 5 giorni: niente subito');
  perform tests.eq(private.queue_scheduled_billing_work(now() + interval '3 days'), 0, 'né dopo');
  perform tests.eq((select reminder_notified_at from public.billing_scheduled_changes where id = cid),
    null::timestamptz, 'mai segnato');
  perform tests.eq((select count(*)::integer from public.notifications
    where type = 'billing_change_reminder' and related_id = ws), 1, 'nessuna notifica in più');
  perform tests.sched_service();
  perform public.billing_cancel_scheduled_change('sandbox', tests.id('Ow'), ws);

  -- Regole cambiate: 31 persone (Team non ha limite) e un cambio verso Base.
  perform tests.login('Ow');
  people := (public.get_workspace_access(ws) #>> '{usage,people}')::integer;
  for i in people + 1..31 loop
    mid := (public.add_member(ws, jsonb_build_object('full_name', 'Lavoro ' || i), 'none', '{}', 'all',
      jsonb_build_array(jsonb_build_object('venue_id', va))) ->> 'member_id')::uuid;
  end loop;
  perform tests.logout();
  cid := tests.sched_row(sid, ws, now() + interval '25 hours');
  perform tests.eq(private.queue_scheduled_billing_work(now()), 0, 'fuori dalla finestra le regole non si ricontrollano');
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'pending', 'ancora in attesa');
  update public.billing_scheduled_changes set effective_at = now() + interval '23 hours' where id = cid;
  perform tests.eq(private.queue_scheduled_billing_work(now()), 1, 'dentro la finestra: ricontrollate');
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason, 'failed/rules_changed', '31 persone su Base: non si invia');
  perform tests.eq(row.last_error_code, 'billing_scheduled_people', 'con il codice della regola');
  perform tests.eq(row.alert_kind, 'failed', 'e l''allarme al fondatore');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 1, 'e il titolare lo sa dall''app');
  perform tests.eq((select title || ' | ' || body from public.notifications
    where type = 'billing_change_reminder' and related_id = ws and user_id = tests.id('Ow')
      and title like '% non si applica'),
    'Il cambio dell''abbonamento di Lavoro pianificato: azienda non si applica | Al rinnovo del '
      || private.rome_date(now() + interval '23 hours')
      || ' resta il piano attuale. I dettagli sono nella pagina Piano sul web.',
    'testo neutro con la data del rinnovo');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Co')), 0, 'niente al collaboratore');
  perform tests.ok(row.closed_at is not null, 'con l''istante');
  perform tests.sched_service();
  perform tests.eq((select count(*)::integer from public.billing_scheduled_claim('sandbox', 10)), 0,
    'un cambio fallito non si prende in carico');
  perform tests.login('Ow');
  perform public.remove_member(mid);
  perform tests.logout();

  -- Azienda cancellata dentro la finestra: anche lei è una regola cambiata.
  cid := tests.sched_row(sid, ws, now() + interval '20 hours');
  update public.workspaces set deleted_at = now() where id = ws;
  perform private.queue_scheduled_billing_work(now());
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason || '/' || row.last_error_code || '/' || row.alert_kind,
    'failed/rules_changed/workspace_deleted/failed', 'azienda cancellata: non si invia');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 1,
    'azienda cancellata: nessuna notifica, non c''è più una pagina Piano');
  update public.workspaces set deleted_at = null where id = ws;

  -- Allarme: a 7 ore niente, a 5 ore il cambio non ancora inviato fa partire l'allarme.
  cid := tests.sched_row(sid, ws, now() + interval '7 hours');
  perform tests.eq(private.queue_scheduled_billing_work(now()), 0, 'a 7 ore dal rinnovo nessun allarme');
  update public.billing_scheduled_changes set effective_at = now() + interval '5 hours' where id = cid;
  perform tests.eq(private.queue_scheduled_billing_work(now()), 1, 'a 5 ore: allarme');
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.alert_kind, 'not_sent', 'cambio non ancora inviato');
  perform tests.eq(row.status, 'pending', 'resta da inviare');
  perform tests.eq(row.closed_at, null::timestamptz, 'e aperto');
  perform tests.eq(private.queue_scheduled_billing_work(now()), 0, 'l''allarme non si ripete');

  -- Il lavoro gira anche senza il segreto Vault (banco, progetto non configurato).
  perform private.run_scheduled_billing_changes();
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'pending',
    'senza segreto non parte nulla');

  -- Presa in carico: una volta sola, solo nel suo ambiente.
  perform tests.sched_service();
  perform tests.eq((select count(*)::integer from public.billing_scheduled_claim('live', 10)), 0,
    'un cambio sandbox non si invia in live');
  perform tests.eq((select string_agg(id::text, ',') from public.billing_scheduled_claim('sandbox', 10)),
    cid::text, 'preso in carico');
  perform tests.eq((select next_attempt_at from public.billing_scheduled_changes where id = cid),
    now() + interval '15 minutes', 'tolto dalla coda per 15 minuti');
  perform tests.eq((select count(*)::integer from public.billing_scheduled_claim('sandbox', 10)), 0,
    'la seconda presa in carico non lo restituisce');

  -- Esiti transitori: l'attesa cresce fino a un'ora.
  waits := '';
  for i in 1..5 loop
    perform public.billing_scheduled_result(cid, false, 'paddle_unavailable', false);
    select * into row from public.billing_scheduled_changes where id = cid;
    waits := waits || extract(epoch from row.next_attempt_at - now())::integer / 60 || ' ';
  end loop;
  perform tests.eq(waits, '10 20 40 60 60 ', 'attesa 10 → 20 → 40 → 60 minuti');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 1, 'un errore transitorio non avvisa il titolare');
  perform tests.eq(row.attempts, 5, 'ogni tentativo contato');
  perform tests.eq(row.status || '/' || row.last_error_code, 'pending/paddle_unavailable', 'resta da inviare');
  perform tests.eq(row.close_reason, null::text, 'senza motivo di chiusura');
  perform tests.eq((select count(*)::integer from public.billing_scheduled_claim('sandbox', 10)), 0,
    'durante l''attesa non si riprende');

  -- Esito positivo: inviato.
  perform public.billing_scheduled_result(cid, true, null, false);
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status, 'applied', 'inviato a Paddle');
  perform tests.eq(row.applied_at, now(), 'con l''istante');
  perform public.billing_scheduled_result(cid, false, 'paddle_period_moved', true);
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'applied',
    'un esito su una riga non più in attesa non cambia nulla');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;

  -- Errori permanenti: fallito con allarme; il motivo distingue Paddle cambiato da Paddle che rifiuta.
  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, false, 'paddle_items_changed', true);
  perform tests.logout();
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason || '/' || row.last_error_code || '/' || row.alert_kind,
    'failed/paddle_mismatch/paddle_items_changed/failed', 'articoli cambiati su Paddle');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 2, 'errore permanente: il titolare è avvisato');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Co')), 0, 'il collaboratore no');
  perform tests.eq((select body from public.notifications
    where type = 'billing_change_reminder' and related_id = ws and user_id = tests.id('Ow')
      and title like '% non si applica' order by created_at desc, id limit 1),
    'Al rinnovo del ' || private.rome_date(now() + interval '23 hours')
      || ' resta il piano attuale. I dettagli sono nella pagina Piano sul web.', 'stesso testo');
  perform tests.ok(row.closed_at is not null, 'con l''istante');

  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, false, 'paddle_period_moved', true);
  perform tests.logout();
  perform tests.eq((select close_reason from public.billing_scheduled_changes where id = cid),
    'paddle_mismatch', 'rinnovo spostato su Paddle');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 3, 'avvisato anche qui');

  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, false, 'paddle_rejected_422', true);
  perform tests.logout();
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason || '/' || row.last_error_code || '/' || row.alert_kind,
    'failed/paddle_error/paddle_rejected_422/failed', 'Paddle rifiuta la richiesta');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 4, 'e anche qui');
  perform tests.ok(row.closed_at is not null, 'con l''istante');

  -- Annullato mentre era in invio (pausa dal portale): l'esito arriva tardi e non conta.
  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  update public.billing_scheduled_changes set status = 'canceled', close_reason = 'paused', closed_at = now()
   where id = cid;
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, true, null, false);
  perform public.billing_scheduled_result(gen_random_uuid(), true, null, false);
  perform tests.logout();
  perform tests.eq((select status || '/' || close_reason from public.billing_scheduled_changes where id = cid),
    'canceled/paused', 'annullato resta annullato');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 4, 'esiti positivi e tardivi non avvisano');

  -- Il giorno del rinnovo il cambio non inviato non si prende più: decide l'avviso del rinnovo.
  cid := tests.sched_row(sid, ws, now() - interval '1 minute');
  perform tests.sched_service();
  perform tests.eq((select count(*)::integer from public.billing_scheduled_claim('sandbox', 10)), 0,
    'oltre la data d''effetto non si invia');
  perform tests.logout();
  update public.billing_scheduled_changes set status = 'canceled', close_reason = 'canceled', closed_at = now()
   where id = cid;

  -- Cambio di ciclo a metà: gli articoli sono su Paddle, la data del rinnovo
  -- non è stata rimessa. Si riprova come un errore transitorio, con l'allarme
  -- dedicato al fondatore; il titolare non riceve un «non si applica».
  cid := tests.sched_row(sid, ws, now() + interval '5 hours');
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, false, 'paddle_date_not_fixed', false);
  perform tests.logout();
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.attempts || '/' || row.last_error_code || '/' || row.alert_kind,
    'pending/1/paddle_date_not_fixed/date_not_fixed', 'data non rimessa: in attesa, con l''allarme');
  perform tests.eq(row.next_attempt_at, now() + interval '10 minutes', 'con l''attesa dei transitori');
  perform tests.eq(row.close_reason || row.closed_at::text, null::text, 'aperto, senza motivo di chiusura');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 4, 'il titolare non è avvisato');
  -- A 5 ore dal rinnovo il passo «non inviato» non lo sovrascrive.
  perform tests.eq(private.queue_scheduled_billing_work(now()), 0, 'a 5 ore: nessuna riga toccata');
  perform tests.eq((select alert_kind from public.billing_scheduled_changes where id = cid), 'date_not_fixed',
    'il «non inviato» a 6 ore non sovrascrive la data non rimessa');
  -- Un altro errore transitorio non toglie l'allarme; la data rimessa lo lascia
  -- al fondatore, che lo chiude con una nota.
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, false, 'paddle_unavailable', false);
  perform tests.logout();
  perform tests.eq((select attempts || '/' || alert_kind from public.billing_scheduled_changes where id = cid),
    '2/date_not_fixed', 'un errore transitorio dopo non toglie l''allarme');
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, true, null, false);
  perform tests.logout();
  perform tests.eq((select status || '/' || alert_kind from public.billing_scheduled_changes where id = cid),
    'applied/date_not_fixed', 'data rimessa: inviato, l''allarme resta finché non lo chiude il fondatore');
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;

  -- Già su Paddle ma l'esito si è perso (timeout, RPC fallita): l'avviso della
  -- nostra PATCH ha portato l'abbonamento al punto d'arrivo. Non è una regola
  -- cambiata: resta in attesa, la prossima presa in carico lo chiude come inviato.
  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  perform tests.sched_service();
  ev := jsonb_set(jsonb_set(tests.sched_event(62, null, base_m, 0, ends),
    '{data,id}', '"sub_01runner"'), '{data,customer_id}', '"ctm_01runner"');
  perform tests.sched_apply(ev);
  perform tests.logout();
  perform tests.eq(private.billing_scheduled_rules_error(sid, 'base', 'month', 0), 'billing_no_change',
    'l''abbonamento è già al punto d''arrivo');
  perform tests.eq(private.queue_scheduled_billing_work(now()), 0, 'nessuna riga toccata');
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status, 'pending', 'già al punto d''arrivo: resta in attesa');
  perform tests.eq(row.alert_kind, null::text, 'nessun allarme a vuoto');
  perform tests.eq(row.close_reason, null::text, 'nessun motivo di chiusura');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), 4, 'il titolare non riceve un «non si applica» falso');
end $$;

-- Righe aperte oltre la data d'effetto, esiti tardivi, data non rimessa per
-- sempre e un'azienda che rompe il giro: nessuna resta senza uscita.
-- Un trigger di prova fa fallire l'aggiornamento della riga indicata in
-- `tests.boom`, come farebbe un'azienda con dati che fanno sollevare i controlli.
create function tests.sched_boom() returns trigger language plpgsql as $$
begin
  if new.id::text = current_setting('tests.boom', true) then
    raise exception 'boom';
  end if;
  return new;
end $$;
create trigger billing_scheduled_changes_boom before update on public.billing_scheduled_changes
  for each row execute function tests.sched_boom();

do $$
declare
  ws uuid; ws2 uuid; co uuid; sid uuid; sid2 uuid; cid uuid; c2 uuid; n integer; ev jsonb;
  row public.billing_scheduled_changes;
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Rinnovo scaduto: azienda');
  perform public.create_venue(ws, 'Sede A');
  ws2 := public.create_workspace('Rinnovo scaduto: seconda azienda');
  perform public.create_venue(ws2, 'Sede A');
  perform tests.logout();
  perform tests.sched_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  ev := jsonb_set(jsonb_set(tests.sched_event(70, co, team_m, 1, now() + interval '10 days'),
    '{data,id}', '"sub_01overdue"'), '{data,customer_id}', '"ctm_01overdue"');
  perform tests.sched_apply(ev);
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws2, 'team', 'month', 1) ->> 'checkout_id')::uuid;
  ev := jsonb_set(jsonb_set(tests.sched_event(71, co, team_m, 1, now() + interval '10 days'),
    '{data,id}', '"sub_01boom"'), '{data,customer_id}', '"ctm_01boom"');
  perform tests.sched_apply(ev);
  perform tests.logout();
  select id into sid from public.billing_subscriptions where provider_subscription_id = 'sub_01overdue';
  select id into sid2 from public.billing_subscriptions where provider_subscription_id = 'sub_01boom';
  n := tests.sched_failed_count(ws, tests.id('Ow'));

  -- In attesa con il rinnovo passato da 3 ore: nessun avviso del rinnovo è
  -- arrivato e lo stato su Paddle non si conosce. Esce, con l'allarme.
  cid := tests.sched_row(sid, ws, now() - interval '3 hours');
  perform tests.ok(private.billing_future_limits(ws) is not null, 'riga aperta: c''è un limite futuro');
  perform private.queue_scheduled_billing_work(now());
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason || '/' || row.alert_kind,
    'failed/renewal_overdue/renewal_overdue', 'in attesa a rinnovo +3 ore: chiuso con l''allarme');
  perform tests.eq(row.closed_at, now(), 'all''istante del lavoro');
  perform tests.ok(private.billing_future_limits(ws) is null, 'nessun limite futuro dopo la chiusura');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), n, 'il titolare non è avvisato: Paddle non si conosce');

  -- Già inviato, rinnovo passato da 3 ore senza avviso: stessa uscita.
  cid := tests.sched_row(sid, ws, now() - interval '3 hours');
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() - interval '5 hours' where id = cid;
  perform private.queue_scheduled_billing_work(now());
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason || '/' || row.alert_kind,
    'failed/renewal_overdue/renewal_overdue', 'inviato a rinnovo +3 ore: chiuso con l''allarme');
  perform tests.ok(private.billing_future_limits(ws) is null, 'libero anche qui');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), n, 'il titolare non è avvisato');

  -- A rinnovo +1 ora l'avviso può ancora arrivare: niente si chiude.
  cid := tests.sched_row(sid, ws, now() - interval '1 hour');
  update public.billing_scheduled_changes set status = 'applied', applied_at = now() - interval '5 hours' where id = cid;
  perform private.queue_scheduled_billing_work(now());
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || coalesce(row.alert_kind, '-'), 'applied/-', 'inviato a rinnovo +1 ora: invariato');
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;
  cid := tests.sched_row(sid, ws, now() - interval '1 hour');
  perform private.queue_scheduled_billing_work(now());
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'pending',
    'in attesa a rinnovo +1 ora: ancora aperto');
  update public.billing_scheduled_changes set status = 'canceled', close_reason = 'canceled', closed_at = now()
   where id = cid;

  -- Esito positivo su una riga già chiusa: Paddle ha il cambio, qui no. Lo
  -- stato resta, ma il fondatore lo deve sapere.
  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  update public.billing_scheduled_changes set status = 'canceled', close_reason = 'paused', closed_at = now()
   where id = cid;
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, true, null, false);
  perform tests.logout();
  perform tests.eq((select status || '/' || close_reason || '/' || alert_kind from public.billing_scheduled_changes
    where id = cid), 'canceled/paused/renewal_mismatch', 'annullato ma su Paddle: resta annullato, con l''allarme');
  cid := tests.sched_row(sid, ws, now() + interval '23 hours');
  update public.billing_scheduled_changes set status = 'failed', close_reason = 'rules_changed', closed_at = now(),
    alert_kind = 'failed' where id = cid;
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, true, null, false);
  perform tests.logout();
  perform tests.eq((select status || '/' || close_reason || '/' || alert_kind from public.billing_scheduled_changes
    where id = cid), 'failed/rules_changed/renewal_mismatch', 'fallito ma su Paddle: l''allarme cambia');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), n, 'l''esito tardivo non avvisa il titolare');

  -- Il cambio arriva dopo il «non inviato» e prima dell'email: niente allarme.
  cid := tests.sched_row(sid, ws, now() + interval '5 hours');
  update public.billing_scheduled_changes set alert_kind = 'not_sent' where id = cid;
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, true, null, false);
  perform tests.logout();
  perform tests.eq((select status || '/' || coalesce(alert_kind, '-') from public.billing_scheduled_changes where id = cid),
    'applied/-', '«non inviato» senza email: arrivato, l''allarme si spegne');
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;
  -- Email già partita: l'allarme resta, il fondatore lo chiude con una nota.
  cid := tests.sched_row(sid, ws, now() + interval '5 hours');
  update public.billing_scheduled_changes set alert_kind = 'not_sent' where id = cid;
  update public.billing_scheduled_changes set alert_emailed_at = now() where id = cid;
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, true, null, false);
  perform tests.logout();
  perform tests.eq((select status || '/' || alert_kind from public.billing_scheduled_changes where id = cid),
    'applied/not_sent', '«non inviato» già spedito: l''allarme resta');
  update public.billing_scheduled_changes set status = 'confirmed', confirmed_at = now() where id = cid;

  -- Data del rinnovo che non si può più rimettere: gli articoli sono su Paddle,
  -- quindi al titolare non si dice «resta il piano attuale».
  cid := tests.sched_row(sid, ws, now() + interval '20 hours');
  perform tests.sched_service();
  perform public.billing_scheduled_result(cid, false, 'paddle_date_not_fixed_final', true);
  perform tests.logout();
  select * into row from public.billing_scheduled_changes where id = cid;
  perform tests.eq(row.status || '/' || row.close_reason || '/' || row.last_error_code || '/' || row.alert_kind,
    'failed/date_not_fixed/paddle_date_not_fixed_final/date_not_fixed', 'data non rimessa per sempre');
  perform tests.ok(row.closed_at is not null, 'chiuso, con l''istante');
  perform tests.eq(tests.sched_failed_count(ws, tests.id('Ow')), n, 'nessun «non si applica» al titolare');

  -- Un'azienda che fa fallire il giro non ferma gli allarmi delle altre.
  cid := tests.sched_row(sid, ws, now() + interval '5 hours');
  c2 := tests.sched_row(sid2, ws2, now() + interval '5 hours');
  perform set_config('tests.boom', c2::text, true);
  perform private.queue_scheduled_billing_work(now());
  perform tests.eq((select alert_kind from public.billing_scheduled_changes where id = cid), 'not_sent',
    'l''altra azienda riceve il suo allarme');
  perform tests.eq((select coalesce(alert_kind, '-') from public.billing_scheduled_changes where id = c2), '-',
    'la riga che fallisce resta com''era');
  update public.billing_scheduled_changes set status = 'canceled', close_reason = 'canceled', closed_at = now()
   where id = cid;
  cid := tests.sched_row(sid, ws, now() - interval '3 hours');
  perform set_config('tests.boom', '', true);
  update public.billing_scheduled_changes set effective_at = now() - interval '3 hours' where id = c2;
  perform set_config('tests.boom', c2::text, true);
  perform private.queue_scheduled_billing_work(now());
  perform tests.eq((select status from public.billing_scheduled_changes where id = cid), 'failed',
    'il rinnovo scaduto dell''altra azienda si chiude');
  perform tests.eq((select status from public.billing_scheduled_changes where id = c2), 'pending',
    'la riga che fallisce resta aperta');
  perform set_config('tests.boom', '', true);
end $$;
drop trigger billing_scheduled_changes_boom on public.billing_scheduled_changes;

rollback;
select 'billing scheduled changes: ok' as result;
