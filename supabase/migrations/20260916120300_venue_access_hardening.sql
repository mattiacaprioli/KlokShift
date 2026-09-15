-- Chiudere la porta lasciata aperta da 20260916120000, e dire al titolare cosa
-- sta succedendo quando l'indirizzo che scrive è già di un professionista.
--
-- ⚠️ Prerequisito: 20260916120000 e 20260916120200.

-- ---------------------------------------------------------------------------
-- 1. `user_id` non si sceglie a mano
-- ---------------------------------------------------------------------------
-- La policy `venue_access: owner all` controlla solo `owner_id = auth.uid()`:
-- basta per garantire che la sede sia sua, non per garantire **chi** ci fa
-- entrare. Con una POST diretta all'API REST un titolare può scrivere
-- `user_id = <uuid di chiunque>, status = 'active'` su una propria sede, e la
-- vittima non ha mai acconsentito a niente.
--
-- Il danno non è solo che quella persona si ritrova una sede altrui in lista.
-- È che `venues_owner_not_delegate` le impedisce da quel momento di creare un
-- locale proprio (`is_delegate`), e `venue_access_one_company` impedisce al suo
-- vero datore di lavoro di invitarla. Un account bloccato da un estraneo.
--
-- Qui l'unica cosa che lega la riga a una persona reale torna a essere
-- l'indirizzo: `user_id` deve essere l'account **di quell'email**, confermata,
-- con ruolo `manager`. È lo stesso invariante di `link_venue_access_for_user`,
-- applicato anche al ramo "il titolare collega subito un account esistente".
create or replace function public.venue_access_user_matches_email()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
  v_role  public.user_role;
begin
  if new.user_id is null then
    return new;
  end if;

  -- Deroga: una persona che collabora già con questo titolare non va
  -- riverificata. Serve per `addTeamVenue` (una sede in più a chi c'è già) e per
  -- chi ha cambiato indirizzo dopo essersi collegato. Non apre nulla: per avere
  -- una riga viva con questo titolare bisogna essere passati dal controllo sotto
  -- almeno una volta.
  if exists (
    select 1 from public.venue_access a
     where a.user_id  = new.user_id
       and a.owner_id = new.owner_id
       and a.status  <> 'revoked'
       and a.id      <> new.id
  ) then
    return new;
  end if;

  select lower(u.email) into v_email
    from auth.users u
    where u.id = new.user_id and u.email_confirmed_at is not null;

  if v_email is null or new.email is null
     or v_email <> lower(trim(new.email)) then
    raise exception 'user_email_mismatch';
  end if;

  select p.role into v_role from public.profiles p where p.id = new.user_id;
  if v_role is distinct from 'manager' then
    raise exception 'not_a_manager';
  end if;

  return new;
end;
$$;

revoke execute on function public.venue_access_user_matches_email()
  from anon, authenticated, public;

-- ⚠️ Il nome viene dopo `venue_access_one_company` in ordine alfabetico, ed è
-- l'ordine in cui Postgres fa scattare i trigger di pari evento: il controllo
-- "una sola azienda" resta il primo a parlare, come prima di questa migration.
drop trigger if exists venue_access_user_matches_email on public.venue_access;
create trigger venue_access_user_matches_email
  before insert or update on public.venue_access
  for each row execute function public.venue_access_user_matches_email();

-- ---------------------------------------------------------------------------
-- 2. Cercare un account per indirizzo, **con il suo ruolo**
-- ---------------------------------------------------------------------------
-- Rimpiazza `find_manager_by_email` (20260916120200), che tornava zero righe sia
-- quando l'indirizzo non esiste sia quando esiste ma è di un professionista. Due
-- situazioni opposte: nella prima si manda un invito, nella seconda l'invito è
-- carta straccia — chi lo riceve non può registrarsi, ha già un account, e
-- `link_venue_access_for_user` rifiuta comunque i ruoli diversi da `manager`.
-- Il titolare deve saperlo subito, non scoprirlo da una riga che resta `pending`
-- per sempre.
--
-- Non espone nulla di nuovo: `find_waiter_by_email` dice già a un titolare se un
-- indirizzo ha un account da professionista.
create or replace function public.find_team_candidate(p_email text)
returns table (id uuid, full_name text, avatar_url text, role public.user_role)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_url, p.role
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and u.email_confirmed_at is not null
    and p.id <> (select auth.uid())
    and exists (
      select 1 from public.profiles me
      where me.id = (select auth.uid()) and me.role = 'manager'
    )
  limit 1;
$$;

revoke execute on function public.find_team_candidate(text) from anon, public;
grant execute on function public.find_team_candidate(text) to authenticated;

drop function if exists public.find_manager_by_email(text);

-- ---------------------------------------------------------------------------
-- 3. La notifica non promette quello che non c'è
-- ---------------------------------------------------------------------------
-- «Trovi i turni e l'organico nella tua app»: l'organico non c'è. Le RPC
-- `security definer` che lo servono controllano ancora `owner_id = auth.uid()`
-- (è la F2), quindi un collaboratore che apre Organico trova una lista vuota.
-- Il resto della funzione è identico a 20260916120200.
create or replace function public.venue_access_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_venue  text;
  v_person text;
  v_owner  text;
begin
  select v.name into v_venue from public.venues v where v.id = new.venue_id;

  -- ⚠️ I rami sono separati per `tg_op` e non uniti in una condizione sola: in
  -- un trigger di INSERT `old` non è assegnato, e leggerne un campo solleva
  -- "record old is not assigned yet" — dentro un AFTER trigger vuol dire far
  -- fallire l'inserimento dell'accesso.
  if tg_op = 'INSERT' then
    if new.user_id is not null and new.status = 'active' then
      insert into public.notifications (user_id, type, title, body, related_id)
      values (
        new.user_id,
        'team_linked',
        'Ora gestisci ' || coalesce(v_venue, 'un locale'),
        'Trovi i turni del locale nella tua app',
        new.venue_id
      );
    end if;
    return null;
  end if;

  -- L'invito per indirizzo ha trovato il suo account: lo sanno in due.
  -- ⚠️ Anche una riga revocata e riaperta passa di qui (`old.status = 'revoked'`
  -- e `new.status = 'active'`): chi rientra va avvisato come la prima volta.
  if new.status = 'active'
     and (old.status <> 'active' or (old.user_id is null and new.user_id is not null))
     and new.user_id is not null then
    select p.full_name into v_person from public.profiles p where p.id = new.user_id;

    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      new.user_id,
      'team_linked',
      'Ora gestisci ' || coalesce(v_venue, 'un locale'),
      'Trovi i turni del locale nella tua app',
      new.venue_id
    );

    -- Il titolare lo sa già quando è lui a riaprire l'accesso: la notifica è per
    -- il caso in cui la persona è arrivata da sola, registrandosi.
    if old.user_id is null then
      insert into public.notifications (user_id, type, title, body, related_id)
      values (
        new.owner_id,
        'team_joined',
        'Invito accettato',
        coalesce(v_person, new.email, 'La persona che hai invitato')
          || ' ora gestisce ' || coalesce(v_venue, 'il locale'),
        new.venue_id
      );
    end if;
  end if;

  -- Accesso revocato: si dice, non si toglie in silenzio. `team_removed` non
  -- porta da nessuna parte (la sede non c'è più per lui), come `staff_removed`.
  if new.status = 'revoked' and old.status <> 'revoked' and new.user_id is not null then
    select p.full_name into v_owner from public.profiles p where p.id = new.owner_id;
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      new.user_id,
      'team_removed',
      'Accesso revocato',
      coalesce(v_owner, 'Il titolare') || ' ha revocato il tuo accesso a '
        || coalesce(v_venue, 'un locale'),
      null
    );
  end if;

  return null;
end;
$$;

revoke execute on function public.venue_access_notify() from anon, authenticated, public;
