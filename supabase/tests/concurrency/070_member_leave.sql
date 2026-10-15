-- A blocca l'azienda per aggiungere una persona già in organico; B esce.
-- Mentre B aspetta l'azienda, non deve trattenere la riga di organico che serve ad A.
\set ON_ERROR_STOP on
set statement_timeout = '20s';
create extension if not exists dblink with schema tests;
set search_path = tests,public,pg_catalog;
create table tests.member_leave_fixture(workspace_id uuid,venue_id uuid,member_id uuid);
create table tests.member_leave_result(ok boolean,error text);
create function tests.member_leave_worker(p_leave boolean) returns uuid language plpgsql as $$
declare f tests.member_leave_fixture; result uuid;
begin
  select * into f from tests.member_leave_fixture;
  if p_leave then
    perform tests.login('Emp');
    perform public.leave(f.member_id);
    result := f.member_id;
  else
    perform tests.login('Ow');
    result := (public.add_member(f.workspace_id,'{"full_name":"Emma","email":"emp@t.test"}',
      'none','{}','all',jsonb_build_array(jsonb_build_object('venue_id',f.venue_id)))->>'member_id')::uuid;
  end if;
  perform tests.logout();
  execute 'reset role';
  return result;
end $$;
create function tests.member_leave_wait() returns void language plpgsql as $$
begin
  for attempt in 1..1000 loop
    perform pg_stat_clear_snapshot();
    if exists (select 1 from pg_stat_activity
      where application_name='member_leave_b' and wait_event_type='Lock') then return; end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'member leave: timeout in attesa del lock aziendale';
end $$;
-- Fixture committata, preparata attraverso le RPC come gli altri test concorrenti.
do $$
declare ws uuid; venue uuid; member uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Concorrenza uscita membro');
  venue := public.create_venue(ws,'Sede uscita membro');
  perform tests.logout();
  execute 'reset role';
  perform public.grant_workspace_access(ws,'complimentary_lifetime','team',1,now(),null,'Fixture uscita locale');
  perform tests.login('Ow');
  member := (public.add_member(ws,'{"full_name":"Emma","email":"emp@t.test"}',
    'none','{}','all',jsonb_build_array(jsonb_build_object('venue_id',venue)))->>'member_id')::uuid;
  perform tests.login('Emp');
  perform public.respond_to_invite(member,true);
  perform tests.logout();
  execute 'reset role';
  insert into tests.member_leave_fixture values(ws,venue,member);
end $$;
do $$
declare f tests.member_leave_fixture; a uuid; b uuid; err_a text; err_b text;
begin
  select * into f from tests.member_leave_fixture;
  perform dblink_connect_u('member_leave_a','dbname=postgres user=postgres application_name=member_leave_a');
  perform dblink_connect_u('member_leave_b','dbname=postgres user=postgres application_name=member_leave_b');
  perform dblink_exec('member_leave_a','set statement_timeout=''10s''');
  perform dblink_exec('member_leave_b','set statement_timeout=''10s''');
  perform dblink_exec('member_leave_a','begin');
  perform * from dblink('member_leave_a',format(
    'select id from public.workspaces where id=%L for update',f.workspace_id)) as t(id uuid);
  perform dblink_send_query('member_leave_b','select tests.member_leave_worker(true)');
  perform tests.member_leave_wait();
  perform dblink_send_query('member_leave_a','select tests.member_leave_worker(false)');
  select id into a from dblink_get_result('member_leave_a',false) as t(id uuid);
  err_a := dblink_error_message('member_leave_a');
  perform * from dblink_get_result('member_leave_a',false) as t(id uuid);
  perform dblink_exec('member_leave_a','commit');
  select id into b from dblink_get_result('member_leave_b',false) as t(id uuid);
  err_b := dblink_error_message('member_leave_b');
  perform * from dblink_get_result('member_leave_b',false) as t(id uuid);
  perform tests.eq(err_a,'OK','aggiunta della stessa persona senza deadlock');
  perform tests.eq(err_b,'OK','uscita concorrente senza deadlock');
  perform tests.eq(a,f.member_id,'aggiunta riusa la scheda');
  perform tests.eq(b,f.member_id,'uscita completa sulla stessa scheda');
  perform tests.eq((select status::text from public.workspace_members where id=f.member_id),
    'left','uscita successiva al commit dell''aggiunta');
  perform tests.ok(not exists (select 1 from public.venue_members
    where member_id=f.member_id and left_at is null),'nessuna sede attiva dopo l''uscita');
  perform dblink_disconnect('member_leave_a');
  perform dblink_disconnect('member_leave_b');
  insert into tests.member_leave_result values(true,null);
exception when others or query_canceled then
  if 'member_leave_a'=any(coalesce(dblink_get_connections(),'{}'::text[])) then
    perform dblink_disconnect('member_leave_a');
  end if;
  if 'member_leave_b'=any(coalesce(dblink_get_connections(),'{}'::text[])) then
    perform dblink_disconnect('member_leave_b');
  end if;
  insert into tests.member_leave_result values(false,sqlerrm);
end $$;
delete from public.workspaces where id in (select workspace_id from tests.member_leave_fixture);
drop table tests.member_leave_fixture;
drop function tests.member_leave_worker(boolean),tests.member_leave_wait();
do $$
declare err text;
begin
  select error into err from tests.member_leave_result where not ok;
  if found then raise exception 'member leave concurrency: %',err; end if;
end $$;
drop table tests.member_leave_result;
reset statement_timeout;
select 'member leave concurrency: ok' as result;
