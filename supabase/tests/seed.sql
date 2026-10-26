-- Seed di sviluppo e fixture dei test RLS. Si applica dopo le migration
-- (`run.sh reset`). Costruisce tutto passando dalle RPC, impersonando gli
-- attori: se una RPC si rompe, il seed lo dice.
--
--   Ow    titolare di W1, lavora in V1
--   Co    collaboratore di W1, ambito solo V1, permesso «turni», lavora in V1
--   Co2   collaboratore di W1, tutte le sedi, permesso «ore»
--   Emp   dipendente di W1/V1 e titolare di W2 (multi-workspace)
--   Emp2  dipendente di W1/V2
--   Str   estraneo
--
-- Sedi: W1 = {V1, V2}, W2 = {V3}. Tutti confermati e con la stessa password
-- di comodo non serve: i test non passano da GoTrue.

drop schema if exists tests cascade;
create schema tests;
grant usage on schema tests to public;

create table tests.ids (name text primary key, id uuid not null);
grant all on tests.ids to public;

create function tests.id(p_name text) returns uuid
language sql stable as $$ select id from tests.ids where name = p_name $$;

-- Impersona un attore per il resto della transazione.
create function tests.login(p_name text) returns void language plpgsql as $$
begin
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', tests.id(p_name), 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', tests.id(p_name)::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

create function tests.anon() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'anon', true);
end $$;

create function tests.logout() returns void language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
  perform set_config('request.jwt.claim.sub', '', true);
end $$;

create function tests.ok(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if p_cond is distinct from true then
    raise exception 'FAIL: %', p_msg;
  end if;
end $$;

create function tests.eq(p_actual anyelement, p_expected anyelement, p_msg text)
returns void language plpgsql as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'FAIL: % (atteso %, trovato %)', p_msg, p_expected, p_actual;
  end if;
end $$;

-- L'istruzione deve fallire, con un messaggio che contiene p_expect.
create function tests.raises(p_sql text, p_expect text, p_msg text default null)
returns void language plpgsql as $$
declare v_err text;
begin
  begin
    execute p_sql;
  exception when others then
    v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: % — doveva fallire con "%": %', coalesce(p_msg, ''), p_expect, p_sql;
  end if;
  if position(p_expect in v_err) = 0 then
    raise exception 'FAIL: % — atteso "%", trovato "%"', coalesce(p_msg, ''), p_expect, v_err;
  end if;
end $$;

grant execute on all functions in schema tests to public;

-- ---------------------------------------------------------------------------
do $$
declare
  ow uuid := gen_random_uuid();  co uuid := gen_random_uuid();  co2 uuid := gen_random_uuid();
  emp uuid := gen_random_uuid(); emp2 uuid := gen_random_uuid(); str uuid := gen_random_uuid();
  w1 uuid; w2 uuid; v1 uuid; v2 uuid; v3 uuid;
  r jsonb;
begin
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values
    (ow,   'ow@t.test',   now(), '{"full_name":"Olivia Owner"}'),
    (co,   'co@t.test',   now(), '{"full_name":"Carlo Collab"}'),
    (co2,  'co2@t.test',  now(), '{"full_name":"Cora Collab"}'),
    (emp,  'emp@t.test',  now(), '{"full_name":"Emma Employee"}'),
    (emp2, 'emp2@t.test', now(), '{"full_name":"Enzo Employee"}'),
    (str,  'str@t.test',  now(), '{"full_name":"Sara Stranger"}');
  insert into tests.ids values
    ('Ow', ow), ('Co', co), ('Co2', co2), ('Emp', emp), ('Emp2', emp2), ('Str', str);

  -- W1 e le sue sedi
  perform tests.login('Ow');
  w1 := public.create_workspace('W1');
  perform tests.logout();
  perform public.grant_workspace_access(w1,'complimentary_lifetime','team',10,now(),null,'Fixture locale dominio');
  perform tests.login('Ow');
  v1 := public.create_venue(w1, 'V1', 'Via Uno 1', 'Milano');
  v2 := public.create_venue(w1, 'V2', 'Via Due 2', 'Milano');
  insert into tests.ids values ('W1', w1), ('V1', v1), ('V2', v2);

  -- Il titolare si mette in organico in V1 (nessun invito, nessuna persona nuova).
  r := public.add_member(w1, '{}'::jsonb, 'none', '{}'::jsonb, 'all',
         jsonb_build_array(jsonb_build_object('venue_id', v1)), true);
  insert into tests.ids select 'M_Ow', m.id from public.workspace_members m
    where m.workspace_id = w1 and m.user_id = ow;

  -- Dipendenti: hanno un account, quindi ricevono un invito da accettare.
  r := public.add_member(w1, '{"full_name":"Emma","email":"emp@t.test"}'::jsonb, 'none', '{}'::jsonb, 'all',
         jsonb_build_array(jsonb_build_object('venue_id', v1, 'employment_type', 'fisso')));
  insert into tests.ids values ('M_Emp', (r ->> 'member_id')::uuid);
  r := public.add_member(w1, '{"full_name":"Enzo","email":"emp2@t.test"}'::jsonb, 'none', '{}'::jsonb, 'all',
         jsonb_build_array(jsonb_build_object('venue_id', v2)));
  insert into tests.ids values ('M_Emp2', (r ->> 'member_id')::uuid);

  -- Collaboratori.
  r := public.add_member(w1, '{"full_name":"Carlo","email":"co@t.test"}'::jsonb, 'collaborator',
         '{"shifts":true}'::jsonb, 'selected',
         jsonb_build_array(jsonb_build_object('venue_id', v1, 'in_scope', true)));
  insert into tests.ids values ('M_Co', (r ->> 'member_id')::uuid);
  r := public.add_member(w1, '{"full_name":"Cora","email":"co2@t.test"}'::jsonb, 'collaborator',
         '{"hours":true}'::jsonb, 'all', '[]'::jsonb);
  insert into tests.ids values ('M_Co2', (r ->> 'member_id')::uuid);

  -- Accettano gli inviti.
  perform tests.login('Emp');  perform public.respond_to_invite(tests.id('M_Emp'), true);
  perform tests.login('Emp2'); perform public.respond_to_invite(tests.id('M_Emp2'), true);
  perform tests.login('Co');   perform public.respond_to_invite(tests.id('M_Co'), true);
  perform tests.login('Co2');  perform public.respond_to_invite(tests.id('M_Co2'), true);

  -- W2: Emp è titolare altrove.
  perform tests.login('Emp');
  w2 := public.create_workspace('W2');
  perform tests.logout();
  perform public.grant_workspace_access(w2,'complimentary_lifetime','team',10,now(),null,'Fixture locale dominio');
  perform tests.login('Emp');
  v3 := public.create_venue(w2, 'V3');
  insert into tests.ids values ('W2', w2), ('V3', v3);
  insert into tests.ids select 'M_Emp_W2', m.id from public.workspace_members m
    where m.workspace_id = w2 and m.user_id = emp;

  perform tests.logout();
end $$;


-- Fixture: storico nel passato. Dal 26/10/2026 `public.create_shifts` rifiuta
-- i turni già finiti (20261026000100: il passato si registra, non si
-- pianifica), ma molti test hanno bisogno di turni conclusi «come li faceva la
-- pianificazione». Questa è la versione di prima, con gli stessi controlli di
-- permesso e la stessa `assign_one`: cambia solo che accetta date passate.
-- Gira come chi l'ha definita, ma `auth.uid()` resta l'attore impersonato.
create function tests.create_shifts(p_plans jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan    jsonb;
  v_venue   uuid;
  v_dates   date[];
  v_date    date;
  v_shift   uuid;
  v_ids     uuid[] := '{}';
  v_staff   jsonb;
  v_item    jsonb;
  v_break   integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  for v_venue in select distinct private.venue_workspace((p->>'venue_id')::uuid) from jsonb_array_elements(coalesce(p_plans,'[]'::jsonb)) p order by 1 loop
    perform private.assert_workspace_operational(v_venue);
  end loop;

  for v_plan in select * from jsonb_array_elements(coalesce(p_plans, '[]'::jsonb)) loop
    v_venue := (v_plan ->> 'venue_id')::uuid;
    if v_venue is null or not private.can(v_venue, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if btrim(coalesce(v_plan ->> 'title', '')) = '' then
      raise exception 'title_required' using errcode = '23514';
    end if;

    v_dates := case
      when v_plan ? 'dates' then array(select d::date from jsonb_array_elements_text(v_plan -> 'dates') d)
      else array[(v_plan ->> 'date')::date]
    end;
    v_staff := coalesce(v_plan -> 'staff', '[]'::jsonb);
    v_break := coalesce((v_plan ->> 'break_minutes')::integer, 0);
    perform private.assert_shift_break(
      (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time, v_break);

    foreach v_date in array v_dates loop
      insert into public.shifts (
        venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
        break_minutes
      ) values (
        v_venue, btrim(v_plan ->> 'title'), nullif(btrim(coalesce(v_plan ->> 'description', '')), ''),
        v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time,
        coalesce((v_plan ->> 'require_confirmation')::boolean, false),
        private.positions_for(v_plan -> 'role_targets', jsonb_array_length(v_staff)),
        v_break
      ) returning id into v_shift;

      perform private.replace_requirements(v_shift, v_venue, v_plan -> 'role_targets');
      for v_item in select * from jsonb_array_elements(v_staff) loop
        perform private.assign_one(v_shift, (v_item ->> 'venue_member_id')::uuid, (v_item ->> 'role_id')::uuid);
      end loop;
      v_ids := v_ids || v_shift;
    end loop;
  end loop;
  return v_ids;
end;
$function$
;
grant execute on function tests.create_shifts(jsonb) to authenticated;
