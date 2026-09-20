-- L'invito di un collaboratore: stessa meccanica dell'organico, altro destinatario.
--
-- Nessun token, nessun magic link: chi riceve l'email si registra con **quel**
-- indirizzo, e l'aggancio avviene al momento della registrazione confermata. Il
-- link dell'email non autorizza niente — se qualcun altro lo apre, non succede
-- nulla. È la stessa scelta di 20260916100000, per la stessa ragione.
--
-- ⚠️ Prerequisito: 20260916100000/100100/100200 (email sulle schede staff e
-- linker degli inviti) devono essere già applicate. Questa migration rimpiazza
-- `notification_category()` e il trigger `profiles_link_staff_invites`, che
-- nascono lì.

-- ---------------------------------------------------------------------------
-- 1. Categoria delle notifiche nuove
-- ---------------------------------------------------------------------------
-- Bucket 'staff' e non uno nuovo: aggiungere una categoria vuol dire aggiungere
-- un interruttore in Impostazioni, e "collaboratori" non è una cosa che si
-- silenzia — sono tre notifiche in tutta la vita di un account.
create or replace function public.notification_category(t public.notification_type)
returns text
language sql
immutable
set search_path = ''
as $$
  select case t
    when 'new_message'    then 'messages'
    when 'staff_invite'   then 'staff'
    when 'staff_response' then 'staff'
    when 'staff_removed'  then 'staff'
    when 'staff_linked'   then 'staff'
    when 'team_linked'    then 'staff'
    when 'team_joined'    then 'staff'
    when 'team_removed'   then 'staff'
    else 'shifts'  -- application_* + shift_* (candidature e turni)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Trovare un gestore già registrato
-- ---------------------------------------------------------------------------
-- Gemella di `find_waiter_by_email` (20260712085513): l'email vive in
-- `auth.users`, quindi serve DEFINER. Serve al ramo "la persona ha già un
-- account topWaitr": in quel caso non parte nessuna email, si scrive subito
-- `user_id` e l'accesso è attivo.
create or replace function public.find_manager_by_email(p_email text)
returns table (id uuid, full_name text, avatar_url text)
language sql
security definer
set search_path = ''
as $$
  select p.id, p.full_name, p.avatar_url
  from auth.users u
  join public.profiles p on p.id = u.id
  where lower(u.email) = lower(trim(p_email))
    and p.role = 'manager'
    and p.id <> (select auth.uid())
    and exists (
      select 1 from public.profiles me
      where me.id = (select auth.uid()) and me.role = 'manager'
    )
  limit 1;
$$;

revoke execute on function public.find_manager_by_email(text) from anon, public;
grant execute on function public.find_manager_by_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Le notifiche, da un trigger solo
-- ---------------------------------------------------------------------------
-- Tutte e tre le notifiche nascono da un cambiamento di questa riga, quindi
-- stanno qui e non sparse fra la RPC di aggancio e il data layer: chi collega un
-- account con una `update` diretta (il titolare che aggiunge un gestore già
-- registrato) deve produrre gli stessi avvisi di chi ci arriva registrandosi.
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
    -- Il titolare ha aggiunto una persona già registrata: avvisa solo lei, lui
    -- lo sa già e si prenderebbe una notifica per ogni sede spuntata.
    if new.user_id is not null and new.status = 'active' then
      insert into public.notifications (user_id, type, title, body, related_id)
      values (
        new.user_id,
        'team_linked',
        'Ora gestisci ' || coalesce(v_venue, 'un locale'),
        'Trovi i turni e l''organico nella tua app',
        new.venue_id
      );
    end if;
    return null;
  end if;

  -- L'invito per indirizzo ha trovato il suo account: lo sanno in due.
  if old.user_id is null and new.user_id is not null and new.status = 'active' then
    select p.full_name into v_person from public.profiles p where p.id = new.user_id;

    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      new.user_id,
      'team_linked',
      'Ora gestisci ' || coalesce(v_venue, 'un locale'),
      'Trovi i turni e l''organico nella tua app',
      new.venue_id
    );

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

drop trigger if exists venue_access_notify on public.venue_access;
create trigger venue_access_notify
  after insert or update on public.venue_access
  for each row execute function public.venue_access_notify();

-- ---------------------------------------------------------------------------
-- 4. L'aggancio alla registrazione
-- ---------------------------------------------------------------------------
-- ⚠️ `email_confirmed_at is not null` è qui per la stessa ragione che vale per
-- l'organico, e pesa di più: chi entra da questa porta non vede i propri turni,
-- vede quelli di tutti. Senza il controllo, registrarsi con l'indirizzo di un
-- altro — senza mai provare di possederlo — basterebbe a entrare nella gestione
-- di un locale.
create or replace function public.link_venue_access_for_user(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email  text;
  v_role   public.user_role;
  v_linked integer := 0;
  r        record;
begin
  select lower(u.email) into v_email
    from auth.users u
    where u.id = p_user and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  select p.role into v_role from public.profiles p where p.id = p_user;
  -- Solo un account "locale" gestisce un locale. Un professionista invitato per
  -- sbaglio non si ritrova la dashboard di qualcun altro: in F3 la promozione di
  -- un membro dell'organico passerà da un'altra strada, non da un indirizzo.
  if v_role is distinct from 'manager' then
    return 0;
  end if;

  for r in
    select a.id from public.venue_access a
     where lower(a.email) = v_email
       and a.user_id is null
       and a.status = 'pending'
     order by a.created_at
  loop
    -- Riga per riga, e ogni errore si ferma qui: un invito da un'altra azienda
    -- (il trigger `venue_access_one_company` solleva) o una riga già collegata a
    -- questo account non devono far saltare gli inviti legittimi che seguono.
    begin
      update public.venue_access
         set user_id = p_user, status = 'active'
       where id = r.id;
      v_linked := v_linked + 1;
    exception when others then
      null;
    end;
  end loop;

  return v_linked;
end;
$$;

revoke execute on function public.link_venue_access_for_user(uuid)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. Lo stesso trigger di prima, con un ramo in più
-- ---------------------------------------------------------------------------
-- Un secondo trigger AFTER INSERT su `profiles` sarebbe un secondo posto in cui
-- ricordarsi che qui dentro **non si può sollevare**: un'eccezione fa fallire
-- l'insert di `ensureProfile`, cioè blocca la registrazione. Meglio un ramo in
-- più in quello che esiste già.
create or replace function public.link_staff_invites_on_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Qualunque bug qui dentro deve costare un aggancio mancato (recuperabile con
  -- `claim_staff_invites`), mai un utente che non riesce a entrare nell'app.
  begin
    perform public.link_staff_invites_for_user(new.id);
  exception when others then
    null;
  end;
  begin
    perform public.link_venue_access_for_user(new.id);
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke execute on function public.link_staff_invites_on_profile()
  from anon, authenticated, public;

-- La rete di sicurezza lato client copre ora entrambi i casi. Il nome resta:
-- è già chiamata da `ensureProfile` e rinominarla vorrebbe dire una finestra in
-- cui l'app pubblicata chiama una funzione che non esiste più.
create or replace function public.claim_staff_invites()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.link_staff_invites_for_user((select auth.uid()))
       + public.link_venue_access_for_user((select auth.uid()));
$$;

revoke execute on function public.claim_staff_invites() from anon, public;
grant execute on function public.claim_staff_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Claim dell'invio email (la chiama solo l'Edge Function, con service_role)
-- ---------------------------------------------------------------------------
-- Gemella di `claim_staff_invite_send`. Il tetto delle 24 ore è **condiviso**
-- fra i due inviti: contarli separatamente vorrebbe dire che un account
-- compromesso ne manda quaranta invece di venti.
create or replace function public.claim_venue_access_send(p_access uuid, p_owner uuid)
returns table (email text, owner_name text, venue_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_recent integer;
begin
  select a.id, a.owner_id, a.email, a.user_id, a.venue_id,
         a.invited_at, a.invite_count
    into r
    from public.venue_access a
    where a.id = p_access
    for update;

  if r.id is null            then raise exception 'not_owner';      end if;
  if r.owner_id <> p_owner   then raise exception 'not_owner';      end if;
  if r.user_id is not null   then raise exception 'already_linked'; end if;
  if r.email is null         then raise exception 'no_email';       end if;

  if r.invite_count >= 5 then raise exception 'rate_limited'; end if;
  if r.invited_at is not null and r.invited_at > now() - interval '15 minutes' then
    raise exception 'rate_limited';
  end if;

  select (select count(*) from public.staff_people sp
           where sp.owner_id = p_owner and sp.invited_at > now() - interval '24 hours')
       + (select count(*) from public.venue_access va
           where va.owner_id = p_owner and va.invited_at > now() - interval '24 hours')
    into v_recent;
  if v_recent >= 20 then raise exception 'rate_limited'; end if;

  update public.venue_access
     set invited_at = now(), invite_count = invite_count + 1
   where id = p_access;

  return query
    select r.email,
           coalesce(p.full_name, 'Un locale'),
           coalesce(v.name, 'un locale')
      from public.profiles p
      left join public.venues v on v.id = r.venue_id
     where p.id = p_owner;
end;
$$;

revoke execute on function public.claim_venue_access_send(uuid, uuid)
  from anon, authenticated, public;
