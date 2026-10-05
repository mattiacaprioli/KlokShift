-- Due sessioni all'ultimo posto. La barriera ferma A dopo il lock aziendale;
-- B deve aspettare, poi rileggere l'uso dopo il commit di A.
\set ON_ERROR_STOP on
set statement_timeout='20s';
create extension if not exists dblink with schema tests;
set search_path=tests,public,pg_catalog;
create table tests.capacity_fixture(workspace_id uuid,venue_id uuid,reopen_venue uuid,kind text);
create table tests.capacity_result(ok boolean,error text);
grant select on tests.capacity_fixture to authenticated,postgres;
create function tests.capacity_barrier() returns trigger language plpgsql as $$
begin
  if coalesce(to_jsonb(new)->>'display_name',to_jsonb(new)->>'name') like 'Race %' then
    perform pg_advisory_lock(202610050014);
    perform pg_advisory_unlock(202610050014);
  end if;
  return new;
end $$;
create trigger z_capacity_barrier before insert on public.workspace_members
for each row execute function tests.capacity_barrier();
create trigger z_capacity_barrier before insert or update of closed_at on public.venues
for each row execute function tests.capacity_barrier();
create function tests.capacity_worker(p_kind text,p_name text) returns uuid language plpgsql as $$
declare f record; result uuid;
begin
  select * into f from tests.capacity_fixture where kind=p_kind;
  perform tests.login('Ow');
  if p_name='Race A' and p_kind in ('people_reopen','venues_reopen') then
    perform public.set_venue_closed(f.reopen_venue,false);
    result:=f.reopen_venue;
  elsif p_kind in ('people','people_reopen') then
    result := (public.add_member(f.workspace_id,jsonb_build_object('full_name',p_name),'none','{}','all',
      jsonb_build_array(jsonb_build_object('venue_id',f.venue_id)))->>'member_id')::uuid;
  else
    result := public.create_venue(f.workspace_id,p_name);
  end if;
  perform tests.logout();
  execute 'reset role';
  return result;
end $$;
create function tests.capacity_wait(p_names text[],p_count integer) returns void language plpgsql as $$
begin
  for attempt in 1..1000 loop
    -- Il DO riusa questa funzione per più gare; non riusare lo snapshot
    -- delle statistiche delle connessioni già chiuse nella gara precedente.
    perform pg_stat_clear_snapshot();
    if (select count(*) from pg_stat_activity where application_name=any(p_names) and wait_event_type='Lock')=p_count then return; end if;
    perform pg_sleep(0.01);
  end loop;
  raise exception 'capacity: timeout barriera % (attesi %)',p_names,p_count;
end $$;
-- Fixture committate. Le concessioni sono solo dati di test fidati.
do $$
declare ws uuid; venue uuid; reopen_venue uuid;
begin
  for kind in 1..4 loop
    reopen_venue:=null;
    perform tests.login('Ow');
    ws:=public.create_workspace('Concorrenza capacità '||kind);
    venue:=public.create_venue(ws,'Sede capacità '||kind);
    perform tests.logout();
    execute 'reset role';
    perform public.grant_workspace_access(ws,'complimentary_lifetime','base',case kind when 3 then 3 else 2 end,now(),null,'Fixture race locale');
    if kind in (3,4) then
      perform tests.login('Ow');
      reopen_venue:=public.create_venue(ws,'Race Riapertura');
      if kind=3 then
        perform public.add_member(ws,'{"full_name":"Solo sede chiusa"}','none','{}','all',
          jsonb_build_array(jsonb_build_object('venue_id',reopen_venue)));
      end if;
      perform public.set_venue_closed(reopen_venue,true);
      perform tests.logout();
      execute 'reset role';
    end if;
    if kind in (1,3) then
      perform tests.login('Ow');
      for i in 1..29 loop
        perform public.add_member(ws,jsonb_build_object('full_name','Posto '||i),'none','{}','all',
          jsonb_build_array(jsonb_build_object('venue_id',venue)));
      end loop;
      perform tests.logout();
      execute 'reset role';
    end if;
    insert into tests.capacity_fixture values(ws,venue,reopen_venue,
      case kind when 1 then 'people' when 2 then 'venues' when 3 then 'people_reopen' else 'venues_reopen' end);
  end loop;
end $$;

do $$
declare a uuid; b uuid; err_a text; err_b text; ws uuid; used integer; v_kind text; usage_key text;
begin
  foreach v_kind in array array['people','venues','people_reopen','venues_reopen'] loop
    usage_key:=case when v_kind in ('people','people_reopen') then 'people' else 'venues' end;
    perform pg_advisory_lock(202610050014);
    perform dblink_connect_u('capacity_a','dbname=postgres user=postgres application_name=capacity_a');
    perform dblink_connect_u('capacity_b','dbname=postgres user=postgres application_name=capacity_b');
    perform dblink_send_query('capacity_a',format('select tests.capacity_worker(%L,''Race A'')',v_kind));
    perform tests.capacity_wait(array['capacity_a'],1);
    perform dblink_send_query('capacity_b',format('select tests.capacity_worker(%L,''Race B'')',v_kind));
    perform tests.capacity_wait(array['capacity_a','capacity_b'],2);
    perform pg_advisory_unlock(202610050014);
    select id into a from dblink_get_result('capacity_a',false) as t(id uuid);
    err_a:=dblink_error_message('capacity_a');
    perform * from dblink_get_result('capacity_a',false) as t(id uuid);
    select id into b from dblink_get_result('capacity_b',false) as t(id uuid);
    err_b:=dblink_error_message('capacity_b');
    perform * from dblink_get_result('capacity_b',false) as t(id uuid);
    perform tests.eq(err_a,'OK','primo worker passa: '||v_kind);
    perform tests.ok(a is not null and b is null,'solo il primo worker occupa il posto: '||v_kind);
    perform tests.ok(position(case usage_key when 'people' then 'workspace_people_capacity' else 'workspace_venue_capacity' end in err_b)>0,
      'secondo worker rifiutato per capacità: '||v_kind);
    select workspace_id into ws from tests.capacity_fixture where capacity_fixture.kind=v_kind;
    -- Accesso interno con istante esplicito: nessun auth/client aggira il lock.
    used:=(private.workspace_access_at(ws,now())#>>array['usage',usage_key])::integer;
    perform tests.eq(used,case usage_key when 'people' then 30 else 2 end,'uso finale esatto: '||v_kind);
    perform dblink_disconnect('capacity_a');
    perform dblink_disconnect('capacity_b');
  end loop;
  insert into tests.capacity_result values(true,null);
exception when others or query_canceled then
  perform pg_advisory_unlock(202610050014);
  if 'capacity_a'=any(coalesce(dblink_get_connections(),'{}'::text[])) then perform dblink_disconnect('capacity_a'); end if;
  if 'capacity_b'=any(coalesce(dblink_get_connections(),'{}'::text[])) then perform dblink_disconnect('capacity_b'); end if;
  insert into tests.capacity_result values(false,sqlerrm);
end $$;
drop trigger z_capacity_barrier on public.workspace_members;
drop trigger z_capacity_barrier on public.venues;
delete from public.workspaces where id in (select workspace_id from tests.capacity_fixture);
drop table tests.capacity_fixture;
drop function tests.capacity_barrier(),tests.capacity_worker(text,text),tests.capacity_wait(text[],integer);
do $$
declare err text;
begin
  select error into err from tests.capacity_result where not ok;
  if found then raise exception 'commercial capacity concurrency: %',err; end if;
end $$;
drop table tests.capacity_result;
reset statement_timeout;
select 'commercial capacity concurrency: ok' as result;
