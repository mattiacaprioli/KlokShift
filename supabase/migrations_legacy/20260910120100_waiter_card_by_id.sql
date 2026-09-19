-- Performance / Disk IO — parte 2: la scheda pubblica del professionista passa
-- da full scan a lookup per chiave.
--
-- Il problema NON è `security definer` in sé, è che il filtro sta FUORI.
-- `private.waiter_public_cards_src()` è una funzione SQL set-returning con
-- prosecdef = true e proconfig non nullo: Postgres non può inlinarla
-- (inline_set_returning_function la rifiuta). Quindi
--
--     select * from public.waiter_public_cards where id = $1
--
-- esegue la funzione PER INTERO — scansione di tutti i profiles con role
-- 'waiter' joinati a waiter_profiles — e applica il filtro solo DOPO.
-- Una riga restituita, l'intera tabella profili letta.
--
-- Chi pagava questo prezzo:
--   • il client, a ogni apertura di home/profilo/QR/scheda cameriere;
--   • chat_counterpart, quindi get_chat_counterparts, che fa un left join
--     lateral → N full scan a ogni apertura della lista chat;
--   • il trigger notify_on_new_message → un full scan PER OGNI MESSAGGIO inviato;
--   • la policy "reviews: public insert" → tutta la vetrina camerieri
--     materializzata a ogni recensione inserita dal sito pubblico con anon key.
--
-- Soluzione: una variante PARAMETRICA. Resta `security definer` (serve, per
-- bypassare la RLS di profiles come prima), ma il filtro sta dentro il corpo →
-- index scan su profiles_pkey, una riga.
--
-- ⚠️ Il bypass RLS non torna in una vista `public` security definer: è
-- esattamente il fix di sicurezza di 20260710202137. Resta confinato in una
-- funzione, si sposta soltanto il filtro.

-- ---------------------------------------------------------------------------
-- 1) La funzione parametrica
-- ---------------------------------------------------------------------------
-- Colonne, coalesce e cast identici a private.waiter_public_cards_src()
-- (20260909195210): la proiezione pubblica non cambia di una virgola, incluso
-- il filtro deleted_at che tiene fuori gli account cancellati.
create or replace function public.get_waiter_public_card(p_waiter uuid)
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
  where p.id = p_waiter
    and p.role = 'waiter'
    and p.deleted_at is null;
$$;

-- Stessa esposizione della vista, che anon già poteva leggere: nessun dato in
-- più diventa visibile. anon serve al sito recensioni (web-review/).
grant execute on function public.get_waiter_public_card(uuid) to anon, authenticated;

comment on function public.get_waiter_public_card(uuid) is
  'Scheda pubblica di UN professionista. Da preferire sempre alla vista waiter_public_cards per le letture per id: la vista non è inlinabile e scansiona tutta profiles.';

comment on view public.waiter_public_cards is
  'Vetrina pubblica dei professionisti. ⚠️ Non inlinabile (la sorgente è una funzione SECURITY DEFINER): un WHERE esterno NON viene spinto dentro e la lettura costa un full scan di profiles. Per leggere una singola scheda usare public.get_waiter_public_card(uuid).';

-- ---------------------------------------------------------------------------
-- 2) chat_counterpart passa alla funzione parametrica
-- ---------------------------------------------------------------------------
-- Identica a 20260716110000 tranne il ramo cameriere. Toglie un full scan di
-- profiles per ogni messaggio inviato e per ogni conversazione in lista.
create or replace function public.chat_counterpart(p_user uuid, p_is_manager boolean)
returns table (name text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_is_manager then
    return query
      select v.name, v.logo_url
      from public.venues v
      where v.owner_id = p_user
      limit 1;
  else
    return query
      select coalesce(w.full_name, 'Cameriere'), w.avatar_url
      from public.get_waiter_public_card(p_user) w
      limit 1;
  end if;
end;
$$;

-- Helper interno: usato solo dai DEFINER (trigger + RPC), non esposto.
revoke execute on function public.chat_counterpart(uuid, boolean) from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 3) La policy di insert recensione smette di materializzare la vetrina
-- ---------------------------------------------------------------------------
-- Identica a 20260705120000 tranne la sorgente dell'exists. Il motivo per cui
-- lì si usava la vista invece di profiles resta valido — serve il bypass RLS,
-- perché anon non vede alcuna riga di profiles — ed è garantito anche qui.
drop policy if exists "reviews: public insert" on public.reviews;
create policy "reviews: public insert"
  on public.reviews for insert
  to anon, authenticated
  with check (
    rating between 1 and 5
    and char_length(coalesce(comment, '')) <= 500
    and exists (
      select 1 from public.get_waiter_public_card(waiter_id)
    )
  );
