-- Il permesso a ore va in conflitto solo se il suo intervallo si sovrappone a un
-- intervallo di lavoro; i crediti a giornata (ferie, malattia) restano sulla
-- regola dei giorni. Ogni caso ha il suo giorno, così le somme non si mescolano.
begin;

do $$
declare
  vm2 uuid;
  vm1 uuid;
  d date;
  ids uuid[];
  s record;
begin
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');

  perform tests.login('Ow');

  -- 1. I bordi che si toccano non sono un conflitto (V2: il turno finito conta da sé).
  d := current_date - 30;
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Giorno', 'date', d::text,
    'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  perform public.record_absence(tests.id('M_Emp2'), 'permesso', d, d, '15:00', '17:00');
  select * into s from public.get_workspace_absence_summary(tests.id('W1'), d, d + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(s.permesso_recognized_hours, 2::numeric, 'permesso 15-17 dopo un turno 9-15: riconosciuto');
  perform tests.eq(s.conflict_hours, 0::numeric, 'i bordi che si toccano non sono un conflitto');

  -- 2. Sovrapposizione vera.
  d := current_date - 25;
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Giorno', 'date', d::text,
    'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  perform public.record_absence(tests.id('M_Emp2'), 'permesso', d, d, '14:00', '16:00');
  select * into s from public.get_workspace_absence_summary(tests.id('W1'), d, d + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(s.permesso_recognized_hours, 0::numeric, 'permesso 14-16 su un turno 9-15: non riconosciuto');
  perform tests.eq(s.conflict_hours, 2::numeric, 'permesso 14-16 su un turno 9-15: da verificare');

  -- 3. Turno notturno del giorno prima: il permesso del mattino presto non lo tocca...
  d := current_date - 20;
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Notte', 'date', (d - 1)::text,
    'start_time', '22:00', 'end_time', '04:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  perform public.record_absence(tests.id('M_Emp2'), 'permesso', d, d, '08:00', '10:00');
  select * into s from public.get_workspace_absence_summary(tests.id('W1'), d, d + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(s.conflict_hours, 0::numeric, 'permesso 8-10 dopo un turno notturno finito alle 4: nessun conflitto');
  perform tests.eq(s.permesso_recognized_hours, 2::numeric, 'permesso 8-10 dopo la notte: riconosciuto');

  -- 4. ...ma quello che cade dentro la notte sì.
  d := current_date - 15;
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Notte', 'date', (d - 1)::text,
    'start_time', '22:00', 'end_time', '04:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  perform public.record_absence(tests.id('M_Emp2'), 'permesso', d, d, '03:00', '05:00');
  select * into s from public.get_workspace_absence_summary(tests.id('W1'), d, d + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(s.conflict_hours, 2::numeric, 'permesso 3-5 dentro un turno notturno: conflitto');

  -- 5. Credito a giornata: resta la regola dei giorni.
  d := current_date - 10;
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V2'), 'title', 'Giorno', 'date', d::text,
    'start_time', '09:00', 'end_time', '17:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  perform public.set_absence_hour_credit(
    public.record_absence(tests.id('M_Emp2'), 'ferie', d, d), d, 480);
  select * into s from public.get_workspace_absence_summary(tests.id('W1'), d, d + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(s.conflict_hours, 8::numeric, 'ferie a giornata con un turno lo stesso giorno: da verificare');

  -- 6. Ogni credito si arrotonda al centesimo.
  d := current_date - 8;
  perform public.set_absence_hour_credit(
    public.record_absence(tests.id('M_Emp2'), 'ferie', d, d), d, 470);
  select * into s from public.get_workspace_absence_summary(tests.id('W1'), d, d + 1)
   where member_id = tests.id('M_Emp2');
  perform tests.eq(s.ferie_hours, 7.83::numeric, '470 minuti sono 7,83 ore');

  -- 7. Ramo della timbratura approvata: conta l'intervallo timbrato (09:00-16:30),
  --    non quello del turno (09:00-15:00). Sede V1 con timbratura dall'app.
  d := current_date - 40;
  select x.id into vm1 from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  ids := tests.create_shifts(jsonb_build_array(jsonb_build_object(
    'venue_id', tests.id('V1'), 'title', 'Giorno', 'date', d::text,
    'start_time', '09:00', 'end_time', '15:00',
    'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm1)))));
  perform public.enter_clock_record(
    (select x.id from public.shift_assignments x where x.shift_id = ids[1]),
    (d + time '09:00') at time zone 'Europe/Rome',
    (d + time '16:30') at time zone 'Europe/Rome', null);
  -- La funzione privata non è eseguibile dai ruoli app: si chiama da superuser.
  perform tests.logout();
  perform tests.eq(private.absence_hours_conflict(tests.id('M_Emp'), d, '16:00', '18:00'), true,
    'timbratura approvata 9-16:30: permesso 16-18 in conflitto');
  perform tests.eq(private.absence_hours_conflict(tests.id('M_Emp'), d, '16:30', '18:00'), false,
    'timbratura approvata 9-16:30: permesso 16:30-18 non in conflitto');
  perform tests.eq(private.absence_hours_conflict(tests.id('M_Emp'), d, '07:00', '09:00'), false,
    'timbratura approvata 9-16:30: permesso 7-9 non in conflitto');
end $$;

rollback;
