-- Modifica ed elimina messaggio (2026-11-18), come WhatsApp.
--
-- Solo i propri messaggi di testo (le card del cambio turno hanno il loro
-- stato). Modifica entro 15 minuti, eliminazione entro 48 ore: i limiti li
-- decide il database; `src/features/chat/messageActions.ts` ne è il gemello
-- manuale e serve solo a mostrare le voci.
--
-- Il testo vecchio si cancella **davvero** (scelta del fondatore): niente
-- colonna nascosta, niente log. Anche la notifica in-app nata da quel
-- messaggio viene riscritta. Le push già consegnate non si possono richiamare.
--
-- Il messaggio eliminato resta come riga, con `content = ''` e `deleted_at`,
-- per mostrare «Messaggio eliminato» e perché arrivi in diretta come UPDATE
-- (un DELETE in realtime porta solo l'id e il filtro per conversazione lo perde).

alter table public.messages
  add column edited_at  timestamptz,
  add column deleted_at timestamptz;

alter table public.messages drop constraint messages_content_check;
alter table public.messages add constraint messages_content_check
  -- Un eliminato non ha testo, **mai**: anche se una modifica arrivasse dopo
  -- l'eliminazione (telefono e dashboard insieme), fallirebbe qui.
  check ((deleted_at is null and btrim(content) <> '')
      or (deleted_at is not null and content = ''));

-- Il messaggio, se è mio, di testo e in una mia conversazione.
create function private.own_text_message(p_message uuid)
returns public.messages language plpgsql stable security definer set search_path = '' as $$
declare
  m public.messages;
begin
  select * into m from public.messages
   where id = p_message
     and sender_id = (select auth.uid())
     and kind = 'text'
     and conversation_id in (select private.my_conversation_ids());
  if m.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return m;
end;
$$;

-- Riscrive la notifica `new_message` del destinatario nata da quel messaggio:
-- il suffisso `': ' || left(<vecchio>, 80)` diventa `': ' || <nuovo>`. La
-- notifica nasce dal trigger AFTER INSERT nella stessa transazione del
-- messaggio, quindi ha lo stesso `created_at`: è così che si riconosce, e un
-- altro messaggio con lo stesso testo non viene toccato.
create function private.rewrite_message_notification(m public.messages, p_new text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_to     uuid;
  v_suffix text := ': ' || left(m.content, 80);
begin
  select case when c.user_a = m.sender_id then c.user_b else c.user_a end into v_to
    from public.conversations c where c.id = m.conversation_id;
  update public.notifications n
     set body = left(n.body, length(n.body) - length(v_suffix)) || ': ' || p_new
   where n.user_id = v_to
     and n.type = 'new_message'
     and n.related_id = m.conversation_id
     and n.created_at = m.created_at
     and right(n.body, length(v_suffix)) = v_suffix;
end;
$$;

create function public.edit_message(p_message uuid, p_content text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m       public.messages := private.own_text_message(p_message);
  v_text  text := btrim(coalesce(p_content, ''));
begin
  if m.deleted_at is not null then
    raise exception 'message_deleted';
  end if;
  if v_text = '' or length(v_text) > 1000 then
    raise exception 'message_invalid';
  end if;
  if now() > m.created_at + interval '15 minutes' then
    raise exception 'message_edit_expired';
  end if;
  if v_text = m.content then
    return;
  end if;
  update public.messages set content = v_text, edited_at = now()
   where id = m.id and deleted_at is null;
  if not found then
    raise exception 'message_deleted';  -- eliminato nel frattempo
  end if;
  perform private.rewrite_message_notification(m, left(v_text, 80));
end;
$$;

create function public.delete_message(p_message uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.messages := private.own_text_message(p_message);
begin
  if m.deleted_at is not null then
    return;
  end if;
  if now() > m.created_at + interval '48 hours' then
    raise exception 'message_delete_expired';
  end if;
  update public.messages set content = '', deleted_at = now()
   where id = m.id and deleted_at is null;
  if not found then
    return;  -- eliminato nel frattempo da un altro dispositivo
  end if;
  perform private.rewrite_message_notification(m, 'Messaggio eliminato');
end;
$$;

revoke execute on function private.own_text_message(uuid) from public, anon, authenticated;
revoke execute on function private.rewrite_message_notification(public.messages, text) from public, anon, authenticated;
revoke execute on function public.edit_message(uuid, text), public.delete_message(uuid) from public, anon;
grant execute on function public.edit_message(uuid, text), public.delete_message(uuid) to authenticated;
