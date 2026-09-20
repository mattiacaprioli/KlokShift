-- L'account del collaboratore nasce quando sceglie la password, non quando parte
-- l'invito.
--
-- La 20260917110000 aveva spostato la creazione dell'account sul titolare, via
-- `generateLink({ type: 'invite' })`. Risolveva il problema giusto — l'invito non
-- si rompe più in silenzio quando l'invitato sceglie il ruolo sbagliato — ma
-- lasciava due buchi, figli della stessa causa: è GoTrue a creare l'`auth.users`,
-- e lo crea al momento dell'invio.
--
--   1. L'indirizzo restava occupato. L'account esisteva prima che la persona
--      facesse qualunque cosa, e chi riceveva l'invito per sbaglio non riusciva
--      più a registrarsi da nessuna parte. `claim_venue_access_cancel` e
--      `inert_invite_user` erano le toppe: qui sotto si droppano, perché il
--      problema che curavano non esiste più.
--   2. L'accesso si attivava prima della password. Aprire il link confermava
--      l'email e apriva una sessione; `ensureProfile` + `link_venue_access_for_user`
--      mettevano le righe a `active`, e il form password veniva dopo. Chi
--      abbandonava a metà era dentro senza password.
--
-- Ora nell'email c'è un token nostro. La pagina `#/invito` lo scambia con un
-- account (`createUser`, password e `email_confirm` insieme) nel momento in cui
-- la persona preme «Entra». Prima di quel momento non esiste nessun `auth.users`:
-- ignorare l'email torna a non avere conseguenze.
--
-- ⚠️ **Perché un token, se 20260916100000:5-8 e 20260916120200:3-6 dicono «niente
-- token».** Quel ragionamento era giusto lì: nel flusso organico il link portava
-- alla vetrina e non autorizzava niente, quindi token e scadenza non avrebbero
-- avuto nulla da proteggere — teatro. Qui il token **è** l'unica autenticazione:
-- è la sola cosa che fa nascere l'account, e prova il possesso della casella
-- esattamente come faceva il link GoTrue. La regola non si ignora, non si applica.
--
-- `email_confirmed_at is not null` resta il cardine di tutto (AGENTS.md), e resta
-- onesto: `createUser({ email_confirm: true })` lo valorizza **solo** perché è
-- tornato indietro un token consegnato a quell'indirizzo.

-- ---------------------------------------------------------------------------
-- 1. Via le toppe della 20260917110000
-- ---------------------------------------------------------------------------
drop function if exists public.claim_venue_access_cancel(uuid, uuid);
drop function if exists public.inert_invite_user(text);

-- ---------------------------------------------------------------------------
-- 2. Il token sulla riga d'invito
-- ---------------------------------------------------------------------------
-- Sulla riga e non in una tabella a parte: un invito è già una riga di
-- `venue_access`, con la sua email, i suoi contatori e la sua unique. Una
-- seconda tabella vorrebbe dire una FK, una RLS e un secondo posto da tenere
-- allineato per ricordare la stessa cosa.
--
-- ⚠️ Si salva l'**hash**, mai il token: chi legge il database non deve poter
-- entrare nell'account di nessuno. L'hash lo calcola la Edge Function in Deno
-- (SHA-256), così non serve `pgcrypto` — che in questo progetto non risulta
-- abilitata da nessuna migration.
alter table public.venue_access
  add column if not exists invite_token_hash  text,
  add column if not exists invite_expires_at  timestamptz,
  add column if not exists invite_accepted_at timestamptz;

comment on column public.venue_access.invite_token_hash is
  'SHA-256 esadecimale del token d''invito. Azzerato quando l''invito è accettato: è ciò che lo rende monouso.';

-- Due inviti non possono condividere un hash. È anche l'indice con cui la Edge
-- Function trova la riga: senza, ogni accettazione sarebbe un seq scan.
create unique index if not exists venue_access_invite_token_uq
  on public.venue_access (invite_token_hash) where invite_token_hash is not null;

-- ---------------------------------------------------------------------------
-- 3. L'invio salva il token insieme ai contatori
-- ---------------------------------------------------------------------------
-- ⚠️ `drop` e non `create or replace`: aggiungere parametri non sostituisce la
-- funzione, ne crea una seconda accanto. Due versioni vive della stessa RPC sono
-- il modo migliore per chiamare quella sbagliata.
drop function if exists public.claim_venue_access_send(uuid, uuid);

create function public.claim_venue_access_send(
  p_access     uuid,
  p_owner      uuid,
  p_token_hash text,
  p_expires    timestamptz
)
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

  -- Il tetto delle 24 ore è **condiviso** fra i due inviti: contarli
  -- separatamente vorrebbe dire che un account compromesso ne manda quaranta
  -- invece di venti.
  select (select count(*) from public.staff_people sp
           where sp.owner_id = p_owner and sp.invited_at > now() - interval '24 hours')
       + (select count(*) from public.venue_access va
           where va.owner_id = p_owner and va.invited_at > now() - interval '24 hours')
    into v_recent;
  if v_recent >= 20 then raise exception 'rate_limited'; end if;

  -- Il token nuovo sostituisce il vecchio nella stessa transazione dei
  -- contatori: «Rimanda l'invito» fa morire il link precedente, che è quello che
  -- ci si aspetta. `invite_accepted_at` torna a null perché questo è un invito
  -- nuovo, non la riapertura di uno già speso.
  update public.venue_access
     set invited_at         = now(),
         invite_count       = invite_count + 1,
         invite_token_hash  = p_token_hash,
         invite_expires_at  = p_expires,
         invite_accepted_at = null
   where id = p_access;

  return query
    select r.email,
           coalesce(p.full_name, 'Una sede'),
           coalesce(v.name, 'una sede')
      from public.profiles p
      left join public.venues v on v.id = r.venue_id
     where p.id = p_owner;
end;
$$;

revoke execute on function public.claim_venue_access_send(uuid, uuid, text, timestamptz)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 4. Leggere un invito dal token
-- ---------------------------------------------------------------------------
-- Serve due volte: alla pagina, per dire *chi* ti ha invitato e *dove* prima di
-- chiederti una password, e di nuovo al submit, perché fra i due momenti
-- l'invito può essere scaduto o revocato.
--
-- Tre eccezioni diverse e non un `null` unico: in pagina diventano tre copy
-- diversi, e «link non valido» su un invito già usato manderebbe la persona dal
-- titolare invece che al login.
create or replace function public.claim_venue_access_invite(p_hash text)
returns table (email text, owner_name text, venue_name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select a.id, a.owner_id, a.venue_id, a.email, a.user_id, a.status,
         a.invite_expires_at, a.invite_accepted_at
    into r
    from public.venue_access a
    where a.invite_token_hash = p_hash;

  -- L'hash sparisce quando l'invito è accettato, quindi «non trovato» copre
  -- anche il secondo click sullo stesso link: il caso `invite_used` qui sotto
  -- resta per le righe che l'hash ce l'hanno ancora (accettazione a metà, vedi
  -- l'ordine in `accept-invite`).
  if r.id is null then raise exception 'invite_not_found'; end if;

  if r.invite_accepted_at is not null then raise exception 'invite_used';    end if;
  if r.invite_expires_at is null
     or r.invite_expires_at <= now()  then raise exception 'invite_expired'; end if;
  -- Revocato nel frattempo, o già collegato a un account: il token non vale più.
  if r.user_id is not null
     or r.status <> 'pending'         then raise exception 'already_linked'; end if;
  if r.email is null                  then raise exception 'no_email';       end if;

  return query
    select r.email,
           coalesce(p.full_name, 'Una sede'),
           coalesce(v.name, 'una sede')
      from public.profiles p
      left join public.venues v on v.id = r.venue_id
     where p.id = r.owner_id;
end;
$$;

revoke execute on function public.claim_venue_access_invite(text)
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- 5. Bruciare il token
-- ---------------------------------------------------------------------------
-- Chiamata **dopo** che l'account esiste. Azzerare l'hash è ciò che rende
-- l'invito monouso; `invite_accepted_at` resta per sapere che è stato speso e
-- non semplicemente perso.
--
-- ⚠️ Non collega la riga: `user_id` lo valorizza `link_venue_access_for_user` al
-- primo accesso. Farlo qui sarebbe anche impossibile —
-- `venue_access_user_matches_email` pretende `profiles.role = 'manager'`, e la
-- riga `profiles` non esiste finché l'app non fa `ensureProfile`.
create or replace function public.consume_venue_access_invite(p_hash text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  select a.id, a.email, a.user_id, a.status,
         a.invite_expires_at, a.invite_accepted_at
    into r
    from public.venue_access a
    where a.invite_token_hash = p_hash
    for update;

  if r.id is null                     then raise exception 'invite_not_found'; end if;
  if r.invite_accepted_at is not null then raise exception 'invite_used';      end if;

  update public.venue_access
     set invite_token_hash  = null,
         invite_accepted_at = now()
   where id = r.id;

  return r.email;
end;
$$;

revoke execute on function public.consume_venue_access_invite(text)
  from anon, authenticated, public;
