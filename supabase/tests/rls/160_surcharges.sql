-- Maggiorazioni (2026-11-04): notturno, domenica, festivi e straordinario
-- calcolati da `get_workspace_surcharges` sulle stesse righe delle ore, con le
-- regole della versione del mese, una voce per minuto (la più alta) e le ore in
-- proporzione a quelle che contano. Date fisse nel passato: contano solo i
-- turni finiti.
begin;

-- Ore di una voce per persona e giorno (null se non c'è).
create function pg_temp.sh(p_from date, p_to date, p_member text, p_date date, p_kind text)
returns numeric language sql as $$
  select sum(s.hours) from public.get_workspace_surcharges(tests.id('W1'), p_from, p_to) s
   where s.member_id = tests.id(p_member) and s.date = p_date and s.kind = p_kind;
$$;
grant execute on function pg_temp.sh(date, date, text, date, text) to public;

do $$
declare
  w1 uuid := tests.id('W1');
  vm uuid;      -- Emma in V1
  vm_ow uuid;   -- il titolare in V1
  vm2 uuid;     -- Enzo in V2
  vm2b uuid;    -- Enzo anche in V1
  ids uuid[];
  h numeric;
  n numeric;
  s numeric;
begin
  -- Per contare le chiamate alle funzioni (pg_stat_xact_user_functions).
  perform set_config('track_functions', 'all', true);
  select x.id into vm from public.venue_members x where x.member_id = tests.id('M_Emp') and x.venue_id = tests.id('V1');
  select x.id into vm_ow from public.venue_members x where x.member_id = tests.id('M_Ow') and x.venue_id = tests.id('V1');
  select x.id into vm2 from public.venue_members x where x.member_id = tests.id('M_Emp2') and x.venue_id = tests.id('V2');
  insert into public.venue_members (member_id, venue_id, workspace_id)
  values (tests.id('M_Emp2'), tests.id('V1'), w1) returning id into vm2b;

  perform tests.login('Ow');
  ids := tests.create_shifts(jsonb_build_array(
    -- 1 maggio: notte, prima di ogni regola
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Notte maggio', 'date', '2026-05-12',
      'start_time', '22:00', 'end_time', '02:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 2 festa della Repubblica (martedì)
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Repubblica', 'date', '2026-06-02',
      'start_time', '20:00', 'end_time', '00:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 3 Ferragosto (sabato), parità notturno/festivi
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Ferragosto', 'date', '2026-08-15',
      'start_time', '20:00', 'end_time', '00:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 4-5 patrono di V1 il 15/9: il titolare in V1, Enzo in V2
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Patrono V1', 'date', '2026-09-15',
      'start_time', '10:00', 'end_time', '14:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_ow))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Patrono V2', 'date', '2026-09-15',
      'start_time', '10:00', 'end_time', '14:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    -- 6-7 straordinario settimanale di Enzo
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Lun', 'date', '2026-09-07',
      'start_time', '10:00', 'end_time', '16:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Mer', 'date', '2026-09-09',
      'start_time', '10:00', 'end_time', '16:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    -- 8-9 perimetro: V2 poi V1 nella stessa settimana
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Lun V2', 'date', '2026-09-21',
      'start_time', '10:00', 'end_time', '16:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Mer V1', 'date', '2026-09-23',
      'start_time', '10:00', 'end_time', '16:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2b))),
    -- 10-12 settimana a cavallo di settembre e ottobre
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Mar 29', 'date', '2026-09-29',
      'start_time', '08:00', 'end_time', '16:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Mer 30', 'date', '2026-09-30',
      'start_time', '08:00', 'end_time', '12:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Gio 1', 'date', '2026-10-01',
      'start_time', '08:00', 'end_time', '12:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2))),
    -- 13 l'esempio dello spec: domenica 18-02 con 30 minuti non retribuiti
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Domenica sera', 'date', '2026-10-11',
      'start_time', '18:00', 'end_time', '02:00', 'break_minutes', 30,
      'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 14 sabato verso domenica
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Sabato notte', 'date', '2026-10-17',
      'start_time', '20:00', 'end_time', '02:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 15 cambio dell'ora (sabato 24 → domenica 25 ottobre)
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Ora solare', 'date', '2026-10-24',
      'start_time', '22:00', 'end_time', '06:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 16 ore corrette a mano
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Notte corretta', 'date', '2026-10-20',
      'start_time', '22:00', 'end_time', '06:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 17 bozza
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Bozza', 'date', '2026-10-22', 'draft', true,
      'start_time', '22:00', 'end_time', '02:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    -- 18 il titolare in turno a ottobre, senza contratto
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Titolare', 'date', '2026-10-13',
      'start_time', '10:00', 'end_time', '14:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm_ow)))
  ));
  perform tests.logout();
  update public.shifts set break_paid = false where id = ids[13];
  update public.shift_assignments set worked_hours = 4, hours_source = 'manual' where shift_id = ids[16];

  perform tests.login('Ow');
  -- Senza «Ore» niente (prima di dare «Ore» a Co).
  perform tests.login('Co');
  perform tests.raises(format('select * from public.get_workspace_surcharges(%L, %L, %L)', w1, '2026-10-01', '2026-11-01'),
    'not_allowed', 'senza Ore niente maggiorazioni');

  perform tests.login('Ow');
  -- Nessuna regola: nessuna riga.
  perform tests.eq((select count(*)::integer from public.get_workspace_surcharges(w1, '2026-05-01', '2026-06-01')), 0,
    'senza regole niente maggiorazioni');
  -- Senza regole non si rifà il conto delle ore: la pagina Ore non paga niente.
  perform tests.logout();
  perform tests.eq((select coalesce(sum(f.calls), 0)::integer from pg_stat_xact_user_functions f
                     where f.schemaname = 'private' and f.funcname = 'workspace_hour_rows_in'), 0,
    'senza regole nessun calcolo delle ore');
  perform tests.login('Ow');

  perform public.save_surcharge_rules(w1, '2026-06-01', '{"night_pct":20,"holiday_pct":50}'::jsonb);
  perform public.save_surcharge_rules(w1, '2026-08-01', '{"night_pct":20,"holiday_pct":20}'::jsonb);
  perform public.save_surcharge_rules(w1, '2026-09-01', '{"holiday_pct":50,"overtime_pct":25}'::jsonb);
  perform public.save_surcharge_rules(w1, '2026-10-01', '{"night_pct":20,"sunday_pct":30,"overtime_pct":25}'::jsonb);
  perform public.save_venue_patron(tests.id('V1'), 15, 9);

  -- Un mese passato si accende salvandolo.
  perform tests.eq(pg_temp.sh('2026-05-01', '2026-06-01', 'M_Emp', '2026-05-12', 'night'), null::numeric, 'maggio ancora senza regole');
  perform public.save_surcharge_rules(w1, '2026-05-01', '{"night_pct":20}'::jsonb);
  perform tests.eq(pg_temp.sh('2026-05-01', '2026-06-01', 'M_Emp', '2026-05-12', 'night'), 4.00, 'maggio acceso');

  -- Festivo più alto del notturno; a parità vince festivi.
  perform tests.eq(pg_temp.sh('2026-06-01', '2026-07-01', 'M_Emp', '2026-06-02', 'holiday'), 4.00, '2 giugno festivo');
  perform tests.eq(pg_temp.sh('2026-06-01', '2026-07-01', 'M_Emp', '2026-06-02', 'night'), null::numeric, 'il festivo assorbe il notturno');
  perform tests.eq(pg_temp.sh('2026-08-01', '2026-09-01', 'M_Emp', '2026-08-15', 'holiday'), 4.00, 'parità: vince festivi');
  perform tests.eq(pg_temp.sh('2026-08-01', '2026-09-01', 'M_Emp', '2026-08-15', 'night'), null::numeric, 'parità: niente notturno');

  -- Patrono di V1, non di V2.
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Ow', '2026-09-15', 'holiday'), 4.00, 'patrono in V1');
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-15', 'holiday'), null::numeric, 'non in V2');

  -- Straordinario settimanale: 10 h a settimana.
  perform public.update_member(tests.id('M_Emp2'), '{"contract_hours":10,"contract_period":"week"}'::jsonb);
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-07', 'overtime'), null::numeric, 'lunedì nelle 10 ore');
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-09', 'overtime'), 2.00, 'mercoledì oltre le 10 ore');
  perform tests.eq((select s.percentage from public.get_workspace_surcharges(w1, '2026-09-01', '2026-10-01') s
                     where s.member_id = tests.id('M_Emp2') and s.date = '2026-09-09' and s.kind = 'overtime'),
    25.0::numeric, 'percentuale della versione di settembre');
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-23', 'overtime'), 2.00, 'ore in V2 e in V1 sommate');
  -- Settimana a cavallo: ogni minuto nel mese del suo turno.
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-30', 'overtime'), 2.00, '30 settembre');
  perform tests.eq(pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp2', '2026-10-01', 'overtime'), 4.00, '1 ottobre');

  -- Straordinario giornaliero e mensile.
  perform public.update_member(tests.id('M_Emp2'), '{"contract_hours":4,"contract_period":"day"}'::jsonb);
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-07', 'overtime'), 2.00, 'giornaliero');
  perform public.update_member(tests.id('M_Emp2'), '{"contract_hours":30,"contract_period":"month"}'::jsonb);
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-23', 'overtime'), null::numeric, 'mensile: entro le 30');
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-29', 'overtime'), 6.00, 'mensile: oltre le 30');
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-30', 'overtime'), 4.00, 'mensile: tutto oltre');
  perform public.update_member(tests.id('M_Emp2'), '{"contract_hours":10,"contract_period":"week"}'::jsonb);

  -- L'esempio dello spec.
  perform tests.eq(pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-11', 'sunday'), 5.62, 'esempio: domenica');
  perform tests.eq(pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-11', 'night'), 1.88, 'esempio: notturno');
  perform tests.eq((select d.hours from public.get_workspace_hours_daily(w1, '2026-10-01', '2026-11-01') d
                     where d.member_id = tests.id('M_Emp') and d.date = '2026-10-11' and d.kind = 'work'),
    7.50, 'esempio: le ore lavorate restano 7,5');

  -- Sabato verso domenica.
  perform tests.eq(pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-17', 'night'), 2.00, 'sabato 22-24 notturno');
  perform tests.eq(pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-17', 'sunday'), 2.00, 'domenica 00-02');

  -- Cambio dell'ora: 9 ore reali, 2 di sabato notte e 7 di domenica.
  h := (select d.hours from public.get_workspace_hours_daily(w1, '2026-10-01', '2026-11-01') d
         where d.member_id = tests.id('M_Emp') and d.date = '2026-10-24' and d.kind = 'work');
  n := pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-24', 'night');
  s := pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-24', 'sunday');
  perform tests.eq(n, round(h * 2 / 9, 2), 'cambio dell''ora: notturno su 9 ore reali');
  perform tests.ok(abs(n + s - h) <= 0.01, 'cambio dell''ora: notturno + domenica = ore');

  -- Ore corrette a mano: mai più delle ore che contano.
  perform tests.eq(pg_temp.sh('2026-10-01', '2026-11-01', 'M_Emp', '2026-10-20', 'night'), 4.00, 'ore corrette a mano');

  -- Bozza: niente.
  perform tests.eq((select count(*)::integer from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                     where x.date = '2026-10-22'), 0, 'le bozze non hanno maggiorazioni');

  -- Senza contratto: solo i dipendenti.
  perform tests.ok(exists (select 1 from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                            where x.kind = 'no_contract' and x.member_id = tests.id('M_Emp')), 'Emma senza contratto');
  perform tests.ok(not exists (select 1 from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                                where x.kind = 'no_contract' and x.member_id = tests.id('M_Ow')), 'il titolare no');
  perform tests.ok(not exists (select 1 from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                                where x.kind = 'no_contract' and x.member_id = tests.id('M_Emp2')), 'Enzo ha il contratto');

  -- Una versione nuova non cambia i mesi prima.
  perform public.save_surcharge_rules(w1, '2026-11-01', '{"night_pct":25}'::jsonb);
  perform tests.eq((select x.percentage from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                     where x.member_id = tests.id('M_Emp') and x.date = '2026-10-11' and x.kind = 'night'),
    20.0::numeric, 'ottobre resta al 20');

  -- Il riga «work» e le sue maggiorazioni hanno gli stessi orari.
  perform tests.ok(exists (select 1 from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                             join public.get_workspace_hours_daily(w1, '2026-10-01', '2026-11-01') d
                               on d.member_id = x.member_id and d.date = x.date and d.kind = 'work'
                              and d.clock_in = x.clock_in and d.clock_out = x.clock_out
                              and d.title is not distinct from x.title and d.venue_name is not distinct from x.venue_name
                            where x.date = '2026-10-11' and x.kind = 'night'), 'stessa chiave della riga di lavoro');

  -- Perimetro: con «Ore» solo su V1 si vede la riga di V1 con lo straordinario
  -- calcolato anche sulle ore di V2, e nessuna riga di V2.
  perform public.set_member_access(tests.id('M_Co'), 'collaborator', '{"hours":true}'::jsonb,
    'selected', array[tests.id('V1')]);
  perform tests.login('Co');
  perform tests.eq(pg_temp.sh('2026-09-01', '2026-10-01', 'M_Emp2', '2026-09-23', 'overtime'), 2.00,
    'perimetro: straordinario con le ore di V2');
  perform tests.eq((select count(*)::integer from public.get_workspace_surcharges(w1, '2026-09-01', '2026-10-01') x
                     where x.date in ('2026-09-07', '2026-09-09', '2026-09-21', '2026-09-29', '2026-09-30')), 0,
    'perimetro: niente righe di V2');

  -- Periodi intrecciati (contratto giornaliero 4 h): il turno del 3/9 timbrato
  -- dalle 23:30 del 2/9 sta fra due turni del 2/9; le ore del 2/9 non si azzerano.
  perform tests.login('Ow');
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Mattina 2', 'date', '2026-09-02',
      'start_time', '08:00', 'end_time', '12:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Notte 3', 'date', '2026-09-03',
      'start_time', '00:00', 'end_time', '02:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm))),
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Tardi 2', 'date', '2026-09-02',
      'start_time', '23:40', 'end_time', '23:55', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm)))
  ));
  perform public.update_member(tests.id('M_Emp'), '{"contract_hours":4,"contract_period":"day"}'::jsonb);
  perform tests.logout();
  insert into public.shift_clock_records (assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at)
  select a.id, ids[2], tests.id('V1'), vm, 'app',
         timestamptz '2026-09-02 23:30 Europe/Rome', timestamptz '2026-09-03 02:00 Europe/Rome'
    from public.shift_assignments a where a.shift_id = ids[2];
  update public.shift_assignments set worked_hours = 2.5, attendance_reviewed_at = now(),
    attendance_reviewed_by = tests.id('Ow') where shift_id = ids[2];
  perform tests.login('Ow');
  perform tests.eq((select sum(x.hours) from public.get_workspace_surcharges(w1, '2026-09-01', '2026-10-01') x
                     where x.member_id = tests.id('M_Emp') and x.title = 'Tardi 2' and x.kind = 'overtime'),
    0.25, 'periodi intrecciati: le ore del giorno non si azzerano');

  -- La base è quella che vede chi legge: con «Ore» solo su V1, il turno di
  -- V1 conta 4 ore (il turno sovrapposto di V2 non è nel suo perimetro), e le
  -- sue maggiorazioni stanno su quelle 4 ore, non sull'ora che resta al titolare.
  ids := tests.create_shifts(jsonb_build_array(
    jsonb_build_object('venue_id', tests.id('V1'), 'title', 'Notte V1', 'date', '2026-10-06',
      'start_time', '22:00', 'end_time', '02:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2b))),
    jsonb_build_object('venue_id', tests.id('V2'), 'title', 'Notte V2', 'date', '2026-10-06',
      'start_time', '23:00', 'end_time', '03:00', 'staff', jsonb_build_array(jsonb_build_object('venue_member_id', vm2)))
  ));
  perform tests.eq((select d.hours from public.get_workspace_hours_daily(w1, '2026-10-01', '2026-11-01') d
                     where d.title = 'Notte V1' and d.kind = 'work'), 1.00, 'il titolare: 1 ora sola su V1');
  perform tests.login('Co');
  perform tests.eq((select d.hours from public.get_workspace_hours_daily(w1, '2026-10-01', '2026-11-01') d
                     where d.title = 'Notte V1' and d.kind = 'work'), 4.00, 'chi vede solo V1: 4 ore');
  perform tests.eq((select sum(x.hours) from public.get_workspace_surcharges(w1, '2026-10-01', '2026-11-01') x
                     where x.title = 'Notte V1' and x.kind = 'night'), 4.00, 'notturno sulle 4 ore che vede');
  perform tests.logout();
end $$;

rollback;
select 'surcharges: ok' as result;
