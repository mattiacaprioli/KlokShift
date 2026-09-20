-- Matrice A: identità, visibilità, scritture dirette, regole «su me stesso».
-- Ogni DO impersona un attore; un test che fallisce solleva e ferma la suite.
begin;

-- ---------------------------------------------------------------------------
-- Cosa vede ciascuno (conteggi per tabella e attore)
-- ---------------------------------------------------------------------------
do $$
begin
  -- workspace_members
  perform tests.login('Ow');
  perform tests.eq((select count(*) from public.workspace_members), 5::bigint, 'Ow vede i 5 membri di W1');
  perform tests.login('Co');
  -- sé stesso, la squadra di gestione (Ow, Co2) e chi lavora nella sua sede V1 (Ow, Emp)
  perform tests.eq((select count(*) from public.workspace_members), 4::bigint, 'Co vede sé, Ow, Co2 e Emp');
  perform tests.ok(not exists (select 1 from public.workspace_members where id = tests.id('M_Emp2')),
    'Co non vede Emp2 (lavora in V2, fuori dal suo ambito)');
  perform tests.login('Co2');
  perform tests.eq((select count(*) from public.workspace_members), 3::bigint,
    'Co2 (solo «ore») vede la squadra di gestione ma non i dipendenti');
  perform tests.login('Emp');
  perform tests.eq((select count(*) from public.workspace_members), 2::bigint,
    'Emp vede solo le proprie due appartenenze (dipendente di W1, titolare di W2)');
  perform tests.login('Emp2');
  perform tests.eq((select count(*) from public.workspace_members), 1::bigint, 'Emp2 vede solo sé stesso');
  perform tests.login('Str');
  perform tests.eq((select count(*) from public.workspace_members), 0::bigint, 'Str non vede nessuno');

  -- venues
  perform tests.login('Ow');   perform tests.eq((select count(*) from public.venues), 2::bigint, 'Ow: V1, V2');
  perform tests.login('Co');   perform tests.eq((select count(*) from public.venues), 1::bigint, 'Co: solo V1 (ambito)');
  perform tests.login('Co2');  perform tests.eq((select count(*) from public.venues), 2::bigint, 'Co2: tutte le sedi');
  perform tests.login('Emp');  perform tests.eq((select count(*) from public.venues), 2::bigint, 'Emp: V1 (lavora) + V3 (titolare)');
  perform tests.login('Emp2'); perform tests.eq((select count(*) from public.venues), 1::bigint, 'Emp2: V2');
  perform tests.login('Str');  perform tests.eq((select count(*) from public.venues), 0::bigint, 'Str: nessuna');

  -- workspaces
  perform tests.login('Emp');  perform tests.eq((select count(*) from public.workspaces), 2::bigint, 'Emp vede W1 e W2');
  perform tests.login('Str');  perform tests.eq((select count(*) from public.workspaces), 0::bigint, 'Str non vede aziende');

  -- member_hr / member_scope
  perform tests.login('Emp2'); perform tests.eq((select count(*) from public.member_scope), 0::bigint, 'Emp2 non legge gli ambiti');
  perform tests.login('Ow');   perform tests.eq((select count(*) from public.member_scope), 1::bigint, 'Ow legge l''ambito di Co');

  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Anon: niente. (Era il buco «venues: public read using (true)».)
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.anon();
  perform tests.raises('select count(*) from public.venues', 'permission denied', 'anon non legge le sedi');
  perform tests.raises('select count(*) from public.workspace_members', 'permission denied', 'anon non legge i membri');
  perform tests.raises('select count(*) from public.profiles', 'permission denied', 'anon non legge i profili');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Il profilo non ha né ruolo né piano, e il piano non si scrive dal client
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.ok(not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles' and column_name in ('role', 'plan')
  ), 'profiles non ha role/plan');

  perform tests.login('Ow');
  perform tests.raises('update public.workspaces set plan = ''free''', 'permission denied', 'plan non scrivibile');
  perform tests.raises('update public.profiles set deleted_at = now()', 'permission denied', 'deleted_at non scrivibile');
  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Scritture dirette: solo dove ammesse
-- ---------------------------------------------------------------------------
do $$
declare v_n bigint;
begin
  perform tests.login('Ow');
  perform tests.raises(
    format('insert into public.workspace_members (workspace_id, display_name) values (%L, ''x'')', tests.id('W1')),
    'permission denied', 'nessun INSERT diretto su workspace_members');
  perform tests.raises(
    format('update public.workspace_members set authority = ''owner'' where id = %L', tests.id('M_Co')),
    'permission denied', 'nessun UPDATE diretto su workspace_members');
  perform tests.raises('delete from public.workspace_members', 'permission denied', 'nessun DELETE diretto');
  perform tests.raises(
    format('insert into public.venues (workspace_id, name) values (%L, ''x'')', tests.id('W1')),
    'permission denied', 'le sedi si creano con create_venue');
  perform tests.raises(
    format('update public.venues set workspace_id = %L', tests.id('W2')),
    'permission denied', 'venues.workspace_id fuori dal GRANT');
  perform tests.raises(
    'insert into public.member_invites (member_id, channel) select id, ''email'' from public.workspace_members',
    'permission denied', 'member_invites non raggiungibile');

  -- Aggiornare una sede: il titolare sì (1 riga)…
  update public.venues set city = 'Torino' where id = tests.id('V1');
  get diagnostics v_n = row_count;
  perform tests.eq(v_n, 1::bigint, 'Ow modifica V1');
  -- …chi non ha «Sede» tocca 0 righe (la RLS le nasconde: il client deve usare .select()).
  perform tests.login('Co');
  update public.venues set city = 'Roma' where id = tests.id('V1');
  get diagnostics v_n = row_count;
  perform tests.eq(v_n, 0::bigint, 'Co senza «Sede» non modifica V1');
  perform tests.login('Emp2');
  update public.venues set city = 'Roma' where id = tests.id('V2');
  get diagnostics v_n = row_count;
  perform tests.eq(v_n, 0::bigint, 'Emp2 non modifica V2');

  -- Il listino mansioni: chi ha «Sede».
  perform tests.login('Ow');
  insert into public.venue_roles (venue_id, name) values (tests.id('V1'), 'Barman');
  perform tests.login('Emp2');
  perform tests.raises(
    format('insert into public.venue_roles (venue_id, name) values (%L, ''Cuoco'')', tests.id('V2')),
    'row-level security', 'Emp2 non scrive mansioni');

  -- Il proprio profilo sì, quello altrui no.
  perform tests.login('Emp');
  update public.profiles set city = 'Napoli' where id = tests.id('Emp');
  get diagnostics v_n = row_count;
  perform tests.eq(v_n, 1::bigint, 'Emp modifica il proprio profilo');
  update public.profiles set city = 'Napoli' where id = tests.id('Emp2');
  get diagnostics v_n = row_count;
  perform tests.eq(v_n, 0::bigint, 'Emp non modifica il profilo di Emp2');

  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- add_member: chi può aggiungere chi
-- ---------------------------------------------------------------------------
do $$
declare r jsonb;
begin
  -- Co ha solo «turni»: non aggiunge dipendenti, e non crea collaboratori.
  perform tests.login('Co');
  perform tests.raises(
    format($f$select public.add_member(%L, '{"full_name":"X"}', 'none', '{}', 'all', %L)$f$,
           tests.id('W1'), jsonb_build_array(jsonb_build_object('venue_id', tests.id('V1')))::text),
    'not_allowed', 'Co non ha «Staff»');
  perform tests.raises(
    format($f$select public.add_member(%L, '{"full_name":"X","email":"x@t.test"}', 'collaborator', '{"shifts":true}', 'all', '[]')$f$,
           tests.id('W1')),
    'owner_only', 'solo il titolare crea collaboratori');
  perform tests.login('Emp2');
  perform tests.raises(
    format($f$select public.add_member(%L, '{"full_name":"X"}', 'none', '{}', 'all', '[]')$f$, tests.id('W1')),
    'not_allowed', 'un dipendente non aggiunge nessuno');

  -- Il titolare non può usare una sede di un'altra azienda.
  perform tests.login('Ow');
  perform tests.raises(
    format($f$select public.add_member(%L, '{"full_name":"X"}', 'none', '{}', 'all', %L)$f$,
           tests.id('W1'), jsonb_build_array(jsonb_build_object('venue_id', tests.id('V3')))::text),
    'venue_not_in_workspace', 'sede di un altro workspace');
  perform tests.raises(
    format($f$select public.add_member(%L, '{"full_name":"X"}', 'owner', '{}', 'all', '[]')$f$, tests.id('W1')),
    'use_transfer_ownership', 'non si crea un titolare con add_member');
  perform tests.raises(
    format($f$select public.add_member(%L, '{"full_name":"X"}', 'collaborator', '{}', 'all', '[]')$f$, tests.id('W1')),
    'email_required', 'un collaboratore richiede un''email');

  -- Una persona senza account: scheda attiva non collegata, esito invite_email.
  r := public.add_member(tests.id('W1'), '{"full_name":"Nuovo","email":"nuovo@t.test"}'::jsonb, 'none', '{}'::jsonb, 'all', '[]'::jsonb);
  perform tests.eq(r ->> 'outcome', 'invite_email', 'senza account → invite_email');
  -- Senza email: scheda manuale.
  r := public.add_member(tests.id('W1'), '{"full_name":"Manuale"}'::jsonb, 'none', '{}'::jsonb, 'all', '[]'::jsonb);
  perform tests.eq(r ->> 'outcome', 'created_manual', 'senza email → created_manual');
  -- Un account esistente: invito da accettare (consenso), non ingresso diretto.
  r := public.add_member(tests.id('W1'), '{"full_name":"Sara","email":"str@t.test"}'::jsonb, 'none', '{}'::jsonb, 'all', '[]'::jsonb);
  perform tests.eq(r ->> 'outcome', 'invited_in_app', 'account esistente → invited_in_app');
  perform tests.eq(
    (select status::text from public.workspace_members where id = (r ->> 'member_id')::uuid),
    'invited', 'l''invito non è ancora un ingresso');
  -- Di nuovo la stessa email: nessun duplicato.
  r := public.add_member(tests.id('W1'), '{"full_name":"Sara","email":"str@t.test"}'::jsonb, 'none', '{}'::jsonb, 'all', '[]'::jsonb);
  perform tests.eq(r ->> 'outcome', 'already_member', 'stessa email → già in azienda');

  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Regole «su me stesso» e «solo il titolare»
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.login('Ow');
  perform tests.ok(not private.is_restricted_self(tests.id('M_Ow')), 'il titolare non è limitato su sé stesso');
  perform tests.login('Co');
  perform tests.ok(private.is_restricted_self(tests.id('M_Co')), 'il collaboratore è limitato su sé stesso');
  perform tests.ok(not private.is_restricted_self(tests.id('M_Emp')), 'gli altri non sono «sé stesso»');

  -- Accessi e titolarità: solo titolare.
  perform tests.raises(
    format($f$select public.set_member_access(%L, 'collaborator', '{"staff":true}', 'all')$f$, tests.id('M_Emp')),
    'not_allowed', 'Co non concede permessi');
  perform tests.raises(format('select public.transfer_ownership(%L, %L)', tests.id('W1'), tests.id('M_Co2')),
    'not_allowed', 'Co non cede la titolarità');
  perform tests.raises(format('select public.remove_member(%L)', tests.id('M_Co')),
    'not_allowed', 'Co non toglie sé stesso: esce con leave()');

  perform tests.login('Ow');
  perform tests.raises(
    format($f$select public.set_member_access(%L, 'none')$f$, tests.id('M_Ow')),
    'use_transfer_ownership', 'il titolare non si retrocede da solo');
  perform tests.raises(format('select public.remove_member(%L)', tests.id('M_Ow')),
    'owner_cannot_be_removed', 'il titolare non viene rimosso dall''azienda');
  perform tests.raises(format('select public.leave(%L)', tests.id('M_Ow')),
    'owner_cannot_leave', 'il titolare non esce dall''azienda');

  -- Un dipendente senza account non può ricevere poteri di gestione.
  perform public.add_member(tests.id('W1'), '{"full_name":"Nuovo","email":"nuovo@t.test"}'::jsonb);
  perform tests.raises(
    format($f$select public.set_member_access(%L, 'collaborator', '{"shifts":true}', 'all')$f$,
           (select id from public.workspace_members where lower(email) = 'nuovo@t.test')),
    'needs_account', 'niente permessi a chi non ha un account');

  -- Il titolare si toglie dall'organico di una sede (ma resta titolare).
  perform public.remove_member(tests.id('M_Ow'), tests.id('V1'));
  perform tests.ok(exists (select 1 from public.venue_members
    where member_id = tests.id('M_Ow') and venue_id = tests.id('V1') and left_at is not null),
    'Ow esce dall''organico di V1');
  perform tests.ok(private.owns_workspace(tests.id('W1')), 'e resta titolare');

  perform tests.logout();
end $$;

-- ---------------------------------------------------------------------------
-- Ultimo titolare (vincolo differito)
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.logout();
  set constraints public.workspace_members_need_an_owner immediate;
  perform tests.raises(
    format('update public.workspace_members set authority = ''none'' where id = %L', tests.id('M_Ow')),
    'workspace_needs_an_owner', 'un''azienda non resta senza titolare');
end $$;

-- ---------------------------------------------------------------------------
-- Cessione della titolarità
-- ---------------------------------------------------------------------------
do $$
begin
  perform tests.login('Ow');
  perform public.transfer_ownership(tests.id('W1'), tests.id('M_Co2'));
  perform tests.ok(not private.owns_workspace(tests.id('W1')), 'Ow non è più titolare');
  perform tests.login('Co2');
  perform tests.ok(private.owns_workspace(tests.id('W1')), 'Co2 è il nuovo titolare');
  perform tests.logout();  -- la view privata non è leggibile da authenticated, per costruzione
  perform tests.eq((select count(*) from private.member_venue_grants g where g.user_id = tests.id('Ow')), 2::bigint,
    'Ow è ora collaboratore con tutte le sedi');
end $$;

-- ---------------------------------------------------------------------------
-- Aggancio delle schede all'account (gate: email confermata)
-- ---------------------------------------------------------------------------
do $$
declare
  v_new uuid := gen_random_uuid();
  v_unconf uuid := gen_random_uuid();
  v_member uuid;
begin
  perform tests.login('Co2');  -- titolare dopo la cessione
  perform public.add_member(tests.id('W1'), '{"full_name":"Lia","email":"lia@t.test"}'::jsonb);
  perform public.add_member(tests.id('W1'), '{"full_name":"Ugo","email":"ugo@t.test"}'::jsonb);
  perform tests.logout();

  -- Registrazione NON confermata: nessun aggancio.
  insert into auth.users (id, email, email_confirmed_at) values (v_unconf, 'ugo@t.test', null);
  perform tests.ok((select user_id is null from public.workspace_members where lower(email) = 'ugo@t.test'),
    'email non confermata: la scheda non si aggancia');
  -- Conferma: si aggancia.
  update auth.users set email_confirmed_at = now() where id = v_unconf;
  perform tests.eq((select user_id from public.workspace_members where lower(email) = 'ugo@t.test'), v_unconf,
    'confermata l''email la scheda si aggancia');

  -- Registrazione già confermata.
  insert into auth.users (id, email, email_confirmed_at) values (v_new, 'lia@t.test', now());
  perform tests.eq((select user_id from public.workspace_members where lower(email) = 'lia@t.test'), v_new,
    'registrazione con email confermata: aggancio immediato');
  perform tests.ok(exists (select 1 from public.profiles where id = v_new), 'il trigger crea il profilo');
  perform tests.ok(exists (select 1 from public.notifications where type = 'staff_linked' and related_id =
    (select id from public.workspace_members where lower(email) = 'lia@t.test')),
    'il titolare riceve «Scheda collegata»');
end $$;

-- ---------------------------------------------------------------------------
-- get_my_context
-- ---------------------------------------------------------------------------
do $$
declare c jsonb;
begin
  perform tests.login('Emp');
  c := public.get_my_context();
  perform tests.eq(jsonb_array_length(c -> 'memberships'), 2, 'Emp ha due appartenenze');
  perform tests.eq(
    (select count(*) from jsonb_array_elements(c -> 'memberships') m where m ->> 'authority' = 'owner'), 1::bigint,
    'una sola da titolare');
  perform tests.login('Str');
  perform tests.eq(jsonb_array_length(public.get_my_context() -> 'memberships'), 1,
    'Str ha un invito pendente (Sara, aggiunta dal titolare)');
  perform tests.anon();
  perform tests.raises('select public.get_my_context()', 'permission denied', 'anon non ha un contesto');
  perform tests.logout();
end $$;

rollback;
select 'identity: ok' as result;
