-- B03: nelle ore definitive, un turno sovrapposto toglie ore a un turno Manuale
-- automatico solo se a sua volta conta come Manuale automatico. Un turno che
-- contribuisce zero (App senza timbratura approvata) non erode il lavoro valido.
begin;

-- Il consuntivo di Emp in un intervallo di giorni.
create function tests.emp_hours(p_from date, p_to date)
returns table (approved numeric, planned numeric, to_review integer)
language sql as $$
  select coalesce(sum(s.approved_hours), 0), coalesce(sum(s.hours), 0),
         coalesce(sum(s.to_review_count), 0)::integer
    from public.get_workspace_hours_summary(tests.id('W1'), p_from, p_to) s
   where s.member_id = tests.id('M_Emp');
$$;
grant execute on function tests.emp_hours(date, date) to authenticated;

create function tests.shift(p_vm uuid, p_venue uuid, p_date date, p_start text, p_end text)
returns uuid language plpgsql as $$
declare ids uuid[]; v_id uuid;
begin
  ids := public.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', p_venue, 'title', 'Sovrapposizione',
    'date', p_date::text, 'start_time', p_start, 'end_time', p_end,
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', p_vm)))));
  select id into v_id from public.shift_assignments where shift_id = ids[1];
  return v_id;
end $$;
grant execute on function tests.shift(uuid, uuid, date, text, text) to authenticated;

do $$
declare
  vm1 uuid;
  vm2 uuid;
  d date := current_date - 40;
  a1 uuid;
  a2 uuid;
  absence uuid;
begin
  perform tests.login('Ow');
  select id into vm1 from public.venue_members
   where member_id = tests.id('M_Emp') and venue_id = tests.id('V1');
  vm2 := public.set_member_venue(tests.id('M_Emp'), tests.id('V2'));

  -- Manuale + Manuale: la deduplicazione resta (09–17 + 13–19 = 10 h, non 14).
  perform tests.shift(vm1, tests.id('V1'), d, '09:00', '17:00');
  perform tests.shift(vm2, tests.id('V2'), d, '13:00', '19:00');
  perform tests.eq((select approved from tests.emp_hours(d, d + 1)), 10::numeric,
    'due turni Manuali sovrapposti contano l''unione');

  -- Il collaboratore con Ore solo su V1 non vede V2, che non gli toglie nulla.
  perform public.set_member_access(tests.id('M_Co'), 'collaborator', '{"hours":true}'::jsonb,
    'selected', array[tests.id('V1')]);
  perform tests.login('Co');
  perform tests.eq((select approved from tests.emp_hours(d, d + 1)), 8::numeric,
    'una sede fuori ambito non erode le ore della sede visibile');
  perform tests.login('Ow');

  -- Sovrapposizione completa con un turno App senza timbratura. A parità di
  -- inizio la vecchia regola sottraeva al turno con l'id minore: si rende App
  -- quello con l'id maggiore, così il caso è deterministico.
  a1 := tests.shift(vm1, tests.id('V1'), d + 1, '09:00', '17:00');
  a2 := tests.shift(vm2, tests.id('V2'), d + 1, '09:00', '17:00');
  perform tests.logout();
  update public.shift_assignments set hours_source = 'clock_expected' where id = greatest(a1, a2);
  update public.shift_assignments set hours_source = 'manual_auto' where id = least(a1, a2);
  perform tests.login('Ow');
  perform tests.eq((select approved from tests.emp_hours(d + 1, d + 2)), 8::numeric,
    'un turno App senza timbratura non cancella il turno Manuale sovrapposto');
  perform tests.eq((select planned from tests.emp_hours(d + 1, d + 2)), 8::numeric,
    'il programmato resta l''unione degli intervalli');
  absence := public.record_absence(tests.id('M_Emp'), 'ferie', d + 1, d + 1);
  perform public.set_absence_hour_credit(absence, d + 1, 480);
  perform tests.eq((select conflict_hours from public.get_workspace_absence_summary(
    tests.id('W1'), d + 1, d + 2) where member_id = tests.id('M_Emp')),
    8::numeric, 'il credito ferie resta in conflitto con il lavoro Manuale');

  -- Da qui V2 rileva con l'App.
  perform public.set_member_clock_method(vm2, 'app');

  -- Sovrapposizione parziale con un turno App senza timbratura.
  perform tests.shift(vm1, tests.id('V1'), d + 2, '09:00', '17:00');
  perform tests.shift(vm2, tests.id('V2'), d + 2, '13:00', '17:00');
  perform tests.eq((select approved from tests.emp_hours(d + 2, d + 3)), 8::numeric,
    'il turno App senza timbratura non toglie 4 ore al Manuale');

  -- App con timbratura ancora da approvare: separata, non sottrae.
  perform tests.shift(vm1, tests.id('V1'), d + 3, '09:00', '17:00');
  a2 := tests.shift(vm2, tests.id('V2'), d + 3, '13:00', '17:00');
  perform tests.logout();
  insert into public.shift_clock_records(assignment_id, shift_id, venue_id, venue_member_id,
    method, clock_in_at, clock_out_at)
  select a2, a.shift_id, tests.id('V2'), vm2, 'app',
         ((d + 3)::timestamp + time '13:00') at time zone 'Europe/Rome',
         ((d + 3)::timestamp + time '17:00') at time zone 'Europe/Rome'
    from public.shift_assignments a where a.id = a2;
  perform tests.login('Ow');
  perform tests.eq((select approved from tests.emp_hours(d + 3, d + 4)), 8::numeric,
    'la timbratura da approvare non erode il Manuale');
  perform tests.eq((select to_review from tests.emp_hours(d + 3, d + 4)), 1,
    'la timbratura resta da verificare');

  -- Approvata: valori espliciti, decisione corrente invariata (si sommano).
  perform public.approve_clock_record(a2);
  perform tests.eq((select approved from tests.emp_hours(d + 3, d + 4)), 12::numeric,
    'la timbratura approvata si somma al Manuale come prima');

  -- Turni annullati, rifiutati o mancati non sottraggono nulla.
  perform tests.shift(vm1, tests.id('V1'), d + 4, '09:00', '17:00');
  a2 := tests.shift(vm2, tests.id('V2'), d + 4, '13:00', '17:00');
  perform public.set_shift_status((select shift_id from public.shift_assignments where id = a2), 'cancelled');
  perform tests.shift(vm1, tests.id('V1'), d + 5, '09:00', '17:00');
  a2 := tests.shift(vm2, tests.id('V2'), d + 5, '13:00', '17:00');
  perform public.record_attendance(a2, '{"status":"no_show"}'::jsonb);
  perform tests.eq((select approved from tests.emp_hours(d + 4, d + 6)), 16::numeric,
    'annullati e mancati non erodono le ore');

  -- Giorni adiacenti: notte Manuale 22–06 e mattina App 04–08 del giorno dopo.
  perform tests.shift(vm1, tests.id('V1'), d + 6, '22:00', '06:00');
  perform tests.shift(vm2, tests.id('V2'), d + 7, '04:00', '08:00');
  perform tests.eq((select approved from tests.emp_hours(d + 6, d + 8)), 8::numeric,
    'il turno App del mattino non erode la notte Manuale');

  -- Giorni adiacenti fra due Manuali: la deduplicazione vale anche a cavallo.
  perform public.set_member_clock_method(vm2, null);
  perform tests.shift(vm1, tests.id('V1'), d + 8, '22:00', '06:00');
  perform tests.shift(vm2, tests.id('V2'), d + 9, '04:00', '08:00');
  perform tests.eq((select approved from tests.emp_hours(d + 8, d + 10)), 10::numeric,
    'due Manuali a cavallo della mezzanotte contano l''unione');

  perform tests.logout();
end $$;
rollback;
