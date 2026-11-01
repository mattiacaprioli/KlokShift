-- Tipi di notifica della bozza (2026-10-31, design bozza e pubblicazione):
--   shift_published        una notifica per persona quando chi gestisce pubblica
--                          le bozze (publish_shifts, 20261103000300);
--   shift_drafts_reminder  a chi ha «Turni» quando una bozza inizia entro 24 ore
--                          (20261103000400).
-- Il prefisso shift_ li mette da soli nella categoria «Turni»
-- (public.notification_category ha shifts come ripiego, la dashboard li
-- classifica dal prefisso). In una migration a sé: un valore aggiunto a un enum
-- non si può usare nella stessa transazione in cui nasce.

alter type public.notification_type add value if not exists 'shift_published';
alter type public.notification_type add value if not exists 'shift_drafts_reminder';
