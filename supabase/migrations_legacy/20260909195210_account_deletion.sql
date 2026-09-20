-- Cancellazione account (requisito obbligatorio Google Play "User Data" e
-- Apple 5.1.1(v): se l'app permette di creare un account deve permettere di
-- cancellarlo, in-app e via URL web).
--
-- SCELTA DI FONDO: si anonimizza il profilo invece di cancellarlo. La riga
-- profiles resta come lapide (nome "Utente eliminato", nessun dato personale) e
-- tutto ciò che vi punta — conversazioni, turni, locali — continua a funzionare,
-- senza rendere nullable nessuna colonna e senza toccare RLS.
-- ⚠️ Perché la lapide sopravviva serve anche la migration successiva
-- (20260909195333), che toglie `profiles_id_fkey`: quella FK verso auth.users è
-- ON DELETE CASCADE, quindi cancellare l'utente di autenticazione porterebbe via
-- il profilo e, a cascata, locali/turni/assegnazioni.
--
-- Cosa NON viene distrutto, di proposito:
--   * lo storico ore dello staff: `shift_assignments` pende da `staff_members`,
--     che viene solo slegato dall'account. Sono registri del locale, non dati
--     personali del cameriere, e il commercialista ne ha bisogno.
--   * i locali e i turni passati di un ristoratore che si cancella: distruggerli
--     cancellerebbe lo storico ore di tutti i suoi dipendenti, che non hanno
--     chiesto nulla. Il locale viene marcato chiuso.
--   * le conversazioni: la controparte continua a vedere il thread, con il
--     mittente eliminato mostrato come "Utente eliminato".

alter table public.profiles add column if not exists deleted_at timestamptz;
alter table public.venues   add column if not exists closed_at  timestamptz;

comment on column public.profiles.deleted_at is
  'Account cancellato dall''utente: la riga resta come lapide anonima perché conversazioni, turni e locali vi puntano. Filtrare sempre deleted_at is null nelle viste pubbliche.';
comment on column public.venues.closed_at is
  'Locale chiuso perché il titolare ha cancellato l''account. Storico turni e ore conservati.';

-- La vetrina pubblica dei camerieri deve smettere di mostrare chi si è cancellato.
-- Firma e tipi identici all'originale, altrimenti CREATE OR REPLACE fallisce
-- sulla vista che la referenzia (vedi 20260710202137).
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
  where p.role = 'waiter'
    and p.deleted_at is null;
$$;

-- Routine di cancellazione. Prende l'id esplicito invece di auth.uid() perché
-- viene chiamata dalla Edge Function con la service_role dopo aver verificato
-- il JWT: revocata agli utenti autenticati, così un client non può eseguirla da
-- solo e restare con l'account di login vivo ma i dati già rimossi.
create or replace function public.delete_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_user;
  if not found then
    return;
  end if;

  if v_role = 'waiter' then
    -- Reputazione, candidature e scheda professionale sono dati personali suoi.
    delete from public.reviews            where waiter_id = p_user;
    delete from public.waiter_experiences where waiter_id = p_user;
    delete from public.waiter_profiles    where id        = p_user;
    delete from public.applications       where waiter_id = p_user;

    -- Inviti mai accettati: via. Collaborazioni attive: si slega l'account ma la
    -- scheda resta, altrimenti il locale perde le ore già lavorate.
    delete from public.staff_members
      where waiter_id = p_user and link_status = 'pending';
    update public.staff_members
      set waiter_id = null
      where waiter_id = p_user;
  else
    -- Il locale sopravvive per non distruggere lo storico altrui, ma va chiuso.
    update public.venues
      set closed_at = now()
      where owner_id = p_user and closed_at is null;

    -- I turni futuri ancora aperti non avrebbero più nessuno a gestirli.
    -- L'update fa scattare notify_on_shift_cancelled, che avvisa assegnati e
    -- candidati accettati: è il comportamento voluto, non un effetto collaterale.
    update public.shifts s
      set status = 'cancelled'
      where s.venue_id in (select v.id from public.venues v where v.owner_id = p_user)
        and s.date >= current_date
        and s.status <> 'cancelled';
  end if;

  -- Comuni a entrambi i ruoli.
  delete from public.push_tokens   where user_id = p_user;
  delete from public.notifications where user_id = p_user;

  -- La lapide: nessun dato personale, ma la riga resta perché conversazioni,
  -- turni e locali la referenziano.
  update public.profiles
    set full_name          = 'Utente eliminato',
        avatar_url         = null,
        phone              = null,
        bio                = null,
        city               = null,
        notification_prefs = '{}'::jsonb,
        deleted_at         = now()
    where id = p_user;
end;
$$;

revoke all on function public.delete_account(uuid) from anon, authenticated, public;

-- Identità in chat di un account cancellato. Senza questa toppa il ramo
-- cameriere non restituisce ALCUNA riga (la vetrina ora filtra i cancellati) e
-- il LEFT JOIN LATERAL in get_chat_counterparts darebbe nome NULL: la
-- controparte vedrebbe una conversazione senza nome invece di "Utente
-- eliminato". Il ramo ristoratore non ha il problema perché il locale
-- sopravvive alla cancellazione e dà ancora nome e logo.
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
      from public.waiter_public_cards w
      where w.id = p_user
      limit 1;
  end if;

  if not found then
    return query select 'Utente eliminato'::text, null::text;
  end if;
end;
$$;

revoke execute on function public.chat_counterpart(uuid, boolean) from anon, authenticated, public;
