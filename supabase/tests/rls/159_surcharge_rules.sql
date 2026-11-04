-- Regole delle maggiorazioni (2026-11-04): versioni mensili dell'azienda,
-- scritte da chiunque abbia «Ore»; patrono della sede; festivi nazionali.
begin;

do $$
declare
  r jsonb;
  w1 uuid := tests.id('W1');
begin
  perform tests.login('Ow');
  perform public.save_surcharge_rules(w1, '2026-11-01', '{"night_pct":20,"sunday_pct":30}'::jsonb);
  r := public.get_surcharge_rules(w1);
  perform tests.eq(jsonb_array_length(r -> 'versions'), 1, 'una versione');
  perform tests.eq((r -> 'versions' -> 0 ->> 'night_pct')::numeric, 20::numeric, 'notturno al 20');
  perform tests.eq(r -> 'versions' -> 0 ->> 'night_start', '22:00', 'fascia di default: inizio');
  perform tests.eq(r -> 'versions' -> 0 ->> 'night_end', '06:00', 'fascia di default: fine');
  perform tests.eq(r -> 'versions' -> 0 ->> 'holiday_pct', null::text, 'festivi spenti');
  perform tests.eq(r -> 'versions' -> 0 ->> 'valid_from', '2026-11-01', 'mese di partenza');

  -- Dicembre cambia il notturno; novembre resta com'era, ottobre non ha regole.
  perform public.save_surcharge_rules(w1, '2026-12-01', '{"night_pct":25}'::jsonb);
  perform tests.logout();
  perform tests.eq((select s.night_pct from private.surcharge_rules_at(w1, '2026-11-15') s), 20.0::numeric(4,1),
    'novembre usa la sua versione');
  perform tests.eq((select s.night_pct from private.surcharge_rules_at(w1, '2026-12-03') s), 25.0::numeric(4,1),
    'dicembre usa la nuova');
  perform tests.eq((select count(*)::integer from private.surcharge_rules_at(w1, '2026-10-31')), 0,
    'prima della prima versione niente');

  -- Risalvare un mese sostituisce la sua versione.
  perform tests.login('Ow');
  perform public.save_surcharge_rules(w1, '2026-11-01', '{"night_pct":20}'::jsonb);
  perform tests.logout();
  perform tests.eq((select count(*)::integer from public.workspace_surcharge_rules s
                     where s.workspace_id = w1 and s.valid_from = '2026-11-01'), 1, 'una sola versione per mese');
  perform tests.eq((select s.sunday_pct from private.surcharge_rules_at(w1, '2026-11-15') s), null::numeric(4,1),
    'la domenica spenta resta spenta');

  -- Valori fuori dalle regole.
  perform tests.login('Ow');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"night_pct":0}'), 'invalid_surcharge', 'zero');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"night_pct":301}'), 'invalid_surcharge', 'oltre 300');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"night_pct":12.25}'), 'invalid_surcharge', 'due decimali');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-02',
    '{"night_pct":20}'), 'invalid_surcharge', 'non il primo del mese');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"night_pct":20,"night_start":"22:10"}'), 'invalid_surcharge', 'fascia non al quarto d''ora');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"night_pct":20,"night_start":"06:00","night_end":"06:00"}'), 'invalid_surcharge', 'inizio uguale alla fine');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"night_pct":20,"night_end":"24:00"}'), 'invalid_surcharge', '24:00 non è un orario');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01',
    '{"nigth_pct":20}'), 'invalid_surcharge', 'chiave sconosciuta');

  -- Co2 ha solo «Ore»: scrive le regole. Co ha solo «Turni»: niente.
  perform tests.login('Co2');
  perform public.save_surcharge_rules(w1, '2026-11-01', '{"night_pct":20,"overtime_pct":25}'::jsonb);
  perform tests.logout();
  perform tests.eq((select s.overtime_pct from private.surcharge_rules_at(w1, '2026-11-15') s), 25.0::numeric(4,1),
    'con Ore si scrivono le regole');
  perform tests.login('Co');
  perform tests.raises(format('select public.get_surcharge_rules(%L)', w1), 'not_allowed', 'senza Ore niente lettura');
  perform tests.raises(format('select public.save_surcharge_rules(%L, %L, %L::jsonb)', w1, '2026-11-01', '{}'),
    'not_allowed', 'senza Ore niente scrittura');
  perform tests.raises(format('select public.save_venue_patron(%L, 4, 10)', tests.id('V1')),
    'not_allowed', 'senza Ore niente patrono');

  -- Patrono della sede.
  perform tests.login('Ow');
  perform public.save_venue_patron(tests.id('V1'), 4, 10);
  r := public.get_surcharge_rules(w1);
  perform tests.ok(exists (select 1 from jsonb_array_elements(r -> 'patrons') p
                            where p ->> 'venue_id' = tests.id('V1')::text
                              and (p ->> 'day')::int = 4 and (p ->> 'month')::int = 10), 'patrono letto');
  perform tests.raises(format('select public.save_venue_patron(%L, 31, 2)', tests.id('V1')),
    'invalid_patron', 'data impossibile');
  perform tests.raises(format('select public.save_venue_patron(%L, 4, 10)', gen_random_uuid()),
    'not_allowed', 'sede che non esiste');
  perform public.save_venue_patron(tests.id('V2'), 10, 11);

  -- Festivi.
  perform tests.logout();
  perform tests.ok(private.italian_holiday('2026-04-05', tests.id('V2')), 'Pasqua 2026');
  perform tests.ok(private.italian_holiday('2026-04-06', tests.id('V2')), 'lunedì dell''Angelo 2026');
  perform tests.ok(private.italian_holiday('2027-03-29', tests.id('V2')), 'lunedì dell''Angelo 2027');
  perform tests.ok(private.italian_holiday('2026-10-04', tests.id('V2')), 'San Francesco dal 2026');
  perform tests.ok(private.italian_holiday('2026-12-26', tests.id('V2')), 'Santo Stefano');
  perform tests.ok(private.italian_holiday('2026-06-02', tests.id('V2')), 'Festa della Repubblica');
  perform tests.ok(not private.italian_holiday('2025-10-04', tests.id('V2')), 'il 4 ottobre prima del 2026 no');
  perform tests.ok(not private.italian_holiday('2026-04-07', tests.id('V2')), 'un giorno qualunque no');
  perform tests.ok(private.italian_holiday('2026-11-10', tests.id('V2')), 'il patrono di V2');
  perform tests.ok(not private.italian_holiday('2026-11-10', tests.id('V1')), 'non è il patrono di V1');

  -- I codici delle maggiorazioni.
  perform tests.login('Ow');
  perform public.save_export_codes(w1, '{"night":"NOT","overtime":"STR","sunday":"DOM","holiday":"FES"}'::jsonb);
  perform tests.eq(public.get_export_codes(w1) -> 'codes',
    '{"night":"NOT","overtime":"STR","sunday":"DOM","holiday":"FES"}'::jsonb, 'codici delle maggiorazioni');

  -- Un estraneo non legge niente.
  perform tests.login('Str');
  perform tests.raises(format('select public.get_surcharge_rules(%L)', w1), 'not_allowed', 'estraneo');
  perform tests.logout();
end $$;

rollback;
select 'surcharge rules: ok' as result;
