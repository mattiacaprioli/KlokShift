-- Spunte della chat (2026-11-18): inviato, ricevuto, visualizzato.
--
-- «Visualizzato» c'era già: `messages.read_at`, scritto da
-- `mark_conversation_read` quando il destinatario apre il thread. Resta com'è,
-- e con lui il conteggio dei non letti.
--
-- «Ricevuto» è un **segnalibro per persona** sulla conversazione: fin dove la
-- sua app ha scaricato i messaggi. Un messaggio dell'altro scritto entro il
-- segnalibro è ricevuto. Così il costo è una scrittura per conversazione, solo
-- quando avanza, invece di una per messaggio (piano free, disco già esaurito
-- una volta). Il segnalibro vale `last_message_at`, mai `now()`: non può
-- dichiarare ricevuto un messaggio che non esisteva ancora.
--
-- Le conferme sono sempre accese per tutti, nei due sensi (scelta del
-- fondatore): nessun interruttore.

alter table public.conversations
  add column user_a_delivered_at timestamptz,
  add column user_b_delivered_at timestamptz;

-- Porta il proprio segnalibro all'ultimo messaggio in tutte le proprie
-- conversazioni dove c'è qualcosa di nuovo. Non arretra mai. Restituisce
-- quante conversazioni ha avanzato (0 = nessuna scrittura).
create function public.mark_chats_delivered()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
  v_n  integer;
begin
  update public.conversations c
     set user_a_delivered_at = case when c.user_a = v_me then c.last_message_at else c.user_a_delivered_at end,
         user_b_delivered_at = case when c.user_b = v_me then c.last_message_at else c.user_b_delivered_at end
   where c.id in (select private.my_conversation_ids())
     and c.last_message_at is not null
     and c.last_message_at > coalesce(
           case when c.user_a = v_me then c.user_a_delivered_at else c.user_b_delivered_at end,
           '-infinity'::timestamptz);
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.mark_chats_delivered() from public, anon;
grant execute on function public.mark_chats_delivered() to authenticated;

-- Aprire il thread vuol dire anche averlo ricevuto: avanza il segnalibro.
create or replace function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := (select auth.uid());
begin
  if p_conversation not in (select private.my_conversation_ids()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.messages set read_at = now()
   where conversation_id = p_conversation and sender_id <> v_me and read_at is null;
  update public.notifications set read_at = now()
   where user_id = v_me and type = 'new_message'
     and related_id = p_conversation and read_at is null;
  update public.conversations c
     set user_a_delivered_at = case when c.user_a = v_me then c.last_message_at else c.user_a_delivered_at end,
         user_b_delivered_at = case when c.user_b = v_me then c.last_message_at else c.user_b_delivered_at end
   where c.id = p_conversation
     and c.last_message_at > coalesce(
           case when c.user_a = v_me then c.user_a_delivered_at else c.user_b_delivered_at end,
           '-infinity'::timestamptz);
end;
$$;

-- Le spunte cambiano in diretta anche per il «ricevuto».
do $$
begin
  -- Idempotente: il realtime di una tabella si può accendere anche dal
  -- pannello di Supabase, e un doppio `add table` fermerebbe il rilascio.
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'conversations') then
    alter publication supabase_realtime add table public.conversations;
  end if;
end $$;
