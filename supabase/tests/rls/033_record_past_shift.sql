-- Turno già fatto: chi ha Ore registra a posteriori un turno dimenticato. Le
-- persone risultano presenti, le ore contano subito (anche con la timbratura
-- dall'app), e nessuno riceve «Nuovo turno assegnato».
begin;

do $$
declare
  vm uuid;
  vm_ow uuid;
  vm_emp2 uuid;
  d date := current_date - 3;
  sid uuid;
  sh public.shifts;
  asg public.shift_assignments;
  one jsonb;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm_ow from public.venue_members x
   where x.member_id = tests.id('M_Ow') and x.venue_id = tests.id('V1');
  select x.id into vm_emp2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');
  one := jsonb_build_array(jsonb_build_object('venue_member_id', vm));

  -- Con la timbratura dall'app le ore senza timbratura non contano: quelle
  -- registrate qui sì, perché le ha registrate chi ha Ore.
  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');

  -- È una registrazione di ore: «Turni» non basta.
  perform tests.login('Co');
  perform tests.raises(format(
      'select public.record_past_shift(%L, %L, ''18:00'', ''23:00'', 0, ''Sera'', null, %L::jsonb)',
      tests.id('V1'), d, one),
    'not_allowed', 'chi ha solo Turni non registra ore');

  perform tests.login('Co2');
  perform tests.raises(format(
      'select public.record_past_shift(%L, %L, ''18:00'', ''23:00'', 0, ''Sera'', null, %L::jsonb)',
      tests.id('V1'), current_date + 1, one),
    'shift_not_finished', 'un turno che deve ancora finire si pianifica');
  perform tests.raises(format(
      'select public.record_past_shift(%L, %L, ''18:00'', ''23:00'', 0, ''Sera'', null, ''[]''::jsonb)',
      tests.id('V1'), d),
    'staff_required', 'serve almeno una persona');
  perform tests.raises(format(
      'select public.record_past_shift(%L, %L, ''18:00'', ''18:00'', 0, ''Sera'', null, %L::jsonb)',
      tests.id('V1'), d, one),
    'shift_times_invalid', 'inizio e fine non coincidono');
  perform tests.raises(format(
      'select public.record_past_shift(%L, %L, ''18:00'', ''23:00'', 0, ''Sera'', null, %L::jsonb)',
      tests.id('V1'), d, jsonb_build_array(jsonb_build_object('venue_member_id', vm_emp2))),
    'not_in_roster', 'solo chi è in organico in quella sede');
  perform tests.raises(format(
      'select public.record_past_shift(%L, %L, ''18:00'', ''23:00'', 0, ''Sera'', null, %L::jsonb)',
      tests.id('V1'), d, one || one),
    'already_assigned', 'la stessa persona una volta sola');

  sid := public.record_past_shift(tests.id('V1'), d, '18:00', '23:00', 30, 'Sera',
    '  Dimenticato in agenda  ', one);
  perform tests.logout();

  select * into sh from public.shifts where id = sid;
  select * into asg from public.shift_assignments where shift_id = sid;
  perform tests.ok(sh.recorded_at is not null, 'il turno è marcato come registrato');
  perform tests.eq(sh.recorded_by, tests.id('Co2'), 'da chi l''ha registrato');
  perform tests.eq(sh.description, 'Dimenticato in agenda', 'con la nota');
  perform tests.eq(sh.break_minutes, 30, 'e la pausa');
  perform tests.ok(not sh.unplanned, 'non è un fuori turno da timbratura');
  perform tests.eq(asg.status::text, 'confirmed', 'la persona risulta presente');
  perform tests.eq(asg.hours_source, 'manual_auto', 'le ore sono quelle del turno');
  perform tests.ok(asg.worked_hours is null, 'senza ore scritte a mano');
  perform tests.eq((select count(*) from public.notifications where related_id = sid),
    0::bigint, 'nessuna notifica di default');

  perform tests.login('Co2');
  perform tests.eq((select sum(approved_hours) from public.get_workspace_hours_summary(
      tests.id('W1'), d, d + 1) where member_id = tests.id('M_Emp')),
    4.5::numeric, 'le ore contano subito, pausa non retribuita esclusa, anche con la timbratura');

  -- Chi registra può chiedere di avvisare: un messaggio che dice cosa è
  -- successo, non «conferma la presenza».
  sid := public.record_past_shift(tests.id('V1'), d - 1, '12:00', '15:00', 0, 'Pranzo',
    null, one, true);
  perform tests.logout();
  perform tests.eq((select count(*) from public.notifications
                     where related_id = sid and user_id = tests.id('Emp') and title = 'Turno registrato'),
    1::bigint, 'con p_notify la persona viene avvisata');

  -- Il titolare registra anche le proprie ore.
  perform tests.login('Ow');
  sid := public.record_past_shift(tests.id('V1'), d, '09:00', '12:00', 0, 'Mattina', null,
    jsonb_build_array(jsonb_build_object('venue_member_id', vm_ow)));
  perform tests.ok(sid is not null, 'il titolare registra il proprio turno');
end $$;

rollback;
select 'record past shift: ok' as result;
