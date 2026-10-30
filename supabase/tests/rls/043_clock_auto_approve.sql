-- Approvare le timbrature in orario: in blocco dalla pagina Ore, oppure da sole
-- all'uscita se la sede lo sceglie. Fuori orario, corrette o di un
-- collaboratore restano sempre da guardare a mano.
begin;

do $$
declare
  vm uuid;
  vm_co uuid;
  ids uuid[];
  a_manual uuid;
  a_auto uuid;
  a_long uuid;
  a_co uuid;
  rec public.shift_clock_records;
  row public.shift_assignments;
  today date := public.local_now()::date;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm_co from public.venue_members x
   where x.member_id = tests.id('M_Co') and x.venue_id = tests.id('V1');

  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'A', 'date', today::text,
      'start_time', '00:00', 'end_time', '08:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'B', 'date', today::text,
      'start_time', '08:00', 'end_time', '16:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'C', 'date', today::text,
      'start_time', '16:00', 'end_time', '22:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'D', 'date', today::text,
      'start_time', '00:00', 'end_time', '08:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_co)))));
  select id into a_manual from public.shift_assignments where shift_id = ids[1];
  select id into a_auto from public.shift_assignments where shift_id = ids[2];
  select id into a_long from public.shift_assignments where shift_id = ids[3];
  select id into a_co from public.shift_assignments where shift_id = ids[4];

  -- 1. Sede senza automatico: 8 ore timbrate su un turno di 8, resta da approvare.
  perform tests.login('Emp');
  rec := public.clock_punch(a_manual, 'in');
  perform set_config('role', 'postgres', true);
  update public.shift_clock_records set clock_in_at = clock_timestamp() - interval '8 hours' where id = rec.id;
  perform tests.login('Emp');
  perform public.clock_punch(a_manual, 'out');
  select * into row from public.shift_assignments where id = a_manual;
  perform tests.ok(row.attendance_reviewed_at is null, 'senza l''impostazione nessuna approvazione da sola');

  -- In blocco: conta chi ha «Ore», non chi ha solo «Turni».
  perform tests.login('Co');
  perform tests.eq(public.approve_regular_clock_records(tests.id('W1'), today, today, true), 0,
    'Turni non basta per approvare le ore');
  perform tests.login('Ow');
  perform tests.eq(public.approve_regular_clock_records(tests.id('W1'), today, today, true), 1,
    'una timbratura in orario da approvare');
  perform tests.raises(format('select public.approve_regular_clock_records(%L, %L, %L)', tests.id('W1'), today, today - 1),
    'invalid_period', 'periodo rovesciato');
  perform tests.eq(public.approve_regular_clock_records(tests.id('W1'), today, today), 1, 'approvata in blocco');
  select * into row from public.shift_assignments where id = a_manual;
  perform tests.eq(row.attendance_reviewed_by, tests.id('Ow'), 'in blocco la approva una persona');
  perform tests.eq(row.attendance_auto_approved, false, 'e non risulta automatica');
  perform tests.eq(row.worked_hours, 8::numeric, 'con le ore della timbratura');
  perform tests.eq(public.approve_regular_clock_records(tests.id('W1'), today, today, true), 0,
    'una volta approvata non si riconta');

  -- 2. La sede accende l'automatico: lo può fare solo chi ha «Ore».
  perform tests.login('Co');
  perform tests.raises(format('select public.set_venue_clock_auto_approve(%L, true)', tests.id('V1')),
    'not_allowed', 'Turni non basta per l''automatico');
  perform tests.login('Ow');
  perform public.set_venue_clock_auto_approve(tests.id('V1'), true);

  perform tests.login('Emp');
  rec := public.clock_punch(a_auto, 'in');
  perform set_config('role', 'postgres', true);
  update public.shift_clock_records set clock_in_at = clock_timestamp() - interval '8 hours' where id = rec.id;
  perform tests.login('Emp');
  perform public.clock_punch(a_auto, 'out');
  select * into row from public.shift_assignments where id = a_auto;
  perform tests.ok(row.attendance_reviewed_at is not null, 'in orario: approvata all''uscita');
  perform tests.ok(row.attendance_reviewed_by is null, 'senza revisore');
  perform tests.eq(row.attendance_auto_approved, true, 'e si dice automatica');
  perform tests.eq(row.hours_source, 'clock', 'ore dalla timbratura');

  -- Una correzione di chi gestisce la rende una revisione umana.
  perform tests.login('Ow');
  perform public.correct_clock_record(rec.id, rec.clock_in_at - interval '8 hours' + interval '15 minutes', null, 'Arrivato dopo');
  select * into row from public.shift_assignments where id = a_auto;
  perform tests.eq(row.attendance_auto_approved, false, 'corretta: non più automatica');

  -- 3. Fuori orario (4 ore su 6): resta da guardare.
  perform tests.login('Emp');
  rec := public.clock_punch(a_long, 'in');
  perform set_config('role', 'postgres', true);
  update public.shift_clock_records set clock_in_at = clock_timestamp() - interval '4 hours' where id = rec.id;
  perform tests.login('Emp');
  perform public.clock_punch(a_long, 'out');
  select * into row from public.shift_assignments where id = a_long;
  perform tests.ok(row.attendance_reviewed_at is null, 'fuori orario resta da approvare');
  perform tests.login('Ow');
  perform tests.eq(public.approve_regular_clock_records(tests.id('W1'), today, today, true), 0,
    'e non entra nel blocco');

  -- 4. Le ore di un collaboratore non si approvano mai da sole.
  perform tests.login('Co');
  rec := public.clock_punch(a_co, 'in');
  perform set_config('role', 'postgres', true);
  update public.shift_clock_records set clock_in_at = clock_timestamp() - interval '8 hours' where id = rec.id;
  perform tests.login('Co');
  perform public.clock_punch(a_co, 'out');
  select * into row from public.shift_assignments where id = a_co;
  perform tests.ok(row.attendance_reviewed_at is null, 'il collaboratore resta da approvare');
end $$;

select tests.logout();
rollback;
