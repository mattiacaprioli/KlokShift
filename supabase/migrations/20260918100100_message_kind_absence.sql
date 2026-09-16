-- Le card di ferie, permessi e malattia nel thread di chat col titolare.
--
-- In un file a sé per la stessa ragione di 20260918100000: la migration che
-- scrive le RPC inserisce messaggi con questi valori.
--
--   absence_request   la richiesta (o la malattia comunicata)
--   absence_response  la decisione del titolare, o il ritiro della richiesta
alter type public.message_kind add value if not exists 'absence_request';
alter type public.message_kind add value if not exists 'absence_response';
