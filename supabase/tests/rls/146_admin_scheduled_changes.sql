-- Area fondatore: cambi di piano programmati da verificare. Solo il fondatore
-- con secondo fattore; un avviso si chiude con una nota, un cambio non
-- inviato si ritenta solo prima del rinnovo.
begin;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000025',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000026',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture cambi programmati');
-- Un fondatore revocato non riceve più gli allarmi.
insert into private.platform_admins(user_id,reason,revoked_at) values(tests.id('Co2'),'Fixture revocata',now());

-- Allarmi push al fondatore per un'azienda (leggibili anche impersonando il servizio).
create function tests.admin_alerts(p_ws uuid, p_user uuid)
returns integer language sql security definer set search_path = '' as $$
  select count(*)::integer from public.notifications
   where type = 'billing_admin_alert' and related_id = p_ws and user_id = p_user
$$;
-- Dentro la transazione now() è fermo: si cerca il testo, non l'ultima.
create function tests.has_admin_alert(p_ws uuid, p_text text)
returns boolean language sql security definer set search_path = '' as $$
  select exists (select 1 from public.notifications
   where type = 'billing_admin_alert' and related_id = p_ws and title || ' | ' || body = p_text)
$$;
grant execute on function tests.admin_alerts(uuid, uuid), tests.has_admin_alert(uuid, text) to public;

create function tests.as_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
create function tests.as_admin(p_aal text default 'aal2') returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000025', 'aal', p_aal)::text, true);
end $$;
grant execute on function tests.as_service(), tests.as_admin(text) to public;

do $$
declare
  ws uuid; co uuid; sub uuid; r jsonb;
  ia uuid; ib uuid; id_ uuid; ie uuid; ic uuid; ig uuid; ih uuid;
  items jsonb := jsonb_build_array(jsonb_build_object('price_id', 'pri_01m577s3dchg2ctcrenkderz05', 'quantity', 1));
  e1 timestamptz := now() + interval '10 days';
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Fondatore: cambi');
  perform public.create_venue(ws, 'Unica sede');
  perform tests.logout();
  perform tests.as_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_08aa', 'event_type', 'subscription.created',
    'occurred_at', now(), 'data', jsonb_build_object('id', 'sub_08admin', 'customer_id', 'ctm_08admin', 'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', 'pri_01m577s3dchg2ctcrenkderz05'),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', e1),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', co))));
  perform tests.logout();
  select id into sub from public.billing_subscriptions where workspace_id = ws;

  -- A: fallito con rinnovo futuro; B: fallito col rinnovo passato;
  -- D: rinnovo diverso dal programmato; C: annullato dal titolare, senza avviso.
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval,
    status, close_reason, closed_at, alert_kind, last_error_code, attempts, alert_emailed_at, alert_email_attempts)
  values
   (sub, ws, 'sandbox', 'base', 'month', 0, items, items, 2900, 'EUR', e1, tests.id('Ow'), 'month',
    'failed', 'rules_changed', now(), 'failed', 'rules_changed', 2, now(), 1)
  returning id into ia;
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval,
    status, close_reason, closed_at, alert_kind)
  values (sub, ws, 'sandbox', 'base', 'month', 0, items, items, 2900, 'EUR', now() - interval '1 day', tests.id('Ow'), 'month',
    'failed', 'paddle_error', now(), 'failed') returning id into ib;
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval,
    status, close_reason, closed_at, alert_kind)
  values (sub, ws, 'sandbox', 'base', 'month', 0, items, items, 2900, 'EUR', e1, tests.id('Ow'), 'month',
    'failed', 'renewal_mismatch', now(), 'renewal_mismatch') returning id into id_;
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval,
    status, close_reason, closed_at)
  values (sub, ws, 'sandbox', 'base', 'month', 0, items, items, 2900, 'EUR', e1, tests.id('Ow'), 'month',
    'canceled', 'owner', now()) returning id into ic;

  -- Senza secondo fattore e per un titolare cliente: niente.
  perform tests.as_admin('aal1');
  perform tests.raises('select public.admin_list_scheduled_billing_changes()', 'admin_mfa_required', 'serve il secondo fattore');
  perform tests.login('Ow');
  perform tests.raises('select public.admin_list_scheduled_billing_changes()', 'admin_not_allowed', 'il titolare non è il fondatore');
  perform tests.raises(format('select public.admin_resolve_scheduled_billing_change(%L, ''tentativo'')', ia),
    'admin_not_allowed', 'il titolare non chiude gli avvisi');
  perform tests.raises(format('select public.admin_retry_scheduled_billing_change(%L)', ia),
    'admin_not_allowed', 'il titolare non ritenta');

  perform tests.as_admin();
  r := public.admin_list_scheduled_billing_changes();
  perform tests.eq((r ->> 'open_total')::integer, 3, 'tre avvisi non chiusi');
  perform tests.eq((r ->> 'total')::integer, 3, 'l''elenco da verificare ha solo righe con allarme');
  perform tests.eq((select count(*)::integer from jsonb_array_elements(r -> 'items') i where i ->> 'id' = ic::text), 0,
    'il cambio annullato senza avviso non c''è');
  perform tests.eq((select i ->> 'workspace_name' from jsonb_array_elements(r -> 'items') i where i ->> 'id' = ia::text),
    'Fondatore: cambi', 'con il nome dell''azienda');
  perform tests.eq((select i ->> 'requested_by_name' from jsonb_array_elements(r -> 'items') i where i ->> 'id' = ia::text),
    'Olivia Owner', 'con il nome di chi l''ha chiesto (senza nome sulla scheda, quello del profilo)');
  r := public.admin_list_scheduled_billing_changes(ws, false);
  perform tests.eq((r ->> 'total')::integer, 4, 'lo storico dell''azienda ha anche l''annullato');

  perform tests.raises(format('select public.admin_resolve_scheduled_billing_change(%L, ''ok'')', ia),
    'admin_review_note_required', 'una nota di 2 caratteri non basta');
  perform tests.raises(format('select public.admin_resolve_scheduled_billing_change(%L, ''niente da fare'')', ic),
    'admin_review_not_open', 'senza avviso non c''è nulla da chiudere');
  perform tests.raises('select public.admin_resolve_scheduled_billing_change(gen_random_uuid(), ''niente da fare'')',
    'admin_not_found', 'riga inesistente');
  perform public.admin_resolve_scheduled_billing_change(ib, 'Rimborsato su Paddle');
  perform tests.eq((public.admin_list_scheduled_billing_changes() ->> 'open_total')::integer, 2, 'chiuso: esce dall''elenco');
  perform tests.eq((select i ->> 'review_note' from jsonb_array_elements(public.admin_list_scheduled_billing_changes(ws, false) -> 'items') i
    where i ->> 'id' = ib::text), 'Rimborsato su Paddle', 'resta nello storico con la nota');
  perform tests.raises(format('select public.admin_resolve_scheduled_billing_change(%L, ''di nuovo'')', ib),
    'admin_review_not_open', 'non si chiude due volte');

  -- Ritentativo: non per rinnovo passato né per rinnovo diverso dal programmato.
  perform tests.raises(format('select public.admin_retry_scheduled_billing_change(%L)', ib),
    'scheduled_change_not_retryable', 'rinnovo passato: non si ritenta');
  perform tests.raises(format('select public.admin_retry_scheduled_billing_change(%L)', id_),
    'scheduled_change_not_retryable', 'rinnovo diverso: non si ritenta');
  perform tests.raises(format('select public.admin_retry_scheduled_billing_change(%L)', ic),
    'scheduled_change_not_retryable', 'un cambio annullato non si ritenta');

  -- Con rinnovo futuro torna in coda, pulito.
  perform public.admin_retry_scheduled_billing_change(ia);
  perform tests.logout();
  perform tests.eq((select status from public.billing_scheduled_changes where id = ia), 'pending', 'torna in attesa');
  perform tests.eq((select attempts from public.billing_scheduled_changes where id = ia), 0, 'tentativi azzerati');
  perform tests.eq((select close_reason || closed_at::text || coalesce(alert_kind, '') || coalesce(last_error_code, '')
      from public.billing_scheduled_changes where id = ia), null, 'motivo, chiusura, avviso ed errore azzerati');
  perform tests.eq((select alert_emailed_at is null and alert_email_attempts = 0 and reviewed_at is null
      from public.billing_scheduled_changes where id = ia), true, 'email d''allarme e revisione azzerate');

  -- Un altro cambio aperto per lo stesso abbonamento blocca il ritentativo.
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval,
    status, close_reason, closed_at, alert_kind)
  values (sub, ws, 'sandbox', 'base', 'month', 0, items, items, 2900, 'EUR', e1, tests.id('Ow'), 'month',
    'failed', 'paddle_mismatch', now(), 'failed') returning id into ie;
  perform tests.as_admin();
  perform tests.raises(format('select public.admin_retry_scheduled_billing_change(%L)', ie),
    'billing_change_pending', 'già un cambio aperto per l''abbonamento');
  perform tests.logout();

  -- Un allarme nuovo riapre un avviso già chiuso. A è di nuovo in attesa:
  -- scatta «non inviato» (come il passo 3 del runner), il fondatore lo chiude.
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 0, 'finora nessun allarme push');
  update public.billing_scheduled_changes set alert_kind = 'not_sent' where id = ia;
  -- Il fondatore lo sa anche con una push, che non passa dalla Edge Function degli allarmi.
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 1, 'non inviato: una push al fondatore');
  perform tests.ok(tests.has_admin_alert(ws, 'Cambio di piano da controllare: Fondatore: cambi | '
    || 'Non è ancora arrivato a Paddle e il rinnovo è vicino. Apri l''area fondatore.'), 'titolo e testo, senza importi');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Co2')), 0, 'niente al fondatore revocato');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Ow')), 0, 'niente al titolare');
  update public.billing_scheduled_changes set alert_emailed_at = now(), alert_email_attempts = 1 where id = ia;
  perform tests.as_admin();
  perform public.admin_resolve_scheduled_billing_change(ia, 'Avvisato il titolare');
  r := public.admin_list_scheduled_billing_changes();
  perform tests.logout();
  -- Aperti a questo punto: D (rinnovo diverso) ed E (fallito). A è chiuso.
  perform tests.eq((r ->> 'open_total')::integer, 2, 'non inviato chiuso: esce dall''elenco');
  -- Un aggiornamento che non cambia l'allarme (tentativo transitorio) non tocca la revisione.
  perform tests.as_service();
  perform public.billing_scheduled_result(ia, false, 'paddle_unavailable', false);
  perform tests.logout();
  perform tests.eq((select status || '/' || attempts::text || '/' || review_note || '/' || alert_email_attempts::text
      from public.billing_scheduled_changes where id = ia), 'pending/1/Avvisato il titolare/1',
    'stesso allarme: revisione ed email restano');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 1, 'stesso allarme: nessuna push in più');
  -- Poi Paddle lo rifiuta: `failed` è un allarme nuovo e riapre la verifica.
  perform tests.as_service();
  perform public.billing_scheduled_result(ia, false, 'paddle_rejected_422', true);
  perform tests.logout();
  perform tests.eq((select status || '/' || close_reason || '/' || alert_kind from public.billing_scheduled_changes where id = ia),
    'failed/paddle_error/failed', 'rifiutato da Paddle');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 2, 'allarme nuovo: un''altra push');
  perform tests.ok(tests.has_admin_alert(ws, 'Cambio di piano da controllare: Fondatore: cambi | '
    || 'Non si può applicare: al rinnovo resta il piano attuale. Apri l''area fondatore.'), 'testo del fallito');
  perform tests.eq((select reviewed_at is null and reviewed_by is null and review_note is null
      and alert_emailed_at is null and alert_email_attempts = 0
      from public.billing_scheduled_changes where id = ia), true, 'non inviato → fallito: revisione ed email azzerate');
  perform tests.as_admin();
  perform tests.eq((public.admin_list_scheduled_billing_changes() ->> 'open_total')::integer, 3,
    'fallito dopo la chiusura: torna da verificare');
  perform tests.logout();

  -- Rinnovo arrivato con un piano diverso (reconcile) su un «non inviato» già chiuso.
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval, alert_kind)
  values (sub, ws, 'sandbox', 'base', 'year', 0, items,
    jsonb_build_array(jsonb_build_object('price_id', 'pri_01m577th8zt8x41cxk2p8m5n63', 'quantity', 1)),
    29000, 'EUR', now() + interval '1 minute', tests.id('Ow'), 'month', 'not_sent') returning id into ig;
  update public.billing_scheduled_changes set alert_emailed_at = now(), alert_email_attempts = 1 where id = ig;
  perform tests.as_admin();
  perform public.admin_resolve_scheduled_billing_change(ig, 'Riprovo più tardi');
  perform tests.eq((public.admin_list_scheduled_billing_changes() ->> 'open_total')::integer, 3, 'chiuso: non conta');
  perform tests.logout();
  perform tests.as_service();
  r := public.billing_apply_event('sandbox', jsonb_build_object('event_id', 'evt_08ab', 'event_type', 'subscription.updated',
    'occurred_at', now() + interval '1 second', 'data', jsonb_build_object('id', 'sub_08admin', 'customer_id', 'ctm_08admin',
      'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', 'pri_01m577s3dchg2ctcrenkderz05'),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now(), 'ends_at', now() + interval '1 month'),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', co))));
  perform tests.logout();
  perform tests.eq(r ->> 'outcome', 'applied', 'il rinnovo è applicato');
  perform tests.eq((select status || '/' || close_reason || '/' || alert_kind from public.billing_scheduled_changes where id = ig),
    'failed/renewal_mismatch/renewal_mismatch', 'rinnovato mensile invece che annuale');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 3, 'rinnovo diverso: una push dal reconcile');
  perform tests.ok(tests.has_admin_alert(ws, 'Cambio di piano da controllare: Fondatore: cambi | '
    || 'Il rinnovo è avvenuto con un piano diverso da quello programmato. Apri l''area fondatore.'), 'testo del rinnovo diverso');
  perform tests.eq((select reviewed_at is null and reviewed_by is null and review_note is null
      and alert_emailed_at is null and alert_email_attempts = 0
      from public.billing_scheduled_changes where id = ig), true, 'non inviato → rinnovo diverso: revisione ed email azzerate');
  perform tests.as_admin();
  perform tests.eq((public.admin_list_scheduled_billing_changes() ->> 'open_total')::integer, 4,
    'rinnovo diverso dopo la chiusura: torna da verificare');
  perform tests.logout();

  -- Cambio di ciclo a metà: un «non inviato» già chiuso diventa «data non
  -- rimessa». È un allarme nuovo (verifica ed email ripartono) e si ritenta.
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval, alert_kind)
  values (sub, ws, 'sandbox', 'base', 'year', 0, items,
    jsonb_build_array(jsonb_build_object('price_id', 'pri_01m577th8zt8x41cxk2p8m5n63', 'quantity', 1)),
    29000, 'EUR', e1, tests.id('Ow'), 'month', 'not_sent') returning id into ih;
  update public.billing_scheduled_changes set alert_emailed_at = now(), alert_email_attempts = 1 where id = ih;
  perform tests.as_admin();
  perform public.admin_resolve_scheduled_billing_change(ih, 'Riprovo più tardi');
  perform tests.logout();
  perform tests.as_service();
  perform public.billing_scheduled_result(ih, false, 'paddle_date_not_fixed', false);
  perform tests.logout();
  perform tests.eq((select status || '/' || alert_kind || '/' || last_error_code from public.billing_scheduled_changes where id = ih),
    'pending/date_not_fixed/paddle_date_not_fixed', 'data del rinnovo non rimessa');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 4, 'data non rimessa: una push');
  perform tests.ok(tests.has_admin_alert(ws, 'Cambio di piano da controllare: Fondatore: cambi | '
    || 'Il ciclo è cambiato su Paddle ma la data del rinnovo no. Apri l''area fondatore.'), 'testo della data non rimessa');
  perform tests.eq((select reviewed_at is null and review_note is null and alert_emailed_at is null and alert_email_attempts = 0
      from public.billing_scheduled_changes where id = ih), true, 'non inviato → data non rimessa: revisione ed email azzerate');
  perform tests.as_admin();
  r := public.admin_list_scheduled_billing_changes();
  perform tests.eq((select i ->> 'alert_kind' from jsonb_array_elements(r -> 'items') i where i ->> 'id' = ih::text),
    'date_not_fixed', 'da verificare nel pannello');
  perform public.admin_resolve_scheduled_billing_change(ih, 'Riprovo l''invio');
  perform public.admin_retry_scheduled_billing_change(ih);
  perform tests.logout();
  -- Il ritentativo tiene l'allarme: gli articoli sono su Paddle, e il passo
  -- «non inviato» del lavoro pianificato non lo sovrascrive.
  perform tests.eq((select status || '/' || attempts || '/' || coalesce(alert_kind, '-') || '/' || coalesce(last_error_code, '-')
      from public.billing_scheduled_changes where id = ih), 'pending/0/date_not_fixed/-', 'data non rimessa: si ritenta, l''allarme resta');
  perform tests.eq((select reviewed_at is null and review_note is null and alert_emailed_at is null and alert_email_attempts = 0
      and next_attempt_at <= now() from public.billing_scheduled_changes where id = ih), true,
    'ritentativo: revisione, email e attesa azzerate');
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 4, 'stesso allarme: nessuna push in più');

  -- Un allarme che nasce per un'azienda cancellata arriva lo stesso.
  update public.workspaces set deleted_at = now() where id = ws;
  update public.billing_scheduled_changes set alert_kind = 'renewal_overdue' where id = ih;
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 5, 'rinnovo scaduto: una push');
  perform tests.ok(tests.has_admin_alert(ws, 'Cambio di piano da controllare: Fondatore: cambi | '
    || 'Paddle non ha rinnovato alla data del cambio. Apri l''area fondatore.'), 'testo del rinnovo scaduto');
  update public.workspaces set deleted_at = null where id = ws;

  -- Esito positivo arrivato su una riga già chiusa: la push lo dice com'è.
  insert into public.billing_scheduled_changes (subscription_id, workspace_id, environment, target_plan, target_interval,
    target_extra_venues, from_items, target_items, renewal_cents, currency, effective_at, requested_by, from_interval,
    status, close_reason, closed_at)
  values (sub, ws, 'sandbox', 'base', 'month', 0, items, items, 2900, 'EUR', e1, tests.id('Ow'), 'month',
    'canceled', 'paused', now()) returning id into ie;
  perform tests.as_service();
  perform public.billing_scheduled_result(ie, true, null, false);
  perform tests.logout();
  perform tests.eq(tests.admin_alerts(ws, tests.id('Str')), 6, 'esito tardivo: una push');
  perform tests.ok(tests.has_admin_alert(ws, 'Cambio di piano da controllare: Fondatore: cambi | '
    || 'Paddle ha ricevuto il cambio, ma qui risultava già chiuso. Apri l''area fondatore.'), 'testo dell''esito tardivo');
end $$;

rollback;
select 'admin cambi programmati: ok' as result;
