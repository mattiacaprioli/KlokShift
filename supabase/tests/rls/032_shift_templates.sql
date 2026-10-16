-- Modelli di turno (20261016000200_shift_templates): per sede, letti e scritti
-- da chi ha «Turni», solo via RPC, con lo stesso confine commerciale dei turni.
begin;

do $$
declare
  v1 uuid := tests.id('V1');
  v2 uuid := tests.id('V2');
  ws uuid := tests.id('W1');
  role_v1 uuid := gen_random_uuid();
  role_v2 uuid := gen_random_uuid();
  t1 uuid;
  t2 uuid;
  t3 uuid;
  tpl public.shift_templates;
begin
  perform tests.logout();
  insert into public.venue_roles (id, venue_id, name) values
    (role_v1, v1, 'Sala'), (role_v2, v2, 'Cucina');

  -- ---------------------------------------------------------------------------
  -- Salvare, rileggere, risalvare con lo stesso nome.
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  t1 := public.save_shift_template(v1, jsonb_build_object(
    'name', '  Cena ', 'start_time', '18:00', 'end_time', '23:30',
    'break_minutes', 30, 'description', ' Divisa nera ', 'require_confirmation', true,
    'role_targets', jsonb_build_array(
      jsonb_build_object('role_id', role_v1, 'count', 3),
      jsonb_build_object('role_id', role_v1, 'count', 0))));
  select * into tpl from public.shift_templates where id = t1;
  perform tests.eq(tpl.name, 'Cena', 'il nome si salva senza spazi');
  perform tests.eq(tpl.start_time, time '18:00', 'inizio');
  perform tests.eq(tpl.end_time, time '23:30', 'fine');
  perform tests.eq(tpl.break_minutes, 30, 'pausa');
  perform tests.eq(tpl.description, 'Divisa nera', 'note senza spazi');
  perform tests.eq(tpl.require_confirmation, true, 'chiedi conferma');
  perform tests.eq(tpl.role_targets,
    jsonb_build_array(jsonb_build_object('role_id', role_v1, 'count', 3)),
    'solo i fabbisogni con count > 0');

  t2 := public.save_shift_template(v1, jsonb_build_object(
    'name', 'CENA', 'start_time', '19:00', 'end_time', '00:30', 'description', ''));
  perform tests.eq(t2, t1, 'stesso nome (maiuscole e spazi a parte) → stesso modello');
  select * into tpl from public.shift_templates where id = t1;
  perform tests.eq(tpl.name, 'CENA', 'il nome si aggiorna');
  perform tests.eq(tpl.start_time, time '19:00', 'orario aggiornato');
  perform tests.eq(tpl.description, null::text, 'note vuote → null');
  perform tests.eq(tpl.role_targets, '[]'::jsonb, 'fabbisogno svuotato');
  perform tests.eq((select count(*) from public.shift_templates where venue_id = v1), 1::bigint,
    'nessun doppione');

  -- ---------------------------------------------------------------------------
  -- Validazione: stesse regole del turno.
  -- ---------------------------------------------------------------------------
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', ' ', 'start_time', '18:00', 'end_time', '23:00')),
    'name_required', 'nome vuoto');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Uguale', 'start_time', '18:00', 'end_time', '18:00')),
    'template_invalid', 'inizio e fine coincidono');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Senza fine', 'start_time', '18:00')),
    'template_invalid', 'manca la fine');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Pausa lunga', 'start_time', '18:00', 'end_time', '19:00',
      'break_minutes', 60)),
    'break_too_long', 'la pausa non può coprire il turno');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Altra sede', 'start_time', '18:00', 'end_time', '23:00',
      'role_targets', jsonb_build_array(jsonb_build_object('role_id', role_v2, 'count', 1)))),
    'role_not_in_venue', 'ruolo di un''altra sede');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Troppi', 'start_time', '18:00', 'end_time', '23:00',
      'role_targets', jsonb_build_array(jsonb_build_object('role_id', role_v1, 'count', 100)))),
    'template_invalid', 'fabbisogno oltre 99');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Senza ruolo', 'start_time', '18:00', 'end_time', '23:00',
      'role_targets', jsonb_build_array(jsonb_build_object('count', 2)))),
    'template_invalid', 'fabbisogno senza ruolo');

  -- Nessuna scrittura diretta.
  perform tests.raises(format(
    'insert into public.shift_templates (venue_id, name, start_time, end_time) values (%L, ''X'', ''18:00'', ''23:00'')', v1),
    'permission denied', 'insert diretto negato');
  perform tests.raises(format('delete from public.shift_templates where id = %L', t1),
    'permission denied', 'delete diretto negato');

  -- ---------------------------------------------------------------------------
  -- Chi legge e chi scrive.
  -- ---------------------------------------------------------------------------
  perform tests.login('Co');
  perform tests.eq((select count(*) from public.shift_templates where id = t1), 1::bigint,
    'il collaboratore con Turni su V1 legge');
  t3 := public.save_shift_template(v1, jsonb_build_object(
    'name', 'Pranzo', 'start_time', '11:30', 'end_time', '15:00'));
  perform tests.ok(t3 is not null, 'il collaboratore con Turni salva su V1');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v2,
    jsonb_build_object('name', 'Pranzo', 'start_time', '11:30', 'end_time', '15:00')),
    'not_allowed', 'fuori dal suo ambito');
  perform public.delete_shift_template(t3);
  perform tests.eq((select count(*) from public.shift_templates where id = t3), 0::bigint,
    'il collaboratore con Turni elimina su V1');

  perform tests.login('Co2');
  perform tests.eq((select count(*) from public.shift_templates), 0::bigint, 'solo Ore: non legge');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Ore', 'start_time', '18:00', 'end_time', '23:00')),
    'not_allowed', 'solo Ore: non salva');
  perform tests.raises(format('select public.delete_shift_template(%L)', t1),
    'not_allowed', 'solo Ore: non elimina');

  perform tests.login('Emp');
  perform tests.eq((select count(*) from public.shift_templates), 0::bigint, 'il dipendente non legge');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Dip', 'start_time', '18:00', 'end_time', '23:00')),
    'not_allowed', 'il dipendente non salva');

  perform tests.login('Str');
  perform tests.eq((select count(*) from public.shift_templates), 0::bigint, 'l''estraneo non legge');
  perform tests.raises(format('select public.delete_shift_template(%L)', t1),
    'not_allowed', 'l''estraneo non elimina');
  perform tests.raises(format('select public.delete_shift_template(%L)', gen_random_uuid()),
    'not_allowed', 'modello inesistente: niente no-op silenzioso');

  -- ---------------------------------------------------------------------------
  -- Al massimo 30 modelli per sede; risalvare uno esistente resta possibile.
  -- ---------------------------------------------------------------------------
  perform tests.login('Ow');
  for i in 2..30 loop
    perform public.save_shift_template(v1, jsonb_build_object(
      'name', 'Modello ' || i, 'start_time', '09:00', 'end_time', '13:00'));
  end loop;
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Il trentunesimo', 'start_time', '09:00', 'end_time', '13:00')),
    'template_limit', 'oltre 30 modelli per sede');
  perform tests.eq(public.save_shift_template(v1, jsonb_build_object(
    'name', 'cena', 'start_time', '18:00', 'end_time', '23:00')), t1,
    'al limite si aggiorna ancora un modello esistente');
  perform tests.ok(public.save_shift_template(v2, jsonb_build_object(
    'name', 'Cena', 'start_time', '18:00', 'end_time', '23:00')) <> t1,
    'il limite e il nome sono per sede');

  -- ---------------------------------------------------------------------------
  -- Azienda in sola lettura: si consulta, non si scrive.
  -- ---------------------------------------------------------------------------
  perform tests.logout();
  delete from public.workspace_access_periods where workspace_id = ws;
  perform public.grant_workspace_access(ws, 'complimentary_temporary', 'base', 3,
    now() - interval '31 days', now() - interval '1 hour', 'Fixture archivio modelli');
  perform tests.login('Ow');
  perform tests.ok((select count(*) from public.shift_templates where venue_id = v1) > 0,
    'in archivio i modelli si leggono');
  perform tests.raises(format('select public.save_shift_template(%L, %L)', v1,
    jsonb_build_object('name', 'Archivio', 'start_time', '18:00', 'end_time', '23:00')),
    'workspace_read_only', 'in archivio non si salva');
  perform tests.raises(format('select public.delete_shift_template(%L)', t1),
    'workspace_read_only', 'in archivio non si elimina');
end $$;

rollback;
select 'shift templates: ok' as result;
