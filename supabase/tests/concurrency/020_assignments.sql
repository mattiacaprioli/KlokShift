-- B11: due spostamenti concorrenti della stessa assegnazione. Come in
-- 010_absences.sql, dblink apre due vere sessioni e un trigger test-only le
-- ferma prima della DELETE dell'assegnazione di partenza: il primo worker ci
-- arriva e aspetta il cancello, il secondo deve aspettare il primo. Senza
-- serializzazione il secondo, sbloccato, cancellava zero righe e creava
-- comunque la sua destinazione.
\set ON_ERROR_STOP on

drop extension if exists dblink cascade;
create extension dblink with schema tests;
set search_path = tests, public, pg_catalog;

drop table if exists tests.b11_ids;
create table tests.b11_ids (name text primary key, id uuid not null);
grant select on tests.b11_ids to authenticated;
drop table if exists tests.b11_workers;
create table tests.b11_workers (connection text primary key, pid integer not null);
drop table if exists tests.b11_result;
create table tests.b11_result (scenario text not null, ok boolean not null, error text);

create or replace function tests.b11_id(p_name text) returns uuid
language sql stable as $$ select id from tests.b11_ids where name = p_name $$;

create or replace function tests.b11_barrier()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_lock(202610040011);
  perform pg_advisory_unlock(202610040011);
  return old;
end;
$$;

drop trigger if exists b11_barrier on public.shift_assignments;
create trigger b11_barrier
  before delete on public.shift_assignments
  for each row execute function tests.b11_barrier();

-- Fixture di uno scenario: S0 (giorno p_day) con Emp, S1 (giorno dopo) con il
-- titolare. Committata prima dello scenario, così le due sessioni la vedono.
create or replace function tests.b11_prepare(p_day integer)
returns void language plpgsql as $$
declare
  v_vm_emp uuid;
  v_vm_ow uuid;
  v_ids uuid[];
begin
  perform tests.login('Ow');
  select id into v_vm_emp from public.venue_members
   where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');
  select id into v_vm_ow from public.venue_members
   where member_id = tests.id('M_Ow') and venue_id = tests.id('V1');
  if not exists (select 1 from public.venue_members
                  where member_id = tests.id('M_Emp2') and venue_id = tests.id('V1')) then
    perform public.set_member_venue(tests.id('M_Emp2'), tests.id('V1'));
  end if;
  v_ids := public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'B11 partenza',
      'date', (current_date + p_day)::text, 'start_time', '09:00', 'end_time', '13:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_vm_emp))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'B11 arrivo',
      'date', (current_date + p_day + 1)::text, 'start_time', '09:00', 'end_time', '13:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', v_vm_ow)))));
  perform tests.logout();
  execute 'reset role';
  delete from tests.b11_ids;
  insert into tests.b11_ids values
    ('S0', v_ids[1]), ('S1', v_ids[2]), ('vm_emp', v_vm_emp), ('vm_ow', v_vm_ow),
    ('vm_emp2', (select id from public.venue_members
                  where member_id = tests.id('M_Emp2') and venue_id = tests.id('V1'))),
    ('a0', (select id from public.shift_assignments where shift_id = v_ids[1]));
end;
$$;

create or replace function tests.b11_move(p_assignment uuid, p_to_shift uuid, p_to_date date, p_app text)
returns text language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('application_name', p_app, false);
  perform tests.login('Ow');
  v_id := public.move_assignment(p_assignment, p_to_shift, p_to_date);
  perform tests.logout();
  execute 'reset role';
  return v_id::text;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.b11_reassign(p_assignment uuid, p_to uuid, p_app text)
returns text language plpgsql as $$
declare v_id uuid;
begin
  perform set_config('application_name', p_app, false);
  perform tests.login('Ow');
  v_id := public.reassign(p_assignment, p_to);
  perform tests.logout();
  execute 'reset role';
  return v_id::text;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.b11_connect(p_name text, p_app text)
returns void language plpgsql as $$
declare v_pid integer;
begin
  perform dblink_connect_u(p_name, 'dbname=postgres user=postgres');
  perform dblink_exec(p_name, format('set application_name = %L', p_app));
  select pid into v_pid from dblink(p_name, 'select pg_backend_pid()') as t(pid integer);
  insert into tests.b11_workers (connection, pid) values (p_name, v_pid)
  on conflict (connection) do update set pid = excluded.pid;
end;
$$;

create or replace function tests.b11_disconnect(p_name text)
returns void language plpgsql as $$
begin
  if p_name = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect(p_name);
  end if;
exception when others then
  null;
end;
$$;

create or replace function tests.b11_collect(p_name text, out value text, out error text)
returns record language plpgsql as $$
begin
  select r.value into value from dblink_get_result(p_name, false) as r(value text);
  error := dblink_error_message(p_name);
  perform * from dblink_get_result(p_name, false) as r(value text);
end;
$$;

create or replace function tests.b11_collect_pair(
  p_a text, p_b text,
  out a_value text, out a_error text, out b_value text, out b_error text
) returns record language plpgsql as $$
declare
  v_a_done boolean := false;
  v_b_done boolean := false;
begin
  for v_attempt in 1..1000 loop
    if not v_a_done and dblink_is_busy(p_a) = 0 then
      select value, error into a_value, a_error from tests.b11_collect(p_a);
      v_a_done := true;
    end if;
    if not v_b_done and dblink_is_busy(p_b) = 0 then
      select value, error into b_value, b_error from tests.b11_collect(p_b);
      v_b_done := true;
    end if;
    if v_a_done and v_b_done then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'B11: timeout raccogliendo i risultati di % e %', p_a, p_b;
end;
$$;

create or replace function tests.b11_wait_workers(p_connections text[], p_expected integer)
returns void language plpgsql as $$
begin
  for v_attempt in 1..200 loop
    if (
      select count(*) from pg_stat_activity a
      join tests.b11_workers w on w.pid = a.pid
       where w.connection = any(p_connections) and a.wait_event_type = 'Lock'
    ) = p_expected then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'B11: timeout aspettando % worker bloccati (%)', p_expected, p_connections;
end;
$$;

-- Lancia A, aspetta che sia fermo, lancia B, aspetta che aspetti, apre il cancello.
create or replace function tests.b11_race(p_a_sql text, p_b_sql text,
  out a_error text, out b_error text)
returns record language plpgsql as $$
declare v_a text; v_b text;
begin
  perform pg_advisory_lock(202610040011);
  perform tests.b11_connect('b11_a', 'b11_a');
  perform tests.b11_connect('b11_b', 'b11_b');
  perform dblink_send_query('b11_a', p_a_sql);
  perform tests.b11_wait_workers(array['b11_a'], 1);
  perform dblink_send_query('b11_b', p_b_sql);
  perform tests.b11_wait_workers(array['b11_a', 'b11_b'], 2);
  perform pg_advisory_unlock(202610040011);
  select x.a_error, x.b_error into a_error, b_error
    from tests.b11_collect_pair('b11_a', 'b11_b') x;
  perform tests.b11_disconnect('b11_a');
  perform tests.b11_disconnect('b11_b');
end;
$$;

create or replace function tests.b11_run(p_scenario text, p_day integer)
returns void language plpgsql as $$
declare
  v_started timestamptz := clock_timestamp();
  v_err_a text;
  v_err_b text;
  v_a0 uuid := tests.b11_id('a0');
  v_s0 uuid := tests.b11_id('S0');
  v_s1 uuid := tests.b11_id('S1');
  v_twin_day date := current_date + p_day + 2;
  v_error text;
begin
  begin
    if p_scenario = 'move_move' then
      select a_error, b_error into v_err_a, v_err_b from tests.b11_race(
        format('select tests.b11_move(%L, %L, null, %L)', v_a0, v_s1, 'b11_a'),
        format('select tests.b11_move(%L, null, %L, %L)', v_a0, v_twin_day, 'b11_b'));
      perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
        format('fra due spostamenti della stessa persona ne riesce uno (A=%s, B=%s)', v_err_a, v_err_b));
      perform tests.eq((
        select count(*) from public.shift_assignments a join public.shifts s on s.id = a.shift_id
         where a.venue_member_id = tests.b11_id('vm_emp')
           and s.date between current_date + p_day and v_twin_day
      ), 1::bigint, 'la persona resta su un turno solo');
      perform tests.eq((
        select count(*) from public.shifts
         where venue_id = tests.id('V1') and date = v_twin_day and title = 'B11 partenza'
      ), case when v_err_b = 'OK' then 1::bigint else 0::bigint end,
        'il gemello esiste solo se ha vinto lo spostamento che lo crea');
      perform tests.eq((
        select count(*) from public.notifications
         where user_id = tests.id('Emp') and type = 'shift_assigned' and created_at >= v_started
      ), 1::bigint, 'una sola notifica di nuovo turno');
    end if;

    if p_scenario = 'reassign_reassign' then
      select a_error, b_error into v_err_a, v_err_b from tests.b11_race(
        format('select tests.b11_reassign(%L, %L, %L)', v_a0, tests.b11_id('vm_ow'), 'b11_a'),
        format('select tests.b11_reassign(%L, %L, %L)', v_a0, tests.b11_id('vm_emp2'), 'b11_b'));
      perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
        format('fra due passaggi di mano dello stesso turno ne riesce uno (A=%s, B=%s)', v_err_a, v_err_b));
      perform tests.eq((select count(*) from public.shift_assignments where shift_id = v_s0),
        1::bigint, 'sul turno resta una sola persona');
      -- `private.notify` non avvisa chi fa l'azione: il titolare che si prende il
      -- turno non riceve nulla, Emp2 solo se ha vinto il suo passaggio di mano.
      perform tests.eq((
        select count(*) from public.notifications
         where user_id = tests.id('Emp2') and type = 'shift_assigned' and created_at >= v_started
      ), case when v_err_b = 'OK' then 1::bigint else 0::bigint end,
        'notifica di nuovo turno solo se ha vinto il passaggio a Emp2');
    end if;

    if p_scenario = 'move_reassign' then
      select a_error, b_error into v_err_a, v_err_b from tests.b11_race(
        format('select tests.b11_move(%L, %L, null, %L)', v_a0, v_s1, 'b11_a'),
        format('select tests.b11_reassign(%L, %L, %L)', v_a0, tests.b11_id('vm_emp2'), 'b11_b'));
      perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
        format('fra spostamento e passaggio di mano ne riesce uno (A=%s, B=%s)', v_err_a, v_err_b));
      perform tests.eq((
        (select count(*) from public.shift_assignments where shift_id = v_s0)
        + (select count(*) from public.shift_assignments
            where shift_id = v_s1 and venue_member_id <> tests.b11_id('vm_ow'))
      ), 1::bigint, 'dall''origine nasce una sola assegnazione');
    end if;

    if p_scenario = 'removed' then
      perform tests.login('Ow');
      perform public.unassign(v_a0);
      perform tests.raises(format('select public.move_assignment(%L, null, %L)', v_a0, v_twin_day),
        'not_allowed', 'spostare un''assegnazione già rimossa fallisce');
      perform tests.raises(format('select public.reassign(%L, %L)', v_a0, tests.b11_id('vm_emp2')),
        'not_allowed', 'passare di mano un''assegnazione già rimossa fallisce');
      perform tests.logout();
      execute 'reset role';
      perform tests.eq((
        select count(*) from public.shifts
         where venue_id = tests.id('V1') and date = v_twin_day and title = 'B11 partenza'
      ), 0::bigint, 'nessun gemello per un''origine scomparsa');
    end if;
  exception when others then
    v_error := sqlerrm;
  end;

  perform pg_advisory_unlock_all();
  perform tests.b11_disconnect('b11_a');
  perform tests.b11_disconnect('b11_b');
  insert into tests.b11_result values (p_scenario, v_error is null, v_error);
end;
$$;

select tests.b11_prepare(300);
select tests.b11_run('move_move', 300);
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.b11_prepare(310);
select tests.b11_run('reassign_reassign', 310);
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.b11_prepare(320);
select tests.b11_run('move_reassign', 320);
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.b11_prepare(330);
select tests.b11_run('removed', 330);

-- Pulizia: turni e notifiche dei quattro scenari, poi gli strumenti di test.
drop trigger if exists b11_barrier on public.shift_assignments;
delete from public.notifications
 where related_id in (select id from public.shifts
                       where title like 'B11 %' and date >= current_date + 300);
delete from public.shift_assignments
 where shift_id in (select id from public.shifts
                     where title like 'B11 %' and date >= current_date + 300);
delete from public.shifts where title like 'B11 %' and date >= current_date + 300;

drop function if exists tests.b11_barrier();
drop function if exists tests.b11_prepare(integer);
drop function if exists tests.b11_move(uuid, uuid, date, text);
drop function if exists tests.b11_reassign(uuid, uuid, text);
drop function if exists tests.b11_connect(text, text);
drop function if exists tests.b11_disconnect(text);
drop function if exists tests.b11_collect_pair(text, text);
drop function if exists tests.b11_collect(text);
drop function if exists tests.b11_wait_workers(text[], integer);
drop function if exists tests.b11_race(text, text);
drop function if exists tests.b11_run(text, integer);
drop function if exists tests.b11_id(text);
drop extension dblink cascade;

do $$
declare
  v_scenario text;
  v_error text;
begin
  select scenario, error into v_scenario, v_error
    from tests.b11_result where not ok order by scenario limit 1;
  if v_error is not null then
    raise exception 'FAIL: B11 concorrenza spostamenti (%) — %', v_scenario, v_error;
  end if;
  perform tests.eq((select count(*) from tests.b11_result), 4::bigint,
    'sono stati eseguiti tutti i quattro scenari concorrenti');
end;
$$;
