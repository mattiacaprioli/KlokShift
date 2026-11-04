-- Matricola della persona (2026-11-04): il codice del dipendente nel programma
-- paghe del consulente. Sta in member_hr con il contratto, la scrive chi ha
-- «Team» e non si ripete dentro la stessa azienda, nemmeno fra chi è uscito.
begin;

do $$
declare
  w2_owner uuid;
  v_err text;
begin
  select m.id into w2_owner from public.workspace_members m
   where m.workspace_id = (select v.workspace_id from public.venues v where v.name = 'V3')
     and m.user_id = tests.id('Emp');

  perform tests.login('Ow');
  perform public.update_member(tests.id('M_Emp'), '{"matricola":" A12 "}'::jsonb);
  perform tests.eq((select h.matricola from public.member_hr h where h.member_id = tests.id('M_Emp')),
    'A12', 'la matricola si salva senza spazi ai lati');

  perform tests.raises(format('select public.update_member(%L, %L::jsonb)', tests.id('M_Emp2'),
    '{"matricola":"  a12 "}'), 'matricola_taken:Emma', 'stessa matricola, maiuscole e spazi diversi: dice chi ce l''ha');

  perform tests.raises(format('select public.update_member(%L, %L::jsonb)', tests.id('M_Emp2'),
    json_build_object('matricola', repeat('x', 31))), 'invalid_code', 'oltre 30 caratteri');

  perform public.update_member(tests.id('M_Emp2'), '{"matricola":""}'::jsonb);
  perform tests.eq((select h.matricola from public.member_hr h where h.member_id = tests.id('M_Emp2')),
    null::text, 'vuota = nessuna matricola');

  -- Gli altri dati di contratto non si toccano scrivendo la matricola.
  perform public.update_member(tests.id('M_Emp2'), '{"contract_hours":20,"contract_period":"week"}'::jsonb);
  perform public.update_member(tests.id('M_Emp2'), '{"matricola":"B7"}'::jsonb);
  perform tests.eq((select h.contract_hours from public.member_hr h where h.member_id = tests.id('M_Emp2')),
    20::numeric, 'il contratto resta');

  -- Chi ha «Team» solo su V1 non vede Enzo (V2): l'errore non lo nomina.
  perform public.set_member_access(
    tests.id('M_Co'), 'collaborator', '{"staff":true}'::jsonb, 'selected', array[tests.id('V1')]);
  perform tests.login('Co');
  begin
    perform public.update_member(tests.id('M_Emp'), '{"matricola":"b7"}'::jsonb);
  exception when others then v_err := sqlerrm;
  end;
  perform tests.eq(v_err, 'matricola_taken', 'senza Team su chi ce l''ha, niente nome');
  perform tests.login('Ow');

  -- Chi è uscito tiene la sua matricola.
  perform public.remove_member(tests.id('M_Emp'));
  perform tests.raises(format('select public.update_member(%L, %L::jsonb)', tests.id('M_Co'),
    '{"matricola":"A12"}'), 'matricola_taken', 'la matricola di chi è uscito resta sua');

  -- Chi ha solo «Ore» non la scrive.
  perform tests.login('Co2');
  perform tests.raises(format('select public.update_member(%L, %L::jsonb)', tests.id('M_Emp2'),
    '{"matricola":"C1"}'), 'not_allowed', 'senza Team niente matricola');

  -- In un'altra azienda la stessa matricola va bene.
  perform tests.login('Emp');
  perform public.update_member(w2_owner, '{"matricola":"A12"}'::jsonb);
  perform tests.logout();
  perform tests.eq((select h.matricola from public.member_hr h where h.member_id = w2_owner),
    'A12', 'un''altra azienda ha le sue matricole');
end $$;

rollback;
select 'member matricola: ok' as result;
