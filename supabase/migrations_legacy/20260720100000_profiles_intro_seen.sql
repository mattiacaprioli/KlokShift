-- Flag "ha visto l'intro di primo utilizzo" (onboarding educativo, per ruolo).
-- Distinto da onboarding_complete (che è il wizard di setup profilo del cameriere):
-- questo copre il carosello di valore mostrato una volta a cameriere e ristoratore.
-- Cross-device (sul profilo, non sul dispositivo) → sopravvive alla reinstallazione.
alter table public.profiles
  add column if not exists intro_seen boolean not null default false;
