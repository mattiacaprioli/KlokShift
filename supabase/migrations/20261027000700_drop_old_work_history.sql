-- Via `get_my_work_history(p_limit, p_offset)`, lo storico personale a pagine
-- numerate (20260920001200, riscritto in 20260926000000).
--
-- Dal 22/09 l'app legge lo storico da `get_my_work_history_page` (a cursore) e
-- `get_my_work_history_range` (per periodo); questa non la chiama più nessuna
-- schermata, né dell'app né della dashboard. Di solito si aspetta che le build
-- vecchie escano di circolazione, ma l'app non è ancora sugli store: le sole
-- build installate sono quelle di prova del fondatore. Toglierla adesso evita
-- di doverla tenere compatibile a ogni modifica di `private.my_work_history`.

drop function if exists public.get_my_work_history(integer, integer);
