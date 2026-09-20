-- Nuovo valore dell'enum in una migration separata: Postgres non permette di
-- usare un valore aggiunto a un enum nella stessa transazione che lo aggiunge,
-- quindi il trigger che lo usa sta nella migration successiva (stesso schema
-- adottato per shift_assigned / staff_removed / shift_cancelled / shift_updated).
alter type public.notification_type add value if not exists 'shift_unassigned';
