-- Ripulire un invito collaboratore mai aperto.
--
-- Da questa versione l'account del collaboratore lo crea il titolare: la Edge
-- Function `invite-staff` (ramo `kind: "team"`) genera un link d'invito, e
-- generarlo crea un `auth.users`. Finché quel link non viene aperto l'account è
-- inerte — email non confermata, nessuna password, nessun profilo — ma occupa
-- l'indirizzo: chi l'ha ricevuto per sbaglio non riesce più a registrarsi, né
-- come sede né come professionista, e vede solo «utente già registrato».
--
-- Le due funzioni qui sotto sono il permesso a cancellarlo. Nessuna delle due
-- cancella niente: la prima dice «quell'indirizzo è tuo e non l'ha ancora usato
-- nessuno», la seconda dice «l'account dietro quell'indirizzo è ancora inerte».
-- La delete vera la fa la Edge Function con il service_role, dopo aver avuto
-- entrambi i sì. Due controlli su due tabelle diverse di proposito: da
-- `venue_access` non si vede `email_confirmed_at`, e da `auth.users` non si vede
-- di chi è l'invito.

-- ---------------------------------------------------------------------------
-- 1. Di chi è questo invito
-- ---------------------------------------------------------------------------
-- Gemella di `claim_venue_access_send` (20260916120200) e con la stessa forma:
-- il titolare arriva dal token JWT, la riga da un id, e tutto ciò che decide sta
-- qui dentro. La Edge Function non deve poter cancellare un account passando un
-- indirizzo.
create or replace function public.claim_venue_access_cancel(p_access uuid, p_owner uuid)
returns table (email text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r        record;
  v_linked integer;
  v_others integer;
begin
  select a.id, a.owner_id, a.email, a.user_id
    into r
    from public.venue_access a
   where a.id = p_access
   for update;

  if r.id is null          then raise exception 'not_owner';      end if;
  if r.owner_id <> p_owner then raise exception 'not_owner';      end if;
  if r.email is null       then raise exception 'no_email';       end if;
  -- L'invito è stato accettato: quell'account adesso è di quella persona. Si
  -- revoca l'accesso, non si cancella chi l'aveva.
  if r.user_id is not null then raise exception 'already_linked'; end if;

  -- Lo stesso indirizzo può stare su più righe — altre sedi di questo titolare,
  -- o un invito di un'altra azienda. Se **una qualsiasi** è già collegata a un
  -- account, quell'account non è più «l'invito che sto cancellando»: è di
  -- qualcuno, e non si tocca.
  select count(*) into v_linked
    from public.venue_access a
   where lower(a.email) = lower(r.email)
     and a.user_id is not null;
  if v_linked > 0 then raise exception 'already_linked'; end if;

  -- Qualcun altro sta ancora aspettando questa persona: un'altra azienda, o
  -- questo stesso titolare su un'altra sede. L'account è uno solo e il link
  -- d'invito pure: cancellarlo qui spegnerebbe anche l'invito che resta in
  -- piedi, senza che nessuno dei due lo sappia.
  --
  -- ⚠️ `a.id <> r.id` e non `owner_id <> p_owner`: revocando una sede su tre si
  -- deve fermare, revocandole tutte e tre no. Chi revoca in blocco mette tutte
  -- le righe a `revoked` prima di arrivare qui, quindi il conto torna zero.
  select count(*) into v_others
    from public.venue_access a
   where lower(a.email) = lower(r.email)
     and a.user_id is null
     and a.status = 'pending'
     and a.id <> r.id;
  if v_others > 0 then raise exception 'invite_shared'; end if;

  return query select r.email;
end;
$$;

revoke execute on function public.claim_venue_access_cancel(uuid, uuid)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 2. L'account dietro l'indirizzo è ancora inerte?
-- ---------------------------------------------------------------------------
-- Torna l'id dell'`auth.users` **solo** se nessuno l'ha ancora usato: email non
-- confermata e nessuna riga `profiles`. Due condizioni e non una, perché
-- coprono due momenti diversi — chi ha aperto il link ma non ha ancora scelto la
-- password ha già il profilo (`ensureProfile` gira appena c'è una sessione), e
-- il suo account non è più cancellabile.
--
-- Serve anche al reinvio: prima di generare un link nuovo si cancella quello
-- vecchio, così «Rimanda l'invito» riparte sempre da un `type: 'invite'` pulito
-- invece di dipendere da come GoTrue tratta un utente non confermato.
--
-- Esiste come funzione perché `supabase-js` non sa cercare un utente per email e
-- `auth.users` non passa da PostgREST. La chiama solo la Edge Function, con il
-- service_role.
create or replace function public.inert_invite_user(p_email text)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select u.id
    from auth.users u
   where lower(u.email) = lower(p_email)
     and u.email_confirmed_at is null
     and not exists (select 1 from public.profiles p where p.id = u.id)
   limit 1;
$$;

revoke execute on function public.inert_invite_user(text)
  from anon, authenticated, public;
