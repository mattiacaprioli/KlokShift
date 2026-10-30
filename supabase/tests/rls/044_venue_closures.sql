-- Giorni di chiusura della sede: li vede chi vede la sede, li scrive chi ha
-- «Turni» o «Dati della sede», solo dalle RPC.
begin;

do $$
declare
  c uuid;
  d date := public.local_now()::date + 10;
begin
  -- Il titolare chiude V1 per due giorni.
  perform tests.login('Ow');
  c := public.save_venue_closure(tests.id('V1'), d, d + 1, '  Ferragosto  ');
  perform tests.eq((select reason from public.venue_closures where id = c), 'Ferragosto', 'motivo ripulito');
  perform tests.raises(format('select public.save_venue_closure(%L, %L, %L)', tests.id('V1'), d, d - 1),
    'closure_invalid', 'fine prima dell''inizio');
  perform tests.raises(
    format('insert into public.venue_closures (venue_id, start_date, end_date) values (%L, %L, %L)', tests.id('V1'), d, d),
    'permission denied', 'nessuna scrittura diretta');

  -- Lo vede chi lavora in V1, non chi lavora solo in V2.
  perform tests.login('Emp');
  perform tests.ok(exists (select 1 from public.venue_closures where id = c), 'il dipendente di V1 la vede');
  perform tests.login('Emp2');
  perform tests.ok(not exists (select 1 from public.venue_closures where id = c), 'chi lavora altrove no');

  -- Turni basta per scriverla; le sole Ore no.
  perform tests.login('Co');
  perform tests.ok(public.save_venue_closure(tests.id('V1'), d + 5, d + 5) is not null, 'chi organizza i turni la aggiunge');
  perform tests.login('Co2');
  perform tests.raises(format('select public.save_venue_closure(%L, %L, %L)', tests.id('V1'), d, d),
    'not_allowed', 'le sole Ore non bastano');
  perform tests.raises(format('select public.delete_venue_closure(%L)', c),
    'not_allowed', 'né per toglierla');
  perform tests.login('Emp');
  perform tests.raises(format('select public.delete_venue_closure(%L)', c),
    'not_allowed', 'il dipendente non la toglie');

  perform tests.login('Co');
  perform public.delete_venue_closure(c);
  perform tests.ok(not exists (select 1 from public.venue_closures where id = c), 'tolta');

  -- Ogni anno: al massimo un anno di periodo.
  perform tests.ok(public.save_venue_closure(tests.id('V1'), '2026-12-24', '2027-01-06', 'Natale', true) is not null,
    'chiusura annuale a cavallo d''anno');
  perform tests.raises(format('select public.save_venue_closure(%L, %L, %L, null, true)', tests.id('V1'), '2026-01-01', '2026-12-31'),
    'closure_invalid', 'un anno intero non si ripete');

  -- Riposo settimanale: giorni ISO, senza doppioni, scritto da chi ha Turni.
  perform tests.eq((public.set_venue_rest_days(tests.id('V1'), array[1,1,7]::smallint[])).rest_days,
    array[1,7]::smallint[], 'lunedì e domenica, senza doppioni');
  perform tests.raises(format('select public.set_venue_rest_days(%L, %L::smallint[])', tests.id('V1'), '{8}'),
    'closure_invalid', 'nessun ottavo giorno');
  perform tests.login('Co2');
  perform tests.raises(format('select public.set_venue_rest_days(%L, %L::smallint[])', tests.id('V1'), '{1}'),
    'not_allowed', 'le sole Ore non bastano per il riposo');
  perform tests.login('Emp');
  perform tests.eq((select rest_days from public.venues where id = tests.id('V1')), array[1,7]::smallint[],
    'il dipendente lo vede');
end $$;

select tests.anon();
select tests.raises('select count(*) from public.venue_closures', 'permission denied', 'anon escluso');
select tests.logout();
rollback;
