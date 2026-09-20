-- Vista pubblica "biglietto da visita" del cameriere: SOLO colonne sicure
-- (niente phone/email). La legge il sito web di recensione (via anon) per
-- mostrare chi si sta recensendo, e l'app per la reputazione portabile.
-- security_invoker = false → la vista espone una proiezione curata bypassando
-- la RLS di profiles (che altrimenti nasconderebbe le righe altrui e il phone).
create or replace view public.waiter_public_cards
with (security_invoker = false)
as
select
  p.id,
  p.full_name,
  p.avatar_url,
  p.city,
  wp.primary_role,
  coalesce(wp.rating_avg, 0)::numeric(3, 2) as rating_avg,
  coalesce(wp.rating_count, 0)::int as rating_count
from public.profiles p
left join public.waiter_profiles wp on wp.id = p.id
where p.role = 'waiter';

grant select on public.waiter_public_cards to anon, authenticated;
