-- Clienti fondatori (docs/MONETIZATION.md §2-bis): le prime 10 aziende che
-- pagano hanno il 30% per 24 mesi dal primo addebito. Il posto lo conta il
-- database (lo sconto su Paddle non ha limite d'uso): righe attive e finite,
-- più i posti riservati a mano dal fondatore.
-- Posti e idoneità sono per ambiente: le prove in sandbox non prendono i posti
-- veri (live); i posti riservati dal fondatore sono live.
begin;

create function tests.fo_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.fo_service() to public;

-- Abbonamento Piccola mensile come lo inoltra la Edge Function dopo la firma.
-- p_discount null = abbonamento senza sconto.
create function tests.fo_event(p_seq integer, p_type text, p_sub text, p_checkout uuid,
  p_status text, p_starts timestamptz, p_ends timestamptz, p_discount text)
returns jsonb language sql as $$
  select jsonb_build_object('event_id', 'evt_01founder' || p_seq, 'event_type', p_type,
    'occurred_at', now() + make_interval(secs => p_seq),
    'data', jsonb_build_object('id', p_sub, 'customer_id', 'ctm_01founder', 'status', p_status,
      'items', jsonb_build_array(jsonb_build_object(
        'price', jsonb_build_object('id', 'pri_01m577s3dchg2ctcrenkderz05'),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', p_starts, 'ends_at', p_ends),
      'discount', case when p_discount is null then null
        else jsonb_build_object('id', p_discount, 'starts_at', p_starts, 'ends_at', null, 'type', 'standard') end,
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', case when p_checkout is null then null
        else jsonb_build_object('klokshift_checkout', p_checkout) end));
$$;
grant execute on function tests.fo_event(integer, text, text, uuid, text, timestamptz, timestamptz, text) to public;

-- Azienda nuova di Ow, con una sede aperta e la prova avviata.
create function tests.fo_workspace(p_name text) returns uuid language plpgsql as $$
declare ws uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace(p_name);
  perform public.create_venue(ws, 'Sede ' || p_name);
  perform public.start_workspace_trial(ws);
  return ws;
end $$;
grant execute on function tests.fo_workspace(text) to public;

-- Prepara un acquisto Piccola mensile come la Edge Function.
create function tests.fo_prepare(p_ws uuid) returns jsonb language plpgsql as $$
begin
  perform tests.fo_service();
  return public.billing_prepare_checkout('sandbox', tests.id('Ow'), p_ws, 'base', 'month', 0);
end $$;
grant execute on function tests.fo_prepare(uuid) to public;

-- Il fondatore, con MFA (come in 095_founder_concessions).
insert into auth.sessions(id, user_id) values ('00000000-0000-4000-8000-000000000148', tests.id('Str'));
insert into auth.mfa_factors(id, user_id, factor_type, status)
values ('00000000-0000-4000-8000-000000000149', tests.id('Str'), 'totp', 'verified');
insert into private.platform_admins(user_id, reason) values (tests.id('Str'), 'Fixture clienti fondatori');
create function tests.fo_founder() returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000148', 'aal', 'aal2')::text, true);
end $$;
grant execute on function tests.fo_founder() to public;

-- Dieci aziende che hanno già preso il posto in un ambiente (fixture).
create function tests.fo_fill_seats(p_env text) returns void language plpgsql as $$
declare ws uuid;
begin
  perform tests.logout();
  for i in 1..10 loop
    insert into public.workspaces (name) values ('Fondatrice ' || i) returning id into ws;
    insert into public.workspace_founder_offers (workspace_id, environment, source, status, activated_at, ends_at)
    values (ws, p_env, 'auto', 'active', now() - interval '1 day', now() + interval '23 months');
  end loop;
end $$;
create function tests.fo_clear_seats() returns void language plpgsql as $$
begin
  perform tests.logout();
  delete from public.workspace_founder_offers o using public.workspaces w
   where w.id = o.workspace_id and w.name like 'Fondatrice %';
end $$;
grant execute on function tests.fo_fill_seats(text), tests.fo_clear_seats() to public;

-- Catalogo live finto (rollback a fine file): sconto e prezzo Piccola mensile,
-- per provare il percorso live che in produzione arriverà con la sua migration.
insert into private.billing_discounts (environment, discount_id, kind)
values ('live', 'dsc_01livefixture', 'founder');
insert into private.billing_prices (environment, price_id, item, billing_interval)
values ('live', 'pri_01livefixturebase', 'base', 'month');

-- 0. Catalogo e superficie.
do $$
begin
  perform tests.eq((select count(*)::int from private.billing_discounts
                     where environment = 'sandbox' and kind = 'founder' and selectable
                       and discount_id = 'dsc_01m820gne44grwwhcyekfe10ws'), 1, 'lo sconto sandbox è in catalogo');
  perform tests.eq(private.founder_seats_taken('sandbox'), 0, 'nessun posto preso in sandbox');
  perform tests.eq(private.founder_seats_taken('live'), 0, 'né in live');
  perform tests.eq(has_function_privilege('authenticated', 'public.billing_founder_offers_due(text)', 'EXECUTE'),
    false, 'il client non legge gli sconti in scadenza');
  perform tests.eq(has_function_privilege('service_role', 'public.billing_founder_offers_due(text)', 'EXECUTE'),
    true, 'il servizio sì');
  perform tests.eq(has_function_privilege('authenticated', 'private.founder_seats_taken(text)', 'EXECUTE'),
    false, 'conteggio interno');
  perform tests.eq(has_function_privilege('authenticated', 'private.queue_founder_offer_notices(timestamptz)', 'EXECUTE'),
    false, 'lavoro interno');
  perform tests.login('Ow');
  perform tests.raises('select * from public.workspace_founder_offers', 'permission denied',
    'il titolare non legge la tabella');
  perform tests.raises('select * from private.billing_discounts', 'permission denied',
    'né il catalogo degli sconti');
  perform tests.raises(format('insert into public.workspace_founder_offers (workspace_id, environment, source, status) values (%L, ''live'', ''founder'', ''reserved'')',
    tests.id('W1')), 'permission denied', 'e non si riserva un posto da sé');
  perform tests.raises('select public.billing_founder_offers_due(''sandbox'')', 'permission denied',
    'un client non esegue billing_founder_offers_due');
  perform tests.login('Co');
  perform tests.raises(format('select public.get_founder_offer(%L, ''sandbox'')', tests.id('W1')), 'not_allowed',
    'un collaboratore non legge lo sconto');
  perform tests.login('Emp2');
  perform tests.raises(format('select public.get_founder_offer(%L, ''live'')', tests.id('W1')), 'not_allowed',
    'un dipendente nemmeno');
  -- W1 è gratuita a vita: lo sconto non si somma.
  perform tests.login('Ow');
  perform tests.eq(public.get_founder_offer(tests.id('W1'), 'sandbox'),
    jsonb_build_object('status', null, 'ends_at', null, 'percent', 30, 'eligible', false),
    'gratuità a vita: niente sconto');
  perform tests.eq((public.get_founder_offer(tests.id('W1'), 'live') ->> 'eligible')::boolean, false,
    'in nessun ambiente');
  perform tests.raises(format('select public.get_founder_offer(%L, ''prod'')', tests.id('W1')),
    'billing_invalid_environment', 'ambiente inventato');
  perform tests.raises(format('select public.get_founder_offer(%L, null)', tests.id('W1')),
    'billing_invalid_environment', 'ambiente mancante');
  perform tests.logout();
end $$;

-- 1. Azienda nuova: lo sconto c'è; con 10 posti presi no.
do $$
declare ws uuid; r jsonb;
begin
  ws := tests.fo_workspace('Fondatori: nuova');
  perform tests.eq(public.get_founder_offer(ws, 'sandbox'),
    jsonb_build_object('status', null, 'ends_at', null, 'percent', 30, 'eligible', true),
    'azienda nuova: idonea');
  r := tests.fo_prepare(ws);
  perform tests.eq(r ->> 'discount_id', 'dsc_01m820gne44grwwhcyekfe10ws', 'il checkout porta lo sconto');
  perform tests.ok(r ? 'checkout_id' and jsonb_array_length(r -> 'items') = 1, 'e il resto non cambia');

  -- Dieci posti presi in sandbox: niente sconto in sandbox, live intatto.
  perform tests.fo_fill_seats('sandbox');
  perform tests.eq(private.founder_seats_taken('sandbox'), 10, 'dieci posti presi in sandbox');
  perform tests.eq(private.founder_seats_taken('live'), 0, 'nessuno in live');
  r := tests.fo_prepare(ws);
  perform tests.ok(r ? 'discount_id', 'la chiave c''è sempre');
  perform tests.eq(r ->> 'discount_id', null::text, 'posti sandbox finiti: niente sconto in sandbox');
  perform tests.login('Ow');
  perform tests.eq((public.get_founder_offer(ws, 'sandbox') ->> 'eligible')::boolean, false, 'non idonea in sandbox');
  perform tests.eq((public.get_founder_offer(ws, 'live') ->> 'eligible')::boolean, true, 'ancora idonea in live');
  perform tests.fo_service();
  perform tests.eq(public.billing_prepare_checkout('live', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'discount_id',
    'dsc_01livefixture', 'il checkout live porta lo sconto live');
  -- I posti sandbox non fermano il fondatore: riserva posti live.
  perform tests.fo_founder();
  perform tests.eq((public.admin_get_workspace_control(ws) #>> '{founder_seats,taken}')::int, 0,
    'il contatore del fondatore conta solo i posti live');

  -- Dieci posti presi in live: niente sconto live, e il fondatore non riserva oltre.
  perform tests.fo_clear_seats();
  perform tests.fo_fill_seats('live');
  perform tests.fo_service();
  perform tests.eq(public.billing_prepare_checkout('live', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'discount_id',
    null::text, 'posti live finiti: niente sconto live');
  perform tests.eq(tests.fo_prepare(ws) ->> 'discount_id', 'dsc_01m820gne44grwwhcyekfe10ws', 'la sandbox ha i suoi posti');
  perform tests.login('Ow');
  perform tests.eq((public.get_founder_offer(ws, 'live') ->> 'eligible')::boolean, false, 'non idonea in live');
  perform tests.fo_founder();
  perform tests.eq((public.admin_get_workspace_control(ws) #>> '{founder_seats,taken}')::int, 10, 'dieci posti live');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L, ''grant_founder_offer'', ''Prima cliente'', gen_random_uuid(), %L)',
    ws, public.admin_get_workspace_control(ws) ->> 'revision'), 'founder_seats_full', 'posti finiti');
  perform tests.fo_clear_seats();
  perform tests.eq(private.founder_seats_taken('live'), 0, 'posti di nuovo liberi');
end $$;

-- 2. Un abbonamento passato, anche disdetto, esclude lo sconto automatico nel
--    suo ambiente; una prova in sandbox non tocca il live.
do $$
declare ws uuid; co uuid; r jsonb;
begin
  ws := tests.fo_workspace('Fondatori: già abbonata');
  co := (tests.fo_prepare(ws) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox', tests.fo_event(1, 'subscription.created', 'sub_01foold', co,
    'active', now() - interval '1 day', now() + interval '29 days', null));
  perform public.billing_apply_event('sandbox', tests.fo_event(2, 'subscription.canceled', 'sub_01foold', null,
    'canceled', now() - interval '1 day', now() + interval '29 days', null));
  perform tests.eq((select count(*)::int from public.workspace_founder_offers where workspace_id = ws), 0,
    'senza sconto nessuna riga');
  r := tests.fo_prepare(ws);
  perform tests.eq(r ->> 'discount_id', null::text, 'abbonamento disdetto: niente sconto');
  perform tests.logout();
  perform tests.eq(private.founder_offer_open(ws, 'sandbox'), false, 'non idonea in sandbox');
  perform tests.eq(private.founder_offer_open(ws, 'live'), true, 'ancora idonea in live');
  perform tests.eq(private.founder_offer_discount(ws, 'live'), 'dsc_01livefixture', 'col suo sconto live');
  perform tests.login('Ow');
  perform tests.eq((public.get_founder_offer(ws, 'sandbox') ->> 'eligible')::boolean, false, 'il titolare: non in sandbox');
  perform tests.eq((public.get_founder_offer(ws, 'live') ->> 'eligible')::boolean, true, 'il titolare: sì in live');
  -- A mano invece no: la gratuità a vita esclude in ogni ambiente.
  perform tests.fo_founder();
  perform tests.raises(format('select public.admin_apply_workspace_action(%L, ''grant_founder_offer'', ''Gratuita'', gen_random_uuid(), %L)',
    tests.id('W1'), public.admin_get_workspace_control(tests.id('W1')) ->> 'revision'), 'founder_offer_not_eligible',
    'gratuita a vita');
  perform tests.logout();
end $$;

-- 3. L'avviso con lo sconto attiva il posto: 24 mesi dal primo periodo.
do $$
declare ws uuid; co uuid; o public.workspace_founder_offers; r jsonb; due jsonb; n integer;
begin
  ws := tests.fo_workspace('Fondatori: attiva');
  co := (tests.fo_prepare(ws) ->> 'checkout_id')::uuid;
  r := public.billing_apply_event('sandbox', tests.fo_event(10, 'subscription.created', 'sub_01foactive', co,
    'active', '2026-12-01 00:00 Europe/Rome', '2027-01-01 00:00 Europe/Rome', 'dsc_01m820gne44grwwhcyekfe10ws'));
  perform tests.eq(r ->> 'outcome', 'applied', 'avviso applicato');
  perform tests.logout();
  select * into o from public.workspace_founder_offers where workspace_id = ws;
  perform tests.eq(o.status, 'active', 'posto attivo');
  perform tests.eq(o.source, 'auto', 'preso dal checkout');
  perform tests.eq(o.activated_at, '2026-12-01 00:00 Europe/Rome'::timestamptz, 'dal primo periodo');
  perform tests.eq(o.ends_at, '2028-12-01 00:00 Europe/Rome'::timestamptz, '24 mesi di calendario');
  perform tests.eq(o.subscription_id, (r ->> 'subscription_id')::uuid, 'legato all''abbonamento');
  perform tests.eq(private.founder_seats_taken('sandbox'), 1, 'un posto preso in sandbox');
  perform tests.eq(private.founder_seats_taken('live'), 0, 'nessuno in live');
  perform tests.eq((select environment from public.workspace_founder_offers where workspace_id = ws), 'sandbox',
    'dall''ambiente dell''abbonamento');

  -- Paddle ripete lo stesso avviso (event id diverso): niente doppioni, scadenza ferma.
  perform tests.fo_service();
  perform public.billing_apply_event('sandbox', tests.fo_event(11, 'subscription.created', 'sub_01foactive', co,
    'active', '2026-12-01 00:00 Europe/Rome', '2027-01-01 00:00 Europe/Rome', 'dsc_01m820gne44grwwhcyekfe10ws'));
  -- E il rinnovo (o un passaggio all'annuale) non fa ripartire i 24 mesi.
  perform public.billing_apply_event('sandbox', tests.fo_event(12, 'subscription.updated', 'sub_01foactive', null,
    'active', '2027-01-01 00:00 Europe/Rome', '2027-02-01 00:00 Europe/Rome', 'dsc_01m820gne44grwwhcyekfe10ws'));
  perform tests.logout();
  perform tests.eq((select count(*)::int from public.workspace_founder_offers where workspace_id = ws), 1, 'una riga');
  perform tests.eq((select ends_at from public.workspace_founder_offers where workspace_id = ws),
    '2028-12-01 00:00 Europe/Rome'::timestamptz, 'scadenza invariata');
  perform tests.eq((select activated_at from public.workspace_founder_offers where workspace_id = ws),
    '2026-12-01 00:00 Europe/Rome'::timestamptz, 'inizio invariato');

  perform tests.login('Ow');
  perform tests.eq(public.get_founder_offer(ws, 'live'),
    jsonb_build_object('status', null, 'ends_at', null, 'percent', 30, 'eligible', false),
    'in live nessuna riga, e l''abbonamento aperto esclude l''acquisto');
  perform tests.eq(public.get_founder_offer(ws, 'sandbox'), jsonb_build_object('status', 'active',
    'ends_at', '2028-12-01 00:00 Europe/Rome'::timestamptz, 'percent', 30, 'eligible', false),
    'il titolare vede lo sconto attivo');

  -- Avviso 60 giorni prima, una volta sola, ai titolari attivi.
  perform tests.logout();
  n := private.queue_founder_offer_notices('2028-12-01 00:00 Europe/Rome'::timestamptz - interval '61 days');
  perform tests.eq(n, 0, 'a 61 giorni ancora niente');
  n := private.queue_founder_offer_notices('2028-12-01 00:00 Europe/Rome'::timestamptz - interval '60 days');
  perform tests.eq(n, 1, 'a 60 giorni la notifica');
  perform tests.eq((select count(*)::int from public.notifications
                     where user_id = tests.id('Ow') and type = 'founder_offer_ending' and related_id = ws), 1,
    'una notifica al titolare');
  perform tests.eq((select title from public.notifications
                     where user_id = tests.id('Ow') and type = 'founder_offer_ending' and related_id = ws),
    'Lo sconto fondatori finisce il 1° dicembre 2028', 'titolo con la data');
  perform tests.eq((select body from public.notifications
                     where user_id = tests.id('Ow') and type = 'founder_offer_ending' and related_id = ws),
    'Dal rinnovo successivo si paga il listino in vigore. Puoi cambiare o disdire dalla pagina Piano.',
    'corpo senza importi');
  perform tests.eq((select count(*)::int from public.notifications
                     where type = 'founder_offer_ending' and related_id = ws and user_id <> tests.id('Ow')), 0,
    'solo i titolari');
  n := private.queue_founder_offer_notices('2028-12-01 00:00 Europe/Rome'::timestamptz - interval '59 days');
  perform tests.eq(n, 0, 'richiamata, nessuna seconda');
  perform tests.eq((select count(*)::int from public.notifications
                     where type = 'founder_offer_ending' and related_id = ws), 1, 'sempre una');

  -- In scadenza entro 24 ore: il servizio sa a quale abbonamento togliere lo sconto.
  perform tests.fo_service();
  perform tests.eq((select count(*)::int from public.billing_founder_offers_due('sandbox')), 0, 'oggi non scade');
  perform tests.logout();
  update public.workspace_founder_offers set activated_at = now() - interval '23 months', ends_at = now() + interval '2 hours'
   where workspace_id = ws;
  perform tests.fo_service();
  select d into due from public.billing_founder_offers_due('sandbox') d;
  perform tests.eq(due, jsonb_build_object('workspace_id', ws, 'paddle_subscription_id', 'sub_01foactive',
    'ends_at', (select ends_at from public.workspace_founder_offers where workspace_id = ws)), 'riga dovuta');
  perform tests.eq((select count(*)::int from public.billing_founder_offers_due('live')), 0, 'solo del suo ambiente');

  -- Lo sconto tolto (dal runner, poi l'avviso firmato): il posto finisce e resta contato.
  perform public.billing_apply_event('sandbox', tests.fo_event(13, 'subscription.updated', 'sub_01foactive', null,
    'active', '2027-02-01 00:00 Europe/Rome', '2027-03-01 00:00 Europe/Rome', null));
  perform tests.logout();
  select * into o from public.workspace_founder_offers where workspace_id = ws;
  perform tests.eq(o.status, 'ended', 'sconto finito');
  perform tests.ok(o.ended_at is not null, 'con la data');
  perform tests.eq(private.founder_seats_taken('sandbox'), 1, 'il posto finito conta ancora');
  perform tests.fo_service();
  perform tests.eq((select count(*)::int from public.billing_founder_offers_due('sandbox')), 0, 'non più dovuta');
  perform tests.login('Ow');
  perform tests.eq(public.get_founder_offer(ws, 'sandbox') ->> 'status', 'ended', 'il titolare lo vede finito');
  -- Lo sconto ricompare sullo stesso abbonamento (rimesso a mano su Paddle):
  -- la riga torna attiva con la scadenza di prima, già passata, e il runner la
  -- ritrova per toglierlo di nuovo. I 24 mesi non ripartono.
  perform tests.logout();
  update public.workspace_founder_offers set activated_at = now() - interval '25 months', ends_at = now() - interval '1 day'
   where workspace_id = ws;
  perform tests.fo_service();
  perform public.billing_apply_event('sandbox', tests.fo_event(14, 'subscription.updated', 'sub_01foactive', null,
    'active', '2027-02-01 00:00 Europe/Rome', '2027-03-01 00:00 Europe/Rome', 'dsc_01m820gne44grwwhcyekfe10ws'));
  perform tests.logout();
  select * into o from public.workspace_founder_offers where workspace_id = ws;
  perform tests.eq(o.status, 'active', 'riaperta');
  perform tests.ok(o.ended_at is null, 'senza data di fine');
  perform tests.ok(o.ends_at < now(), 'con la scadenza di prima');
  perform tests.eq(private.founder_seats_taken('sandbox'), 1, 'sempre un posto');
  perform tests.fo_service();
  perform tests.eq((select d ->> 'paddle_subscription_id' from public.billing_founder_offers_due('sandbox') d),
    'sub_01foactive', 'scaduta: il runner la ritrova');
  -- Tolto di nuovo: finisce di nuovo.
  perform public.billing_apply_event('sandbox', tests.fo_event(15, 'subscription.updated', 'sub_01foactive', null,
    'active', '2027-02-01 00:00 Europe/Rome', '2027-03-01 00:00 Europe/Rome', null));
  perform tests.logout();
  perform tests.eq((select status from public.workspace_founder_offers where workspace_id = ws), 'ended', 'di nuovo finita');
end $$;

-- 4. Posto riservato a mano: è live, vale anche a posti live finiti solo nel
--    checkout live, l'avviso live lo attiva e resta del fondatore.
do $$
declare ws uuid; op uuid := gen_random_uuid(); rev text; res jsonb; again jsonb; co uuid; r jsonb; o public.workspace_founder_offers;
  ev jsonb;
begin
  ws := tests.fo_workspace('Fondatori: riservata');
  -- Senza lo sconto live in catalogo il fondatore non riserva: il posto
  -- resterebbe preso senza checkout scontato.
  perform tests.logout();
  update private.billing_discounts set selectable = false where environment = 'live';
  perform tests.fo_founder();
  perform tests.raises(format('select public.admin_apply_workspace_action(%L, ''grant_founder_offer'', ''Senza sconto'', gen_random_uuid(), %L)',
    ws, public.admin_get_workspace_control(ws) ->> 'revision'), 'founder_offer_unavailable', 'nessuno sconto live');
  perform tests.logout();
  perform tests.eq(private.founder_seats_taken('live'), 0, 'nessun posto preso');
  update private.billing_discounts set selectable = true where environment = 'live';
  perform tests.fo_founder();
  perform tests.raises(format('select public.admin_apply_workspace_action(%L, ''grant_founder_offer'', '''', gen_random_uuid(), %L)',
    ws, public.admin_get_workspace_control(ws) ->> 'revision'), 'admin_reason_required', 'motivo obbligatorio');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L, ''grant_founder_offer'', ''x'', gen_random_uuid(), %L, p_plan => ''base'')',
    ws, public.admin_get_workspace_control(ws) ->> 'revision'), 'admin_invalid_operation', 'niente parametri di concessione');
  rev := public.admin_get_workspace_control(ws) ->> 'revision';
  res := public.admin_apply_workspace_action(ws, 'grant_founder_offer', 'Ristorante amico, primo feedback', op, rev);
  perform tests.eq(res ->> 'action', 'grant_founder_offer', 'intervento registrato');
  perform tests.ok(public.admin_get_workspace_control(ws) ->> 'revision' <> rev, 'la revisione cambia');
  again := public.admin_apply_workspace_action(ws, 'grant_founder_offer', 'Ristorante amico, primo feedback', op, rev);
  perform tests.eq(again, res, 'ripetuto: stesso esito');
  perform tests.eq(public.admin_get_workspace_control(ws) #>> '{snapshot,founder_offer,status}', 'reserved',
    'il fondatore vede il posto riservato');
  perform tests.eq((public.admin_get_workspace_control(ws) #>> '{founder_seats,taken}')::int, 1,
    'posti live presi: il riservato (quello sandbox finito non conta)');
  perform tests.eq((public.admin_get_workspace_control(ws) #>> '{founder_seats,total}')::int, 10, 'su dieci');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L, ''grant_founder_offer'', ''Di nuovo'', gen_random_uuid(), %L)',
    ws, public.admin_get_workspace_control(ws) ->> 'revision'), 'founder_offer_not_eligible', 'una volta sola');
  perform tests.logout();
  perform tests.eq((select count(*)::int from private.admin_operations where target_id = ws and action = 'grant_founder_offer'),
    1, 'una riga di registro');
  select * into o from public.workspace_founder_offers where workspace_id = ws;
  perform tests.eq(o.environment || '/' || o.status || '/' || o.source, 'live/reserved/founder', 'riservato dal fondatore, in live');
  perform tests.eq(private.founder_seats_taken('live'), 1, 'il riservato conta in live');
  perform tests.eq(private.founder_seats_taken('sandbox'), 1, 'non in sandbox');

  -- Posti finiti in entrambi gli ambienti: il riservato vale solo nel checkout live.
  perform tests.fo_fill_seats('sandbox');
  perform tests.fo_fill_seats('live');
  perform tests.eq(tests.fo_prepare(ws) ->> 'discount_id', null::text, 'in sandbox il posto live non vale');
  perform tests.login('Ow');
  perform tests.eq(public.get_founder_offer(ws, 'live'), jsonb_build_object('status', 'reserved', 'ends_at', null,
    'percent', 30, 'eligible', true), 'il titolare vede il posto riservato');
  perform tests.eq((public.get_founder_offer(ws, 'sandbox') ->> 'status'), null::text, 'in sandbox nessuna riga');
  perform tests.fo_service();
  r := public.billing_prepare_checkout('live', tests.id('Ow'), ws, 'base', 'month', 0);
  perform tests.eq(r ->> 'discount_id', 'dsc_01livefixture', 'il posto riservato vale anche a posti live finiti');
  co := (r ->> 'checkout_id')::uuid;
  ev := jsonb_set(tests.fo_event(20, 'subscription.created', 'sub_01foreserved', co,
    'active', '2026-12-15 10:30 Europe/Rome', '2027-01-15 10:30 Europe/Rome', 'dsc_01livefixture'),
    '{data,items,0,price,id}', '"pri_01livefixturebase"');
  perform tests.eq(public.billing_apply_event('live', ev) ->> 'outcome', 'applied', 'avviso live applicato');
  perform tests.logout();
  select * into o from public.workspace_founder_offers where workspace_id = ws;
  perform tests.eq(o.environment || '/' || o.status || '/' || o.source, 'live/active/founder', 'attivato, resta del fondatore');
  perform tests.eq(o.ends_at, '2028-12-15 10:30 Europe/Rome'::timestamptz, '24 mesi');
  perform tests.eq((select count(*)::int from public.workspace_founder_offers where workspace_id = ws), 1,
    'nessuna riga sandbox');
  perform tests.fo_service();
  perform tests.eq((select count(*)::int from public.billing_founder_offers_due('live')), 0, 'live non scade oggi');
  perform tests.logout();
  update public.workspace_founder_offers set activated_at = now() - interval '23 months',
    ends_at = now() + interval '1 hour' where workspace_id = ws;
  perform tests.fo_service();
  perform tests.eq((select d ->> 'paddle_subscription_id' from public.billing_founder_offers_due('live') d),
    'sub_01foreserved', 'dovuto in live');
  perform tests.eq((select count(*)::int from public.billing_founder_offers_due('sandbox') d
                     where d ->> 'workspace_id' = ws::text), 0, 'non in sandbox');
  perform tests.fo_clear_seats();
end $$;

rollback;
select 'founder offers: ok' as result;
