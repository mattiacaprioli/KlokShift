-- Matrice D: inviti in uscita e accettazione via token.
-- Le RPC sono riservate alla service role (le chiama la Edge Function): i test le
-- eseguono da `postgres` e verificano che gli utenti NON possano.
begin;

do $$
declare
  m_emp uuid; m_co uuid; r record; h text := 'hash-di-prova-1'; newuser uuid := gen_random_uuid();
begin
  -- Nessun utente le raggiunge da REST.
  perform tests.login('Ow');
  perform tests.raises(format('select public.claim_invite_send(%L, %L)', tests.id('M_Emp'), tests.id('Ow')), 'permission denied', 'claim_invite_send è solo service role');
  perform tests.raises('select public.peek_invite(''x'')', 'permission denied', 'peek_invite pure');
  perform tests.raises('select public.consume_invite(''x'', null)', 'permission denied', 'consume_invite pure');

  -- Preparo due schede senza account: un dipendente e un collaboratore.
  m_emp := (public.add_member(tests.id('W1'), '{"full_name":"Nina","email":"nina@t.test"}'::jsonb) ->> 'member_id')::uuid;
  m_co  := (public.add_member(tests.id('W1'), '{"full_name":"Carla","email":"carla@t.test"}'::jsonb, 'collaborator', '{"shifts":true}'::jsonb) ->> 'member_id')::uuid;
  perform tests.logout();

  -- Dipendente: canale email, niente token.
  select * into r from public.claim_invite_send(m_emp, tests.id('Ow'));
  perform tests.eq(r.channel, 'email', 'il dipendente riceve un''email semplice');
  perform tests.eq(r.workspace_name, 'W1', 'con il nome dell''azienda');
  perform tests.raises(format('select public.claim_invite_send(%L, %L)', m_emp, tests.id('Ow')), 'rate_limited', 'non due invii di fila');
  perform tests.raises(format('select public.claim_invite_send(%L, %L)', m_emp, tests.id('Str')), 'not_owner', 'un estraneo non invita');

  -- Collaboratore: solo il titolare, con un token.
  perform tests.raises(format('select public.claim_invite_send(%L, %L, %L, %L)', m_co, tests.id('Co'), h, now() + interval '7 days'),
    'not_owner', 'un collaboratore non invita collaboratori');
  perform tests.raises(format('select public.claim_invite_send(%L, %L)', m_co, tests.id('Ow')), 'token_required', 'il token è obbligatorio');
  select * into r from public.claim_invite_send(m_co, tests.id('Ow'), h, now() + interval '7 days');
  perform tests.eq(r.channel, 'token', 'il collaboratore riceve un link con token');

  -- Il link.
  perform tests.eq((select email from public.peek_invite(h)), 'carla@t.test', 'peek restituisce l''email');
  perform tests.raises('select public.peek_invite(''sbagliato'')', 'invite_not_found', 'token sconosciuto');
  update public.member_invites set expires_at = now() - interval '1 minute' where token_hash = h;
  perform tests.raises(format('select public.peek_invite(%L)', h), 'invite_expired', 'link scaduto');
  update public.member_invites set expires_at = now() + interval '1 day' where token_hash = h;

  -- Accettazione: l'account nasce con l'email confermata e il trigger aggancia la
  -- scheda (ancora `invited`); consume_invite la rende definitiva.
  insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data)
    values (newuser, 'carla@t.test', now(), '{"full_name":"Carla"}');
  perform tests.eq((select user_id from public.workspace_members where id = m_co), newuser, 'l''account nato dal link aggancia la scheda');
  perform tests.eq((select status::text from public.workspace_members where id = m_co), 'invited', 'ma resta da accettare finché il token non è consumato');
  perform tests.raises(format('select public.consume_invite(%L, %L)', h, tests.id('Str')), 'account_not_linked', 'solo l''account nato da quel link');
  perform tests.eq(public.consume_invite(h, newuser), 'carla@t.test', 'consume_invite restituisce l''email');
  perform tests.eq((select status::text from public.workspace_members where id = m_co), 'active', 'ora è attiva');
  perform tests.raises(format('select public.consume_invite(%L, %L)', h, newuser), 'invite_not_found', 'monouso: il secondo click non trova nulla');
  perform tests.raises(format('select public.peek_invite(%L)', h), 'invite_not_found', 'e il link non è più valido');

  -- E da collaboratrice attiva vede la gestione con i permessi dati.
  perform set_config('request.jwt.claims', json_build_object('sub', newuser, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', newuser::text, true);
  perform set_config('role', 'authenticated', true);
  perform tests.eq((select count(*) from public.venues), 2::bigint, 'Carla vede le sedi di W1');
  perform tests.logout();
end $$;

rollback;
select 'invites: ok' as result;
