-- Nuovo tipo di notifica: chi aveva rifiutato un turno lo conferma di nuovo
-- (revisione dipendente E05). In una migration a sé: un valore aggiunto a un
-- enum non si può usare nella stessa transazione in cui nasce.

alter type public.notification_type add value if not exists 'shift_reconfirmed';
