-- Tre tipi di notifica per ferie, permessi e malattia, in un file tutto loro.
--
-- Postgres non permette di **usare** un valore di enum nella stessa transazione
-- che lo aggiunge («unsafe use of new value»): stessa forma di 20260915110000.
--
--   absence_request   il professionista chiede ferie o un permesso
--   absence_response  il titolare ha deciso (approvata / rifiutata)
--   absence_sick      il professionista comunica una malattia (non si approva)
--
-- Finiscono nella categoria 'staff' delle preferenze: `notification_category()`
-- viene riscritta in 20260918100200.
alter type public.notification_type add value if not exists 'absence_request';
alter type public.notification_type add value if not exists 'absence_response';
alter type public.notification_type add value if not exists 'absence_sick';
