-- Nuovo tipo di notifica: il promemoria di timbratura (revisione dipendente
-- E10). In una migration a sé: un valore aggiunto a un enum non si può usare
-- nella stessa transazione in cui nasce, e `notification_category` (SQL) lo
-- legge quando la si ricrea.

alter type public.notification_type add value if not exists 'clock_reminder';
