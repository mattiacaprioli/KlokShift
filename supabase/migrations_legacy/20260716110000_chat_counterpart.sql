-- Chat — audit #8: fonte unica per il nome/avatar della controparte.
-- Prima esistevano due verità sul lato CAMERIERE: il trigger notify_on_new_message
-- leggeva public.profiles.full_name, il client leggeva waiter_public_cards.full_name.
-- (Il lato ristoratore concordava già su venues.name.) Ora entrambi passano da
-- public.chat_counterpart: manager → venues.name/logo_url, cameriere →
-- waiter_public_cards.full_name/avatar_url.

-- 1) Risoluzione nome/avatar di un partecipante secondo il suo lato ------------
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
end;
$$;

-- Helper interno: usato solo dai DEFINER qui sotto (trigger + RPC), non esposto.
revoke execute on function public.chat_counterpart(uuid, boolean) from anon, authenticated, public;

-- 2) RPC per il client: controparte di OGNI conversazione (chiave = id conv.) --
-- Risolve per lato conversazione (la stessa persona può essere cameriere di là e
-- proprietario di locale di qua). Legge solo le conversazioni dell'utente.
create or replace function public.get_chat_counterparts(p_conversations uuid[])
returns table (conversation_id uuid, name text, avatar_url text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  return query
    select c.id, cc.name, cc.avatar_url
    from public.conversations c
    left join lateral public.chat_counterpart(
      case when c.waiter_id = (select auth.uid()) then c.manager_id else c.waiter_id end,
      c.waiter_id = (select auth.uid())
    ) cc on true
    where c.id = any(p_conversations)
      and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()));
end;
$$;

revoke execute on function public.get_chat_counterparts(uuid[]) from anon, public;
grant execute on function public.get_chat_counterparts(uuid[]) to authenticated;

-- 3) Trigger notify_on_new_message: nome mittente dalla stessa fonte del client -
create or replace function public.notify_on_new_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter    uuid;
  v_manager   uuid;
  v_recipient uuid;
  v_sender    text;
begin
  select c.waiter_id, c.manager_id
    into v_waiter, v_manager
    from public.conversations c
    where c.id = new.conversation_id;

  if v_waiter is null then
    return new;
  end if;

  v_recipient := case when new.sender_id = v_waiter then v_manager else v_waiter end;

  -- Dedupe: se c'è già una notifica non letta per questa conversazione non se
  -- ne crea un'altra; il badge del tab Messaggi conta comunque i messaggi.
  if exists (
    select 1 from public.notifications n
    where n.user_id = v_recipient
      and n.type = 'new_message'
      and n.related_id = new.conversation_id
      and n.read_at is null
  ) then
    return new;
  end if;

  -- Nome mittente dalla fonte unica: ristoratore → nome locale, cameriere →
  -- waiter_public_cards. (Stessa risoluzione del client via get_chat_counterparts.)
  select name into v_sender
    from public.chat_counterpart(new.sender_id, new.sender_id = v_manager);

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_recipient, 'new_message', 'Nuovo messaggio',
    coalesce(v_sender, 'Qualcuno') || ': ' || left(new.content, 80),
    new.conversation_id
  );
  return new;
end;
$$;

revoke execute on function public.notify_on_new_message() from anon, authenticated, public;
