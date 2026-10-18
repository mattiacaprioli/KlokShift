-- Due avvisi gemelli dello stesso abbonamento nuovo (`subscription.created` e
-- `subscription.activated`, come li manda Paddle) elaborati in parallelo.
-- Una terza sessione tiene il lock dell'azienda finché entrambi non sono in
-- coda: senza la rilettura dopo il lock il secondo risultava un secondo
-- abbonamento (`duplicate_subscription`). Visto col primo acquisto sandbox.
\set ON_ERROR_STOP on
set statement_timeout = '20s';

create extension if not exists dblink with schema tests;
set search_path = tests, public, pg_catalog;

drop table if exists tests.c90_fixture;
create table tests.c90_fixture (workspace_id uuid primary key, checkout_id uuid not null);
grant select on tests.c90_fixture to public;
drop table if exists tests.c90_result;
create table tests.c90_result (ok boolean not null, error text);

create or replace function tests.c90_event(p_event text, p_type text) returns jsonb language sql as $$
  select jsonb_build_object('event_id', p_event, 'event_type', p_type, 'occurred_at', '2026-10-18T12:02:07.557280Z',
    'data', jsonb_build_object('id', 'sub_01c90twin', 'customer_id', 'ctm_01c90', 'status', 'active',
      'items', jsonb_build_array(jsonb_build_object('price', jsonb_build_object('id', 'pri_01m577s3dchg2ctcrenkderz05'),
        'quantity', 1, 'status', 'active', 'recurring', true)),
      'billing_cycle', jsonb_build_object('interval', 'month', 'frequency', 1),
      'current_billing_period', jsonb_build_object('starts_at', '2026-10-18T12:02:07Z', 'ends_at', '2026-11-18T12:02:07Z'),
      'scheduled_change', null, 'canceled_at', null, 'paused_at', null,
      'custom_data', jsonb_build_object('klokshift_checkout', (select checkout_id from tests.c90_fixture))));
$$;

create or replace function tests.c90_apply(p_type text, p_event text) returns text language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  r := public.billing_apply_event('sandbox', tests.c90_event(p_event, p_type));
  perform tests.logout();
  execute 'reset role';
  return coalesce(r ->> 'error', r ->> 'outcome');
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end $$;
grant execute on function tests.c90_apply(text, text) to postgres;

create or replace function tests.c90_wait(p_names text[], p_expected integer)
returns void language plpgsql as $$
begin
  for attempt in 1..1000 loop
    if (select count(*) from pg_stat_activity a
         where a.application_name = any(p_names) and a.wait_event_type = 'Lock') = p_expected then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'C90: timeout aspettando % worker bloccati', p_expected;
end $$;

create or replace function tests.c90_disconnect(p_name text)
returns void language plpgsql as $$
begin
  if p_name = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect(p_name);
  end if;
exception when others then
  null;
end $$;

-- Fixture committata: azienda con una sede e una richiesta d'acquisto aperta.
do $$
declare ws uuid; co uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('C90: avvisi gemelli');
  perform public.create_venue(ws, 'C90: sede');
  perform tests.logout();
  execute 'reset role';
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'service_role', true);
  co := (public.billing_prepare_checkout('sandbox', tests.id('Ow'), ws, 'base', 'month', 0) ->> 'checkout_id')::uuid;
  perform tests.logout();
  execute 'reset role';
  insert into tests.c90_fixture values (ws, co);
end $$;

do $$
declare
  ws uuid := (select workspace_id from tests.c90_fixture);
  a_out text; b_out text; a_error text; b_error text;
  a_done boolean := false; b_done boolean := false;
begin
  perform dblink_connect_u('c90_hold', 'dbname=postgres user=postgres application_name=c90_hold');
  perform dblink_connect_u('c90_a', 'dbname=postgres user=postgres application_name=c90_a');
  perform dblink_connect_u('c90_b', 'dbname=postgres user=postgres application_name=c90_b');
  perform dblink_exec('c90_hold', 'begin');
  perform * from dblink('c90_hold', format('select 1 from public.workspaces where id = %L for update', ws)) as t(x integer);

  perform dblink_send_query('c90_a', 'select tests.c90_apply(''subscription.created'', ''evt_01c90created'')');
  perform dblink_send_query('c90_b', 'select tests.c90_apply(''subscription.activated'', ''evt_01c90activated'')');
  perform tests.c90_wait(array['c90_a', 'c90_b'], 2);
  perform dblink_exec('c90_hold', 'commit');

  for attempt in 1..1000 loop
    if not a_done and dblink_is_busy('c90_a') = 0 then
      select result.v into a_out from dblink_get_result('c90_a', false) as result(v text);
      a_error := dblink_error_message('c90_a');
      perform * from dblink_get_result('c90_a', false) as result(v text);
      a_done := true;
    end if;
    if not b_done and dblink_is_busy('c90_b') = 0 then
      select result.v into b_out from dblink_get_result('c90_b', false) as result(v text);
      b_error := dblink_error_message('c90_b');
      perform * from dblink_get_result('c90_b', false) as result(v text);
      b_done := true;
    end if;
    exit when a_done and b_done;
    perform pg_sleep(0.01);
  end loop;
  perform tests.ok(a_done and b_done, 'C90: entrambi gli avvisi terminano');
  perform tests.eq(a_error, 'OK', 'C90: created senza errore');
  perform tests.eq(b_error, 'OK', 'C90: activated senza errore');
  perform tests.eq(a_out, 'applied', 'C90: created applicato, non scambiato per un duplicato');
  perform tests.eq(b_out, 'applied', 'C90: activated applicato, non scambiato per un duplicato');
  perform tests.eq((select count(*) from public.billing_subscriptions where workspace_id = ws), 1::bigint,
    'C90: un solo abbonamento');
  perform tests.eq((select count(*) from public.workspace_access_periods where workspace_id = ws), 1::bigint,
    'C90: un solo periodo pagato');
  perform tests.eq((select count(*) from private.billing_events
    where event_id like 'evt_01c90%' and outcome = 'rejected'), 0::bigint, 'C90: nessuna anomalia falsa');

  perform tests.c90_disconnect('c90_hold');
  perform tests.c90_disconnect('c90_a');
  perform tests.c90_disconnect('c90_b');
  insert into tests.c90_result values (true, null);
exception when others or query_canceled then
  perform tests.c90_disconnect('c90_hold');
  perform tests.c90_disconnect('c90_a');
  perform tests.c90_disconnect('c90_b');
  insert into tests.c90_result values (false, sqlerrm);
end $$;

-- Pulizia: gli abbonamenti non si cancellano a cascata con l'azienda (apposta).
delete from private.billing_events where event_id like 'evt_01c90%';
delete from public.workspace_access_periods where workspace_id in (select workspace_id from tests.c90_fixture);
delete from public.billing_checkouts where workspace_id in (select workspace_id from tests.c90_fixture);
delete from public.billing_subscriptions where workspace_id in (select workspace_id from tests.c90_fixture);
delete from public.workspaces where id in (select workspace_id from tests.c90_fixture);
drop function tests.c90_event(text, text), tests.c90_apply(text, text),
  tests.c90_wait(text[], integer), tests.c90_disconnect(text);
drop table tests.c90_fixture;
reset statement_timeout;
do $$
declare failure text;
begin
  select error into failure from tests.c90_result where not ok;
  if found then
    raise exception 'C90: %', failure;
  end if;
  perform tests.eq((select count(*) from tests.c90_result where ok), 1::bigint,
    'C90: scenario completato e fixture ripulita');
end $$;
drop table tests.c90_result;
select 'billing twin events concurrency: ok' as result;
