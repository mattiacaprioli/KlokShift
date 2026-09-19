-- Fix advisor "Security Definer View" (0010, ERROR) su public.waiter_public_cards,
-- SENZA introdurre i WARN 0028/0029 ("SECURITY DEFINER function eseguibile via REST").
--
-- Il bypass RLS resta necessario (il sito anon deve leggere i "biglietti" e la policy
-- 'reviews: public insert' li verifica). Lo spostiamo da una VISTA DEFINER (bypass
-- implicito, sconsigliato) a una FUNZIONE SECURITY DEFINER collocata in uno schema
-- PRIVATO non esposto da PostgREST (quindi non chiamabile come /rest/v1/rpc/...).
-- La vista public resta security_invoker=true e delega alla funzione, con nome e
-- colonne IDENTICI => app, tipi generati e altre policy invariati; le tabelle base
-- restano completamente chiuse ad anon.

-- Schema privato non-REST: solo USAGE ad anon/authenticated per poter invocare la
-- funzione tramite la vista (nessun endpoint REST viene creato su questo schema).
create schema if not exists private;
grant usage on schema private to anon, authenticated;

-- 1) Sorgente curata come funzione DEFINER (solo colonne "sicure", niente PII).
create or replace function private.waiter_public_cards_src()
returns table (
  id uuid,
  full_name text,
  avatar_url text,
  city text,
  primary_role text,
  rating_avg numeric,
  rating_count integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    p.id,
    p.full_name,
    p.avatar_url,
    p.city,
    wp.primary_role,
    coalesce(wp.rating_avg, 0)::numeric(3, 2),
    coalesce(wp.rating_count, 0)::int
  from public.profiles p
  left join public.waiter_profiles wp on wp.id = p.id
  where p.role = 'waiter';
$$;

revoke all on function private.waiter_public_cards_src() from public;
grant execute on function private.waiter_public_cards_src() to anon, authenticated;

-- 2) La vista gira come invoker e delega alla funzione DEFINER privata. I cast
--    (numeric(3,2)/int) tengono i tipi colonna IDENTICI alla vista esistente
--    => CREATE OR REPLACE riesce senza dover droppare la policy che la referenzia.
create or replace view public.waiter_public_cards
with (security_invoker = true) as
select
  id,
  full_name,
  avatar_url,
  city,
  primary_role,
  rating_avg::numeric(3, 2) as rating_avg,
  rating_count::int as rating_count
from private.waiter_public_cards_src();

grant select on public.waiter_public_cards to anon, authenticated;

-- 3) Rimuove l'eventuale variante pubblica della funzione (esposta via REST) creata
--    in un passaggio intermedio: no-op su un DB pulito, cleanup sul progetto remoto.
drop function if exists public.waiter_public_cards_src();

-- 4) Fix WARN "Function Search Path Mutable" (0011). Entrambe le funzioni gia'
--    qualificano gli oggetti con schema, quindi basta fissare il search_path.
alter function public.update_updated_at() set search_path = '';
alter function public.get_rating_breakdown(uuid) set search_path = '';
