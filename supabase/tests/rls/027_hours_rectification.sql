-- B02: la rettifica delle ore conserva il metodo con cui il turno si è svolto,
-- anche dopo un cambio di metodo della persona o della sede.
begin;

-- Il consuntivo di Emp in un giorno solo: ore definitive, escluse e turni.
create function tests.emp_day(p_day date)
returns table (approved numeric, untracked numeric, shifts integer)
language sql as $$
  select coalesce(sum(s.approved_hours), 0), coalesce(sum(s.untracked_hours), 0),
         coalesce(sum(s.shifts_count), 0)::integer
    from public.get_workspace_hours_summary(tests.id('W1'), p_day, p_day + 1) s
   where s.member_id = tests.id('M_Emp');
$$;

create function tests.source(p_assignment uuid) returns text
language sql security definer as $$
  select hours_source from public.shift_assignments where id = p_assignment;
$$;

grant execute on function tests.emp_day(date), tests.source(uuid) to authenticated;

do $$
declare
  vm uuid;
  d_manual date := current_date - 20;
  d_app date := current_date - 22;
  d_legacy date := current_date - 24;
  a_manual uuid;
  a_app uuid;
  a_legacy uuid;
  absence uuid;
  r public.shift_assignments;
  shift_ids uuid[];
begin
  perform tests.login('Ow');
  select id into vm from public.venue_members
   where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');

  -- Un turno svolto con il metodo Manuale (quello della sede di default).
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Manuale poi App',
    'date', d_manual::text, 'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select id into a_manual from public.shift_assignments where shift_id = shift_ids[1];
  perform tests.eq((select approved from tests.emp_day(d_manual)), 6::numeric,
    'il turno Manuale concluso vale 6 ore');

  perform public.set_member_clock_method(vm, 'app');
  perform tests.eq(tests.source(a_manual), 'manual_auto', 'il cambio a App congela il turno Manuale');

  -- Rettifica dopo il cambio: il turno resta Manuale.
  perform public.record_attendance(a_manual, '{"worked_hours":5}'::jsonb);
  perform tests.eq(tests.source(a_manual), 'manual', 'la rettifica resta Manuale dopo il cambio a App');
  perform tests.eq((select approved from tests.emp_day(d_manual)), 5::numeric,
    'la rettifica del turno Manuale storico è definitiva');
  perform tests.eq((select untracked from tests.emp_day(d_manual)), 0::numeric,
    'la rettifica del turno Manuale storico non è «senza timbratura»');

  -- Le ferie nello stesso giorno sono in conflitto con il lavoro rettificato.
  absence := public.record_absence(tests.id('M_Emp'), 'ferie', d_manual, d_manual);
  perform public.set_absence_hour_credit(absence, d_manual, 360);
  perform tests.eq((select conflict_hours from public.get_workspace_absence_summary(
    tests.id('W1'), d_manual, d_manual + 1) where member_id = tests.id('M_Emp')),
    6::numeric, 'il lavoro Manuale rettificato tiene in conflitto il credito ferie');

  -- Togliere la rettifica riporta alle ore automatiche del metodo Manuale.
  perform public.record_attendance(a_manual, '{"worked_hours":null}'::jsonb);
  perform tests.eq(tests.source(a_manual), 'manual_auto', 'tolta la rettifica il turno torna Manuale automatico');
  perform tests.eq((select approved from tests.emp_day(d_manual)), 6::numeric,
    'tolta la rettifica tornano le 6 ore pianificate');

  -- Zero non è «nessun valore».
  perform public.record_attendance(a_manual, '{"worked_hours":0}'::jsonb);
  perform tests.eq(tests.source(a_manual), 'manual', 'zero ore è una rettifica, non un reset');
  perform tests.eq((select approved from tests.emp_day(d_manual)), 0::numeric, 'zero ore restano zero');
  perform tests.eq((select shifts from tests.emp_day(d_manual)), 1, 'il turno a zero ore resta nel riepilogo');

  -- Una patch solo di stato non tocca la fonte.
  perform public.record_attendance(a_manual, '{"status":"confirmed"}'::jsonb);
  perform tests.eq(tests.source(a_manual), 'manual', 'la patch di stato non cambia la fonte');

  -- Chi ha «Ore» rettifica con la stessa regola; il dipendente no.
  perform tests.login('Co2');
  perform public.record_attendance(a_manual, '{"worked_hours":4}'::jsonb);
  perform tests.eq(tests.source(a_manual), 'manual', 'il collaboratore con Ore conserva il metodo storico');
  perform tests.login('Emp');
  perform tests.raises(format('select public.record_attendance(%L, ''{"worked_hours": 8}'')', a_manual),
    'not_allowed', 'il dipendente non rettifica le proprie ore');
  perform tests.login('Ow');
  perform tests.eq((select approved from tests.emp_day(d_manual)), 4::numeric,
    'vale la rettifica del collaboratore con Ore');

  -- Verso opposto: un turno App passato non diventa Manuale con il cambio di metodo.
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'App poi Manuale',
    'date', d_app::text, 'start_time', '09:00', 'end_time', '13:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select id into a_app from public.shift_assignments where shift_id = shift_ids[1];
  perform public.set_member_clock_method(vm, 'manual');
  perform tests.eq(tests.source(a_app), 'clock_expected', 'il cambio a Manuale congela il turno App');

  r := public.record_attendance(a_app, '{"worked_hours":4}'::jsonb);
  perform tests.eq((select approved from tests.emp_day(d_app)), 0::numeric,
    'rettificare un turno App dopo il cambio a Manuale non lo approva');
  perform tests.eq((select untracked from tests.emp_day(d_app)), 4::numeric,
    'le ore del turno App rettificato restano da verificare');
  perform public.record_attendance(a_app, '{"worked_hours":null}'::jsonb);
  perform tests.eq(tests.source(a_app), 'clock_expected', 'tolta la rettifica il turno resta App');
  perform tests.eq((select approved from tests.emp_day(d_app)), 0::numeric,
    'tolta la rettifica il turno App non entra con le ore pianificate');

  -- Righe senza fonte ma con ore: scritte con un metodo che non era Manuale.
  perform public.set_member_clock_method(vm, 'app');
  shift_ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Ore App senza fonte',
    'date', d_legacy::text, 'start_time', '09:00', 'end_time', '12:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select id into a_legacy from public.shift_assignments where shift_id = shift_ids[1];
  perform public.record_attendance(a_legacy, '{"worked_hours":3}'::jsonb);
  perform tests.eq(tests.source(a_legacy), null::text, 'le ore App senza timbratura non hanno fonte');
  perform public.set_member_clock_method(vm, 'manual');
  perform public.record_attendance(a_legacy, '{"worked_hours":2}'::jsonb);
  perform tests.eq((select approved from tests.emp_day(d_legacy)), 0::numeric,
    'le ore scritte con il metodo App non diventano Manuali dopo il cambio');
  perform public.record_attendance(a_legacy, '{"worked_hours":null}'::jsonb);
  perform tests.eq(tests.source(a_legacy), 'clock_expected', 'tolte, il turno resta App');
  perform tests.eq((select approved from tests.emp_day(d_legacy)), 0::numeric,
    'tolte, il turno App non entra con le ore pianificate');

  -- Un turno non ancora congelato segue il metodo corrente, come prima.
  perform public.set_member_clock_method(vm, null);
  perform tests.logout();
end $$;
rollback;
