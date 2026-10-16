-- Timbratura senza turno sotto concorrenza (C24 punto 5).
-- 1. Uscita del professionista e chiusura del gestore sulla stessa entrata, nei due
--    ordini: nasce un solo turno, e chi arriva secondo sa che l'uscita c'è già.
-- 2. Due entrate dello stesso account in sedi diverse: ne resta aperta una sola.
\set ON_ERROR_STOP on
set statement_timeout = '30s';
create extension if not exists dblink with schema tests;
set search_path = tests,public,pg_catalog;
create table tests.unplanned_fixture(workspace_id uuid, vm1 uuid, vm2 uuid);
create table tests.unplanned_result(ok boolean, error text);

-- Un attore per connessione: il professionista (Emp) o chi gestisce le ore (Ow).
create function tests.unplanned_worker(p_action text, p_vm uuid, p_record uuid) returns uuid
language plpgsql as $$
declare result uuid;
begin
  if p_action = 'close' then
    perform tests.login('Ow');
    result := (public.close_unplanned_clock(p_record, now() - interval '1 hour', 'Uscita dimenticata')).id;
  else
    perform tests.login('Emp');
    result := (public.clock_punch_unplanned(p_vm, p_action)).id;
  end if;
  perform tests.logout();
  execute 'reset role';
  return result;
end $$;

create function tests.unplanned_wait(p_app text) returns void language plpgsql as $$
begin
  for attempt in 1..1000 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
      where application_name = p_app and wait_event_type = 'Lock') then return; end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'unplanned clock: % non si è mai messo in attesa del lock', p_app;
end $$;

-- A tiene il lock `p_lock`, B parte e si mette in attesa, A esegue il suo passo e
-- fa commit, poi B finisce. Restituisce l'errore di B ('OK' se nessuno).
create function tests.unplanned_race(
  p_lock text, p_a text, p_b text
) returns text language plpgsql as $$
declare err_a text; err_b text;
begin
  perform dblink_connect_u('unplanned_a', 'dbname=postgres user=postgres application_name=unplanned_a');
  perform dblink_connect_u('unplanned_b', 'dbname=postgres user=postgres application_name=unplanned_b');
  perform dblink_exec('unplanned_a', 'set statement_timeout=''10s''');
  perform dblink_exec('unplanned_b', 'set statement_timeout=''10s''');
  perform dblink_exec('unplanned_a', 'begin');
  perform * from dblink('unplanned_a', p_lock) as t(id uuid);
  perform dblink_send_query('unplanned_b', p_b);
  perform tests.unplanned_wait('unplanned_b');
  perform dblink_send_query('unplanned_a', p_a);
  perform * from dblink_get_result('unplanned_a', false) as t(id uuid);
  err_a := dblink_error_message('unplanned_a');
  perform * from dblink_get_result('unplanned_a', false) as t(id uuid);
  perform dblink_exec('unplanned_a', 'commit');
  perform * from dblink_get_result('unplanned_b', false) as t(id uuid);
  err_b := dblink_error_message('unplanned_b');
  perform * from dblink_get_result('unplanned_b', false) as t(id uuid);
  perform dblink_disconnect('unplanned_a');
  perform dblink_disconnect('unplanned_b');
  if err_a <> 'OK' then raise exception 'il primo passo è fallito: %', err_a; end if;
  return err_b;
end $$;

-- Fixture committata: un'azienda con due sedi, Emp in entrambe, timbratura
-- dall'app e senza turno abilitata.
do $$
declare ws uuid; v1 uuid; v2 uuid; member uuid; vm1 uuid; vm2 uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Concorrenza fuori turno');
  v1 := public.create_venue(ws, 'Fuori turno uno');
  perform tests.logout();
  execute 'reset role';
  perform public.grant_workspace_access(ws, 'complimentary_lifetime', 'team', 2, now(), null, 'Fixture fuori turno');
  perform tests.login('Ow');
  v2 := public.create_venue(ws, 'Fuori turno due');
  member := (public.add_member(ws, '{"full_name":"Emma","email":"emp@t.test"}', 'none', '{}', 'all',
    jsonb_build_array(jsonb_build_object('venue_id', v1), jsonb_build_object('venue_id', v2))) ->> 'member_id')::uuid;
  perform tests.login('Emp');
  perform public.respond_to_invite(member, true);
  perform tests.login('Ow');
  select id into vm1 from public.venue_members where member_id = member and venue_id = v1;
  select id into vm2 from public.venue_members where member_id = member and venue_id = v2;
  perform public.set_member_clock_method(vm1, 'app');
  perform public.set_member_clock_method(vm2, 'app');
  perform public.set_member_clock_unplanned(vm1, true);
  perform public.set_member_clock_unplanned(vm2, true);
  perform tests.logout();
  execute 'reset role';
  insert into tests.unplanned_fixture values (ws, vm1, vm2);
end $$;

-- Un'entrata aperta da due ore, pronta per la gara d'uscita.
create function tests.unplanned_open_entry() returns uuid language plpgsql as $$
declare f tests.unplanned_fixture; rec uuid;
begin
  select * into f from tests.unplanned_fixture;
  perform tests.login('Emp');
  rec := (public.clock_punch_unplanned(f.vm1, 'in')).id;
  perform tests.logout();
  execute 'reset role';
  update public.shift_clock_records
     set clock_in_at = now() - interval '2 hours', created_at = now() - interval '2 hours'
   where id = rec;
  return rec;
end $$;

create function tests.unplanned_shifts_of(p_record uuid) returns bigint language sql as $$
  select count(*) from public.shifts s
   where s.unplanned and s.id = (select shift_id from public.shift_clock_records where id = p_record);
$$;

-- Ogni gara in un blocco suo, con la fixture committata prima: le connessioni
-- dblink non vedono quello che questa sessione non ha ancora committato.
create function tests.unplanned_failed(p_error text) returns void language plpgsql as $$
begin
  if 'unplanned_a' = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect('unplanned_a');
  end if;
  if 'unplanned_b' = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect('unplanned_b');
  end if;
  insert into tests.unplanned_result values (false, p_error);
end $$;
create table tests.unplanned_records(label text primary key, id uuid);

-- 1a. Il gestore chiude per primo, il professionista esce mentre aspetta.
insert into tests.unplanned_records select 'gestore_primo', tests.unplanned_open_entry();
do $$
declare f tests.unplanned_fixture; rec uuid; err text;
begin
  select * into f from tests.unplanned_fixture;
  select id into rec from tests.unplanned_records where label = 'gestore_primo';
  err := tests.unplanned_race(
    format('select id from public.shift_clock_records where id = %L for update', rec),
    format('select tests.unplanned_worker(''close'', null, %L)', rec),
    format('select tests.unplanned_worker(''out'', %L, null)', f.vm1));
  perform tests.ok(err like '%clock_already_closed%',
    format('il professionista sa che l''uscita c''è già (errore: %s)', err));
  perform tests.eq(tests.unplanned_shifts_of(rec), 1::bigint, 'chiusura del gestore: un solo turno');
  insert into tests.unplanned_result values (true, null);
exception when others or query_canceled then
  perform tests.unplanned_failed(sqlerrm);
end $$;

-- 1b. Il professionista esce per primo, il gestore chiude mentre aspetta.
insert into tests.unplanned_records select 'professionista_primo', tests.unplanned_open_entry();
do $$
declare f tests.unplanned_fixture; rec uuid; err text;
begin
  select * into f from tests.unplanned_fixture;
  select id into rec from tests.unplanned_records where label = 'professionista_primo';
  err := tests.unplanned_race(
    format('select id from public.shift_clock_records where id = %L for update', rec),
    format('select tests.unplanned_worker(''out'', %L, null)', f.vm1),
    format('select tests.unplanned_worker(''close'', null, %L)', rec));
  perform tests.ok(err like '%clock_already_closed%',
    format('chi gestisce sa che l''uscita c''è già (errore: %s)', err));
  perform tests.eq(tests.unplanned_shifts_of(rec), 1::bigint, 'uscita del professionista: un solo turno');
  insert into tests.unplanned_result values (true, null);
exception when others or query_canceled then
  perform tests.unplanned_failed(sqlerrm);
end $$;

-- 2. Due entrate dello stesso account in due sedi: il lock sull'account le mette
--    in fila, e la seconda trova la prima aperta.
do $$
declare f tests.unplanned_fixture; err text; n_open bigint;
begin
  select * into f from tests.unplanned_fixture;
  err := tests.unplanned_race(
    format('select id from public.profiles where id = %L for update', tests.id('Emp')),
    format('select tests.unplanned_worker(''in'', %L, null)', f.vm1),
    format('select tests.unplanned_worker(''in'', %L, null)', f.vm2));
  perform tests.ok(err like '%clock_already_open%',
    format('la seconda entrata è rifiutata (errore: %s)', err));
  select count(*) into n_open from public.shift_clock_records c
   where c.venue_member_id in (f.vm1, f.vm2) and c.shift_id is null and c.voided_at is null;
  perform tests.eq(n_open, 1::bigint, 'una sola entrata aperta');
  insert into tests.unplanned_result values (true, null);
exception when others or query_canceled then
  perform tests.unplanned_failed(sqlerrm);
end $$;

-- Pulizia: le timbrature valide proteggono le assegnazioni dalla cancellazione
-- (guard_clocked_assignment_delete), quindi prima si annullano.
update public.shift_clock_records set voided_at = now(), voided_by = tests.id('Ow'), void_reason = 'Pulizia test'
 where venue_id in (select v.id from public.venues v
                     where v.workspace_id in (select workspace_id from tests.unplanned_fixture))
   and voided_at is null;
delete from public.workspaces where id in (select workspace_id from tests.unplanned_fixture);
drop table tests.unplanned_fixture, tests.unplanned_records;
drop function tests.unplanned_worker(text, uuid, uuid), tests.unplanned_wait(text),
  tests.unplanned_race(text, text, text), tests.unplanned_open_entry(), tests.unplanned_shifts_of(uuid),
  tests.unplanned_failed(text);
do $$
declare err text;
begin
  select string_agg(error, ' | ') into err from tests.unplanned_result where not ok;
  if err is not null then raise exception 'unplanned clock concurrency: %', err; end if;
  if (select count(*) from tests.unplanned_result where ok) <> 3 then
    raise exception 'unplanned clock concurrency: non tutte le gare sono arrivate in fondo';
  end if;
end $$;
drop table tests.unplanned_result;
reset statement_timeout;
select 'unplanned clock concurrency: ok' as result;
