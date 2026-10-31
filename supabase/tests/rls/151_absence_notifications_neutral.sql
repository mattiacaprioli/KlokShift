-- Le notifiche delle assenze non nominano la malattia: il loro testo è anche
-- quello della push, che passa da Expo, Apple e Google e compare sullo schermo
-- bloccato. Ferie e permessi restano come sono.
begin;

do $$
declare
  sick uuid;
  n    record;
begin
  -- Una malattia futura, così si può anche annullare (una in corso no).
  perform tests.login('Emp');
  sick := public.request_absence(tests.id('W1'), 'malattia', current_date + 40, current_date + 41);
  perform public.request_absence(tests.id('W1'), 'ferie', current_date + 50, current_date + 51);

  perform tests.logout();
  select x.title, x.body into n from public.notifications x
   where x.user_id = tests.id('Ow') and x.type = 'absence_sick'
   order by x.created_at desc limit 1;
  perform tests.eq(n.title, 'Nuova assenza', 'titolo neutro per la malattia');
  perform tests.ok(n.body not ilike '%malattia%', 'il testo non nomina la malattia');
  perform tests.ok(n.body ilike '%ha comunicato un''assenza%', 'il testo dice che c''è un''assenza');

  select x.title into n from public.notifications x
   where x.user_id = tests.id('Ow') and x.type = 'absence_request'
   order by x.created_at desc limit 1;
  perform tests.eq(n.title, 'Richiesta di ferie', 'le ferie restano come sono');

  perform tests.login('Emp');
  perform public.withdraw_absence(sick);

  perform tests.logout();
  select x.title, x.body into n from public.notifications x
   where x.user_id = tests.id('Ow') and x.type = 'absence_response'
   order by x.created_at desc limit 1;
  perform tests.eq(n.title, 'Assenza annullata', 'titolo dell''annullamento');
  perform tests.ok(n.body not ilike '%malattia%', 'l''annullamento non nomina la malattia');
  perform tests.ok(n.body ilike '%ha annullato un''assenza%', 'l''annullamento dice cosa è successo');

  perform tests.ok(not exists (select 1 from public.notifications x
                                where x.title ilike '%malattia%' or x.body ilike '%malattia%'),
    'nessuna notifica nomina la malattia');
end $$;

rollback;
select 'absence notifications neutral: ok' as result;
