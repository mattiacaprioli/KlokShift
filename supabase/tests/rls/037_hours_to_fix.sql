-- Ore da sistemare: ogni turno concluso che il riepilogo non conta compare qui,
-- con il perché — anche chi doveva timbrare e non l'ha fatto, che prima non
-- risultava da nessuna parte.
begin;

do $$
declare
  vm uuid;
  vm2 uuid;
  d date := current_date - 3;
  ids uuid[];
  a_none uuid;
  a_open uuid;
  a_pending uuid;
  a_done uuid;
  counted integer;
  total integer;
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
    -- V2 è senza timbratura: il turno concluso conta da sé.
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Sera V2', 'date', d::text,
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  select a.id into a_none from public.shift_assignments a where a.shift_id = ids[1];
  select a.id into a_open from public.shift_assignments a where a.shift_id = ids[2];
  select a.id into a_pending from public.shift_assignments a where a.shift_id = ids[3];
  select a.id into a_done from public.shift_assignments a where a.shift_id = ids[4];
  perform tests.logout();

  -- Timbrature dal telefono: una senza uscita, una completa da approvare.
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at)
  values (a_open, ids[2], tests.id('V1'), vm, 'app', (d + time '09:00') at time zone 'Europe/Rome');
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  values (a_pending, ids[3], tests.id('V1'), vm, 'app',
          (d + time '13:00') at time zone 'Europe/Rome', (d + time '16:00') at time zone 'Europe/Rome');

  perform tests.login('Co2');
  perform public.enter_clock_record(a_done, (d + time '18:00') at time zone 'Europe/Rome',
    (d + time '23:30') at time zone 'Europe/Rome', null);

  perform tests.eq((select kind from public.get_hours_to_fix(tests.id('W1'), d, d + 1)
                     where assignment_id = a_none), 'not_clocked',
    'chi doveva timbrare e non l''ha fatto ora si vede');
  perform tests.eq((select kind from public.get_hours_to_fix(tests.id('W1'), d, d + 1)
                     where assignment_id = a_open), 'missing_out', 'uscita mancante');
  perform tests.eq((select kind from public.get_hours_to_fix(tests.id('W1'), d, d + 1)
                     where assignment_id = a_pending), 'to_approve', 'da approvare');
  perform tests.eq((select hours from public.get_hours_to_fix(tests.id('W1'), d, d + 1)
                     where assignment_id = a_pending), 3::numeric, 'con le ore proposte');
  perform tests.eq((select count(*) from public.get_hours_to_fix(tests.id('W1'), d, d + 1)
                     where assignment_id = a_done), 0::bigint, 'gli orari inseriti contano già');
  perform tests.eq((select count(*) from public.get_hours_to_fix(tests.id('W1'), d, d + 1)
                     where venue_id = tests.id('V2')), 0::bigint, 'senza timbratura il turno conta da sé');

  -- Il complemento esatto del riepilogo: contate + da sistemare = tutte.
  select coalesce(sum(shifts_count), 0) into counted
    from public.get_workspace_hours_summary(tests.id('W1'), d, d + 1);
  perform tests.logout();
  select count(*) into total
    from public.shift_assignments a join public.shifts s on s.id = a.shift_id
    join public.venues v on v.id = s.venue_id
   where v.workspace_id = tests.id('W1') and s.date = d and s.status <> 'cancelled'
     and a.status not in ('declined', 'no_show');
  perform tests.login('Co2');
  perform tests.eq(counted + (select count(*)::integer from public.get_hours_to_fix(tests.id('W1'), d, d + 1)),
    total, 'contate + da sistemare = tutte le presenze concluse');

  -- È una lista di ore: chi ha solo Turni non la vede.
  perform tests.login('Co');
  perform tests.eq((select count(*) from public.get_hours_to_fix(tests.id('W1'), d, d + 1)),
    0::bigint, 'senza Ore la lista è vuota');
end $$;

rollback;
select 'hours to fix: ok' as result;
