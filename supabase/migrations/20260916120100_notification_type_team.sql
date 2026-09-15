-- I tipi di notifica dei collaboratori, in una migration da soli.
--
-- Postgres non permette di usare un valore di enum nella stessa transazione in
-- cui lo si aggiunge: separare il file è l'unico modo (stesso motivo di
-- 20260916100100 e 20260915110000).
--
-- Tre valori e non uno, perché portano a tre posti diversi:
--   team_linked  → al collaboratore: "ora gestisci <sede>"      → /(manager)/(tabs)
--   team_joined  → al titolare: "ha accettato"                  → /(manager)/team
--   team_removed → al collaboratore: accesso revocato           → nessuna rotta
alter type public.notification_type add value if not exists 'team_linked';
alter type public.notification_type add value if not exists 'team_joined';
alter type public.notification_type add value if not exists 'team_removed';
