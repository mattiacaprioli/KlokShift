-- Pubblicazione delle bozze sotto concorrenza. Come in 020_assignments.sql,
-- dblink apre due vere sessioni e un trigger test-only ferma la prima a metà
-- (prima dell'UPDATE del turno o dell'INSERT dell'assegnazione); la seconda
-- deve mettersi in attesa di un lock, poi il cancello si apre.
--   publish_publish      due «Pubblica» sugli stessi turni: un solo avviso;
--   publish_then_assign  si aggiunge una persona mentre la bozza si pubblica:
--                        la persona è avvisata una volta (dal trigger);
--   assign_then_publish  si pubblica mentre una persona viene aggiunta: avvisata
--                        una volta (dalla pubblicazione).
-- Le due strade si serializzano sul lock dell'azienda
-- (`assert_workspace_operational`), preso da entrambe prima di quello sul turno.
\set ON_ERROR_STOP on

drop extension if exists dblink cascade;
create extension dblink with schema tests;
set search_path = tests, public, pg_catalog;

drop table if exists tests.p100_ids;
create table tests.p100_ids (name text primary key, id uuid not null);
drop table if exists tests.p100_workers;
create table tests.p100_workers (connection text primary key, pid integer not null);
drop table if exists tests.p100_result;
create table tests.p100_result (scenario text not null, ok boolean not null, error text);

create or replace function tests.p100_id(p_name text) returns uuid
language sql stable as $$ select id from tests.p100_ids where name = p_name $$;

create or replace function tests.p100_barrier()
returns trigger language plpgsql as $$
begin
  perform pg_advisory_lock(202611030100);
  perform pg_advisory_unlock(202611030100);
  return new;
end;
$$;

drop trigger if exists p100_barrier_shift on public.shifts;
create trigger p100_barrier_shift
  before update on public.shifts
  for each row execute function tests.p100_barrier();
drop trigger if exists p100_barrier_assignment on public.shift_assignments;
create trigger p100_barrier_assignment
  before insert on public.shift_assignments
  for each row execute function tests.p100_barrier();

-- Una bozza futura in V1, con Emma o vuota. Committata prima dello scenario.
create or replace function tests.p100_prepare(p_day integer, p_with_staff boolean)
returns void language plpgsql as $$
declare
  v_vm uuid;
  v_ids uuid[];
begin
  select id into v_vm from public.venue_members
   where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');
  perform tests.login('Ow');
  v_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'P100 bozza', 'draft', true,
    'date', (current_date + p_day)::text, 'start_time', '09:00', 'end_time', '13:00',
    'staff', case when p_with_staff
                  then jsonb_build_array(jsonb_build_object('venue_member_id', v_vm))
                  else '[]'::jsonb end)));
  perform tests.logout();
  execute 'reset role';
  delete from tests.p100_ids;
  insert into tests.p100_ids values ('S', v_ids[1]), ('vm_emp', v_vm);
end;
$$;

create or replace function tests.p100_publish(p_shift uuid) returns text
language plpgsql as $$
declare r jsonb;
begin
  perform tests.login('Ow');
  r := public.publish_shifts(array[p_shift], true);
  perform tests.logout();
  execute 'reset role';
  return r::text;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.p100_assign(p_shift uuid, p_vm uuid) returns text
language plpgsql as $$
declare v_id uuid;
begin
  perform tests.login('Ow');
  v_id := public.assign(p_shift, p_vm, null);
  perform tests.logout();
  execute 'reset role';
  return v_id::text;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.p100_connect(p_name text)
returns void language plpgsql as $$
declare v_pid integer;
begin
  perform dblink_connect_u(p_name, 'dbname=postgres user=postgres');
  perform dblink_exec(p_name, format('set application_name = %L', p_name));
  perform dblink_exec(p_name, 'set statement_timeout = ''20s''');
  select pid into v_pid from dblink(p_name, 'select pg_backend_pid()') as t(pid integer);
  insert into tests.p100_workers (connection, pid) values (p_name, v_pid)
  on conflict (connection) do update set pid = excluded.pid;
end;
$$;

create or replace function tests.p100_disconnect(p_name text)
returns void language plpgsql as $$
begin
  if p_name = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect(p_name);
  end if;
exception when others then
  null;
end;
$$;

create or replace function tests.p100_collect(p_name text, out value text, out error text)
returns record language plpgsql as $$
begin
  select r.value into value from dblink_get_result(p_name, false) as r(value text);
  error := dblink_error_message(p_name);
  perform * from dblink_get_result(p_name, false) as r(value text);
end;
$$;

create or replace function tests.p100_wait_workers(p_connections text[], p_expected integer)
returns void language plpgsql as $$
begin
  for v_attempt in 1..500 loop
    perform pg_stat_clear_snapshot();
    if (
      select count(*) from pg_stat_activity a
      join tests.p100_workers w on w.pid = a.pid
       where w.connection = any(p_connections) and a.wait_event_type = 'Lock'
    ) = p_expected then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'P100: timeout aspettando % worker bloccati (%)', p_expected, p_connections;
end;
$$;

-- Lancia A, aspetta che sia fermo al cancello, lancia B, aspetta che aspetti,
-- apre il cancello e raccoglie A poi B.
create or replace function tests.p100_race(p_a_sql text, p_b_sql text,
  out a_value text, out a_error text, out b_value text, out b_error text)
returns record language plpgsql as $$
begin
  perform pg_advisory_lock(202611030100);
  perform tests.p100_connect('p100_a');
  perform tests.p100_connect('p100_b');
  perform dblink_send_query('p100_a', p_a_sql);
  perform tests.p100_wait_workers(array['p100_a'], 1);
  perform dblink_send_query('p100_b', p_b_sql);
  perform tests.p100_wait_workers(array['p100_a', 'p100_b'], 2);
  perform pg_advisory_unlock(202611030100);
  select value, error into a_value, a_error from tests.p100_collect('p100_a');
  select value, error into b_value, b_error from tests.p100_collect('p100_b');
  perform tests.p100_disconnect('p100_a');
  perform tests.p100_disconnect('p100_b');
end;
$$;

create or replace function tests.p100_run(p_scenario text)
returns void language plpgsql as $$
declare
  v_s uuid := tests.p100_id('S');
  v_vm uuid := tests.p100_id('vm_emp');
  x record;
  v_error text;
begin
  begin
    if p_scenario = 'publish_publish' then
      select * into x from tests.p100_race(
        format('select tests.p100_publish(%L)', v_s),
        format('select tests.p100_publish(%L)', v_s));
      perform tests.ok(x.a_error = 'OK' and x.b_error = 'OK',
        format('le due pubblicazioni riescono (A=%s, B=%s)', x.a_error, x.b_error));
      perform tests.eq((x.a_value::jsonb ->> 'published')::integer
                       + (x.b_value::jsonb ->> 'published')::integer, 1,
        'il turno è pubblicato una volta sola');
      perform tests.eq((x.a_value::jsonb ->> 'notified')::integer
                       + (x.b_value::jsonb ->> 'notified')::integer, 1,
        'una persona avvisata in tutto');
    end if;

    if p_scenario = 'publish_then_assign' then
      select * into x from tests.p100_race(
        format('select tests.p100_publish(%L)', v_s),
        format('select tests.p100_assign(%L, %L)', v_s, v_vm));
      perform tests.ok(x.a_error = 'OK' and x.b_error = 'OK',
        format('pubblicazione e assegnazione riescono (A=%s, B=%s)', x.a_error, x.b_error));
    end if;

    if p_scenario = 'assign_then_publish' then
      select * into x from tests.p100_race(
        format('select tests.p100_assign(%L, %L)', v_s, v_vm),
        format('select tests.p100_publish(%L)', v_s));
      perform tests.ok(x.a_error = 'OK' and x.b_error = 'OK',
        format('assegnazione e pubblicazione riescono (A=%s, B=%s)', x.a_error, x.b_error));
      perform tests.eq((x.b_value::jsonb ->> 'notified')::integer, 1,
        'la pubblicazione trova la persona appena aggiunta');
    end if;

    perform tests.ok((select published_at is not null from public.shifts where id = v_s),
      'il turno è pubblicato');
    perform tests.eq((
      select count(*) from public.notifications
       where user_id = tests.id('Emp') and related_id = v_s
         and type in ('shift_assigned', 'shift_published')
    ), 1::bigint, 'Emma è avvisata esattamente una volta');
  exception when others then
    v_error := sqlerrm;
  end;

  perform pg_advisory_unlock_all();
  perform tests.p100_disconnect('p100_a');
  perform tests.p100_disconnect('p100_b');
  insert into tests.p100_result values (p_scenario, v_error is null, v_error);
end;
$$;

select tests.p100_prepare(400, true);
select tests.p100_run('publish_publish');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.p100_prepare(410, false);
select tests.p100_run('publish_then_assign');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.p100_prepare(420, false);
select tests.p100_run('assign_then_publish');

-- Pulizia: turni e notifiche dei tre scenari, poi gli strumenti di test.
drop trigger if exists p100_barrier_shift on public.shifts;
drop trigger if exists p100_barrier_assignment on public.shift_assignments;
delete from public.notifications
 where related_id in (select id from public.shifts
                       where title = 'P100 bozza' and date >= current_date + 400);
delete from public.shift_assignments
 where shift_id in (select id from public.shifts
                     where title = 'P100 bozza' and date >= current_date + 400);
delete from public.shifts where title = 'P100 bozza' and date >= current_date + 400;

drop function if exists tests.p100_barrier() cascade;
drop function if exists tests.p100_prepare(integer, boolean);
drop function if exists tests.p100_publish(uuid);
drop function if exists tests.p100_assign(uuid, uuid);
drop function if exists tests.p100_connect(text);
drop function if exists tests.p100_disconnect(text);
drop function if exists tests.p100_collect(text);
drop function if exists tests.p100_wait_workers(text[], integer);
drop function if exists tests.p100_race(text, text);
drop function if exists tests.p100_run(text);
drop function if exists tests.p100_id(text);
drop extension dblink cascade;

do $$
declare
  v_scenario text;
  v_error text;
begin
  select scenario, error into v_scenario, v_error
    from tests.p100_result where not ok order by scenario limit 1;
  if v_error is not null then
    raise exception 'FAIL: P100 concorrenza pubblicazione (%) — %', v_scenario, v_error;
  end if;
  perform tests.eq((select count(*) from tests.p100_result), 3::bigint,
    'sono stati eseguiti tutti i tre scenari concorrenti');
end;
$$;
drop table tests.p100_ids;
drop table tests.p100_workers;
drop table tests.p100_result;
select 'publish shifts concurrency: ok' as result;
