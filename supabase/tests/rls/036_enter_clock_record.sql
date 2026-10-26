-- Orari inseriti da chi gestisce: chi timbra dall'app e non l'ha fatto non
-- resta con un turno che non conta. La timbratura nasce già approvata, con
-- motivo e autore, e le ore entrano nel consuntivo.
begin;

do $$
declare
  vm uuid;
  d date := current_date - 3;
  ids uuid[];
  aid uuid;
  asg public.shift_assignments;
  rec public.shift_clock_records;
  t_in timestamptz;
  t_out timestamptz;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  t_in := (d + time '09:00') at time zone 'Europe/Rome';
  t_out := (d + time '17:30') at time zone 'Europe/Rome';

  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Giornata', 'date', d::text,
    'start_time', '09:00', 'end_time', '17:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))));
  select a.id into aid from public.shift_assignments a where a.shift_id = ids[1];

  perform tests.login('Co');
  perform tests.raises(format('select public.enter_clock_record(%L, %L, %L, ''x'')', aid, t_in, t_out),
    'not_allowed', 'con solo Turni non si inseriscono orari');

  perform tests.login('Co2');
  perform tests.raises(format('select public.enter_clock_record(%L, %L, %L, ''x'')',
      aid, t_in, now() + interval '1 hour'),
    'invalid_clock_interval', 'non nel futuro');
  perform tests.raises(format('select public.enter_clock_record(%L, %L, %L, ''x'')', aid, t_out, t_in),
    'invalid_clock_interval', 'l''uscita dopo l''entrata');

  asg := public.enter_clock_record(aid, t_in, t_out, '  Non ha timbrato, mezz''ora in più  ');
  perform tests.eq(asg.worked_hours, 8.5::numeric, 'le ore vengono dagli orari inseriti');
  perform tests.eq(asg.hours_source, 'clock', 'come una timbratura');
  perform tests.ok(asg.attendance_reviewed_at is not null, 'già approvata');
  perform tests.eq(asg.attendance_reviewed_by, tests.id('Co2'), 'da chi le ha inserite');
  perform tests.eq((select sum(approved_hours) from public.get_workspace_hours_summary(
      tests.id('W1'), d, d + 1) where member_id = tests.id('M_Emp')),
    8.5::numeric, 'e contano nel consuntivo, anche con la timbratura dall''app');

  perform tests.raises(format('select public.enter_clock_record(%L, %L, %L, ''x'')', aid, t_in, t_out),
    'clock_record_exists', 'una timbratura c''è già: si corregge quella');
  perform tests.logout();

  select * into rec from public.shift_clock_records where assignment_id = aid and voided_at is null;
  perform tests.eq(rec.method::text, 'manual', 'si vede che non viene dal telefono');
  perform tests.eq((select c.reason from public.shift_clock_corrections c where c.clock_record_id = rec.id),
    'Non ha timbrato, mezz''ora in più', 'con il motivo');
  perform tests.eq((select c.corrected_by from public.shift_clock_corrections c where c.clock_record_id = rec.id),
    tests.id('Co2'), 'e l''autore');
end $$;

rollback;
select 'enter clock record: ok' as result;
