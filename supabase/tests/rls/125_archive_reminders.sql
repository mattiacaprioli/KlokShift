-- M11: promemoria dell'archivio. Una volta per fase e per titolare; nulla alle
-- aziende operative o con l'archivio già scaduto.
begin;

do $$
declare
  w2 uuid := tests.id('W2');
  v_until timestamptz;
begin
  perform tests.logout();
  perform tests.eq(has_function_privilege('authenticated', 'private.run_archive_reminders()', 'EXECUTE'),
    false, 'il client non fa partire i promemoria');
  perform tests.eq(has_table_privilege('authenticated', 'public.archive_reminders', 'SELECT'),
    false, 'il client non legge la coda delle email');

  -- W1 e W2 sono operative: nessun promemoria.
  perform tests.eq(private.queue_archive_reminders(now()), 0, 'aziende operative: niente');

  -- La gratuità di W2 (titolare Emp) finisce ieri: archivio.
  update public.workspace_access_periods set starts_at = now() - interval '1 year',
    revoked_at = now() - interval '1 day' where workspace_id = w2;
  v_until := (private.workspace_access_at(w2, now()) ->> 'archive_until')::timestamptz;
  perform tests.eq(private.workspace_access_at(w2, now()) ->> 'state', 'archive', 'W2 in archivio');

  perform tests.eq(private.queue_archive_reminders(now()), 1, 'inizio archivio: un promemoria al titolare');
  perform tests.eq((select kind || '/' || email from public.archive_reminders where workspace_id = w2),
    'started/emp@t.test', 'fase e indirizzo del titolare');
  perform tests.eq((select count(*)::integer from public.notifications
    where user_id = tests.id('Emp') and type = 'archive_reminder' and related_id = w2), 1, 'e la notifica nell''app');
  perform tests.eq((select body like '%fino al ' || private.rome_date(v_until) || '%' from public.notifications
    where user_id = tests.id('Emp') and type = 'archive_reminder'), true, 'con la data del termine');
  perform tests.eq(private.queue_archive_reminders(now()), 0, 'il giorno dopo non si ripete');

  perform tests.eq(private.queue_archive_reminders(v_until - interval '20 days'), 1, 'a 30 giorni');
  perform tests.eq(private.queue_archive_reminders(v_until - interval '19 days'), 0, 'una volta sola');
  perform tests.eq(private.queue_archive_reminders(v_until - interval '3 days'), 1, 'a 7 giorni');
  perform tests.eq(private.queue_archive_reminders(v_until - interval '2 days'), 0, 'una volta sola');
  perform tests.eq(private.queue_archive_reminders(v_until + interval '1 day'), 0, 'archivio scaduto: niente');
  perform tests.eq((select string_agg(kind, ',' order by array_position(array['started', '30_days', '7_days'], kind)) from public.archive_reminders
    where workspace_id = w2), 'started,30_days,7_days', 'tre promemoria in tutto');

  -- Un'azienda che entra in archivio con meno di 7 giorni rimasti riceve solo l'ultimo.
  delete from public.archive_reminders where workspace_id = w2;
  perform tests.eq(private.queue_archive_reminders(v_until - interval '1 day'), 1, 'in ritardo: un promemoria');
  perform tests.eq((select string_agg(kind, ',') from public.archive_reminders where workspace_id = w2),
    '7_days', 'solo quello dei 7 giorni');
end $$;

rollback;
select 'archive reminders: ok' as result;
