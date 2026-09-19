-- Piano di abbonamento per profilo (telaio monetizzazione).
-- Un solo campo valido per entrambi i ruoli: oggi il ricavo previsto è dal
-- ristoratore (gestione personale), ma il cameriere potrebbe avere vantaggi Pro
-- in futuro → stesso interruttore.
--
-- Default 'pro': la monetizzazione NON è ancora attiva, quindi oggi tutti sono
-- di fatto Pro (accesso completo). Quando si vorrà monetizzare, basterà cambiare
-- il default a 'free' e i gate ("lucchetti") lato client si attivano da soli.
-- Il valore autorevole resta lato DB; il client non deve scriverlo (la RLS
-- "profiles: own read/write" lo consentirebbe, ma il piano lo imposterà il
-- backend/fatturazione, non l'utente).

alter table public.profiles
  add column if not exists plan text not null default 'pro'
    check (plan in ('free', 'pro'));
