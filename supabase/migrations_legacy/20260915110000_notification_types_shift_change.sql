-- Tre tipi di notifica nuovi, in un file tutto loro.
--
-- Postgres non permette di **usare** un valore di enum nella stessa transazione
-- che lo aggiunge: se questa `alter type` stesse nella migration che scrive le
-- funzioni, il primo insert fallirebbe con «unsafe use of new value». Stessa
-- ragione e stessa forma di 20260909193300, 20260715170000, 20260715150000.
--
--   shift_change_request   il professionista chiede di essere sostituito
--   shift_change_response  il titolare ha deciso (approvata / rifiutata)
--   shift_declined         il professionista ha rifiutato un turno assegnato
--
-- `shift_declined` chiude un buco che c'era da sempre: nessun trigger girava
-- sugli UPDATE di `shift_assignments`, quindi un rifiuto arrivava al titolare
-- solo se in quel momento aveva l'app aperta e collegata al realtime.
--
-- Nessuna di queste finisce in una categoria nuova delle preferenze:
-- `notification_category()` (20260716120000) manda in 'shifts' tutto ciò che non
-- è messaggio o staff, che è esattamente dove vanno.
alter type public.notification_type add value if not exists 'shift_change_request';
alter type public.notification_type add value if not exists 'shift_change_response';
alter type public.notification_type add value if not exists 'shift_declined';
