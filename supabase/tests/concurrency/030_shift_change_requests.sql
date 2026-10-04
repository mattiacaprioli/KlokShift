-- B12: decisioni concorrenti sulla stessa richiesta di cambio turno. Stesso
-- impianto di 010/020: dblink apre due sessioni vere e un trigger test-only le
-- ferma prima dell'UPDATE della richiesta. Senza lock il secondo chiamante,
-- sbloccato, aggiornava comunque la riga per id e produceva i suoi effetti.
\set ON_ERROR_STOP on

drop extension if exists dblink cascade;
create extension dblink with schema tests;
set search_path = tests, public, pg_catalog;

drop table if exists tests.b12_ids;
create table tests.b12_ids (name text primary key, id uuid not null);
grant select on tests.b12_ids to authenticated;
drop table if exists tests.b12_workers;
create table tests.b12_workers (connection text primary key, pid integer not null);
drop table if exists tests.b12_result;
create table tests.b12_result (scenario text not null, ok boolean not null, error text);

create or replace function tests.b12_id(p_name text) returns uuid
language sql stable as $$ select id from tests.b12_ids where name = p_name $$;

create or replace function tests.b12_barrier()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_lock(202610040012);
  perform pg_advisory_unlock(202610040012);
  return new;
end;
$$;

drop trigger if exists b12_barrier on public.shift_change_requests;
create trigger b12_barrier
  before update on public.shift_change_requests
  for each row execute function tests.b12_barrier();

-- Fixture: un turno futuro di Emp in V1 e la sua richiesta (`hours` o
-- `substitution`). Committata prima dello scenario, così le sessioni la vedono.
create or replace function tests.b12_prepare(p_day integer, p_kind text)
returns void language plpgsql as $$
declare
  v_vm_emp uuid;
  v_ids uuid[];
  v_assignment uuid;
  v_request uuid;
begin
  perform tests.login('Ow');
  select id into v_vm_emp from public.venue_members
   where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');
  if not exists (select 1 from public.venue_members
                  where member_id = tests.id('M_Emp2') and venue_id = tests.id('V1')) then
    perform public.set_member_venue(tests.id('M_Emp2'), tests.id('V1'));
  end if;
  v_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'B12 richiesta',
    'date', (current_date + p_day)::text, 'start_time', '09:00', 'end_time', '13:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_vm_emp)))));
  select id into v_assignment from public.shift_assignments where shift_id = v_ids[1];
  perform tests.login('Emp');
  v_request := public.request_shift_change(v_assignment, 'B12', p_kind::public.change_request_kind,
    case when p_kind = 'hours' then time '10:00' end, case when p_kind = 'hours' then time '14:00' end);
  perform tests.logout();
  execute 'reset role';
  delete from tests.b12_ids;
  insert into tests.b12_ids values
    ('S0', v_ids[1]), ('a0', v_assignment), ('req', v_request),
    ('vm_ow', (select id from public.venue_members
                where member_id = tests.id('M_Ow') and venue_id = tests.id('V1'))),
    ('vm_emp2', (select id from public.venue_members
                  where member_id = tests.id('M_Emp2') and venue_id = tests.id('V1')));
end;
$$;

create or replace function tests.b12_resolve(p_request uuid, p_approve boolean, p_repl uuid, p_app text)
returns text language plpgsql as $$
begin
  perform set_config('application_name', p_app, false);
  perform tests.login('Ow');
  perform public.resolve_shift_change_request(p_request, p_approve, p_repl, p_app);
  perform tests.logout();
  execute 'reset role';
  return 'ok';
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.b12_withdraw(p_request uuid, p_app text)
returns text language plpgsql as $$
begin
  perform set_config('application_name', p_app, false);
  perform tests.login('Emp');
  perform public.withdraw_shift_change_request(p_request);
  perform tests.logout();
  execute 'reset role';
  return 'ok';
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.b12_connect(p_name text, p_app text)
returns void language plpgsql as $$
declare v_pid integer;
begin
  perform dblink_connect_u(p_name, 'dbname=postgres user=postgres');
  perform dblink_exec(p_name, format('set application_name = %L', p_app));
  select pid into v_pid from dblink(p_name, 'select pg_backend_pid()') as t(pid integer);
  insert into tests.b12_workers (connection, pid) values (p_name, v_pid)
  on conflict (connection) do update set pid = excluded.pid;
end;
$$;

create or replace function tests.b12_disconnect(p_name text)
returns void language plpgsql as $$
begin
  if p_name = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect(p_name);
  end if;
exception when others then
  null;
end;
$$;

create or replace function tests.b12_collect(p_name text, out value text, out error text)
returns record language plpgsql as $$
begin
  select r.value into value from dblink_get_result(p_name, false) as r(value text);
  error := dblink_error_message(p_name);
  perform * from dblink_get_result(p_name, false) as r(value text);
end;
$$;

create or replace function tests.b12_collect_pair(
  p_a text, p_b text,
  out a_value text, out a_error text, out b_value text, out b_error text
) returns record language plpgsql as $$
declare
  v_a_done boolean := false;
  v_b_done boolean := false;
begin
  for v_attempt in 1..1000 loop
    if not v_a_done and dblink_is_busy(p_a) = 0 then
      select value, error into a_value, a_error from tests.b12_collect(p_a);
      v_a_done := true;
    end if;
    if not v_b_done and dblink_is_busy(p_b) = 0 then
      select value, error into b_value, b_error from tests.b12_collect(p_b);
      v_b_done := true;
    end if;
    if v_a_done and v_b_done then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'B12: timeout raccogliendo i risultati di % e %', p_a, p_b;
end;
$$;

create or replace function tests.b12_wait_workers(p_connections text[], p_expected integer)
returns void language plpgsql as $$
begin
  for v_attempt in 1..200 loop
    if (
      select count(*) from pg_stat_activity a
      join tests.b12_workers w on w.pid = a.pid
       where w.connection = any(p_connections) and a.wait_event_type = 'Lock'
    ) = p_expected then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'B12: timeout aspettando % worker bloccati (%)', p_expected, p_connections;
end;
$$;

-- Lancia A, aspetta che sia fermo, lancia B, aspetta che aspetti, apre il cancello.
create or replace function tests.b12_race(p_a_sql text, p_b_sql text,
  out a_error text, out b_error text)
returns record language plpgsql as $$
declare v_a text; v_b text;
begin
  perform pg_advisory_lock(202610040012);
  perform tests.b12_connect('b12_a', 'b12_a');
  perform tests.b12_connect('b12_b', 'b12_b');
  perform dblink_send_query('b12_a', p_a_sql);
  perform tests.b12_wait_workers(array['b12_a'], 1);
  perform dblink_send_query('b12_b', p_b_sql);
  perform tests.b12_wait_workers(array['b12_a', 'b12_b'], 2);
  perform pg_advisory_unlock(202610040012);
  select x.a_error, x.b_error into a_error, b_error
    from tests.b12_collect_pair('b12_a', 'b12_b') x;
  perform tests.b12_disconnect('b12_a');
  perform tests.b12_disconnect('b12_b');
end;
$$;

create or replace function tests.b12_run(p_scenario text)
returns void language plpgsql as $$
declare
  v_started timestamptz := clock_timestamp();
  v_err_a text;
  v_err_b text;
  v_req uuid := tests.b12_id('req');
  v_s0 uuid := tests.b12_id('S0');
  v_error text;
begin
  begin
    if p_scenario = 'double_resolve' then
      select a_error, b_error into v_err_a, v_err_b from tests.b12_race(
        format('select tests.b12_resolve(%L, true, null, %L)', v_req, 'b12_a'),
        format('select tests.b12_resolve(%L, false, null, %L)', v_req, 'b12_b'));
      perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
        format('approvazione e rifiuto: ne riesce una (A=%s, B=%s)', v_err_a, v_err_b));
      perform tests.ok(coalesce(v_err_a, '') || coalesce(v_err_b, '') like '%già chiusa%',
        'chi arriva secondo legge «già chiusa»');
      perform tests.eq((select status::text from public.shift_change_requests where id = v_req),
        case when v_err_a = 'OK' then 'approved' else 'rejected' end, 'lo stato è quello del vincitore');
      perform tests.eq((select count(*) from public.messages
                         where request_id = v_req and kind = 'shift_change_response'),
        1::bigint, 'una sola card di risposta');
      perform tests.eq((select count(*) from public.notifications
                         where user_id = tests.id('Emp') and type = 'shift_change_response'
                           and created_at >= v_started),
        1::bigint, 'una sola notifica al richiedente');
    end if;

    if p_scenario = 'withdraw_resolve' then
      select a_error, b_error into v_err_a, v_err_b from tests.b12_race(
        format('select tests.b12_withdraw(%L, %L)', v_req, 'b12_a'),
        format('select tests.b12_resolve(%L, true, null, %L)', v_req, 'b12_b'));
      perform tests.ok(v_err_a = 'OK' and v_err_b <> 'OK',
        format('il ritiro arrivato prima vince sulla decisione (A=%s, B=%s)', v_err_a, v_err_b));
      perform tests.eq((select status::text from public.shift_change_requests where id = v_req),
        'withdrawn', 'la richiesta resta ritirata');
      perform tests.eq((select count(*) from public.messages
                         where request_id = v_req and kind = 'shift_change_response'),
        1::bigint, 'solo la riga di ritiro');
      perform tests.eq((select count(*) from public.notifications
                         where user_id = tests.id('Emp') and type = 'shift_change_response'
                           and created_at >= v_started),
        0::bigint, 'la decisione respinta non notifica');
    end if;

    if p_scenario = 'double_substitution' then
      select a_error, b_error into v_err_a, v_err_b from tests.b12_race(
        format('select tests.b12_resolve(%L, true, %L, %L)', v_req, tests.b12_id('vm_emp2'), 'b12_a'),
        format('select tests.b12_resolve(%L, true, %L, %L)', v_req, tests.b12_id('vm_ow'), 'b12_b'));
      perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
        format('due sostituzioni: ne riesce una (A=%s, B=%s)', v_err_a, v_err_b));
      perform tests.eq((select count(*) from public.shift_assignments where shift_id = v_s0),
        1::bigint, 'sul turno resta un solo sostituto');
      perform tests.eq((select count(*) from public.shift_assignments
                         where shift_id = v_s0 and venue_member_id =
                           case when v_err_a = 'OK' then tests.b12_id('vm_emp2') else tests.b12_id('vm_ow') end),
        1::bigint, 'il sostituto è quello della decisione accettata');
      perform tests.eq((select count(*) from public.messages
                         where request_id = v_req and kind = 'shift_change_response'),
        1::bigint, 'una sola card di risposta');
    end if;

    if p_scenario = 'gone_and_repeat' then
      perform tests.login('Ow');
      perform public.unassign(tests.b12_id('a0'));
      perform public.resolve_shift_change_request(v_req, true, null, null);
      perform tests.raises(format('select public.resolve_shift_change_request(%L, false)', v_req),
        'già chiusa', 'una seconda decisione sulla stessa richiesta è respinta');
      perform tests.logout();
      execute 'reset role';
      perform tests.eq((select status::text from public.shift_change_requests where id = v_req),
        'approved', 'con l''assegnazione già rimossa la richiesta si chiude lo stesso');
      perform tests.eq((select count(*) from public.messages
                         where request_id = v_req and kind = 'shift_change_response'),
        1::bigint, 'la chiamata ripetuta non aggiunge card');
    end if;
  exception when others then
    v_error := sqlerrm;
  end;

  perform pg_advisory_unlock_all();
  perform tests.b12_disconnect('b12_a');
  perform tests.b12_disconnect('b12_b');
  insert into tests.b12_result values (p_scenario, v_error is null, v_error);
end;
$$;

select tests.b12_prepare(400, 'hours');
select tests.b12_run('double_resolve');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.b12_prepare(410, 'hours');
select tests.b12_run('withdraw_resolve');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.b12_prepare(420, 'substitution');
select tests.b12_run('double_substitution');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.b12_prepare(430, 'substitution');
select tests.b12_run('gone_and_repeat');

-- Pulizia: richieste, card, notifiche, assegnazioni e turni dei quattro scenari.
drop trigger if exists b12_barrier on public.shift_change_requests;
delete from public.messages where request_id in (
  select r.id from public.shift_change_requests r join public.shifts s on s.id = r.shift_id
   where s.title = 'B12 richiesta' and s.date >= current_date + 400);
delete from public.notifications where created_at >= (
  select min(r.created_at) from public.shift_change_requests r join public.shifts s on s.id = r.shift_id
   where s.title = 'B12 richiesta' and s.date >= current_date + 400);
delete from public.shift_change_requests where shift_id in (
  select id from public.shifts where title = 'B12 richiesta' and date >= current_date + 400);
delete from public.shift_assignments where shift_id in (
  select id from public.shifts where title = 'B12 richiesta' and date >= current_date + 400);
delete from public.shifts where title = 'B12 richiesta' and date >= current_date + 400;

drop function if exists tests.b12_barrier();
drop function if exists tests.b12_prepare(integer, text);
drop function if exists tests.b12_resolve(uuid, boolean, uuid, text);
drop function if exists tests.b12_withdraw(uuid, text);
drop function if exists tests.b12_connect(text, text);
drop function if exists tests.b12_disconnect(text);
drop function if exists tests.b12_collect_pair(text, text);
drop function if exists tests.b12_collect(text);
drop function if exists tests.b12_wait_workers(text[], integer);
drop function if exists tests.b12_race(text, text);
drop function if exists tests.b12_run(text);
drop function if exists tests.b12_id(text);
drop extension dblink cascade;

do $$
declare
  v_scenario text;
  v_error text;
begin
  select scenario, error into v_scenario, v_error
    from tests.b12_result where not ok order by scenario limit 1;
  if v_error is not null then
    raise exception 'FAIL: B12 concorrenza richieste di cambio (%) — %', v_scenario, v_error;
  end if;
  perform tests.eq((select count(*) from tests.b12_result), 4::bigint,
    'sono stati eseguiti tutti i quattro scenari concorrenti');
end;
$$;
