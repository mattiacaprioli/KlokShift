-- Migration separata: un nuovo valore enum non può essere usato nella stessa
-- transazione in cui viene creato (il trigger che lo usa sta nella migration dopo).
alter type public.notification_type add value if not exists 'staff_removed';
