-- Fix RLS: l'insert anonimo in `reviews` veniva sempre rifiutato (42501).
-- La WITH CHECK precedente faceva `exists (select 1 from profiles ...)`, ma quella
-- subquery è valutata col ruolo `anon`, che per la RLS di `profiles` non vede
-- alcuna riga → l'exists era sempre falso → nessun cliente poteva recensire.
--
-- Fix: verificare il destinatario tramite la vista `waiter_public_cards`, che gira
-- come owner (security_invoker=false) e a cui anon ha GRANT SELECT → bypassa la RLS
-- di profiles restando comunque limitata ai soli camerieri.
drop policy if exists "reviews: public insert" on public.reviews;
create policy "reviews: public insert"
  on public.reviews for insert
  to anon, authenticated
  with check (
    rating between 1 and 5
    and char_length(coalesce(comment, '')) <= 500
    and exists (
      select 1 from public.waiter_public_cards w
      where w.id = waiter_id
    )
  );
