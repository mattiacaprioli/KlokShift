-- A19: le normali suite RLS usano una connessione sola e non possono
-- riprodurre due check simultanei. dblink apre due vere sessioni; un trigger
-- test-only le ferma dopo la lettura e prima della scrittura. Il test gira solo
-- nel container sacrificabile e rimuove sempre trigger, helper e fixture.
\set ON_ERROR_STOP on

drop extension if exists dblink cascade;
create extension dblink with schema tests;
set search_path = tests, public, pg_catalog;

drop table if exists tests.a19_workers;
create table tests.a19_workers (connection text primary key, pid integer not null);

create or replace function tests.a19_absence_barrier()
returns trigger language plpgsql as $$
begin
  -- Lock di sessione usato soltanto come cancello: una volta aperto dal test,
  -- ogni worker lo prende e lo rilascia subito. Tenerlo fino al commit
  -- introdurrebbe una dipendenza artificiale dal consumo del risultato dblink.
  perform pg_advisory_lock(202609230019);
  perform pg_advisory_unlock(202609230019);
  return new;
end;
$$;

drop trigger if exists a19_absence_barrier on public.staff_absences;
create trigger a19_absence_barrier
  before insert or update on public.staff_absences
  for each row execute function tests.a19_absence_barrier();

create or replace function tests.a19_request(p_start date, p_end date, p_app text default null)
returns text language plpgsql as $$
declare v_id uuid;
begin
  if p_app is not null then perform set_config('application_name', p_app, false); end if;
  perform tests.login('Emp');
  v_id := public.request_absence(tests.id('W1'), 'ferie', p_start, p_end, null, null, 'A19');
  perform tests.logout();
  execute 'reset role';
  return v_id::text;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.a19_record(p_start date, p_end date, p_app text default null)
returns text language plpgsql as $$
declare v_id uuid;
begin
  if p_app is not null then perform set_config('application_name', p_app, false); end if;
  perform tests.login('Ow');
  v_id := public.record_absence(tests.id('M_Emp'), 'ferie', p_start, p_end, null, null, 'A19');
  perform tests.logout();
  execute 'reset role';
  return v_id::text;
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.a19_resolve(
  p_absence uuid, p_approve boolean, p_note text, p_app text default null
)
returns text language plpgsql as $$
begin
  if p_app is not null then perform set_config('application_name', p_app, false); end if;
  perform tests.login('Ow');
  perform public.resolve_absence(p_absence, p_approve, p_note);
  perform tests.logout();
  execute 'reset role';
  return 'ok';
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.a19_withdraw(p_absence uuid, p_app text default null)
returns text language plpgsql as $$
begin
  if p_app is not null then perform set_config('application_name', p_app, false); end if;
  perform tests.login('Emp');
  perform public.withdraw_absence(p_absence);
  perform tests.logout();
  execute 'reset role';
  return 'ok';
exception when others then
  perform tests.logout();
  execute 'reset role';
  raise;
end;
$$;

create or replace function tests.a19_connect(p_name text, p_app text)
returns void language plpgsql as $$
declare v_pid integer;
begin
  perform dblink_connect_u(
    p_name,
    'dbname=postgres user=postgres'
  );
  perform dblink_exec(p_name, format('set application_name = %L', p_app));
  select pid into v_pid from dblink(p_name, 'select pg_backend_pid()') as t(pid integer);
  insert into tests.a19_workers (connection, pid) values (p_name, v_pid)
  on conflict (connection) do update set pid = excluded.pid;
end;
$$;

create or replace function tests.a19_disconnect(p_name text)
returns void language plpgsql as $$
begin
  if p_name = any(coalesce(dblink_get_connections(), '{}'::text[])) then
    perform dblink_disconnect(p_name);
  end if;
exception when others then
  null;
end;
$$;

-- libpq richiede una lettura aggiuntiva vuota dopo il risultato asincrono;
-- senza, la connessione resta busy e non può essere riutilizzata/disconnessa.
create or replace function tests.a19_collect(
  p_name text, out value text, out error text
) returns record language plpgsql as $$
begin
  select r.value into value
    from dblink_get_result(p_name, false) as r(value text);
  error := dblink_error_message(p_name);
  perform * from dblink_get_result(p_name, false) as r(value text);
end;
$$;

-- Dopo lo sblocco non sappiamo quale worker possieda per primo il lock
-- transazionale. Si raccoglie quello che termina per primo: leggere subito
-- l'altro restituirebbe un risultato ancora busy e impedirebbe il commit che
-- deve liberare il secondo.
create or replace function tests.a19_collect_pair(
  p_a text, p_b text,
  out a_value text, out a_error text, out b_value text, out b_error text
) returns record language plpgsql as $$
declare
  v_a_done boolean := false;
  v_b_done boolean := false;
  v_attempt integer;
begin
  for v_attempt in 1..1000 loop
    if not v_a_done and dblink_is_busy(p_a) = 0 then
      select value, error into a_value, a_error from tests.a19_collect(p_a);
      v_a_done := true;
    end if;
    if not v_b_done and dblink_is_busy(p_b) = 0 then
      select value, error into b_value, b_error from tests.a19_collect(p_b);
      v_b_done := true;
    end if;
    if v_a_done and v_b_done then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'A19: timeout raccogliendo i risultati di % e %', p_a, p_b;
end;
$$;

create or replace function tests.a19_wait_workers(p_connections text[], p_expected integer)
returns void language plpgsql as $$
declare
  v_attempt integer;
  v_details text;
begin
  for v_attempt in 1..200 loop
    if (
      select count(*) from pg_stat_activity a
      join tests.a19_workers w on w.pid = a.pid
       where w.connection = any(p_connections)
         and a.wait_event_type = 'Lock'
    ) = p_expected then
      return;
    end if;
    perform pg_sleep(0.01);
  end loop;
  select string_agg(
    format('%s state=%s wait=%s/%s query=%s', application_name, state,
           coalesce(wait_event_type, '-'), coalesce(wait_event, '-'), left(query, 100)),
    E'\n' order by application_name
  ) into v_details
    from pg_stat_activity a join tests.a19_workers w on w.pid = a.pid
   where w.connection = any(p_connections);
  v_details := coalesce(v_details, 'nessuna sessione') || format(
    E'\nconnessioni=%s', coalesce(array_to_string(dblink_get_connections(), ','), 'nessuna'));
  raise exception 'A19: timeout aspettando % worker bloccati (%) — %',
    p_expected, p_connections, v_details;
end;
$$;

drop table if exists tests.a19_result;
create table tests.a19_result (scenario text not null, ok boolean not null, error text);

create or replace function tests.a19_run(p_scenario text)
returns void language plpgsql as $$
declare
  v_started timestamptz := clock_timestamp();
  v_a text;
  v_b text;
  v_err_a text;
  v_err_b text;
  v_absence uuid;
  v_base_messages bigint;
  v_base_notifications bigint;
  v_error text;
  v_member uuid := tests.id('M_Emp');
  v_emp uuid := tests.id('Emp');
begin
  begin
    if p_scenario = 'overlap' then
    -- Stesso membro, periodi sovrapposti: una sola creazione può riuscire.
    perform pg_advisory_lock(202609230019);
    perform tests.a19_connect('a19_a', 'a19_overlap_request');
    perform tests.a19_connect('a19_b', 'a19_overlap_record');
    perform dblink_send_query('a19_a', format(
      'select tests.a19_request(%L::date, %L::date, %L)', current_date + 200, current_date + 202, 'a19_overlap_request'));
    perform dblink_send_query('a19_b', format(
      'select tests.a19_record(%L::date, %L::date, %L)', current_date + 201, current_date + 203, 'a19_overlap_record'));
    perform tests.a19_wait_workers(array['a19_a','a19_b'], 2);
    perform pg_advisory_unlock(202609230019);
    select a_value, a_error, b_value, b_error into v_a, v_err_a, v_b, v_err_b
      from tests.a19_collect_pair('a19_a', 'a19_b');
    perform tests.a19_disconnect('a19_a');
    perform tests.a19_disconnect('a19_b');
    perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
      'fra due creazioni sovrapposte ne riesce esattamente una');
    perform tests.eq((
      select count(*) from public.staff_absences
       where member_id = v_member and start_date between current_date + 200 and current_date + 203
    ), 1::bigint, 'una sola assenza sovrapposta viene persistita');
    perform tests.eq((
      select count(*) from public.messages
       where kind = 'absence_request' and absence_id in (
         select id from public.staff_absences
          where member_id = v_member and start_date between current_date + 200 and current_date + 203
       )
    ), (select count(*) from public.staff_absences
         where member_id = v_member and requested_by = v_emp
           and start_date between current_date + 200 and current_date + 203),
      'la card esiste solo se ha vinto la richiesta del professionista');
    end if;

    if p_scenario = 'disjoint' then
    -- Periodi disgiunti sullo stesso membro: la serializzazione non li vieta.
    perform pg_advisory_lock(202609230019);
    perform tests.a19_connect('a19_c', 'a19_disjoint_request');
    perform tests.a19_connect('a19_d', 'a19_disjoint_record');
    perform dblink_send_query('a19_c', format(
      'select tests.a19_request(%L::date, %L::date, %L)', current_date + 210, current_date + 210, 'a19_disjoint_request'));
    perform dblink_send_query('a19_d', format(
      'select tests.a19_record(%L::date, %L::date, %L)', current_date + 212, current_date + 212, 'a19_disjoint_record'));
    perform tests.a19_wait_workers(array['a19_c','a19_d'], 2);
    perform pg_advisory_unlock(202609230019);
    select a_value, a_error, b_value, b_error into v_a, v_err_a, v_b, v_err_b
      from tests.a19_collect_pair('a19_c', 'a19_d');
    perform tests.a19_disconnect('a19_c');
    perform tests.a19_disconnect('a19_d');
    perform tests.ok(v_err_a = 'OK' and v_err_b = 'OK',
      'due creazioni concorrenti disgiunte riescono entrambe');
    perform tests.eq((
      select count(*) from public.staff_absences
       where member_id = v_member and start_date in (current_date + 210, current_date + 212)
    ), 2::bigint, 'entrambi i periodi disgiunti sono persistiti');
    end if;

    if p_scenario = 'double_resolve' then
    -- Doppia risoluzione: una sola decisione e un solo set di effetti.
    select id into v_absence from public.staff_absences
     where member_id = v_member and start_date = current_date + 220;
    select count(*) into v_base_messages from public.messages
     where absence_id = v_absence and kind = 'absence_response';
    select count(*) into v_base_notifications from public.notifications
     where user_id = v_emp and type = 'absence_response';
    perform pg_advisory_lock(202609230019);
    perform tests.a19_connect('a19_e', 'a19_resolve_yes');
    perform tests.a19_connect('a19_f', 'a19_resolve_no');
    perform dblink_send_query('a19_e', format(
      'select tests.a19_resolve(%L::uuid, true, %L, %L)', v_absence, 'approvata A19', 'a19_resolve_yes'));
    perform dblink_send_query('a19_f', format(
      'select tests.a19_resolve(%L::uuid, false, %L, %L)', v_absence, 'rifiutata A19', 'a19_resolve_no'));
    perform tests.a19_wait_workers(array['a19_e','a19_f'], 2);
    perform pg_advisory_unlock(202609230019);
    select a_value, a_error, b_value, b_error into v_a, v_err_a, v_b, v_err_b
      from tests.a19_collect_pair('a19_e', 'a19_f');
    perform tests.a19_disconnect('a19_e');
    perform tests.a19_disconnect('a19_f');
    perform tests.ok((v_err_a = 'OK') <> (v_err_b = 'OK'),
      'una richiesta pending riceve una sola decisione');
    perform tests.eq((select count(*) from public.messages
                       where absence_id = v_absence and kind = 'absence_response'),
      v_base_messages + 1, 'la doppia decisione crea una sola card di risposta');
    perform tests.eq((select count(*) from public.notifications
                       where user_id = v_emp and type = 'absence_response'),
      v_base_notifications + 1, 'la doppia decisione crea una sola notifica');
    perform tests.ok(exists (
      select 1 from public.messages m join public.staff_absences a on a.id = m.absence_id
       where a.id = v_absence and m.kind = 'absence_response'
         and ((a.status = 'approved' and m.content like '%approvat%')
           or (a.status = 'rejected' and m.content like '%rifiutat%'))
    ), 'card e stato raccontano la stessa decisione');
    end if;

    if p_scenario = 'withdraw_first' then
    -- Ritiro prima della decisione: il resolver legge withdrawn e non produce effetti.
    select id into v_absence from public.staff_absences
     where member_id = v_member and start_date = current_date + 230;
    select count(*) into v_base_notifications from public.notifications
     where user_id = v_emp and type = 'absence_response';
    perform pg_advisory_lock(202609230019);
    perform tests.a19_connect('a19_g', 'a19_withdraw_first');
    perform tests.a19_connect('a19_h', 'a19_resolve_after_withdraw');
    perform dblink_send_query('a19_g', format(
      'select tests.a19_withdraw(%L::uuid, %L)', v_absence, 'a19_withdraw_first'));
    perform tests.a19_wait_workers(array['a19_g'], 1);
    perform dblink_send_query('a19_h', format(
      'select tests.a19_resolve(%L::uuid, true, %L, %L)', v_absence, 'troppo tardi', 'a19_resolve_after_withdraw'));
    perform tests.a19_wait_workers(array['a19_g','a19_h'], 2);
    perform pg_advisory_unlock(202609230019);
    select a_value, a_error, b_value, b_error into v_a, v_err_a, v_b, v_err_b
      from tests.a19_collect_pair('a19_g', 'a19_h');
    perform tests.a19_disconnect('a19_g');
    perform tests.a19_disconnect('a19_h');
    perform tests.ok(v_err_a = 'OK' and v_err_b <> 'OK',
      'una decisione successiva al ritiro viene respinta');
    perform tests.eq((select status::text from public.staff_absences where id = v_absence),
      'withdrawn', 'il ritiro resta la transizione effettiva');
    perform tests.eq((select count(*) from public.messages
                       where absence_id = v_absence and kind = 'absence_response'),
      1::bigint, 'solo la card di ritiro viene creata');
    perform tests.eq((select count(*) from public.notifications
                       where user_id = v_emp and type = 'absence_response'),
      v_base_notifications, 'la decisione respinta non notifica il richiedente');
    end if;

  exception when others then
    v_error := sqlerrm;
  end;

  perform pg_advisory_unlock_all();
  perform tests.a19_disconnect('a19_a');
  perform tests.a19_disconnect('a19_b');
  perform tests.a19_disconnect('a19_c');
  perform tests.a19_disconnect('a19_d');
  perform tests.a19_disconnect('a19_e');
  perform tests.a19_disconnect('a19_f');
  perform tests.a19_disconnect('a19_g');
  perform tests.a19_disconnect('a19_h');

  delete from public.messages where absence_id in (
    select id from public.staff_absences
     where member_id = v_member and start_date between current_date + 200 and current_date + 240
  );
  delete from public.staff_absences
   where member_id = v_member and start_date between current_date + 200 and current_date + 240;
  delete from public.notifications where created_at >= v_started;

  insert into tests.a19_result values (p_scenario, v_error is null, v_error);
end;
$$;

select tests.a19_run('overlap');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.a19_run('disjoint');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.a19_request(current_date + 220, current_date + 220);
select tests.a19_run('double_resolve');
\connect postgres
set search_path = tests, public, pg_catalog;
select tests.a19_request(current_date + 230, current_date + 230);
select tests.a19_run('withdraw_first');

drop trigger if exists a19_absence_barrier on public.staff_absences;
drop function if exists tests.a19_absence_barrier();
drop function if exists tests.a19_request(date, date, text);
drop function if exists tests.a19_record(date, date, text);
drop function if exists tests.a19_resolve(uuid, boolean, text, text);
drop function if exists tests.a19_withdraw(uuid, text);
drop function if exists tests.a19_connect(text, text);
drop function if exists tests.a19_disconnect(text);
drop function if exists tests.a19_collect_pair(text, text);
drop function if exists tests.a19_collect(text);
drop function if exists tests.a19_wait_workers(text[], integer);
drop function if exists tests.a19_run(text);
drop extension dblink cascade;

do $$
declare
  v_scenario text;
  v_error text;
begin
  select scenario, error into v_scenario, v_error
    from tests.a19_result where not ok order by scenario limit 1;
  if v_error is not null then
    raise exception 'FAIL: A19 concorrenza assenze (%) — %', v_scenario, v_error;
  end if;
  perform tests.eq((select count(*) from tests.a19_result), 4::bigint,
    'sono stati eseguiti tutti i quattro scenari concorrenti');
end;
$$;

drop table tests.a19_result;
drop table tests.a19_workers;
select 'absence concurrency: ok' as result;
