-- Rinomina il sostantivo «locale/locali» in «sede/sedi» nei testi che l'utente
-- legge davvero: i corpi delle notifiche scritti dai trigger e i messaggi di
-- errore sollevati dalle RPC. Il vocabolario del prodotto è cambiato (vedi
-- AGENTS.md): «locale» diceva ristorazione, «sede» tiene dentro hotel, catering,
-- discoteche e agenzie di eventi.
--
-- Perché una riscrittura dinamica e non 13 CREATE OR REPLACE copiati a mano:
-- queste funzioni sono state definite da una dozzina di migration diverse e
-- ricopiarle qui vorrebbe dire duplicare centinaia di righe che nessuno
-- rileggerà mai, con il rischio di riportare indietro una correzione applicata
-- nel frattempo. Qui si tocca **solo** il sostantivo, lasciando intatto tutto il
-- resto della definizione (SECURITY DEFINER, search_path, argomenti, ACL: li
-- porta con sé `pg_get_functiondef` + `CREATE OR REPLACE`, che conserva l'oid e
-- quindi i trigger già agganciati).
do $mig$
declare
  r record;
  src text;
begin
  for r in
    select p.oid
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'claim_staff_invite_send',
        'claim_venue_access_send',
        'link_staff_invites_for_user',
        'notify_on_assignment',
        'notify_on_assignment_removed',
        'notify_on_shift_change',
        'notify_on_staff_invite',
        'notify_on_staff_removed',
        'reassign_shift_assignment',
        'remove_staff_member',
        'resolve_shift_change_request',
        'sync_staff_member_from_person',
        'venue_access_notify'
      )
  loop
    src := pg_get_functiondef(r.oid);

    -- L'ordine conta: le forme con determinante prima di quella nuda, perché
    -- «sede» è femminile e l'articolo va concordato.
    src := replace(src, 'un altro locale', 'un''altra sede');
    src := replace(src, 'Un locale',       'Una sede');
    src := replace(src, 'un locale',       'una sede');
    src := replace(src, 'Il locale',       'La sede');
    src := replace(src, 'il locale',       'la sede');
    src := replace(src, 'del locale',      'della sede');
    src := replace(src, 'nome locale',     'nome della sede');
    src := regexp_replace(src, '\mlocali\M', 'sedi',  'g');
    src := regexp_replace(src, '\mlocale\M', 'sede',  'g');
    src := regexp_replace(src, '\mLocali\M', 'Sedi',  'g');
    src := regexp_replace(src, '\mLocale\M', 'Sede',  'g');

    execute src;
  end loop;
end
$mig$;
