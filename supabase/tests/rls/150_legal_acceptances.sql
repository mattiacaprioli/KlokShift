-- Accettazione di termini e accordo sul trattamento dei dati (art. 28):
-- la registra un titolare, la vedono in attesa titolari e collaboratori,
-- mai i dipendenti. Una versione superata viene rifiutata.
begin;

do $$
declare
  w_new uuid;
  w_old uuid;
begin
  -- Prima di ogni accettazione: W1 è in attesa per chi la gestisce.
  perform tests.login('Ow');
  perform tests.ok(exists (select 1 from public.get_pending_legal_acceptances() p
                            where p.workspace_id = tests.id('W1') and p.can_accept),
    'il titolare vede W1 da accettare');

  perform tests.login('Co');
  perform tests.ok(exists (select 1 from public.get_pending_legal_acceptances() p
                            where p.workspace_id = tests.id('W1') and not p.can_accept),
    'il collaboratore vede W1 in attesa, senza poter accettare');
  perform tests.raises(format('select public.accept_legal_terms(%L, %L)', tests.id('W1'), '1'),
    'owner_only', 'il collaboratore non accetta');

  -- Emp è dipendente di W1 e titolare di W2: vede solo W2.
  perform tests.login('Emp');
  perform tests.ok(exists (select 1 from public.get_pending_legal_acceptances() p
                            where p.workspace_id = tests.id('W2') and p.can_accept),
    'il titolare di W2 la vede da accettare');
  perform tests.ok(not exists (select 1 from public.get_pending_legal_acceptances() p
                                where p.workspace_id = tests.id('W1')),
    'il dipendente di W1 non è mai in attesa per W1');

  -- Versione superata, poi accettazione idempotente.
  perform tests.login('Ow');
  perform tests.raises(format('select public.accept_legal_terms(%L, %L)', tests.id('W1'), '0'),
    'legal_version_outdated', 'versione superata rifiutata');
  perform public.accept_legal_terms(tests.id('W1'), '1');
  perform public.accept_legal_terms(tests.id('W1'), '1');
  perform tests.logout();
  perform tests.eq((select count(*)::integer from private.legal_acceptances a
                     where a.workspace_id = tests.id('W1')), 1, 'una sola riga per versione');
  perform tests.ok((select a.user_id = tests.id('Ow') from private.legal_acceptances a
                     where a.workspace_id = tests.id('W1')), 'registra chi ha accettato');
  perform tests.login('Ow');
  perform tests.ok(not exists (select 1 from public.get_pending_legal_acceptances() p
                                where p.workspace_id = tests.id('W1')),
    'dopo l''accettazione W1 non è più in attesa per il titolare');

  perform tests.login('Co');
  perform tests.ok(not exists (select 1 from public.get_pending_legal_acceptances() p
                                where p.workspace_id = tests.id('W1')),
    'basta un titolare: il collaboratore non è più fermo');

  -- Alla creazione: con la versione l'azienda nasce accettata, senza resta in attesa.
  perform tests.login('Ow');
  w_new := public.create_workspace('Nuova', '1');
  perform tests.ok(not exists (select 1 from public.get_pending_legal_acceptances() p
                                where p.workspace_id = w_new),
    'creata con l''accettazione: niente attesa');
  w_old := public.create_workspace('Altra');
  perform tests.ok(exists (select 1 from public.get_pending_legal_acceptances() p
                            where p.workspace_id = w_old and p.can_accept),
    'creata da un client vecchio: resta da accettare');
  perform tests.raises('select public.create_workspace(''X'', ''0'')',
    'legal_version_outdated', 'creazione con versione superata rifiutata');
end $$;

select tests.anon();
select tests.raises('select * from public.get_pending_legal_acceptances()', 'permission denied', 'anon escluso');
rollback;
select 'legal acceptances: ok' as result;
