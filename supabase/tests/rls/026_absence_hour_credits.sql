-- Le ore riconosciute sono separate dalle ore lavorate e protette da Ore.
begin;
do $$
declare
  a uuid;
  sick uuid;
  conflict_absence uuid;
  shift_ids uuid[];
  assignment_id uuid;
  venue_member_id uuid;
  manual_absence uuid;
begin
  perform tests.login('Ow');
  a := public.record_absence(tests.id('M_Emp'), 'ferie', current_date + 10, current_date + 11);
  sick := public.record_absence(tests.id('M_Emp2'), 'malattia', current_date + 10, current_date + 10);
  perform tests.eq((select ferie_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date + 10, current_date + 12) where member_id = tests.id('M_Emp')),
    0::numeric, 'due giorni di ferie non diventano automaticamente sedici ore');

  perform public.set_absence_hour_credit(a, current_date + 10, 480);
  perform public.set_absence_hour_credit(sick, current_date + 10, 480);
  perform tests.eq((select ferie_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date + 10, current_date + 12) where member_id = tests.id('M_Emp')),
    8::numeric, 'solo il giorno quantificato contribuisce alle ferie');
  perform tests.eq((select malattia_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date + 10, current_date + 12) where member_id = tests.id('M_Emp2')),
    8::numeric, 'la malattia ha la sua colonna in ore');
  -- Una presenza timbrata e approvata nello stesso giorno sospende il credito.
  conflict_absence := public.record_absence(tests.id('M_Emp'), 'ferie', current_date - 3, current_date - 3);
  select id into venue_member_id from public.venue_members
    where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Presenza con assenza',
    'date', (current_date - 3)::text, 'start_time', '09:00', 'end_time', '17:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', venue_member_id)))));
  select id into assignment_id from public.shift_assignments where shift_id = shift_ids[1];
  perform tests.logout();
  insert into public.shift_clock_records(assignment_id, shift_id, venue_id, venue_member_id,
    method, clock_in_at, clock_out_at)
  values (assignment_id, shift_ids[1], tests.id('V1'), venue_member_id, 'app',
    ((current_date - 3)::timestamp + time '09:00') at time zone 'Europe/Rome',
    ((current_date - 3)::timestamp + time '17:00') at time zone 'Europe/Rome');
  update public.shift_assignments set worked_hours = 8, attendance_reviewed_at = now(),
    attendance_reviewed_by = tests.id('Ow') where id = assignment_id;
  perform tests.login('Ow');
  perform public.set_absence_hour_credit(conflict_absence, current_date - 3, 480);
  perform tests.eq((select conflict_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date - 3, current_date - 2) where member_id = tests.id('M_Emp')),
    8::numeric, 'il credito in conflitto è da verificare');
  perform tests.eq((select ferie_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date - 3, current_date - 2) where member_id = tests.id('M_Emp')),
    0::numeric, 'il credito in conflitto non entra nel totale');
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 3, current_date - 2) where member_id = tests.id('M_Emp') limit 1),
    8::numeric, 'il lavoro timbrato rimane nelle ore effettive');
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Presenza solo manuale',
    'date', (current_date - 4)::text, 'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', venue_member_id)))));
  select id into assignment_id from public.shift_assignments where shift_id = shift_ids[1];
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp') limit 1),
    6::numeric, 'il turno Manuale concluso entra automaticamente con la durata pianificata');
  perform public.record_attendance(assignment_id, '{"worked_hours":5}'::jsonb);
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp') limit 1),
    5::numeric, 'chi gestisce può correggere le ore automatiche del metodo Manuale');
  perform tests.eq((select shifts_count from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp') limit 1),
    1::integer, 'il turno consuntivato manualmente conta nel riepilogo');
  perform tests.eq((select untracked_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp') limit 1),
    0::numeric, 'le ore del metodo Manuale non sono senza timbratura');
  manual_absence := public.record_absence(tests.id('M_Emp'), 'ferie', current_date - 4, current_date - 4);
  perform public.set_absence_hour_credit(manual_absence, current_date - 4, 360);
  perform tests.eq((select conflict_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp')),
    6::numeric, 'lavoro manuale e ferie nello stesso giorno sono in conflitto');
  perform tests.eq((select ferie_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp')),
    0::numeric, 'le ferie in conflitto non si sommano al lavoro manuale');
  perform public.set_member_clock_method(venue_member_id, 'app');
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 4, current_date - 3) where member_id = tests.id('M_Emp') limit 1),
    5::numeric, 'il cambio di metodo non riscrive le ore manuali storiche');
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Turno App senza timbratura',
    'date', (current_date - 6)::text, 'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', venue_member_id)))));
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 6, current_date - 5) where member_id = tests.id('M_Emp') limit 1),
    0::numeric, 'il turno App senza timbratura non entra automaticamente');
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Presenza con metodo App',
    'date', (current_date - 5)::text, 'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', venue_member_id)))));
  select id into assignment_id from public.shift_assignments where shift_id = shift_ids[1];
  perform public.record_attendance(assignment_id, '{"worked_hours":6}'::jsonb);
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 5, current_date - 4) where member_id = tests.id('M_Emp') limit 1),
    0::numeric, 'le ore senza timbratura per il metodo App restano fuori dal consuntivo');
  perform tests.eq((select untracked_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 5, current_date - 4) where member_id = tests.id('M_Emp') limit 1),
    6::numeric, 'le ore senza timbratura per il metodo App sono da verificare');
  perform public.set_member_clock_method(venue_member_id, 'manual');
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 5, current_date - 4) where member_id = tests.id('M_Emp') limit 1),
    0::numeric, 'il cambio a Manuale non approva ore del metodo App già registrate');
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 6, current_date - 5) where member_id = tests.id('M_Emp') limit 1),
    0::numeric, 'il cambio a Manuale non trasforma turni App passati in ore lavorate');
  perform public.set_member_clock_method(venue_member_id, null);
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Turno Manuale ereditato dalla sede',
    'date', (current_date - 7)::text, 'start_time', '09:00', 'end_time', '13:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', venue_member_id)))));
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 7, current_date - 6) where member_id = tests.id('M_Emp') limit 1),
    4::numeric, 'anche il metodo Manuale ereditato dalla sede conta il turno concluso');
  manual_absence := public.record_absence(tests.id('M_Emp'), 'ferie', current_date - 7, current_date - 7);
  perform public.set_absence_hour_credit(manual_absence, current_date - 7, 240);
  perform tests.eq((select conflict_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date - 7, current_date - 6) where member_id = tests.id('M_Emp')),
    4::numeric, 'anche le ore manuali automatiche sospendono il credito ferie in conflitto');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 7, current_date - 6) where member_id = tests.id('M_Emp') limit 1),
    4::numeric, 'cambiare il metodo della sede non riscrive il turno Manuale passato');
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Turno App ereditato dalla sede',
    'date', (current_date - 8)::text, 'start_time', '09:00', 'end_time', '13:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', venue_member_id)))));
  perform public.set_venue_clock_method(tests.id('V1'), 'manual');
  perform tests.eq((select approved_hours from public.get_workspace_hours_summary(
    tests.id('W1'), current_date - 8, current_date - 7) where member_id = tests.id('M_Emp') limit 1),
    0::numeric, 'cambiare la sede a Manuale non attribuisce ore ai turni App passati');
  perform tests.eq((select count(*) from public.get_absence_hour_credits(a)),
    1::bigint, 'chi ha Ore legge i crediti');
  perform tests.raises(format('select public.set_absence_hour_credit(%L, %L, 480)', a, current_date + 9),
    'not_allowed', 'nessun credito fuori dall''intervallo');

  perform tests.login('Co');
  perform tests.raises(format('select public.set_absence_hour_credit(%L, %L, 480)', a, current_date + 11),
    'not_allowed', 'Turni senza Ore non decide i crediti');
  perform tests.eq((select count(*) from public.get_absence_hour_credits(a)),
    0::bigint, 'Turni senza Ore non legge i crediti');
  perform tests.login('Emp');
  perform tests.raises(format('select public.set_absence_hour_credit(%L, %L, 480)', a, current_date + 11),
    'not_allowed', 'il professionista non decide le proprie ferie');
  perform tests.login('Ow');
  perform public.set_absence_hour_credit(a, current_date + 10, null);
  perform tests.eq((select ferie_hours from public.get_workspace_absence_summary(
    tests.id('W1'), current_date + 10, current_date + 12) where member_id = tests.id('M_Emp')),
    0::numeric, 'rimuovere il credito ripristina zero ore riconosciute');
end $$;
rollback;
