-- Codici per il consulente (2026-11-04): il codice dell'azienda e un codice per
-- causale, scritti da chi ha «Ore»; `get_export_codes` li dà all'export insieme
-- alle matricole delle sole persone nel perimetro «Ore» di chi esporta.
begin;

do $$
declare
  r jsonb;
begin
  perform tests.login('Ow');
  perform public.update_member(tests.id('M_Emp'), '{"matricola":"E1"}'::jsonb);
  perform public.update_member(tests.id('M_Emp2'), '{"matricola":"E2"}'::jsonb);
  perform public.save_export_codes(tests.id('W1'), '{"company":"AZ1","work":"01","ferie":" FE "}'::jsonb);
  r := public.get_export_codes(tests.id('W1'));
  perform tests.eq(r -> 'codes', '{"company":"AZ1","work":"01","ferie":"FE"}'::jsonb,
    'i codici si salvano senza spazi ai lati');

  -- Il salvataggio tocca solo le chiavi mandate: una chiave assente resta (una
  -- versione vecchia del modulo non cancella i codici che non conosce).
  perform public.save_export_codes(tests.id('W1'), '{"company":"AZ1","work":"01"}'::jsonb);
  perform tests.eq(public.get_export_codes(tests.id('W1')) -> 'codes',
    '{"company":"AZ1","work":"01","ferie":"FE"}'::jsonb, 'una chiave non mandata resta');
  perform public.save_export_codes(tests.id('W1'), '{"ferie":""}'::jsonb);
  perform tests.eq(public.get_export_codes(tests.id('W1')) -> 'codes',
    '{"company":"AZ1","work":"01"}'::jsonb, 'una causale svuotata sparisce');
  perform public.save_export_codes(tests.id('W1'), '{"company":"AZ1","work":"01","malattia":""}'::jsonb);
  perform tests.eq(public.get_export_codes(tests.id('W1')) -> 'codes',
    '{"company":"AZ1","work":"01"}'::jsonb, 'vuoto = nessun codice');

  perform tests.raises(format('select public.save_export_codes(%L, %L::jsonb)', tests.id('W1'),
    '{"straordinario":"ST"}'), 'invalid_code', 'chiave sconosciuta');
  perform tests.raises(format('select public.save_export_codes(%L, %L::jsonb)', tests.id('W1'),
    json_build_object('work', repeat('x', 21))), 'invalid_code', 'oltre 20 caratteri');

  -- Il titolare vede tutte le matricole dell'azienda.
  perform tests.eq((select count(*)::integer from jsonb_array_elements(r -> 'matricole') e
                     where e ->> 'matricola' in ('E1', 'E2')), 2, 'il titolare vede tutte le matricole');

  -- Co2 ha «Ore» su tutte le sedi ma non «Team»: legge e scrive i codici, e
  -- vede le matricole che non vede sulla scheda.
  perform tests.login('Co2');
  perform public.save_export_codes(tests.id('W1'), '{"company":"AZ2"}'::jsonb);
  perform tests.eq((select count(*)::integer from jsonb_array_elements(public.get_export_codes(tests.id('W1')) -> 'matricole')
                     e where e ->> 'matricola' in ('E1', 'E2')), 2, 'con Ore le matricole arrivano all''export');

  -- Co ha solo «Turni»: niente codici.
  perform tests.login('Co');
  perform tests.raises(format('select public.get_export_codes(%L)', tests.id('W1')),
    'not_allowed', 'senza Ore niente lettura');
  perform tests.raises(format('select public.save_export_codes(%L, %L::jsonb)', tests.id('W1'), '{}'),
    'not_allowed', 'senza Ore niente scrittura');

  -- Con «Ore» solo su V1: le matricole di chi lavora solo in V2 non arrivano.
  perform tests.login('Ow');
  perform public.set_member_access(tests.id('M_Co'), 'collaborator', '{"hours":true}'::jsonb,
    'selected', array[tests.id('V1')]);
  perform tests.login('Co');
  r := public.get_export_codes(tests.id('W1'));
  perform tests.ok(exists (select 1 from jsonb_array_elements(r -> 'matricole') e where e ->> 'matricola' = 'E1'),
    'chi lavora in V1 sì');
  perform tests.ok(not exists (select 1 from jsonb_array_elements(r -> 'matricole') e where e ->> 'matricola' = 'E2'),
    'chi lavora solo in V2 no');

  -- Un estraneo non legge niente.
  perform tests.login('Str');
  perform tests.raises(format('select public.get_export_codes(%L)', tests.id('W1')),
    'not_allowed', 'un estraneo no');
end $$;

rollback;
select 'export codes: ok' as result;
