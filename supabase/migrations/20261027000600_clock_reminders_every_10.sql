-- Promemoria di timbratura: il controllo ogni 10 minuti invece che ogni 5
-- (decisione dell'utente del 27/10). Metà delle esecuzioni; il promemoria
-- d'entrata arriva fra 5 e 15 minuti dopo l'inizio, quello d'uscita fra 20 e 30
-- minuti dopo la fine. Le finestre di `private.queue_clock_reminders` restano
-- larghe abbastanza (entrata fino a 60 minuti, uscita fino a 12 ore) da non
-- perdere nessun turno, anche corto.
--
-- `cron.schedule` con lo stesso nome aggiorna il lavoro esistente.

do $$
begin
  perform cron.schedule('clock-reminders', '*/10 * * * *', 'select private.run_clock_reminders()');
exception when others then
  raise notice 'pg_cron non disponibile: promemoria di timbratura non riprogrammati (%).', sqlerrm;
end $$;
