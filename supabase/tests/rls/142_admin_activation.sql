-- Attivazione delle aziende nell'area del fondatore: date e conteggi, mai nomi
-- di persone; solo con allowlist e MFA, come le altre letture globali (090).
begin;
insert into auth.sessions(id,user_id) values ('00000000-0000-4000-8000-000000000105',tests.id('Str'));
insert into auth.mfa_factors(id,user_id,factor_type,status) values
 ('00000000-0000-4000-8000-000000000106',tests.id('Str'),'totp','verified');
insert into private.platform_admins(user_id,reason) values(tests.id('Str'),'Fixture attivazione');

do $$
declare
  vm uuid;
  ids uuid[];
  a uuid;
  item jsonb;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');

  -- Prima di ogni turno: niente primo turno, niente conferma.
  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000105', 'aal', 'aal2')::text, true);
  select i into item from jsonb_array_elements(public.admin_list_activation() -> 'items') i
   where i ->> 'workspace_id' = tests.id('W1')::text;
  perform tests.ok(item is not null, 'l''azienda compare');
  perform tests.ok(item ->> 'first_venue_at' is not null, 'data della prima sede');
  -- Nel team di W1 lavorano Ow, Co, Emp ed Emp2; Co2 gestisce senza turni.
  perform tests.eq((item ->> 'people')::int, 4, 'persone che lavorano nei turni');
  perform tests.eq((item ->> 'linked')::int, 4, 'account collegati');
  perform tests.ok(item ->> 'first_shift_at' is null, 'nessun turno ancora');
  perform tests.ok(item ->> 'first_confirmed_at' is null, 'nessuna conferma ancora');
  perform tests.ok(not (item ? 'members') and item::text not like '%' || tests.id('Emp')::text || '%',
    'nessuna persona nominata');

  -- Il titolare pianifica, il dipendente conferma.
  perform tests.login('Ow');
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Sera', 'date', (current_date + 2)::text,
    'start_time', '18:00', 'end_time', '23:00', 'require_confirmation', true,
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select x.id into a from public.shift_assignments x where x.shift_id = ids[1];
  perform tests.login('Emp');
  perform public.respond_assignment(a, 'confirmed');

  perform tests.login('Str');
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000105', 'aal', 'aal2')::text, true);
  select i into item from jsonb_array_elements(public.admin_list_activation() -> 'items') i
   where i ->> 'workspace_id' = tests.id('W1')::text;
  perform tests.ok(item ->> 'first_shift_at' is not null, 'primo turno pianificato');
  perform tests.ok(item ->> 'first_confirmed_at' is not null, 'prima conferma');

  -- Senza MFA, e a chi non è in allowlist, niente.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', tests.id('Str'), 'role', 'authenticated',
    'session_id', '00000000-0000-4000-8000-000000000105', 'aal', 'aal1')::text, true);
  perform tests.raises('select public.admin_list_activation()', 'admin_mfa_required');
  perform tests.login('Ow');
  perform tests.raises('select public.admin_list_activation()', 'admin_not_allowed', 'il titolare non vede l''attivazione');
end $$;

select tests.anon();
select tests.raises('select public.admin_list_activation()', 'permission denied', 'anon escluso');
select tests.logout();
rollback;
