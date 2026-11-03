-- Le righe del giorno per il consulente (`get_workspace_hours_daily`) e il
-- riepilogo del mese (`get_workspace_hours_summary`, `get_workspace_absence_summary`)
-- leggono la stessa fonte: per ogni persona la somma delle righe è il riepilogo,
-- e le righe «Da verificare» sono esattamente «Ore da sistemare».
begin;

-- Gli stessi conti per chiunque guardi: lavoro, pause e assenze sommati per
-- persona uguali ai riepiloghi, «Da verificare» uguale a get_hours_to_fix.
create function pg_temp.check_daily(p_from date, p_to date, p_who text) returns void
language plpgsql as $$
declare
  bad text;
begin
  select string_agg(coalesce(x.member_id, y.member_id)::text, ', ') into bad
    from (select s.member_id, sum(s.approved_hours) as h, sum(s.paid_break_hours) as pb,
                 sum(s.unpaid_break_hours) as ub
            from public.get_workspace_hours_summary(tests.id('W1'), p_from, p_to) s
           group by s.member_id) x
    full join (select d.member_id, coalesce(sum(d.hours), 0) as h,
                      coalesce(sum(round(d.break_minutes / 60.0, 2)) filter (where d.break_paid), 0) as pb,
                      coalesce(sum(round(d.break_minutes / 60.0, 2)) filter (where not d.break_paid), 0) as ub
                 from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to) d
                where d.kind = 'work' group by d.member_id) y on y.member_id = x.member_id
   where coalesce(x.h, 0) <> coalesce(y.h, 0) or coalesce(x.pb, 0) <> coalesce(y.pb, 0)
      or coalesce(x.ub, 0) <> coalesce(y.ub, 0);
  perform tests.eq(bad, null::text, p_who || ': ore e pause del giornaliero = riepilogo, persona per persona');

  select string_agg(coalesce(x.member_id, y.member_id)::text, ', ') into bad
    from public.get_workspace_absence_summary(tests.id('W1'), p_from, p_to) x
    full join (select d.member_id,
                      coalesce(sum(d.hours) filter (where d.kind = 'ferie'), 0) as ferie,
                      coalesce(sum(d.hours) filter (where d.kind = 'permesso'), 0) as permesso,
                      coalesce(sum(d.hours) filter (where d.kind = 'malattia'), 0) as malattia
                 from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to) d
                where d.kind in ('ferie', 'permesso', 'malattia') group by d.member_id) y
      on y.member_id = x.member_id
   where coalesce(x.ferie_hours, 0) <> coalesce(y.ferie, 0)
      or coalesce(x.permesso_recognized_hours, 0) <> coalesce(y.permesso, 0)
      or coalesce(x.malattia_hours, 0) <> coalesce(y.malattia, 0);
  perform tests.eq(bad, null::text, p_who || ': ferie, permessi e malattia del giornaliero = riepilogo assenze');

  perform tests.eq(
    (select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to) where kind = 'to_fix'),
    (select count(*) from public.get_hours_to_fix(tests.id('W1'), p_from, p_to)),
    p_who || ': tante righe «Da verificare» quante «Ore da sistemare»');
  perform tests.eq(
    (select count(*) from (
       (select f.member_id, f.date, f.kind from public.get_hours_to_fix(tests.id('W1'), p_from, p_to) f)
       except all
       (select d.member_id, d.date, d.note from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to) d
         where d.kind = 'to_fix')) z),
    0::bigint, p_who || ': le righe «Da verificare» hanno il motivo di «Ore da sistemare»');
end $$;
grant execute on function pg_temp.check_daily(date, date, text) to public;

do $$
declare
  vm uuid;
  vm2 uuid;
  d date := current_date - 3;
  p_from date := current_date - 14;
  p_to date := current_date + 1;
  ids uuid[];
  extra uuid[];
  a_open uuid;
  a_pending uuid;
  a_done uuid;
  ab uuid;
  summary text;
  r record;
begin
  select x.id into vm from public.venue_members x
   where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x
   where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');

  -- La preparazione di 037: V1 a timbratura dall'app, V2 manuale.
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
      'start_time', '18:00', 'end_time', '23:00', 'break_minutes', 30,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));
  select a.id into a_open from public.shift_assignments a where a.shift_id = ids[2];
  select a.id into a_pending from public.shift_assignments a where a.shift_id = ids[3];
  select a.id into a_done from public.shift_assignments a where a.shift_id = ids[4];

  -- In più: un turno spezzato, una bozza e un turno annullato, il giorno prima.
  extra := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Spezzato mattina', 'date', (d - 1)::text,
      'start_time', '10:00', 'end_time', '14:00', 'break_minutes', 15,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Spezzato sera', 'date', (d - 1)::text,
      'start_time', '18:00', 'end_time', '22:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Bozza', 'date', (d - 1)::text,
      'start_time', '06:00', 'end_time', '08:00', 'draft', true,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Annullato', 'date', (d - 2)::text,
      'start_time', '06:00', 'end_time', '08:00',
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))));

  -- Assenze di Enzo: ferie con credito il primo giorno e senza il secondo;
  -- un permesso a ore libero; uno in conflitto con il turno spezzato; una
  -- malattia con credito nel giorno della Sera V2 (credito in conflitto).
  ab := public.record_absence(tests.id('M_Emp2'), 'ferie', d - 6, d - 5);
  perform public.set_absence_hour_credit(ab, d - 6, 480);
  perform public.record_absence(tests.id('M_Emp2'), 'permesso', d - 2, d - 2, '15:00', '17:00');
  perform public.record_absence(tests.id('M_Emp2'), 'permesso', d - 1, d - 1, '13:00', '15:00');
  ab := public.record_absence(tests.id('M_Emp2'), 'malattia', d, d);
  perform public.set_absence_hour_credit(ab, d, 470);
  perform tests.logout();

  update public.shifts set status = 'cancelled' where id = extra[4];
  -- Pausa della Sera V2 non retribuita, quella del mattino spezzato retribuita.
  update public.shifts set break_paid = false where id = ids[5];
  update public.shifts set break_paid = true where id = extra[1];

  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at)
  values (a_open, ids[2], tests.id('V1'), vm, 'app', (d + time '09:00') at time zone 'Europe/Rome');
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  values (a_pending, ids[3], tests.id('V1'), vm, 'app',
          (d + time '13:00') at time zone 'Europe/Rome', (d + time '16:00') at time zone 'Europe/Rome');

  perform tests.login('Co2');
  perform public.enter_clock_record(a_done, (d + time '18:00') at time zone 'Europe/Rome',
    (d + time '23:30') at time zone 'Europe/Rome', null);

  -- Il riepilogo dà gli stessi valori di prima del giornaliero (misurati prima
  -- della migration su questa stessa preparazione).
  select string_agg(format('%s|%s|%s|%s|%s|%s|%s|%s|%s', s.member_name, s.venue_name, s.shifts_count,
                           round(s.hours, 2), round(s.approved_hours, 2), s.to_review_count,
                           round(s.proposed_hours, 2), round(s.paid_break_hours, 2),
                           round(s.unpaid_break_hours, 2)), ' / '
                    order by s.member_name, s.venue_name)
    into summary
    from public.get_workspace_hours_summary(tests.id('W1'), p_from, p_to) s;
  perform tests.eq(summary, 'Emma|V1|1|13.50|5.50|2|3.00|0.00|0.00 / Enzo|V2|3|12.50|12.50|0|0.00|0.25|0.50', 'il riepilogo non cambia');

  perform pg_temp.check_daily(p_from, p_to, 'Co2');

  -- Ci sono righe di ogni tipo: il confronto non è a vuoto.
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where kind = 'work'), 4::bigint, 'quattro righe di lavoro (Sera, Sera V2 e il turno spezzato)');
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where kind = 'to_fix'), 3::bigint, 'tre righe da verificare');

  -- Il turno spezzato dà due righe di lavoro lo stesso giorno.
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where kind = 'work' and member_id = tests.id('M_Emp2') and date = d - 1),
    2::bigint, 'il turno spezzato dà due righe');
  perform tests.eq((select string_agg(clock_in || '-' || clock_out, ' ' order by clock_in)
                      from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where kind = 'work' and member_id = tests.id('M_Emp2') and date = d - 1),
    '10:00-14:00 18:00-22:00', 'senza timbratura entrata e uscita sono quelle del turno, in ordine');

  -- La timbratura inserita a mano dà i suoi orari, non quelli del turno.
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'work' and member_id = tests.id('M_Emp');
  perform tests.eq(r.clock_in || '-' || r.clock_out, '18:00-23:30', 'gli orari della timbratura');
  perform tests.eq(r.hours, 5.5::numeric, 'le ore della timbratura');
  perform tests.eq(r.title, 'Sera', 'con il turno');
  perform tests.eq(r.venue_name, 'V1', 'e la sede');

  -- La pausa della riga e se è retribuita.
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'work' and title = 'Sera V2';
  perform tests.eq(r.break_minutes, 30, 'la pausa pianificata');
  perform tests.eq(r.break_paid, false, 'non retribuita');
  perform tests.eq(r.hours, 4.5::numeric, 'la pausa non retribuita si toglie');

  -- «Da verificare»: ore vuote, entrata e uscita se ci sono.
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'to_fix' and note = 'missing_out';
  perform tests.eq(r.hours, null::numeric, 'da verificare: ore vuote');
  perform tests.eq(r.clock_in, '09:00', 'l''entrata timbrata');
  perform tests.eq(r.clock_out, null::text, 'l''uscita manca');
  perform tests.eq((select clock_in || '-' || clock_out
                      from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where kind = 'to_fix' and note = 'not_clocked'),
    '06:00-08:00', 'chi non ha timbrato ha gli orari del turno');

  -- Bozze e turni annullati non compaiono.
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where title in ('Bozza', 'Annullato')), 0::bigint, 'niente bozze né turni annullati');

  -- Le assenze: un giorno per riga.
  perform tests.eq((select hours from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where kind = 'ferie' and date = d - 6), 8::numeric, 'ferie con credito');
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'ferie' and date = d - 5;
  perform tests.ok(r.member_id = tests.id('M_Emp2'), 'il giorno di ferie senza credito compare');
  perform tests.eq(r.hours, null::numeric, 'con le ore vuote');
  perform tests.eq(r.note, null::text, 'e senza nota');
  perform tests.eq(r.clock_in, null::text, 'senza entrata');
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'permesso' and date = d - 2;
  perform tests.eq(r.hours, 2::numeric, 'permesso a ore: la sua durata');
  perform tests.eq(r.note, 'hourly:15:00-17:00', 'permesso a ore: con l''intervallo');
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'permesso' and date = d - 1;
  perform tests.eq(r.hours, null::numeric, 'permesso a ore in conflitto: ore vuote');
  perform tests.eq(r.note, 'conflict', 'permesso a ore in conflitto: da verificare');
  select * into r from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
   where kind = 'malattia' and date = d;
  perform tests.eq(r.hours, null::numeric, 'credito in conflitto: ore vuote');
  perform tests.eq(r.note, 'conflict', 'credito in conflitto: da verificare');

  -- L'ordine: persona, giorno, entrata (le assenze in fondo al giorno).
  perform tests.eq((select string_agg(x.kind, ',' order by x.n) from (
      select d2.kind, row_number() over () as n
        from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to) d2
       where d2.member_id = tests.id('M_Emp2') and d2.date = d - 1) x),
    'work,work,permesso', 'nel giorno: i turni per entrata, poi l''assenza');

  -- Lo stesso per il titolare.
  perform tests.login('Ow');
  perform pg_temp.check_daily(p_from, p_to, 'Ow');

  -- Senza «Ore» non si vede niente.
  perform tests.login('Co');
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)),
    0::bigint, 'senza Ore il giornaliero è vuoto');

  -- Con «Ore» solo su V1: niente lavoro di V2, e le somme tornano lo stesso.
  perform tests.login('Ow');
  perform public.set_member_access(tests.id('M_Co'), 'collaborator', '{"hours":true}'::jsonb,
    'selected', array[tests.id('V1')]);
  perform tests.login('Co');
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where venue_name = 'V2'), 0::bigint, 'con Ore solo su V1 nessuna riga di V2');
  perform tests.eq((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where member_id = tests.id('M_Emp2')), 0::bigint, 'né le assenze di chi lavora solo in V2');
  perform tests.ok((select count(*) from public.get_workspace_hours_daily(tests.id('W1'), p_from, p_to)
                     where venue_name = 'V1') > 0, 'le righe di V1 sì');
  perform pg_temp.check_daily(p_from, p_to, 'Co su V1');
end $$;

rollback;
select 'hours daily: ok' as result;
