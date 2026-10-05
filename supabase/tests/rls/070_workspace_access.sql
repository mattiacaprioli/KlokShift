-- Fondazione commerciale additiva: periodi, prova, conteggi e isolamento.
-- Questo blocco verifica il motore di accesso; non dichiara già applicati i
-- futuri guard su tutte le RPC operative, Storage o pagamenti Paddle.
begin;

create function tests.commercial_service() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('request.jwt.claim.sub', '', true);
  perform set_config('role', 'service_role', true);
end $$;
grant execute on function tests.commercial_service() to public;

-- Superficie commerciale chiusa: le RPC di lettura non aprono le tabelle, e
-- l'oracolo con istante di prova non è un'API con cui il client cambia orologio.
do $$
begin
  perform tests.eq(has_function_privilege('service_role',
    'public.grant_workspace_access(uuid,text,text,integer,timestamp with time zone,timestamp with time zone,text)',
    'EXECUTE'), true, 'il servizio può assegnare una concessione');
  perform tests.eq(has_function_privilege('authenticated',
    'private.workspace_access_at(uuid,timestamp with time zone)', 'EXECUTE'),
    false, 'il client non sceglie l''istante dell''oracolo commerciale');
  perform tests.eq(has_function_privilege('anon',
    'private.workspace_access_at(uuid,timestamp with time zone)', 'EXECUTE'),
    false, 'anon non esegue l''oracolo commerciale');

  perform tests.login('Ow');
  perform tests.raises('select * from public.workspace_commercial_state',
    'permission denied', 'il cliente non legge lo stato commerciale direttamente');
  perform tests.raises('select * from public.workspace_access_periods',
    'permission denied', 'il cliente non legge tutte le concessioni');
  perform tests.raises('update public.workspace_commercial_state set trial_started_at = now()',
    'permission denied', 'il cliente non cambia l''inizio prova');
  perform tests.raises('delete from public.workspace_access_periods',
    'permission denied', 'il cliente non cancella periodi');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''team'',1,now(),null,''test'')',
    tests.id('W1')), 'permission denied', 'il titolare non si concede gratuità');

  perform tests.anon();
  perform tests.raises(format('select public.get_workspace_access(%L)', tests.id('W1')),
    'permission denied', 'anon non legge accesso commerciale');
  perform tests.raises(format('select public.start_workspace_trial(%L)', tests.id('W1')),
    'permission denied', 'anon non avvia prove');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''team'',1,now(),null,''test'')',
    tests.id('W1')), 'permission denied', 'anon non assegna concessioni');
  perform tests.logout();
end $$;

-- Una nuova azienda parte in setup. La prova Team/una sede comincia una volta
-- sola, dalla richiesta del titolare dopo la prima sede, con istanti server.
do $$
declare
  ws uuid;
  venue uuid;
  r jsonb;
  started timestamptz;
  period_id uuid;
  pending_ws uuid;
  next_owner uuid;
  original_owner uuid;
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Commerciale: nuova azienda');
  r := public.get_workspace_access(ws);
  perform tests.eq(r ->> 'state', 'setup', 'nessuna prova avviata implicitamente');
  perform tests.eq((r ->> 'can_operate')::boolean, false, 'setup non concede operatività');
  perform tests.eq((r ->> 'can_read')::boolean, true, 'setup conserva la lettura autorizzata');
  perform tests.raises(format('select public.start_workspace_trial(%L)', ws),
    'trial_requires_open_venue', 'la prova richiede una sede aperta');

  venue := public.create_venue(ws, 'Prima sede');
  perform public.start_workspace_trial(ws);
  r := public.get_workspace_access(ws);
  perform tests.eq(r ->> 'state', 'operational', 'la prova valida dà accesso');
  perform tests.eq(r ->> 'source', 'trial', 'la fonte è la prova, non un pagamento');
  perform tests.eq(r ->> 'plan', 'team', 'la prova usa la capacità Team');
  perform tests.eq((r #>> '{limits,venues}')::integer, 1, 'la prova include una sede');
  perform tests.ok(r #> '{limits,people}' = 'null'::jsonb, 'Team non ha tetto commerciale persone');
  perform tests.eq((r ->> 'operational_from')::timestamptz, now(), 'inizio impostato dal server');
  perform tests.eq((r ->> 'operational_until')::timestamptz,
    now() + interval '720 hours', 'prova di trenta giorni di durata');
  perform tests.logout();
  select trial_started_at into started from public.workspace_commercial_state where workspace_id = ws;
  select id into period_id from public.workspace_access_periods where workspace_id = ws and kind = 'trial';

  perform tests.login('Ow');
  perform public.start_workspace_trial(ws);
  perform public.create_venue(ws, 'Seconda sede: nessun reset');
  perform public.start_workspace_trial(ws);
  perform tests.logout();
  perform tests.eq((select trial_started_at from public.workspace_commercial_state where workspace_id = ws),
    started, 'retry e nuove sedi non riavviano la prova');
  perform tests.eq((select count(*) from public.workspace_access_periods where workspace_id = ws and kind = 'trial'),
    1::bigint, 'retry non duplica il periodo prova');
  perform tests.eq((select id from public.workspace_access_periods where workspace_id = ws and kind = 'trial'),
    period_id, 'il periodo prova rimane lo stesso');

  perform tests.login('Ow');
  select id into original_owner from public.workspace_members
    where workspace_id = ws and user_id = tests.id('Ow');
  next_owner := (public.add_member(ws,
    '{"full_name":"Cora: nuova titolare","email":"co2@t.test"}'::jsonb) ->> 'member_id')::uuid;
  perform tests.login('Co2');
  perform public.respond_to_invite(next_owner, true);
  perform tests.login('Ow');
  perform public.transfer_ownership(ws, next_owner);
  perform tests.login('Co2');
  perform tests.eq(public.start_workspace_trial(ws), period_id,
    'trasferire la titolarità non assegna una seconda prova');
  perform public.transfer_ownership(ws, original_owner);
  perform tests.logout();
  perform tests.eq((select trial_started_at from public.workspace_commercial_state where workspace_id = ws),
    started, 'la prova rimane aziendale anche dopo il trasferimento');

  -- Una prova terminata non rinasce tramite lo stesso comando.
  update public.workspace_access_periods set starts_at = now() - interval '31 days',
    ends_at = now() - interval '1 day' where id = period_id;
  perform tests.login('Ow');
  perform public.start_workspace_trial(ws);
  r := public.get_workspace_access(ws);
  perform tests.eq(r ->> 'state', 'archive', 'retry dopo fine prova non riapre operatività');
  perform tests.eq((r ->> 'can_operate')::boolean, false, 'prova conclusa resta conclusa');
  perform tests.logout();

  delete from public.workspace_access_periods where id = period_id;
  perform tests.login('Ow');
  perform tests.raises(format('select public.start_workspace_trial(%L)', ws),
    'trial_already_used', 'rimuovere il periodo non riabilita una prova già consumata');
  perform tests.logout();

  -- È uno stato di revisione esplicito, come per il backfill delle aziende
  -- esistenti: nessun periodo o diritto gratuito viene inventato.
  perform tests.login('Ow');
  pending_ws := public.create_workspace('Commerciale: azienda da revisionare');
  perform public.create_venue(pending_ws, 'Sede da revisionare');
  perform tests.logout();
  insert into public.workspace_commercial_state (workspace_id, migration_review_required)
    values (pending_ws, true);
  perform tests.login('Ow');
  r := public.get_workspace_access(pending_ws);
  perform tests.eq(r ->> 'state', 'migration_pending', 'revisione commerciale distinguibile');
  perform tests.eq((r ->> 'can_operate')::boolean, false, 'revisione non assegna accesso');
  perform tests.raises(format('select public.start_workspace_trial(%L)', pending_ws),
    'commercial_migration_required', 'un''azienda da revisionare non si autoassegna la prova');
  perform tests.commercial_service();
  perform public.grant_workspace_access(pending_ws, 'transition', 'team', 1,
    now(), now() + interval '24 hours', 'Revisione esplicita del cliente');
  perform tests.logout();
  perform tests.eq((select migration_review_required from public.workspace_commercial_state
    where workspace_id = pending_ws), false, 'solo una concessione fidata chiude la revisione');
  perform tests.login('Ow');
  perform tests.eq(public.get_workspace_access(pending_ws) ->> 'state', 'operational',
    'la classificazione esplicita rende valido il periodo di transizione');
  perform tests.logout();
end $$;

-- Le autorizzazioni del membro precedono la lettura dello stato commerciale.
do $$
declare
  invited uuid;
begin
  perform tests.login('Co');
  perform tests.raises(format('select public.start_workspace_trial(%L)', tests.id('W1')),
    'not_allowed', 'il collaboratore non avvia la prova');
  perform tests.login('Emp');
  perform tests.raises(format('select public.start_workspace_trial(%L)', tests.id('W1')),
    'not_allowed', 'un dipendente titolare altrove non avvia la prova in W1');
  perform tests.login('Str');
  perform tests.raises(format('select public.get_workspace_access(%L)', tests.id('W1')),
    'not_allowed', 'estraneo non legge accesso e conteggi');

  perform tests.login('Ow');
  invited := (public.add_member(tests.id('W1'),
    '{"full_name":"Invitata commerciale","email":"str@t.test"}'::jsonb) ->> 'member_id')::uuid;
  perform tests.login('Str');
  perform tests.raises(format('select public.get_workspace_access(%L)', tests.id('W1')),
    'not_allowed', 'un invito non accettato non autorizza la lettura commerciale');
  perform tests.logout();
  update public.workspace_members set status = 'left', left_at = now() where id = invited;
  perform tests.login('Str');
  perform tests.raises(format('select public.get_workspace_access(%L)', tests.id('W1')),
    'not_allowed', 'un membro uscito non legge la scheda commerciale');
  perform tests.logout();

  update public.workspaces set deleted_at = now() where id = tests.id('W2');
  perform tests.login('Emp');
  perform tests.raises(format('select public.get_workspace_access(%L)', tests.id('W2')),
    'not_allowed', 'un''azienda eliminata non riappare come operativa');
  perform tests.logout();
  update public.workspaces set deleted_at = null where id = tests.id('W2');

  perform tests.raises(format('select public.get_workspace_access(%L)', tests.id('W1')),
    'not_authenticated', 'la RPC richiede una sessione con identità');
  perform tests.raises(format('select public.start_workspace_trial(%L)', tests.id('W1')),
    'not_authenticated', 'avviare la prova richiede identità');
end $$;

-- Il conteggio globale non dipende dall'ambito visibile del collaboratore:
-- owner in organico, persona in due sedi, schede manuali e inviti occupati.
do $$
declare
  r jsonb;
  manual uuid;
  occupied_invite uuid;
  closed_member uuid;
  closed_venue uuid;
begin
  perform tests.login('Ow');
  perform public.set_member_venue(tests.id('M_Emp'), tests.id('V2'));
  manual := (public.add_member(tests.id('W1'), '{"full_name":"Scheda manuale commerciale"}'::jsonb,
    'none', '{}'::jsonb, 'all', jsonb_build_array(jsonb_build_object('venue_id', tests.id('V2'))))
    ->> 'member_id')::uuid;
  occupied_invite := (public.add_member(tests.id('W1'),
    '{"full_name":"Invitata con posto","email":"str@t.test"}'::jsonb,
    'none', '{}'::jsonb, 'all', jsonb_build_array(jsonb_build_object('venue_id', tests.id('V2'))))
    ->> 'member_id')::uuid;
  -- Il precedente invito Str è left: add_member lo ripristina, senza duplicarlo.
  closed_venue := public.create_venue(tests.id('W1'), 'Sede chiusa commerciale');
  closed_member := (public.add_member(tests.id('W1'), '{"full_name":"Solo sede chiusa"}'::jsonb,
    'none', '{}'::jsonb, 'all', jsonb_build_array(jsonb_build_object('venue_id', closed_venue)))
    ->> 'member_id')::uuid;
  perform public.set_venue_closed(closed_venue, true);
  r := public.get_workspace_access(tests.id('W1'));
  perform tests.eq((r #>> '{usage,people}')::integer, 6,
    'Ow, Co, Emp, Emp2, manuale e invitata: persone uniche su sedi aperte');
  perform tests.eq((r #>> '{usage,venues}')::integer, 2, 'le sedi chiuse non consumano capacità');
  perform tests.logout();

  -- Co2 gestisce ma non lavora: non è un settimo posto. Co ha authority turni,
  -- ambito V1 e una riga di organico: conta come persona, senza eccezioni.
  perform tests.login('Co');
  r := public.get_workspace_access(tests.id('W1'));
  perform tests.eq((r #>> '{usage,people}')::integer, 6,
    'ambito ristretto non sottostima il conteggio aziendale');
  perform tests.eq((r #>> '{usage,venues}')::integer, 2, 'il conteggio sedi è dell''intera azienda');
  perform tests.login('Emp');
  r := public.get_workspace_access(tests.id('W1'));
  perform tests.eq(r -> 'usage', 'null'::jsonb, 'un dipendente non riceve conteggi gestionali');
  r := public.get_workspace_access(tests.id('W2'));
  perform tests.eq((r #>> '{usage,people}')::integer, 0,
    'essere titolare senza organico non consuma un posto');
  perform tests.logout();

  update public.venue_members set left_at = now() where member_id = manual;
  r := private.workspace_access_at(tests.id('W1'), now());
  perform tests.eq((r #>> '{usage,people}')::integer, 5, 'uscita dall''organico libera il posto');
  update public.workspace_members set status = 'left', left_at = now() where id = occupied_invite;
  r := private.workspace_access_at(tests.id('W1'), now());
  perform tests.eq((r #>> '{usage,people}')::integer, 4, 'un membro left non occupa posti residui');
end $$;

-- Concessioni: privilegi service reali, validazione e nessun periodo paid.
do $$
declare
  granted uuid;
begin
  perform tests.commercial_service();
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''trial'',''team'',1,now(),now()+interval ''30 days'',''test'')',
    tests.id('W1')), 'invalid_access_kind', 'la prova passa dal comando dedicato');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''paid'',''team'',1,now(),now()+interval ''30 days'',''test'')',
    tests.id('W1')), 'invalid_access_kind', 'non si inventano periodi pagati senza integrazione provider');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''pro'',1,now(),null,''test'')',
    tests.id('W1')), 'invalid_access_plan', 'piano storico non è un piano commerciale');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''team'',0,now(),null,''test'')',
    tests.id('W1')), 'invalid_access_capacity', 'capacità sedi positiva obbligatoria');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_temporary'',''team'',1,now(),null,''test'')',
    tests.id('W1')), 'invalid_access_period', 'solo la gratuità permanente può avere fine nulla');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''transition'',''team'',1,now(),now(),''test'')',
    tests.id('W1')), 'invalid_access_period', 'un intervallo vuoto non concede accesso');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''team'',1,now(),now()+interval ''1 day'',''test'')',
    tests.id('W1')), 'invalid_access_period', 'gratuità a vita distinta da quella temporanea');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''team'',1,now(),null,'' '')',
    tests.id('W1')), 'access_reason_required', 'intervento amministrativo motivato');
  perform tests.raises(format(
    'select public.grant_workspace_access(%L,''complimentary_lifetime'',''team'',1,now(),null,''test'')',
    gen_random_uuid()), 'workspace_not_found', 'nessuna concessione a un''azienda inesistente');
  granted := public.grant_workspace_access(tests.id('W2'), 'complimentary_lifetime',
    'base', 3, now() - interval '1 day', null, 'Azienda test selezionata');
  perform tests.ok(granted is not null, 'concessione service restituisce riferimento');
  perform tests.logout();

  perform tests.eq((select kind from public.workspace_access_periods where id = granted),
    'complimentary_lifetime', 'il beneficio è aziendale e gratuito');
  perform tests.eq((select ends_at from public.workspace_access_periods where id = granted),
    null::timestamptz, 'nessuna scadenza fittizia del beneficio permanente');
  perform tests.login('Emp');
  perform tests.eq(public.get_workspace_access(tests.id('W2')) ->> 'state', 'operational',
    'l''azienda gratuita a vita è operativa');
  perform tests.eq(public.get_workspace_access(tests.id('W1')) ->> 'state', 'setup',
    'la gratuità W2 non passa all''altra azienda dello stesso account');
  perform tests.logout();
end $$;

-- I periodi datati permettono confini deterministici senza sleep né clock
-- controllabile dal browser. Dodici mesi sono di calendario in Europe/Rome.
do $$
declare
  ws uuid;
  finite uuid;
  later uuid;
  lifetime uuid;
  r jsonb;
  starts timestamptz := '2026-01-01 10:00:00+01';
  finish timestamptz := '2026-10-25 12:00:00+01';
begin
  perform tests.login('Ow');
  ws := public.create_workspace('Commerciale: calendario e precedenza');
  perform public.create_venue(ws, 'Sede calendario');
  perform tests.commercial_service();
  finite := public.grant_workspace_access(ws, 'complimentary_temporary', 'base',
    2, starts, finish, 'Concessione finita');
  perform tests.logout();

  r := private.workspace_access_at(ws, starts - interval '1 microsecond');
  perform tests.eq((r ->> 'can_operate')::boolean, false, 'un periodo futuro non concede accesso');
  r := private.workspace_access_at(ws, starts);
  perform tests.eq(r ->> 'state', 'operational', 'inizio del periodo inclusivo');
  perform tests.eq((r #>> '{limits,people}')::integer, 30, 'Base conserva il tetto 30');
  perform tests.eq((r #>> '{limits,venues}')::integer, 2, 'capacità concessa al periodo');
  r := private.workspace_access_at(ws, finish - interval '1 microsecond');
  perform tests.eq((r ->> 'can_operate')::boolean, true, 'accesso fino alla fine esclusiva');
  r := private.workspace_access_at(ws, finish);
  perform tests.eq(r ->> 'state', 'archive', 'la fine del periodo termina operatività');
  perform tests.eq((r ->> 'can_operate')::boolean, false, 'archivio non è un periodo operativo');
  perform tests.eq((r ->> 'can_read')::boolean, true, 'archivio conserva lettura');
  perform tests.eq((r ->> 'can_complete_attendance')::boolean, true,
    'finestra limitata per presenze pregresse');
  perform tests.eq((r ->> 'attendance_until')::timestamptz, finish + interval '168 hours',
    'le rettifiche hanno una fine distinta dall''archivio');
  perform tests.eq((r ->> 'archive_until')::timestamptz, '2027-10-25 12:00:00+02'::timestamptz,
    'dodici mesi conservano l''ora civile, anche se cambia offset DST');

  r := private.workspace_access_at(ws, finish + interval '168 hours');
  perform tests.eq((r ->> 'can_complete_attendance')::boolean, false,
    'la finestra presenze finisce senza un ottavo giorno');
  perform tests.eq((r ->> 'can_read')::boolean, true, 'lettura continua dopo le rettifiche');
  r := private.workspace_access_at(ws, '2027-10-25 12:00:00+02'::timestamptz - interval '1 microsecond');
  perform tests.eq((r ->> 'can_read')::boolean, true, 'ultimo istante dell''archivio');
  r := private.workspace_access_at(ws, '2027-10-25 12:00:00+02'::timestamptz);
  perform tests.eq(r ->> 'state', 'expired', 'termine archivio esclusivo');
  perform tests.eq((r ->> 'can_read')::boolean, false, 'fine archivio non concede lettura');
  perform tests.eq((r ->> 'can_complete_attendance')::boolean, false, 'nessuna scrittura dopo archivio');

  -- Revoca efficace prima del termine: non conservare un anno dalla fine
  -- originaria che non ha più dato accesso operativo.
  update public.workspace_access_periods set revoked_at = '2026-02-28 12:00:00+01' where id = finite;
  r := private.workspace_access_at(ws, '2026-02-28 12:00:00+01');
  perform tests.eq((r ->> 'operational_until')::timestamptz, '2026-02-28 12:00:00+01'::timestamptz,
    'revoca limita la fine effettiva');
  perform tests.eq((r ->> 'archive_until')::timestamptz, '2027-02-28 12:00:00+01'::timestamptz,
    'l''archivio parte dalla fine effettiva');

  -- Anche il giorno bisestile si risolve come anniversario di calendario.
  update public.workspace_access_periods set starts_at = '2024-02-01 10:00:00+01',
    ends_at = '2024-02-29 12:00:00+01', revoked_at = null where id = finite;
  r := private.workspace_access_at(ws, '2024-03-01 12:00:00+01');
  perform tests.eq((r ->> 'archive_until')::timestamptz, '2025-02-28 12:00:00+01'::timestamptz,
    'anniversario del 29 febbraio, non 365 giorni arbitrari');

  perform tests.commercial_service();
  later := public.grant_workspace_access(ws, 'transition', 'team', 4,
    '2026-01-01 10:00:00+01', '2026-12-31 10:00:00+01', 'Transizione autorizzata');
  lifetime := public.grant_workspace_access(ws, 'complimentary_lifetime', 'base', 1,
    '2026-02-01 10:00:00+01', null, 'Beneficio permanente selezionato');
  perform tests.logout();
  r := private.workspace_access_at(ws, '2026-03-01 12:00:00+01');
  perform tests.eq(r ->> 'source', 'complimentary_lifetime', 'la concessione permanente ha precedenza');
  perform tests.eq((r #>> '{limits,venues}')::integer, 1, 'le capacità sovrapposte non si sommano');
  perform tests.eq((r ->> 'operational_until')::timestamptz, null::timestamptz,
    'nessun termine per il beneficio permanente valido');
  r := private.workspace_access_at(ws, '2090-01-01 10:00:00+01');
  perform tests.eq((r ->> 'can_operate')::boolean, true, 'la fine beta non estingue gratuità a vita');

  update public.workspace_access_periods set revoked_at = '2026-04-01 10:00:00+02' where id = lifetime;
  r := private.workspace_access_at(ws, '2026-04-01 10:00:00+02');
  perform tests.eq(r ->> 'source', 'transition', 'alla revoca resta il periodo valido indipendente');
  perform tests.eq((r #>> '{limits,venues}')::integer, 4, 'la capacità proviene dal periodo selezionato');
  r := private.workspace_access_at(ws, '2027-01-01 10:00:00+01');
  perform tests.eq((r ->> 'operational_until')::timestamptz, '2026-12-31 10:00:00+01'::timestamptz,
    'l''ultimo periodo operativo governa archivio, non la prima concessione');
end $$;

rollback;
select 'workspace access: ok' as result;
