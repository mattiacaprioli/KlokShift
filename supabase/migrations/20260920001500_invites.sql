-- Baseline — 16/N: inviti in uscita (email) e accettazione via token.
--
-- Queste RPC le chiamano SOLO le Edge Function `invite-staff` e `accept-invite`
-- con service role (nessun GRANT ad authenticated). Il motivo è il token: chi
-- invita non deve mai conoscerlo. Se lo scegliesse lui (o lo leggesse), potrebbe
-- accettare l'invito al posto del destinatario e creare un account con l'email
-- di un altro, già confermata. Lo genera la Edge Function, in Deno, e il DB ne
-- vede solo l'hash SHA-256.
--
-- Due canali, per i due modi di entrare:
--   email  dipendente: l'email dice «registrati con questo indirizzo»; l'aggancio
--          lo fa il trigger su auth.users quando l'email è confermata.
--   token  collaboratore: l'email porta un link monouso a `#/invito`; l'account
--          NASCE lì (accept-invite), con la password scelta in quel momento.
--          Non si pre-crea mai l'account all'invio: l'indirizzo resterebbe occupato
--          anche per chi l'invito non lo apre.

-- Chi può invitare questa persona, dato un account (la Edge Function chiama con
-- service role, quindi auth.uid() è nullo e qui l'utente arriva per parametro).
-- Il titolare invita chiunque; chi ha «Staff» invita solo dipendenti delle sue sedi.
create function private.user_can_invite(p_user uuid, p_member uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.workspace_members m
     where m.id = p_member
       and (
         exists (
           select 1 from public.workspace_members o
            where o.workspace_id = m.workspace_id and o.user_id = p_user
              and o.authority = 'owner' and o.status = 'active'
         )
         or (
           m.authority = 'none'
           and exists (
             select 1
               from public.venue_members vm
               join private.member_venue_grants g on g.venue_id = vm.venue_id
              where vm.member_id = m.id and vm.left_at is null
                and g.user_id = p_user and 'staff' = any (g.perms)
           )
         )
       )
  );
$$;

-- Registra un invio e restituisce ciò che serve per scrivere l'email.
-- Tetti: 5 invii per persona e non più di uno ogni 15 minuti; 20 persone invitate
-- ogni 24 ore per azienda (un account compromesso non diventa un mailer).
create function public.claim_invite_send(
  p_member uuid, p_caller uuid, p_token_hash text default null, p_expires timestamptz default null
) returns table (
  channel text, email text, display_name text, workspace_name text, venue_names text[]
) language plpgsql security definer set search_path = '' as $$
declare
  m        record;
  v_inv    record;
  v_recent integer;
  v_channel text;
begin
  select w.id, w.workspace_id, w.email, w.display_name, w.authority, w.user_id, w.status
    into m
    from public.workspace_members w where w.id = p_member for update;

  if m.id is null or not private.user_can_invite(p_caller, p_member) then
    raise exception 'not_owner';
  end if;
  if m.status = 'left'     then raise exception 'not_owner';      end if;
  if m.user_id is not null then raise exception 'already_linked'; end if;
  if m.email is null       then raise exception 'no_email';       end if;

  v_channel := case when m.authority = 'none' then 'email' else 'token' end;
  if v_channel = 'token' and (p_token_hash is null or p_expires is null) then
    raise exception 'token_required';
  end if;

  select i.sent_count, i.last_sent_at into v_inv from public.member_invites i where i.member_id = p_member;
  if v_inv.sent_count >= 5 then raise exception 'rate_limited'; end if;
  if v_inv.last_sent_at is not null and v_inv.last_sent_at > now() - interval '15 minutes' then
    raise exception 'rate_limited';
  end if;
  select count(*) into v_recent
    from public.member_invites i
    join public.workspace_members x on x.id = i.member_id
   where x.workspace_id = m.workspace_id and i.last_sent_at > now() - interval '24 hours';
  if v_recent >= 20 then raise exception 'rate_limited'; end if;

  -- Il token nuovo sostituisce il vecchio nella stessa transazione dei contatori:
  -- «Rimanda l'invito» fa morire il link precedente.
  insert into public.member_invites (member_id, channel, token_hash, expires_at, consumed_at, sent_count, last_sent_at)
  values (p_member, v_channel, case when v_channel = 'token' then p_token_hash end,
          case when v_channel = 'token' then p_expires end, null, 1, now())
  on conflict (member_id) do update set
    channel = excluded.channel, token_hash = excluded.token_hash, expires_at = excluded.expires_at,
    consumed_at = null, sent_count = public.member_invites.sent_count + 1, last_sent_at = now();

  return query
    select v_channel, m.email, m.display_name, w.name,
           coalesce((select array_agg(v.name order by v.name)
                       from public.venue_members vm join public.venues v on v.id = vm.venue_id
                      where vm.member_id = p_member and vm.left_at is null), '{}'::text[])
      from public.workspaces w where w.id = m.workspace_id;
end;
$$;

-- Il link è ancora buono? (La pagina `#/invito` lo chiede prima di mostrare il form.)
-- L'hash sparisce all'accettazione: «non trovato» copre anche il secondo click.
create function public.peek_invite(p_hash text)
returns table (email text, display_name text, workspace_name text)
language plpgsql security definer set search_path = '' as $$
declare
  i record;
begin
  select x.consumed_at, x.expires_at, m.email, m.display_name, m.user_id, m.status, m.workspace_id
    into i
    from public.member_invites x join public.workspace_members m on m.id = x.member_id
   where x.token_hash = p_hash;

  if i.workspace_id is null           then raise exception 'invite_not_found'; end if;
  if i.consumed_at is not null        then raise exception 'invite_used';      end if;
  if i.expires_at is null or i.expires_at <= now() then raise exception 'invite_expired'; end if;
  if i.user_id is not null or i.status = 'left'    then raise exception 'already_linked'; end if;
  if i.email is null                  then raise exception 'no_email';         end if;

  return query select i.email, i.display_name, (select w.name from public.workspaces w where w.id = i.workspace_id);
end;
$$;

-- Chiude l'invito dopo che l'account è stato creato. Creare l'account con email
-- confermata ha già agganciato la scheda (trigger su auth.users): qui si rende
-- l'ingresso definitivo e si brucia il token. Se questo passo fallisce l'account
-- esiste e la scheda è agganciata, `invited`: si accetta dentro l'app.
create function public.consume_invite(p_hash text, p_user uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  i record;
begin
  select x.id, x.consumed_at, m.id as member_id, m.email, m.user_id
    into i
    from public.member_invites x join public.workspace_members m on m.id = x.member_id
   where x.token_hash = p_hash for update of x;

  if i.id is null           then raise exception 'invite_not_found'; end if;
  if i.consumed_at is not null then raise exception 'invite_used';   end if;
  -- Deve essere proprio l'account nato da quel link, non uno qualunque.
  if i.user_id is distinct from p_user then raise exception 'account_not_linked'; end if;

  update public.workspace_members set status = 'active', left_at = null where id = i.member_id;
  update public.member_invites set token_hash = null, consumed_at = now() where id = i.id;
  return i.email;
end;
$$;
