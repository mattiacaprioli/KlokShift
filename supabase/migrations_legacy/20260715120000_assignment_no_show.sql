-- Presenza sui turni interni.
-- Aggiunge il valore 'no_show' all'enum assignment_status: un assegnato marcato
-- 'no_show' conta 0 ore nel riepilogo (assente al turno concluso).
-- NB: 'alter type ... add value' non può essere usato nella stessa transazione in
-- cui il valore viene referenziato: sta quindi in una migrazione dedicata,
-- applicata prima di ogni codice/migrazione che lo usa.
alter type public.assignment_status add value if not exists 'no_show';
