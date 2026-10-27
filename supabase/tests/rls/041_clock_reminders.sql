-- Promemoria di timbratura (revisione dipendente E10). Date future fisse e
-- l'istante passato a `private.queue_clock_reminders`: il risultato non dipende
-- dall'ora in cui gira il test.
begin;

do $$
declare
  vm uuid;
  vm2 uuid;
  d date := current_date + 2;
  d2 date := current_date + 3;
  sera uuid;
  pranzo uuid;
  rec uuid;
  n_sera integer;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');

  -- V1 timbra dall'app, V2 no.
  perform tests.login('Ow');
  perform public.set_venue_clock_method(tests.id('V1'), 'app');
  perform public.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Pranzo', 'dates', jsonb_build_array(d::text),
      'start_time', '12:00', 'end_time', '15:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Sera', 'dates', jsonb_build_array(d::text),
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Doppio', 'dates', jsonb_build_array(d::text),
      'start_time', '19:00', 'end_time', '20:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Annullato', 'dates', jsonb_build_array(d::text),
      'start_time', '09:00', 'end_time', '11:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'In ferie', 'dates', jsonb_build_array(d2::text),
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Sera V2', 'dates', jsonb_build_array(d::text),
      'start_time', '18:00', 'end_time', '23:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  perform public.set_shift_status((select id from public.shifts where title = 'Annullato' and date = d), 'cancelled');
  perform tests.logout();

  select id into sera from public.shifts where title = 'Sera' and date = d;
  select id into pranzo from public.shifts where title = 'Pranzo' and date = d;

  perform tests.eq(public.notification_category('clock_reminder'), 'reminders',
    'i promemoria si spengono a parte');
  perform tests.ok(not has_function_privilege('authenticated', 'private.queue_clock_reminders(timestamptz)', 'EXECUTE'),
    'nessun utente accoda promemoria');
  perform tests.ok(not has_function_privilege('authenticated', 'private.run_clock_reminders()', 'EXECUTE'),
    'né li fa partire');

  -- Turno annullato e turno già timbrato: niente.
  perform tests.eq(private.queue_clock_reminders((d + time '09:06') at time zone 'Europe/Rome'), 0,
    'un turno annullato non chiede l''entrata');
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  select a.id, pranzo, tests.id('V1'), vm, 'app',
         (d + time '11:58') at time zone 'Europe/Rome', (d + time '15:02') at time zone 'Europe/Rome'
    from public.shift_assignments a where a.shift_id = pranzo;
  perform tests.eq(private.queue_clock_reminders((d + time '12:06') at time zone 'Europe/Rome'), 0,
    'chi ha timbrato non riceve niente');

  -- Entrata: solo a chi se ne dimentica, 5 minuti dopo l'inizio, una volta.
  perform tests.eq(private.queue_clock_reminders((d + time '18:04') at time zone 'Europe/Rome'), 0,
    'prima dei 5 minuti niente');
  perform tests.eq(private.queue_clock_reminders((d + time '18:06') at time zone 'Europe/Rome'), 1,
    'dopo 5 minuti senza entrata, un promemoria');
  select count(*)::integer into n_sera from public.notifications
   where type = 'clock_reminder' and user_id = tests.id('Emp') and related_id = sera
     and title = 'Hai timbrato l''entrata?' and body like 'V1: il turno delle 18:00 è iniziato%';
  perform tests.eq(n_sera, 1, 'a Emma, sul turno, con l''orario');
  perform tests.eq((select count(*)::integer from public.notifications
                     where type = 'clock_reminder' and user_id = tests.id('Emp2')), 0,
    'dove non si timbra dall''app, niente');
  perform tests.eq(private.queue_clock_reminders((d + time '18:10') at time zone 'Europe/Rome'), 0,
    'mai due volte');

  -- Timbrare chiude il promemoria aperto.
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at)
  select a.id, sera, tests.id('V1'), vm, 'app', (d + time '18:07') at time zone 'Europe/Rome'
    from public.shift_assignments a where a.shift_id = sera
  returning id into rec;
  perform tests.ok((select read_at is not null from public.notifications
                     where type = 'clock_reminder' and related_id = sera),
    'l''entrata segna letto il promemoria');

  -- Già in servizio: il turno sovrapposto non chiede un'altra entrata.
  perform tests.eq(private.queue_clock_reminders((d + time '19:06') at time zone 'Europe/Rome'), 0,
    'con un''entrata aperta altrove, niente');

  -- Uscita: 20 minuti dopo la fine, una volta.
  perform tests.eq(private.queue_clock_reminders((d + time '23:15') at time zone 'Europe/Rome'), 0,
    'prima dei 20 minuti niente');
  perform tests.eq(private.queue_clock_reminders((d + time '23:21') at time zone 'Europe/Rome'), 1,
    'entrata ancora aperta: promemoria d''uscita');
  perform tests.ok(exists (select 1 from public.notifications
                            where type = 'clock_reminder' and related_id = sera and read_at is null
                              and title = 'Hai timbrato l''uscita?' and body like '%finito alle 23:00%'),
    'con l''orario di fine');
  perform tests.eq(private.queue_clock_reminders((d + time '23:30') at time zone 'Europe/Rome'), 0,
    'mai due volte');
  update public.shift_clock_records set clock_out_at = (d + time '23:31') at time zone 'Europe/Rome'
   where id = rec;
  perform tests.eq((select count(*)::integer from public.notifications
                     where type = 'clock_reminder' and user_id = tests.id('Emp') and read_at is null), 0,
    'l''uscita chiude il promemoria');

  -- In ferie quel giorno: niente.
  insert into public.staff_absences (member_id, kind, start_date, end_date, status)
  values (tests.id('M_Emp'), 'ferie', d2, d2, 'approved');
  perform tests.eq(private.queue_clock_reminders((d2 + time '18:06') at time zone 'Europe/Rome'), 0,
    'in ferie approvate non si chiede l''entrata');

  -- Fuori turno: dopo 10 ore, e non a chi ha spento i promemoria.
  insert into public.shift_clock_records (venue_id, venue_member_id, method, clock_in_at)
  values (tests.id('V2'), vm2, 'app', (d2 + time '08:00') at time zone 'Europe/Rome');
  perform tests.eq(private.queue_clock_reminders((d2 + time '17:00') at time zone 'Europe/Rome'), 0,
    'fuori turno da 9 ore: niente');
  update public.profiles set notification_prefs = '{"reminders": false}'::jsonb where id = tests.id('Emp2');
  perform tests.eq(private.queue_clock_reminders((d2 + time '19:00') at time zone 'Europe/Rome'), 0,
    'promemoria spenti: niente, nemmeno nella campanella');
  update public.profiles set notification_prefs = '{}'::jsonb where id = tests.id('Emp2');
  perform tests.eq(private.queue_clock_reminders((d2 + time '19:05') at time zone 'Europe/Rome'), 1,
    'fuori turno da 11 ore: promemoria');
  perform tests.ok(exists (select 1 from public.notifications
                            where type = 'clock_reminder' and user_id = tests.id('Emp2')
                              and related_id is null and title = 'Sei ancora in servizio?'),
    'senza turno da aprire');
end $$;

rollback;
select 'clock reminders: ok' as result;
