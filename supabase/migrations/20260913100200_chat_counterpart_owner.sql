-- In chat, con chi sto parlando quando il titolare ha tre locali?
--
-- Il ramo gestore di `chat_counterpart` (ultima revisione in 20260910120100)
-- faceva:
--
--     select v.name, v.logo_url from public.venues v where v.owner_id = p_user limit 1;
--
-- `limit 1` **senza `order by`**: già oggi, con due sedi, nome e logo della
-- controparte possono cambiare tra due letture — e il thread è uno solo per
-- coppia (indice unico `conversations_waiter_manager_key`, 20260715180000), quindi
-- non esiste una sede "giusta" da mostrare.
--
-- ── La regola ────────────────────────────────────────────────────────────────
--
--   · **una** sede aperta → nome e logo della sede. Identico a prima: chi ha un
--     locale solo continua a chattare con "Trattoria da Mario", nessuna
--     regressione.
--   · **più** sedi (o nessuna) → `profiles.full_name` del titolare, con il logo
--     della sede più vecchia.
--
-- Perché non il nome di una delle sedi quando ce ne sono tre: se Giuseppe scrive
-- di un turno a Milano e il professionista legge "Trattoria da Mario" (Roma),
-- l'etichetta è *attivamente* fuorviante — peggio del non-determinismo di oggi,
-- che almeno sbaglia a caso. Il thread è col titolare, e l'unico nome vero è il
-- suo. Il logo resta quello della sede più vecchia perché è il marchio con cui il
-- gruppo è nato e dà il riconoscimento visivo nella lista; `order by created_at,
-- id` perché due sedi create nello stesso istante non devono potersi invertire.
--
-- Nessuna migration su `conversations`: la decisione di prodotto è che un
-- dipendente e il suo datore di lavoro abbiano **un** filo, non uno per edificio.
--
-- ── Un bug preesistente, sanato qui ─────────────────────────────────────────
--
-- 20260909195210 aveva aggiunto la toppa `if not found then return query select
-- 'Utente eliminato'`, e 20260910120100 (più recente) **l'ha perduta**. Oggi la
-- controparte di un account cancellato torna zero righe → il `left join lateral`
-- in `get_chat_counterparts` dà `name` NULL → il client cade sul fallback
-- generico ("Utente") e il trigger delle notifiche su "Qualcuno". Ripristinata.

create or replace function public.chat_counterpart(p_user uuid, p_is_manager boolean)
returns table (name text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venues int;
begin
  if p_is_manager then
    select count(*) into v_venues
      from public.venues v
     where v.owner_id = p_user and v.closed_at is null;

    if v_venues = 1 then
      -- Una sede sola: si chatta con "Trattoria da Mario", come sempre.
      return query
        select v.name, v.logo_url
          from public.venues v
         where v.owner_id = p_user and v.closed_at is null;
    else
      -- Più sedi (o nessuna): il thread è col TITOLARE, non con una sua sede.
      return query
        select
          coalesce(
            nullif(btrim(p.full_name), ''),
            (select v.name
               from public.venues v
              where v.owner_id = p_user and v.closed_at is null
              order by v.created_at, v.id
              limit 1),
            'Il tuo datore di lavoro'
          ),
          (select v.logo_url
             from public.venues v
            where v.owner_id = p_user and v.closed_at is null
            order by v.created_at, v.id
            limit 1)
        from public.profiles p
       where p.id = p_user;
    end if;
  else
    return query
      select coalesce(w.full_name, 'Cameriere'), w.avatar_url
        from public.get_waiter_public_card(p_user) w
       limit 1;
  end if;

  -- Ripristinata da 20260909195210: senza, il LEFT JOIN LATERAL in
  -- get_chat_counterparts dà nome NULL e la controparte vede una conversazione
  -- senza nome invece di "Utente eliminato".
  if not found then
    return query select 'Utente eliminato'::text, null::text;
  end if;
end;
$$;

-- Helper interno: usato solo dai DEFINER (trigger + RPC), non esposto.
revoke execute on function public.chat_counterpart(uuid, boolean) from anon, authenticated, public;

comment on function public.chat_counterpart(uuid, boolean) is
  'Identità della controparte di una conversazione, per lato. Ramo gestore: una sede → nome e logo della sede; più sedi → full_name del titolare (il thread è uno per coppia, non per sede) con il logo della sede più vecchia. Ramo professionista: get_waiter_public_card. Fonte UNICA: la usano get_chat_counterparts (client) e notify_on_new_message (notifiche) — se divergessero, la lista chat e la notifica mostrerebbero due mittenti diversi per lo stesso messaggio.';

-- ---------------------------------------------------------------------------
-- notify_on_new_message: NIENTE da fare — e va scritto, perché non venga "rifatto"
-- ---------------------------------------------------------------------------
-- La versione con il `limit 1` inline su `venues` è quella di 20260715180000
-- (righe 116-120), **sostituita** da 20260716110000, che la fa passare da
-- `chat_counterpart` proprio per non avere due verità sullo stesso nome. Nessuna
-- migration successiva la ridefinisce: la versione viva chiama la funzione qui
-- sopra e si corregge da sé. Verificabile con:
--     select prosrc from pg_proc where proname = 'notify_on_new_message';
--
-- `get_chat_counterparts` invariata.
