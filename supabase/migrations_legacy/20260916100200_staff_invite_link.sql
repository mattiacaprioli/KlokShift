-- Aggancio automatico: chi si registra con l'email a cui è stato invitato
-- diventa il titolare della scheda che il locale aveva già preparato.
--
-- Prima di questa migration una scheda creata a mano restava con `waiter_id`
-- null per sempre: nessun trigger, nessuna schermata la ricollegava a un
-- account. Il professionista si registrava e non vedeva né il locale né i suoi
-- turni, mentre il titolare continuava a segnargli le ore su una scheda muta.

-- ---------------------------------------------------------------------------
-- 1. Categoria della notifica nuova
-- ---------------------------------------------------------------------------
-- Senza questo, il ramo `else` manderebbe `staff_linked` in 'shifts': lo switch
-- sbagliato in Impostazioni la silenzierebbe, e chi tiene spenti i turni non
-- saprebbe mai di essere entrato in un organico.
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
    else 'shifts'  -- application_* + shift_* (candidature e turni)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Il linker
-- ---------------------------------------------------------------------------
-- ⚠️ `email_confirmed_at is not null` è il cardine di sicurezza di tutta la
-- feature, non un dettaglio. Senza, chiunque si registra con l'indirizzo di un
-- altro — senza mai provare di possederlo — entra nell'organico di un locale
-- che non lo conosce: sedi, turni, colleghi, chat, documenti.
--
-- Oggi la conferma email è attiva sul progetto, quindi non esiste sessione (e
-- nemmeno una riga `profiles`) prima della conferma. Il controllo serve lo
-- stesso: se un giorno qualcuno disattiva "Confirm email" nella dashboard
-- Supabase, questa funzione smette di agganciare — cioè si rompe in modo
-- visibile — invece di diventare un modo silenzioso per entrare negli organici
-- altrui.
create or replace function public.link_staff_invites_for_user(p_user uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email   text;
  v_role    public.user_role;
  v_name    text;
  v_linked  integer := 0;
  r         record;
  v_member  uuid;
  v_venue   text;
begin
  select lower(u.email) into v_email
    from auth.users u
    where u.id = p_user and u.email_confirmed_at is not null;
  if v_email is null then
    return 0;
  end if;

  select p.role, p.full_name into v_role, v_name
    from public.profiles p where p.id = p_user;
  -- Solo i professionisti entrano in un organico. Stesso filtro di
  -- `find_waiter_by_email`: un titolare invitato per sbaglio non diventa staff
  -- di un altro titolare.
  if v_role is distinct from 'waiter' then
    return 0;
  end if;

  for r in
    select sp.id, sp.owner_id
      from public.staff_people sp
      where lower(sp.email) = v_email and sp.waiter_id is null
  loop
    -- Collisione: questo titolare ha già un'altra scheda collegata a questo
    -- account (succede se l'account ha cambiato email in auth dopo essere stato
    -- collegato). L'unique `staff_people_owner_waiter_uq` rifiuterebbe
    -- l'update. Non si fonde niente in automatico: fondere due schede vuol dire
    -- fondere appartenenze, documenti, ore e contratto, e farlo qui sarebbe
    -- perdita di dati in silenzio. Si marca e decide il titolare.
    if exists (
      select 1 from public.staff_people other
      where other.owner_id = r.owner_id and other.waiter_id = p_user
    ) then
      update public.staff_people
        set invite_conflict_at = now()
        where id = r.id;
      continue;
    end if;

    -- Una sola update: il trigger `staff_people_sync_members` propaga il
    -- `waiter_id` su **tutte** le appartenenze della persona, in ogni sede.
    update public.staff_people
      set waiter_id = p_user, invite_conflict_at = null
      where id = r.id;
    v_linked := v_linked + 1;

    select sm.id, v.name into v_member, v_venue
      from public.staff_members sm
      join public.venues v on v.id = sm.venue_id
      where sm.person_id = r.id and sm.link_status <> 'left'
      order by sm.created_at
      limit 1;

    -- Al professionista: il locale c'è già, non deve accettare niente. Il
    -- consenso l'ha dato registrandosi con l'indirizzo dell'invito.
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      p_user,
      'staff_linked',
      'Sei nell''organico',
      coalesce(v_venue, 'Un locale') || ' ti aveva invitato: ora trovi qui i tuoi turni',
      v_member
    );

    -- Al titolare: `staff_response` esiste già e instrada a /(manager)/(tabs)/staff.
    insert into public.notifications (user_id, type, title, body, related_id)
    values (
      r.owner_id,
      'staff_response',
      'Invito accettato',
      coalesce(v_name, 'La persona che hai invitato')
        || ' si è registrata: la sua scheda è ora collegata',
      v_member
    );
  end loop;

  return v_linked;
end;
$$;

revoke execute on function public.link_staff_invites_for_user(uuid)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 3. Trigger sulla creazione del profilo — il percorso primario
-- ---------------------------------------------------------------------------
-- Perché qui e non in una RPC chiamata dal client: `ensureProfile` gira dentro
-- il flusso di `onAuthStateChange`, dove un await in più è esattamente ciò che
-- ha già prodotto il deadlock con la schermata nera al cold start. E un client
-- che perde la rete tra la registrazione e la RPC non ritenta mai: persona
-- registrata, scheda mai agganciata, nessun segnale a nessuno.
create or replace function public.link_staff_invites_on_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- ⚠️ Un AFTER INSERT che solleva fa fallire l'insert di `ensureProfile`, cioè
  -- blocca **la registrazione**. Qualunque bug qui dentro deve costare un
  -- aggancio mancato (recuperabile con `claim_staff_invites`), mai un utente
  -- che non riesce a entrare nell'app.
  begin
    perform public.link_staff_invites_for_user(new.id);
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke execute on function public.link_staff_invites_on_profile()
  from anon, authenticated, public;

drop trigger if exists profiles_link_staff_invites on public.profiles;
create trigger profiles_link_staff_invites
  after insert on public.profiles
  for each row execute function public.link_staff_invites_on_profile();

-- ---------------------------------------------------------------------------
-- 4. Rete di sicurezza lato client
-- ---------------------------------------------------------------------------
-- `profiles` si inserisce una volta sola nella vita di un account: se il trigger
-- non ha agganciato (conferma email arrivata dopo, scheda creata dal titolare
-- quando la persona era già registrata) non ripasserà mai più. Idempotente e su
-- indice: il client la chiama solo quando crea il profilo.
create or replace function public.claim_staff_invites()
returns integer
language sql
security definer
set search_path = ''
as $$
  select public.link_staff_invites_for_user((select auth.uid()));
$$;

revoke execute on function public.claim_staff_invites() from anon, public;
grant execute on function public.claim_staff_invites() to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Claim dell'invio email (la chiama solo l'Edge Function, con service_role)
-- ---------------------------------------------------------------------------
-- Controlli, rate limit e incremento in **una** transazione con `for update`:
-- due tap sul bottone, o due invocazioni concorrenti, non producono due email.
--
-- La function non riceve mai un indirizzo dal chiamante: per spedire a
-- qualcuno il titolare deve prima averlo scritto su una propria scheda, dove
-- l'unique e `invite_count` lo tengono sotto controllo.
create or replace function public.claim_staff_invite_send(p_person uuid, p_owner uuid)
returns table (email text, full_name text, owner_name text, venue_names text[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_recent integer;
begin
  select sp.id, sp.owner_id, sp.email, sp.full_name, sp.waiter_id,
         sp.invited_at, sp.invite_count
    into r
    from public.staff_people sp
    where sp.id = p_person
    for update;

  if r.id is null            then raise exception 'not_owner';      end if;
  if r.owner_id <> p_owner   then raise exception 'not_owner';      end if;
  if r.waiter_id is not null then raise exception 'already_linked'; end if;
  if r.email is null         then raise exception 'no_email';       end if;

  -- Tetto per scheda: 5 inviti in tutto, e non più di uno ogni 15 minuti.
  if r.invite_count >= 5 then raise exception 'rate_limited'; end if;
  if r.invited_at is not null and r.invited_at > now() - interval '15 minutes' then
    raise exception 'rate_limited';
  end if;

  -- Tetto per titolare: un account compromesso non diventa un mailer.
  select count(*) into v_recent
    from public.staff_people sp
    where sp.owner_id = p_owner and sp.invited_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'rate_limited'; end if;

  update public.staff_people
    set invited_at = now(), invite_count = invite_count + 1
    where id = p_person;

  return query
    select r.email,
           r.full_name,
           coalesce(p.full_name, 'Un locale'),
           coalesce(
             array_agg(v.name order by v.name) filter (where v.name is not null),
             '{}'::text[]
           )
      from public.profiles p
      left join public.staff_members sm
        on sm.person_id = p_person and sm.link_status <> 'left'
      left join public.venues v on v.id = sm.venue_id
      where p.id = p_owner
      group by p.full_name;
end;
$$;

revoke execute on function public.claim_staff_invite_send(uuid, uuid)
  from anon, authenticated, public;
