-- Le ore del dipendente con le regole della sede (revisione E02): una riga dello
-- storico personale conta esattamente quando la conta il riepilogo, e se non
-- conta dice lo stesso motivo di «Ore da sistemare». Più chi ha inserito o
-- corretto gli orari (E09).
begin;

do $$
declare
  vm uuid;
  vm2 uuid;
  d date := current_date - 3;
  ids uuid[];
  later uuid[];
  a_none uuid;
  a_open uuid;
  a_pending uuid;
  a_done uuid;
  a_fixed uuid;
  rec_fixed uuid;
  my_counted numeric;
  my_counted_rows integer;
  my_pending integer;
  t record;
  summary record;
  to_fix integer;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');

  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Mattina', 'date', d::text,
      'start_time', '06:00', 'end_time', '08:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Pranzo', 'date', d::text,
      'start_time', '09:00', 'end_time', '12:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Pomeriggio', 'date', d::text,
      'start_time', '13:00', 'end_time', '16:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Sera', 'date', d::text,
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Sera V2', 'date', d::text,
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  later := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Corretto', 'date', (d - 1)::text,
      'start_time', '18:00', 'end_time', '22:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select a.id into a_none from public.shift_assignments a where a.shift_id = ids[1];
  select a.id into a_open from public.shift_assignments a where a.shift_id = ids[2];
  select a.id into a_pending from public.shift_assignments a where a.shift_id = ids[3];
  select a.id into a_done from public.shift_assignments a where a.shift_id = ids[4];
  select a.id into a_fixed from public.shift_assignments a where a.shift_id = later[1];
  perform tests.logout();

  -- Timbrature dal telefono: senza uscita, completa da approvare, e una che la
  -- sede corregge e approva.
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at)
  values (a_open, ids[2], tests.id('V1'), vm, 'app', (d + time '09:00') at time zone 'Europe/Rome');
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  values (a_pending, ids[3], tests.id('V1'), vm, 'app',
          (d + time '13:00') at time zone 'Europe/Rome', (d + time '16:00') at time zone 'Europe/Rome');
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  values (a_fixed, later[1], tests.id('V1'), vm, 'app',
          ((d - 1) + time '18:00') at time zone 'Europe/Rome', ((d - 1) + time '23:40') at time zone 'Europe/Rome')
  returning id into rec_fixed;

  perform tests.login('Co2');
  perform public.enter_clock_record(a_done, (d + time '18:00') at time zone 'Europe/Rome',
    (d + time '23:30') at time zone 'Europe/Rome', null);
  perform public.correct_clock_record(rec_fixed, null,
    ((d - 1) + time '22:00') at time zone 'Europe/Rome', 'uscita reale alle 22');
  perform public.approve_clock_record(a_fixed);

  -- Il lato sede, da confrontare.
  select coalesce(sum(s.shifts_count), 0) as shifts_count, coalesce(sum(s.approved_hours), 0) as approved_hours
    into summary
    from public.get_workspace_hours_summary(tests.id('W1'), d - 1, d + 1) s
   where s.member_id = tests.id('M_Emp');
  select count(*)::integer into to_fix from public.get_hours_to_fix(tests.id('W1'), d - 1, d + 1)
   where member_id = tests.id('M_Emp');

  -- Il lato dipendente.
  perform tests.login('Emp');
  perform tests.eq((select counts from public.get_my_work_history_range(d - 1, d) where title = 'Mattina'),
    false, 'non timbrato: non conta');
  perform tests.eq((select pending_reason from public.get_my_work_history_range(d - 1, d) where title = 'Mattina'),
    'not_clocked', 'e dice perché');
  perform tests.eq((select hours from public.get_my_work_history_range(d - 1, d) where title = 'Mattina'),
    2::numeric, 'con le ore del turno, in attesa');
  perform tests.eq((select pending_reason from public.get_my_work_history_range(d - 1, d) where title = 'Pranzo'),
    'missing_out', 'uscita mancante');
  perform tests.eq((select pending_reason from public.get_my_work_history_range(d - 1, d) where title = 'Pomeriggio'),
    'to_approve', 'da approvare');
  perform tests.eq((select hours from public.get_my_work_history_range(d - 1, d) where title = 'Pomeriggio'),
    3::numeric, 'con le ore proposte');
  perform tests.eq((select counts from public.get_my_work_history_range(d - 1, d) where title = 'Sera'),
    true, 'gli orari inseriti dalla sede contano');
  perform tests.eq((select hours from public.get_my_work_history_range(d - 1, d) where title = 'Sera'),
    5.5::numeric, 'con le ore inserite');
  perform tests.eq((select clock_edit from public.get_my_work_history_range(d - 1, d) where title = 'Sera'),
    'entered', 'e si sa che li ha inseriti la sede');
  perform tests.eq((select hours from public.get_my_work_history_range(d - 1, d) where title = 'Corretto'),
    4::numeric, 'la correzione approvata vale');
  perform tests.eq((select clock_edit from public.get_my_work_history_range(d - 1, d) where title = 'Corretto'),
    'corrected', 'e si sa che la sede ha corretto');
  perform tests.eq((select clock_edit_reason from public.get_my_work_history_range(d - 1, d) where title = 'Corretto'),
    'uscita reale alle 22', 'con il motivo');
  perform tests.eq((select clock_edit from public.get_my_work_history_range(d - 1, d) where title = 'Pomeriggio'),
    null::text, 'una timbratura non toccata resta sua');

  select coalesce(sum(hours) filter (where counts), 0),
         (count(*) filter (where counts))::integer,
         (count(*) filter (where not counts))::integer
    into my_counted, my_counted_rows, my_pending
    from public.get_my_work_history_range(d - 1, d);
  perform tests.eq(my_counted, summary.approved_hours, 'ore che contano = ore approvate del riepilogo');
  perform tests.eq(my_counted_rows, summary.shifts_count::integer, 'turni che contano = turni contati dal riepilogo');
  perform tests.eq(my_pending, to_fix, 'righe in attesa = righe di «Ore da sistemare»');

  select * into t from public.get_my_work_totals(d - 1, d);
  perform tests.eq(t.total_count, 5, 'turni svolti: tutti');
  perform tests.eq(t.total_hours, 9.5::numeric, 'ore: solo quelle che contano');
  perform tests.eq(t.pending_count, 3, 'tre in attesa della sede');
  perform tests.eq(t.pending_hours, 8::numeric, 'con le loro ore a parte');
  perform tests.eq((select total_hours from public.get_my_work_history_totals()), 9.5::numeric,
    'lo stesso da sempre');

  -- Senza timbratura il turno concluso conta da sé.
  perform tests.login('Emp2');
  perform tests.eq((select counts from public.get_my_work_history_range(d, d) where title = 'Sera V2'),
    true, 'sede senza timbratura: conta');
  perform tests.eq((select pending_reason from public.get_my_work_history_range(d, d) where title = 'Sera V2'),
    null::text, 'senza motivo di attesa');
end $$;

rollback;
select 'my work history: ok' as result;
