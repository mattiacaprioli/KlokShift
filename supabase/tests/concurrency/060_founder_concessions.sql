-- Doppi invii e variazioni del fondatore usano lo stesso lock delle capacità.
\set ON_ERROR_STOP on
set statement_timeout='20s';
create extension if not exists dblink with schema tests;
set search_path=tests,public,pg_catalog;
insert into auth.sessions(id,user_id) values('00000000-0000-4000-8000-000000000160',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values('00000000-0000-4000-8000-000000000161',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Concorrenza locale M06a');
create table tests.founder_fixture(kind text,workspace_id uuid,revision text,op_a uuid,op_b uuid);
create table tests.founder_result(ok boolean,error text);
create function tests.founder_barrier() returns trigger language plpgsql as $$
begin
  if new.reason='Concorrenza M06a' then
    perform pg_advisory_lock(202610060060);
    perform pg_advisory_unlock(202610060060);
  end if;
  return new;
end $$;
create trigger z_founder_barrier before insert on public.workspace_access_periods
for each row execute function tests.founder_barrier();
create function tests.founder_worker(p_kind text,p_first boolean) returns uuid language plpgsql as $$
declare f tests.founder_fixture; result uuid;
begin
  select * into f from tests.founder_fixture where kind=p_kind;
  if p_kind='capacity' and not p_first then
    perform tests.login('Ow');
    result:=public.create_venue(f.workspace_id,'Sede concorrente');
  else
    perform tests.login('Str');
    perform set_config('request.jwt.claims',jsonb_build_object('sub',tests.id('Str'),'role','authenticated',
      'session_id','00000000-0000-4000-8000-000000000160','aal','aal2')::text,true);
    result:=(public.admin_apply_workspace_action(f.workspace_id,'grant_lifetime','Concorrenza M06a',
      case when p_first then f.op_a else f.op_b end,f.revision,p_plan=>'team',
      p_venue_limit=>case when p_kind='capacity' then 1 else 2 end,p_document_limit_bytes=>2147483648)->>'period_id')::uuid;
  end if;
  perform tests.logout();
  execute 'reset role';
  return result;
end $$;
create function tests.founder_wait(p_names text[],p_count integer) returns void language plpgsql as $$
begin
  for i in 1..1000 loop
    perform pg_stat_clear_snapshot();
    if (select count(*) from pg_stat_activity where application_name=any(p_names) and wait_event_type='Lock')=p_count then return; end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'founder: timeout barriera';
end $$;
do $$
declare ws uuid; op uuid; kind text;
begin
  foreach kind in array array['retry','stale','capacity'] loop
    perform tests.login('Ow');
    ws:=public.create_workspace('Concorrenza fondatore '||kind);
    perform public.create_venue(ws,'Prima sede');
    perform tests.logout();
    execute 'reset role';
    perform public.grant_workspace_access(ws,'complimentary_lifetime','team',2,now(),null,'Setup fixture');
    op:=gen_random_uuid();
    insert into tests.founder_fixture values(kind,ws,private.admin_workspace_revision(ws),op,
      case when kind='retry' then op else gen_random_uuid() end);
  end loop;
end $$;
do $$
declare f tests.founder_fixture; a uuid; b uuid; error_b text;
begin
  for f in select * from tests.founder_fixture order by kind loop
    perform pg_advisory_lock(202610060060);
    perform dblink_connect_u('founder_a','dbname=postgres user=postgres application_name=founder_a');
    perform dblink_connect_u('founder_b','dbname=postgres user=postgres application_name=founder_b');
    perform dblink_send_query('founder_a',format('select tests.founder_worker(%L,true)',f.kind));
    perform tests.founder_wait(array['founder_a'],1);
    perform dblink_send_query('founder_b',format('select tests.founder_worker(%L,false)',f.kind));
    perform tests.founder_wait(array['founder_a','founder_b'],2);
    perform pg_advisory_unlock(202610060060);
    select id into a from dblink_get_result('founder_a',false) as t(id uuid);
    perform tests.eq(dblink_error_message('founder_a'),'OK','prima concessione passa: '||f.kind);
    perform * from dblink_get_result('founder_a',false) as t(id uuid);
    select id into b from dblink_get_result('founder_b',false) as t(id uuid);
    error_b:=dblink_error_message('founder_b');
    perform * from dblink_get_result('founder_b',false) as t(id uuid);
    if f.kind='retry' then
      perform tests.eq(a,b,'retry simultaneo stesso periodo');
      perform tests.eq(error_b,'OK','retry simultaneo riuscito');
    else
      perform tests.ok(b is null,'secondo intervento rifiutato: '||f.kind);
      perform tests.ok(position(case f.kind when 'stale' then 'admin_stale_revision' else 'workspace_venue_capacity' end in error_b)>0,'motivo concorrente corretto: '||f.kind);
    end if;
    perform tests.eq((select count(*) from private.admin_operations where target_id=f.workspace_id),1::bigint,'audit unico: '||f.kind);
    perform tests.eq((select count(*) from public.workspace_access_periods where workspace_id=f.workspace_id and kind='complimentary_lifetime' and revoked_at is null),1::bigint,'una sola capacità corrente: '||f.kind);
    perform dblink_disconnect('founder_a');
    perform dblink_disconnect('founder_b');
  end loop;
  insert into tests.founder_result values(true,null);
exception when others or query_canceled then
  perform pg_advisory_unlock(202610060060);
  if 'founder_a'=any(coalesce(dblink_get_connections(),'{}'::text[])) then perform dblink_disconnect('founder_a'); end if;
  if 'founder_b'=any(coalesce(dblink_get_connections(),'{}'::text[])) then perform dblink_disconnect('founder_b'); end if;
  insert into tests.founder_result values(false,sqlerrm);
end $$;
drop trigger z_founder_barrier on public.workspace_access_periods;
delete from public.workspaces where id in (select workspace_id from tests.founder_fixture);
delete from private.admin_operations where target_id in (select workspace_id from tests.founder_fixture);
delete from private.platform_admins where user_id=tests.id('Str');
delete from auth.sessions where id='00000000-0000-4000-8000-000000000160';
delete from auth.mfa_factors where id='00000000-0000-4000-8000-000000000161';
drop table tests.founder_fixture;
drop function tests.founder_worker(text,boolean),tests.founder_barrier(),tests.founder_wait(text[],integer);
do $$
declare err text;
begin
  select error into err from tests.founder_result where not ok;
  if found then raise exception 'founder concurrency: %',err; end if;
end $$;
drop table tests.founder_result;
reset statement_timeout;
select 'founder concurrency: ok' as result;
