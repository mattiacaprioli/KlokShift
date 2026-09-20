-- `staff_linked`: il professionista si è registrato con l'email a cui era stato
-- invitato, e la scheda che il locale aveva già preparato è ora la sua.
--
-- File separato dalla migration che lo usa (20260916100200) per lo stesso motivo
-- già documentato in 20260915110000: Postgres non permette di **usare** un
-- valore di enum nella stessa transazione in cui lo aggiunge, e ogni file di
-- migration è una transazione.
alter type public.notification_type add value if not exists 'staff_linked';
