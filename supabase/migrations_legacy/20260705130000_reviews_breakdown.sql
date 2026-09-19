-- Distribuzione dei voti (conteggio per stella) per il riepilogo della lista
-- recensioni. Le reviews sono già a lettura pubblica (RLS "reviews: public read");
-- la funzione espone solo conteggi aggregati. Serve anche alla futura vista
-- lato ristoratore. Nome OUT `cnt` per non confonderlo con l'aggregato count().
create or replace function public.get_rating_breakdown(p_waiter uuid)
returns table(rating int, cnt bigint)
language sql
stable
as $$
  select r.rating, count(*)::bigint as cnt
  from public.reviews r
  where r.waiter_id = p_waiter and r.status = 'published'
  group by r.rating
  order by r.rating desc;
$$;

grant execute on function public.get_rating_breakdown(uuid) to anon, authenticated;

-- Indice per filtro/ordinamento per voto. L'indice (waiter_id, created_at desc)
-- esistente copre già l'ordinamento "recenti".
create index if not exists reviews_waiter_rating_created_idx
  on public.reviews (waiter_id, rating, created_at desc);
