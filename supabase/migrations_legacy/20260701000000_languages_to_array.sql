-- waiter_profiles.languages: da testo libero a text[] (multi-select).
-- Multi-select da lista curata → dati normalizzati e filtrabili
-- (es. `where 'Inglese' = any(languages)`), niente varianti "inglese"/"EN".
-- Non distruttivo: eventuali valori esistenti diventano un array a 1 elemento.
alter table public.waiter_profiles
  alter column languages type text[]
  using case
    when languages is null or btrim(languages) = '' then '{}'::text[]
    else array[btrim(languages)]
  end;

-- Array vuoto invece di null: query e UI non devono gestire il caso null.
alter table public.waiter_profiles
  alter column languages set default '{}'::text[],
  alter column languages set not null;
