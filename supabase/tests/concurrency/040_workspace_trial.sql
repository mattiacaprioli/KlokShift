-- Due vere sessioni avviano la prima prova della stessa azienda: entrambe
-- ricevono lo stesso UUID, una sola data iniziale e un solo periodo.
-- Il cancello test-only ferma A prima dell'INSERT del periodo, mentre B deve
-- aspettare; non si affida alla velocità relativa dei worker.
\set ON_ERROR_STOP on
set statement_timeout = '20s';

create extension if not exists dblink with schema tests;
set search_path = tests, public, pg_catalog;

drop table if exists tests.b13_trial_fixture;
create table tests.b13_trial_fixture (workspace_id uuid primary key);
grant select on tests.b13_trial_fixture to authenticated, postgres;
drop table if exists tests.b13_trial_result;
create table tests.b13_trial_result (ok boolean not null, error text);

create or replace function tests.b13_trial_barrier()
returns trigger language plpgsql as $$
begin
  if new.kind = 'trial' and exists (
    select 1 from tests.b13_trial_fixture f where f.workspace_id = new.workspace_id
  ) then
    perform pg_advisory_lock(202610050013);
    perform pg_advisory_unlock(202610050013);
  end if;
  return new;
end $$;

create or replace function tests.b13_trial_start(p_workspace uuid)
returns uuid language plpgsql as $$
declare v_id uuid;
begin
  perform tests.login('Ow');
  v_id := public.start_workspace_trial(p_workspace);
  perform tests.logout();
  execute 'reset role';
  return v_id;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end $$;
grant execute on function tests.b13_trial_start(uuid) to postgres;

create or replace function tests.b13_trial_wait(p_names text[], p_expected integer)
returns void language plpgsql as $$
begin
  for attempt in 1..1000 loop
    if (select count(*) from pg_stat_activity a
         where a.application_name = any(p_names) and a.wait_event_type = 'Lock') = p_expected then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'B13: timeout aspettando % worker bloccati', p_expected;
end $$;

create or replace function tests.b13_trial_disconnect(p_name text)
returns void language plpgsql as $$
begin
  if p_name = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect(p_name);
  end if;
exception when others then
  -- Chiudere il backend chiamante libera comunque le connessioni dblink.
  null;
end $$;

-- Fixture committata prima di aprire i worker; nessun account o cliente reale.
do $$
declare ws uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('B13: attivazione prova concorrente');
  perform public.create_venue(ws, 'B13: prima sede');
  perform tests.logout();
  execute 'reset role';
  insert into tests.b13_trial_fixture values (ws);
end $$;

drop trigger if exists b13_trial_barrier on public.workspace_access_periods;
create trigger b13_trial_barrier before insert on public.workspace_access_periods
  for each row execute function tests.b13_trial_barrier();

do $$
declare
  ws uuid := (select workspace_id from tests.b13_trial_fixture);
  a_id uuid;
  b_id uuid;
  a_error text;
  b_error text;
  a_done boolean := false;
  b_done boolean := false;
begin
  perform pg_advisory_lock(202610050013);
  perform dblink_connect_u('b13_a', 'dbname=postgres user=postgres application_name=b13_a');
  perform dblink_connect_u('b13_b', 'dbname=postgres user=postgres application_name=b13_b');
  perform dblink_send_query('b13_a', format('select tests.b13_trial_start(%L)', ws));
  perform tests.b13_trial_wait(array['b13_a'], 1);
  perform dblink_send_query('b13_b', format('select tests.b13_trial_start(%L)', ws));
  perform tests.b13_trial_wait(array['b13_a', 'b13_b'], 2);
  perform pg_advisory_unlock(202610050013);

  for attempt in 1..1000 loop
    if not a_done and dblink_is_busy('b13_a') = 0 then
      select result.id into a_id from dblink_get_result('b13_a', false) as result(id uuid);
      a_error := dblink_error_message('b13_a');
      perform * from dblink_get_result('b13_a', false) as result(id uuid);
      a_done := true;
    end if;
    if not b_done and dblink_is_busy('b13_b') = 0 then
      select result.id into b_id from dblink_get_result('b13_b', false) as result(id uuid);
      b_error := dblink_error_message('b13_b');
      perform * from dblink_get_result('b13_b', false) as result(id uuid);
      b_done := true;
    end if;
    exit when a_done and b_done;
    perform pg_sleep(0.01);
  end loop;
  perform tests.ok(a_done and b_done, 'B13: entrambe le chiamate terminano');
  perform tests.eq(a_error, 'OK', 'B13: primo avvio senza errore');
  perform tests.eq(b_error, 'OK', 'B13: retry concorrente senza errore');
  perform tests.ok(a_id is not null, 'B13: primo avvio restituisce UUID');
  perform tests.eq(b_id, a_id, 'B13: entrambi gli avvii restituiscono lo stesso periodo');
  perform tests.eq((select count(*) from public.workspace_access_periods
    where workspace_id = ws and kind = 'trial'), 1::bigint, 'B13: una sola prova aziendale');
  perform tests.eq((select trial_started_at from public.workspace_commercial_state where workspace_id = ws),
    (select starts_at from public.workspace_access_periods where id = a_id),
    'B13: la data iniziale è quella del periodo unico');
  perform tests.eq((select ends_at - starts_at from public.workspace_access_periods where id = a_id),
    interval '720 hours', 'B13: durata prova conservata nel retry');

  perform tests.b13_trial_disconnect('b13_a');
  perform tests.b13_trial_disconnect('b13_b');
  insert into tests.b13_trial_result values (true, null);
exception when others or query_canceled then
  perform pg_advisory_unlock(202610050013);
  perform tests.b13_trial_disconnect('b13_a');
  perform tests.b13_trial_disconnect('b13_b');
  -- Il fallimento si rilancia soltanto dopo aver tolto trigger e fixture.
  insert into tests.b13_trial_result values (false, sqlerrm);
end $$;

drop trigger b13_trial_barrier on public.workspace_access_periods;
delete from public.workspaces where id in (select workspace_id from tests.b13_trial_fixture);
drop table tests.b13_trial_fixture;
drop function tests.b13_trial_barrier(), tests.b13_trial_start(uuid),
  tests.b13_trial_wait(text[], integer), tests.b13_trial_disconnect(text);
reset statement_timeout;
do $$
declare failure text;
begin
  select error into failure from tests.b13_trial_result where not ok;
  if found then
    raise exception 'B13: %', failure;
  end if;
  perform tests.eq((select count(*) from tests.b13_trial_result where ok), 1::bigint,
    'B13: scenario completato e fixture ripulita');
end $$;
drop table tests.b13_trial_result;
select 'workspace trial concurrency: ok' as result;
