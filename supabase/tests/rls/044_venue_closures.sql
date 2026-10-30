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
end $$;

select tests.anon();
select tests.raises('select count(*) from public.venue_closures', 'permission denied', 'anon escluso');
select tests.logout();
rollback;
