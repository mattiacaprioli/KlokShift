-- Listino a fasce del 22/11 (docs/MONETIZATION.md §2): Base fino a 15 persone,
-- Team fino a 40, Grande fino a 100; `custom` è il perimetro senza limite delle
-- concessioni del fondatore. La prova è Grande. Chi è già oltre il limite resta
-- operativo e nessuno viene tolto: si blocca solo la crescita.
begin;

create function tests.bands_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.bands_service() to public;

-- Abbonamento mensile come lo applicherebbe l'avviso di Paddle.
create function tests.bands_event(p_seq integer, p_sub text, p_checkout uuid, p_plan_price text,
  p_ends timestamptz)
returns jsonb language sql as $$
  select jsonb_build_object('event_id', 'evt_01bands' || p_seq, 'event_type', 'subscription.updated',
    'occurred_at', now() + make_interval(secs => p_seq),
    'data', jsonb_build_object('id', p_sub, 'customer_id', 'ctm_01bands', 'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', p_plan_price),
          'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', now() - interval '1 day', 'ends_at', p_ends),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', p_checkout)));
$$;
grant execute on function tests.bands_event(integer, text, uuid, text, timestamptz) to public;

-- Azienda nuova di Ow con una sede aperta; restituisce [azienda, sede].
create function tests.bands_workspace(p_name text) returns uuid[] language plpgsql as $$
declare ws uuid; v uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace(p_name);
  v := public.create_venue(ws, 'Sede ' || p_name);
  return array[ws, v];
end $$;
grant execute on function tests.bands_workspace(text) to public;

-- Porta l'azienda a p_people persone uniche (come titolare).
create function tests.bands_fill(p_ws uuid, p_venue uuid, p_people integer) returns void language plpgsql as $$
declare people integer;
begin
  perform tests.login('Ow');
  people := (public.get_workspace_access(p_ws) #>> '{usage,people}')::integer;
  for i in people + 1..p_people loop
    perform public.add_member(p_ws, jsonb_build_object('full_name', 'Persona ' || i), 'none', '{}', 'all',
      jsonb_build_array(jsonb_build_object('venue_id', p_venue)));
  end loop;
end $$;
grant execute on function tests.bands_fill(uuid, uuid, integer) to public;

create function tests.bands_people(p_ws uuid) returns integer language sql security definer as $$
  select (private.workspace_access_at(p_ws, now()) #>> '{usage,people}')::integer
$$;
grant execute on function tests.bands_people(uuid) to public;

-- 0. Dati: nessuna concessione o prova è rimasta sul Team «senza limite».
--    Il banco di prova parte vuoto e le fixture del seed nascono `custom`;
--    la conversione vera è provata al punto 9 con private.migrate_plan_bands().
do $$
begin
  perform tests.ok(not exists (select 1 from public.workspace_access_periods
    where kind in ('complimentary_lifetime', 'complimentary_temporary', 'transition') and plan = 'team'),
    'nessuna concessione Team rimasta');
  perform tests.ok(not exists (select 1 from public.workspace_access_periods
    where kind = 'trial' and plan = 'team'), 'nessuna prova Team rimasta');
end $$;

-- 1. Le fasce.
do $$
begin
  perform tests.eq(private.plan_people_limit('base'), 15, 'Base fino a 15 persone');
  perform tests.eq(private.plan_people_limit('team'), 40, 'Team fino a 40 persone');
  perform tests.eq(private.plan_people_limit('large'), 100, 'Grande fino a 100 persone');
  perform tests.eq(private.plan_people_limit('custom'), null::integer, 'il perimetro personalizzato non ha limite');
  perform tests.raises('select private.plan_people_limit(''pro'')', 'billing_invalid_selection', 'piani inventati rifiutati');
  perform tests.raises('select private.plan_people_limit(null)', 'billing_invalid_selection', 'anche senza piano');
  perform tests.eq(private.plan_rank('base'), 1, 'Base è la fascia più piccola');
  perform tests.eq(private.plan_rank('team'), 2, 'poi Team');
  perform tests.eq(private.plan_rank('large'), 3, 'poi Grande');
  perform tests.raises('select private.plan_rank(''custom'')', 'billing_invalid_selection',
    'il perimetro personalizzato non si confronta');
  perform tests.eq(has_function_privilege('authenticated', 'private.plan_people_limit(text)', 'EXECUTE'), false,
    'funzioni interne');
end $$;

-- 9. La conversione della migration (Da Buffa): concessioni Team → personalizzato,
--    prove Team → Grande, una riga di registro senza autore per concessione.
do $$
declare w uuid[]; life uuid; temp uuid; trans uuid; trial uuid; a jsonb; n integer;
begin
  w := tests.bands_workspace('Fasce: conversione a vita');
  life := w[1];
  perform tests.logout();
  -- Con le fasce di oggi Team non contiene 45 persone: si entra col personalizzato
  -- e si riporta la riga al Team di ieri, come la trova la migration sul remoto.
  insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason)
  values (life, 'complimentary_lifetime', 'custom', 1, now() - interval '1 day', null, 'Fixture Da Buffa');
  update public.workspace_commercial_state set migration_review_required = false where workspace_id = life;
  perform tests.bands_fill(life, w[2], 45);
  perform tests.logout();
  update public.workspace_access_periods set plan = 'team' where workspace_id = life;

  w := tests.bands_workspace('Fasce: conversione a tempo');
  temp := w[1];
  w := tests.bands_workspace('Fasce: conversione transizione');
  trans := w[1];
  w := tests.bands_workspace('Fasce: conversione prova');
  trial := w[1];
  perform tests.logout();
  insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason)
  values (temp, 'complimentary_temporary', 'team', 1, now() - interval '1 day', now() + interval '30 days', 'Fixture'),
         (trans, 'transition', 'team', 1, now() - interval '1 day', now() + interval '30 days', 'Fixture'),
         (trial, 'trial', 'team', 1, now() - interval '1 day', now() + interval '29 days', 'Fixture');

  n := private.migrate_plan_bands();
  perform tests.eq(n, 4, 'quattro righe convertite');
  perform tests.eq((select plan from public.workspace_access_periods where workspace_id = life), 'custom', 'a vita → personalizzato');
  perform tests.eq((select plan from public.workspace_access_periods where workspace_id = temp), 'custom', 'a tempo → personalizzato');
  perform tests.eq((select plan from public.workspace_access_periods where workspace_id = trans), 'custom', 'transizione → personalizzato');
  perform tests.eq((select plan from public.workspace_access_periods where workspace_id = trial), 'large', 'prova → Grande');

  a := private.workspace_access_at(life, now());
  perform tests.eq(a ->> 'state', 'operational', 'Da Buffa resta operativa');
  perform tests.eq(a #>> '{limits,people}', null::text, 'senza limite di persone');
  perform tests.eq(tests.bands_people(life), 45, 'con le sue 45 persone');

  perform tests.eq((select count(*) from private.admin_operations where action = 'plan_band_migration'
    and actor_id is null and target_id in (life, temp, trans)), 3::bigint, 'una riga di registro per concessione');
  perform tests.eq((select count(*) from private.admin_operations where action = 'plan_band_migration'
    and target_id = trial), 0::bigint, 'la prova non è un intervento del fondatore');
  perform tests.eq((select before_state #>> '{access,plan}' || '→' || (after_state #>> '{access,plan}')
    from private.admin_operations where action = 'plan_band_migration' and target_id = life), 'team→custom',
    'prima e dopo nel registro');
  perform tests.eq(private.migrate_plan_bands(), 0, 'la seconda volta non converte niente');
  perform tests.eq(has_function_privilege('authenticated', 'private.migrate_plan_bands()', 'EXECUTE'), false,
    'funzione interna');
  -- Ow ha un tetto di aziende: queste servivano solo qui.
  update public.workspaces set deleted_at = now() where id in (life, temp, trans, trial);
end $$;

-- Prezzi sandbox di Grande: quelli veri, dalla migration 20261122000300.
do $$
begin
  perform tests.eq((select count(*)::int from private.billing_prices
                     where environment = 'sandbox' and item = 'large' and selectable), 2,
    'Grande ha il prezzo mensile e quello annuale in sandbox');
end $$;

-- 2. Vincoli: le fasce nuove entrano dove servono, `custom` solo nei periodi.
do $$
declare ws uuid;
begin
  ws := tests.id('W1');
  insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason)
  values (ws, 'complimentary_temporary', 'large', 1, now() + interval '10 years', now() + interval '11 years', 'vincolo'),
         (ws, 'complimentary_temporary', 'custom', 1, now() + interval '10 years', now() + interval '11 years', 'vincolo');
  perform tests.raises(format('insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, '
    'starts_at, ends_at, reason) values (%L, ''transition'', ''pro'', 1, now(), now() + interval ''1 day'', ''x'')', ws),
    'workspace_access_periods_plan_check', 'nessun piano inventato nei periodi');
  perform tests.raises('insert into private.billing_prices (environment, price_id, item, billing_interval) '
    'values (''live'', ''pri_01custom'', ''custom'', ''month'')', 'billing_prices_item_check',
    'il personalizzato non si vende');
  perform tests.raises(format('insert into public.billing_checkouts (workspace_id, environment, requested_by, plan, '
    'billing_interval, extra_venues) values (%L, ''sandbox'', %L, ''custom'', ''month'', 0)', ws, tests.id('Ow')),
    'billing_checkouts_plan_check', 'né si compra');
  -- Il registro accetta un intervento senza autore solo per la migrazione del listino.
  insert into private.admin_operations values (gen_random_uuid(), null, 'workspace', ws, 'plan_band_migration',
    'prova', '{}', '{}', '{}', '{}', now());
  perform tests.raises(format('insert into private.admin_operations values (gen_random_uuid(), null, ''workspace'', %L, '
    '''add_note'', ''prova'', ''{}'', ''{}'', ''{}'', ''{}'', now())', ws), 'admin_operations_actor',
    'ogni altro intervento ha un autore');
end $$;

-- 3. Base con 20 persone (entrate prima della fascia da 15): resta operativa,
--    la 21ª no, nessuno viene tolto. Chi esce non conta.
do $$
declare w uuid[]; ws uuid; co uuid; a jsonb; mid uuid;
begin
  w := tests.bands_workspace('Fasce: Base oltre il limite');
  ws := w[1];
  perform public.start_workspace_trial(ws);
  perform tests.bands_fill(ws, w[2], 15);
  perform tests.bands_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  -- Durante la prova (Grande) entrano altre 5 persone; l'avviso di Paddle non conta le persone.
  perform tests.bands_fill(ws, w[2], 20);
  perform tests.bands_service();
  perform public.billing_apply_event('sandbox',
    tests.bands_event(1, 'sub_01bandsbase', co, 'pri_01m577s3dchg2ctcrenkderz05', now() + interval '29 days'));
  perform tests.logout();
  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'source', 'subscription', 'vale l''abbonamento');
  perform tests.eq(a ->> 'plan', 'base', 'Base');
  perform tests.eq(a ->> 'state', 'operational', 'oltre il limite resta operativa');
  perform tests.eq((a #>> '{limits,people}')::integer, 15, 'limite di Base');
  perform tests.eq(tests.bands_people(ws), 20, '20 persone');
  perform tests.login('Ow');
  perform tests.raises(format('select public.add_member(%L, ''{"full_name":"Ventunesima"}'', ''none'', ''{}'', ''all'', %L)',
    ws, jsonb_build_array(jsonb_build_object('venue_id', w[2]))), 'workspace_people_capacity', 'la 21ª persona non entra');
  perform tests.eq(tests.bands_people(ws), 20, 'e nessuno viene tolto');

  -- Chi esce non conta più.
  select m.id into mid from public.workspace_members m
   where m.workspace_id = ws and m.authority = 'none' order by m.created_at limit 1;
  perform public.remove_member(mid);
  perform tests.eq((select status from public.workspace_members where id = mid), 'left', 'uscita');
  perform tests.eq(tests.bands_people(ws), 19, 'la persona uscita non conta');
  perform tests.raises(format('select public.add_member(%L, ''{"full_name":"Ancora no"}'', ''none'', ''{}'', ''all'', %L)',
    ws, jsonb_build_array(jsonb_build_object('venue_id', w[2]))), 'workspace_people_capacity', 'ancora oltre il limite');
  perform tests.logout();
end $$;

-- 4. «Vicino al limite» per il fondatore: a 13 su 15 sì, a 12 no.
do $$
declare w uuid[]; ws uuid; co uuid; flags jsonb;
begin
  w := tests.bands_workspace('Fasce: vicino al limite');
  ws := w[1];
  perform public.start_workspace_trial(ws);
  perform tests.bands_fill(ws, w[2], 12);
  perform tests.bands_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox',
    tests.bands_event(2, 'sub_01bandsnear', co, 'pri_01m577s3dchg2ctcrenkderz05', now() + interval '29 days'));
  perform tests.logout();
  select private.admin_workspace_flags(r) into flags from private.admin_workspace_rows r where r.id = ws;
  perform tests.ok(not flags @> '[{"code":"people_near_capacity"}]', '12 su 15: non ancora vicino');
  perform tests.bands_fill(ws, w[2], 13);
  perform tests.logout();
  select private.admin_workspace_flags(r) into flags from private.admin_workspace_rows r where r.id = ws;
  perform tests.ok(flags @> '[{"code":"people_near_capacity"}]', '13 su 15: vicino al limite');
  perform tests.ok(not flags @> '[{"code":"people_over_capacity"}]', 'ma non oltre');
end $$;

-- 5. La prova è Grande; acquisto, aumento e riduzione seguono le fasce.
do $$
declare w uuid[]; ws uuid; co uuid; a jsonb; r jsonb; cid uuid; mid uuid;
  large_m text := 'pri_01m81x936fptc7ptqzj4qxg1zn';
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
begin
  w := tests.bands_workspace('Fasce: Grande');
  ws := w[1];
  perform public.start_workspace_trial(ws);
  perform tests.logout();
  perform tests.eq((select plan from public.workspace_access_periods where workspace_id = ws and kind = 'trial'),
    'large', 'la prova è Grande');
  a := private.workspace_access_at(ws, now());
  perform tests.eq((a #>> '{limits,people}')::integer, 100, 'con 100 persone');

  perform tests.bands_fill(ws, w[2], 41);
  perform tests.bands_service();
  perform tests.raises(format('select public.billing_prepare_checkout(''sandbox'', %L, %L, ''team'', ''month'', 0)',
    tests.id('Ow'), ws), 'workspace_people_capacity', 'Team non contiene 41 persone');
  perform tests.raises(format('select public.billing_prepare_checkout(''sandbox'', %L, %L, ''base'', ''month'', 0)',
    tests.id('Ow'), ws), 'workspace_people_capacity', 'Base nemmeno');
  perform tests.raises(format('select public.billing_prepare_checkout(''sandbox'', %L, %L, ''custom'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_invalid_selection', 'il personalizzato non si compra');
  r := public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'large', 'month', 0);
  perform tests.eq(r #>> '{items,0,price_id}', large_m, 'Grande con 41 persone: il prezzo di Grande');
  co := (r ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox',
    tests.bands_event(3, 'sub_01bandslarge', co, large_m, now() + interval '29 days'));
  perform tests.eq((select plan from public.billing_subscriptions where provider_subscription_id = 'sub_01bandslarge'),
    'large', 'l''avviso riconosce Grande');
  perform tests.logout();
  perform tests.eq(private.workspace_access_at(ws, now()) ->> 'plan', 'large', 'il periodo pagato è Grande');
  perform tests.bands_service();

  -- Da Grande a Team: non è un aumento.
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 0)',
    tests.id('Ow'), ws), 'billing_downgrade_unsupported', 'Grande→Team non è immediato');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''custom'', 0)',
    tests.id('Ow'), ws), 'billing_invalid_selection', 'il personalizzato non è un piano d''acquisto');
  -- Programmato al rinnovo: con 41 persone Team non basta.
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_scheduled_people', 'Grande→Team con 41 persone rifiutato');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''large'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_no_change', 'Grande→Grande non è un cambio');

  -- Con 40 persone sì, e la capacità futura diventa 40.
  perform tests.login('Ow');
  select m.id into mid from public.workspace_members m
   where m.workspace_id = ws and m.authority = 'none' order by m.created_at desc limit 1;
  perform public.remove_member(mid);
  perform tests.bands_service();
  r := public.billing_prepare_scheduled_change('sandbox', tests.id('Ow'), ws, 'team', 'month', 0);
  perform tests.eq(r ->> 'plan_price_id', team_m, 'Team mensile');
  perform tests.eq(r -> 'known_prices' ->> large_m, 'large', 'riconosce l''articolo Grande');
  cid := public.billing_record_scheduled_change('sandbox', tests.id('Ow'), ws, 'team', 'month', 0,
    jsonb_build_array(jsonb_build_object('price_id', large_m, 'quantity', 1)),
    jsonb_build_array(jsonb_build_object('price_id', team_m, 'quantity', 1)), 2900, 'EUR');
  perform tests.ok(cid is not null, 'Grande→Team registrato');
  perform tests.logout();
  perform tests.eq((private.billing_future_limits(ws) ->> 'people')::integer, 40, 'capacità futura di Team');
  perform tests.login('Ow');
  perform tests.raises(format('select public.add_member(%L, ''{"full_name":"Quarantunesima"}'', ''none'', ''{}'', ''all'', %L)',
    ws, jsonb_build_array(jsonb_build_object('venue_id', w[2]))), 'workspace_people_capacity_scheduled',
    'oltre la capacità futura non si cresce');
  perform tests.logout();
end $$;

-- 6. Team con 16 persone: verso Base no (anche al rinnovo), verso Grande sì.
do $$
declare w uuid[]; ws uuid; co uuid; r jsonb;
  team_m text := 'pri_01m577vzt1b6qkyyf80pnq4aj9';
begin
  w := tests.bands_workspace('Fasce: Team');
  ws := w[1];
  perform public.start_workspace_trial(ws);
  perform tests.bands_fill(ws, w[2], 16);
  perform tests.bands_service();
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'team', 'month', 0) ->> 'checkout_id')::uuid;
  perform public.billing_apply_event('sandbox',
    tests.bands_event(4, 'sub_01bandsteam', co, team_m, now() + interval '29 days'));
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''base'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_scheduled_people', 'Team→Base con 16 persone rifiutato');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''large'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_scheduled_not_reduction', 'Team→Grande passa dall''aumento immediato');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''custom'', ''month'', 0)',
    tests.id('Ow'), ws), 'billing_invalid_selection', 'nemmeno al rinnovo il personalizzato');
  r := public.billing_prepare_change('sandbox', tests.id('Ow'), ws, 'large', 0);
  perform tests.eq(r ->> 'plan_price_id', 'pri_01m81x936fptc7ptqzj4qxg1zn', 'Team→Grande è un aumento');
  -- Self-serve fino a 5 sedi in tutto: 4 aggiuntive sì, 5 no (serve un accordo).
  r := public.billing_prepare_change('sandbox', tests.id('Ow'), ws, 'team', 4);
  perform tests.eq((r ->> 'extra_venues')::integer, 4, '5 sedi in tutto si comprano da sé');
  perform tests.raises(format('select public.billing_prepare_change(''sandbox'', %L, %L, ''team'', 5)',
    tests.id('Ow'), ws), 'billing_venues_need_agreement', 'la sesta sede chiede un accordo');
  perform tests.raises(format('select public.billing_prepare_checkout(''sandbox'', %L, %L, ''team'', ''month'', 5)',
    tests.id('Ow'), ws), 'billing_venues_need_agreement', 'anche all''acquisto');
  perform tests.raises(format('select public.billing_prepare_scheduled_change(''sandbox'', %L, %L, ''team'', ''year'', 5)',
    tests.id('Ow'), ws), 'billing_venues_need_agreement', 'e al rinnovo');
  perform tests.eq(r ->> 'current_plan', 'team', 'da Team');
  perform tests.logout();
end $$;

-- 7. Perimetro personalizzato (Da Buffa): 45 persone, nessun limite.
do $$
declare w uuid[]; ws uuid; a jsonb;
begin
  w := tests.bands_workspace('Fasce: personalizzato');
  ws := w[1];
  perform tests.logout();
  insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason)
  values (ws, 'complimentary_lifetime', 'custom', 1, now(), null, 'Fixture: perimetro senza limite');
  update public.workspace_commercial_state set migration_review_required = false where workspace_id = ws;
  perform tests.bands_fill(ws, w[2], 45);
  perform tests.logout();
  a := private.workspace_access_at(ws, now());
  perform tests.eq(a ->> 'state', 'operational', 'operativa');
  perform tests.eq(a ->> 'plan', 'custom', 'personalizzato');
  perform tests.eq(a #>> '{limits,people}', null::text, 'nessun limite di persone');
  perform tests.eq(tests.bands_people(ws), 45, '45 persone');
  perform tests.ok(not exists (select 1 from private.admin_workspace_rows r
    cross join lateral jsonb_array_elements(private.admin_workspace_flags(r)) f
    where r.id = ws and f ->> 'code' in ('people_near_capacity', 'people_over_capacity')), 'nessun avviso di capacità');
end $$;

-- 8. Il fondatore concede anche Grande o personalizzato, mai sotto l'organico.
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000147',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status)
values('00000000-0000-4000-8000-000000000148',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture fasce');
create function tests.bands_founder() returns void language plpgsql as $$
begin
  perform tests.login('Str');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
    'session_id','00000000-0000-4000-8000-000000000147','aal','aal2')::text,true);
end $$;
grant execute on function tests.bands_founder() to authenticated;

do $$
declare w uuid[]; ws uuid; revision text; a jsonb;
begin
  w := tests.bands_workspace('Fasce: concessione');
  ws := w[1];
  perform tests.logout();
  insert into public.workspace_commercial_state (workspace_id) values (ws) on conflict do nothing;
  insert into public.workspace_access_periods (workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason)
  values (ws, 'complimentary_temporary', 'large', 1, now() - interval '1 day', now() + interval '30 days', 'Fixture');
  perform tests.bands_fill(ws, w[2], 16);
  perform tests.bands_founder();
  revision := public.admin_get_workspace_control(ws) ->> 'revision';
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Troppo piccola'','
    'gen_random_uuid(),%L,p_plan=>''base'',p_venue_limit=>1,p_document_limit_bytes=>2147483648)', ws, revision),
    'workspace_people_capacity', 'Base non contiene 16 persone');
  perform tests.raises(format('select public.admin_apply_workspace_action(%L,''grant_lifetime'',''Inventato'','
    'gen_random_uuid(),%L,p_plan=>''pro'',p_venue_limit=>1,p_document_limit_bytes=>2147483648)', ws, revision),
    'invalid_access_plan', 'piani inventati rifiutati');
  perform public.admin_apply_workspace_action(ws, 'grant_lifetime', 'Team gratuito', gen_random_uuid(), revision,
    p_plan => 'team', p_venue_limit => 1, p_document_limit_bytes => 2147483648);
  a := public.admin_get_workspace_control(ws) -> 'snapshot' -> 'access';
  perform tests.eq(a ->> 'plan' || '/' || (a #>> '{limits,people}'), 'team/40', 'Team gratuito: 40 persone');
  revision := public.admin_get_workspace_control(ws) ->> 'revision';
  perform public.admin_apply_workspace_action(ws, 'grant_lifetime', 'Grande gratuito', gen_random_uuid(), revision,
    p_plan => 'large', p_venue_limit => 1, p_document_limit_bytes => 2147483648);
  a := public.admin_get_workspace_control(ws) -> 'snapshot' -> 'access';
  perform tests.eq(a ->> 'plan' || '/' || (a #>> '{limits,people}'), 'large/100', 'Grande gratuito: 100 persone');
  revision := public.admin_get_workspace_control(ws) ->> 'revision';
  perform public.admin_apply_workspace_action(ws, 'grant_lifetime', 'Perimetro su misura', gen_random_uuid(), revision,
    p_plan => 'custom', p_venue_limit => 1, p_document_limit_bytes => 2147483648);
  a := public.admin_get_workspace_control(ws) -> 'snapshot' -> 'access';
  perform tests.eq(a ->> 'plan', 'custom', 'personalizzato concesso');
  perform tests.eq(a #>> '{limits,people}', null::text, 'senza limite di persone');
  perform tests.logout();
end $$;

-- 10. Le concessioni di servizio accettano tutte le fasce.
do $$
declare ws uuid := tests.id('W1'); g uuid; c uuid;
begin
  perform tests.bands_service();
  g := public.grant_workspace_access(ws, 'complimentary_temporary', 'large', 1,
    now() + interval '20 years', now() + interval '21 years', 'Grande a tempo');
  c := public.grant_workspace_access(ws, 'complimentary_temporary', 'custom', 1,
    now() + interval '22 years', now() + interval '23 years', 'Su misura a tempo');
  perform tests.raises(format('select public.grant_workspace_access(%L,''complimentary_lifetime'',''pro'',1,now(),null,''x'')', ws),
    'invalid_access_plan', 'piani inventati rifiutati');
  perform tests.logout();
  perform tests.eq((select plan from public.workspace_access_periods where id = g), 'large', 'Grande concesso dal servizio');
  perform tests.eq((select plan from public.workspace_access_periods where id = c), 'custom', 'personalizzato concesso dal servizio');
end $$;

rollback;
select 'plan bands: ok' as result;
