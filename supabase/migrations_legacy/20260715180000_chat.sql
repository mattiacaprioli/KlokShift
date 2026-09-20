-- Chat 1:1 cameriere↔ristoratore (M6).
-- 1) Una conversazione per coppia (waiter, manager): consolida eventuali
--    duplicati e aggiunge l'indice unico; shift_id resta come contesto del
--    primo contatto.
-- 2) RPC mark_conversation_read: la policy 'messages: sender update' concede
--    l'UPDATE solo al mittente, quindi il destinatario non può settare read_at.
-- 3) Trigger notify_on_new_message con dedupe: al massimo una notifica non
--    letta per (utente, conversazione), niente flooding della lista notifiche.
-- 4) Realtime su messages (idempotente, come per notifications).

-- 1) Consolidamento duplicati + indice unico --------------------------------

with keep as (
  select distinct on (waiter_id, manager_id) id, waiter_id, manager_id
  from public.conversations
  order by waiter_id, manager_id, created_at asc
)
update public.messages m
set conversation_id = k.id
from public.conversations c
join keep k
  on k.waiter_id = c.waiter_id and k.manager_id = c.manager_id
where m.conversation_id = c.id and c.id <> k.id;

delete from public.conversations c
using (
  select distinct on (waiter_id, manager_id) id, waiter_id, manager_id
  from public.conversations
  order by waiter_id, manager_id, created_at asc
) k
where c.waiter_id = k.waiter_id and c.manager_id = k.manager_id and c.id <> k.id;

create unique index if not exists conversations_waiter_manager_key
  on public.conversations (waiter_id, manager_id);

create index if not exists messages_conversation_created_idx
  on public.messages (conversation_id, created_at desc);

-- 2) RPC: il destinatario segna letti i messaggi della conversazione --------

create or replace function public.mark_conversation_read(p_conversation uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1 from public.conversations c
    where c.id = p_conversation
      and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()))
  ) then
    raise exception 'not allowed';
  end if;

  update public.messages
  set read_at = now()
  where conversation_id = p_conversation
    and sender_id <> (select auth.uid())
    and read_at is null;

  -- Ri-arma la dedupe del trigger: letta la conversazione, letta la notifica.
  update public.notifications
  set read_at = now()
  where user_id = (select auth.uid())
    and type = 'new_message'
    and related_id = p_conversation
    and read_at is null;
end;
$$;

revoke execute on function public.mark_conversation_read(uuid) from anon, public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;

-- 3) Trigger: notifica 'new_message' al destinatario, con dedupe ------------

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

  -- Nome mittente in base al lato della conversazione: il ristoratore appare
  -- col nome del locale, il cameriere col full_name. NON usare il possesso di
  -- una venue come proxy del ruolo (un profilo può possederne una e chattare
  -- comunque da cameriere).
  if new.sender_id = v_manager then
    select v.name into v_sender
      from public.venues v
      where v.owner_id = new.sender_id
      limit 1;
  end if;
  if v_sender is null then
    select p.full_name into v_sender
      from public.profiles p
      where p.id = new.sender_id;
  end if;

  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_recipient, 'new_message', 'Nuovo messaggio',
    coalesce(v_sender, 'Qualcuno') || ': ' || left(new.content, 80),
    new.conversation_id
  );
  return new;
end;
$$;

drop trigger if exists messages_notify on public.messages;
create trigger messages_notify
  after insert on public.messages
  for each row execute function public.notify_on_new_message();

-- Funzione di trigger: non va esposta come RPC SECURITY DEFINER.
revoke execute on function public.notify_on_new_message() from anon, authenticated, public;

-- 4) Realtime su messages (idempotente: potrebbe già essere nella publication,
--    abilitata in setup, non via migration) ---------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
