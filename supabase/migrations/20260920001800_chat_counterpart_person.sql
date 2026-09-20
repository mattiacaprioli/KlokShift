-- ---------------------------------------------------------------------------
-- La chat ha un nome e un'insegna
--
-- Lato gestione la controparte era **solo** l'insegna: il dipendente vedeva
-- «Trattoria da Mario» scrivergli, e rispondeva a un marchio. Un messaggio però
-- lo scrive una persona, e l'asimmetria era netta — il titolare l'aveva sempre
-- visto per nome, lui no.
--
-- Da qui le due cose stanno insieme: **il nome della persona** come intestazione
-- e **il luogo** come sottotitolo (la sede se l'azienda ne ha una sola,
-- altrimenti l'azienda). Vale per la lista, per il thread e — unica riga a
-- disposizione — per la notifica: «Mattia (Trattoria da Mario): ...».
--
-- Oggi dall'altra parte c'è sempre il titolare primario (`open_conversation`
-- non ammette i collaboratori), quindi il nome è già senza ambiguità; il giorno
-- in cui la chat si aprirà ai collaboratori, «la sede» sarebbe tre persone
-- diverse e il sottotitolo da solo non basterebbe più.
-- ---------------------------------------------------------------------------

drop function public.get_chat_counterparts(uuid[]);
drop function private.chat_counterpart(uuid, uuid, boolean);

-- Nome, luogo e foto dell'altra parte.
--   lato gestione        il titolare, con sotto la sede (o l'azienda se ne ha più d'una);
--   lato professionista  il suo profilo, senza sottotitolo.
-- Se la persona non ha un nome si ricade sull'insegna, e il sottotitolo sparisce
-- invece di ripeterla. Stessa sorte per la foto: quella della persona, altrimenti
-- il logo — un cerchio vuoto non è mai la risposta giusta.
create function private.chat_counterpart(p_workspace uuid, p_user uuid, p_is_manager boolean)
returns table (name text, subtitle text, avatar_url text)
language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
  v_avatar text;
  v_place  text;
  v_logo   text;
  v_found  boolean;
  v_n      integer;
begin
  select nullif(btrim(p.full_name), ''), p.avatar_url
    into v_name, v_avatar
    from public.profiles p where p.id = p_user;
  v_found := found;

  if not p_is_manager then
    if not v_found then
      return query select 'Utente eliminato'::text, null::text, null::text;
    else
      return query select coalesce(v_name, 'Professionista'), null::text, v_avatar;
    end if;
    return;
  end if;

  select count(*) into v_n from public.venues v
   where v.workspace_id = p_workspace and v.closed_at is null;
  if v_n = 1 then
    select v.name, v.logo_url into v_place, v_logo from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null;
  else
    -- Più di una sede (o nessuna): il thread è uno per coppia e vale per tutte,
    -- intestarlo a una delle tre sarebbe sbagliato due volte su tre.
    select w.name into v_place from public.workspaces w where w.id = p_workspace;
    select v.logo_url into v_logo from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null
     order by v.created_at, v.id limit 1;
  end if;

  if v_name is null then
    return query select coalesce(v_place, 'Utente eliminato'), null::text, v_logo;
  else
    return query select v_name, v_place, coalesce(v_avatar, v_logo);
  end if;
end;
$$;

create function public.get_chat_counterparts(p_conversations uuid[])
returns table (conversation_id uuid, name text, subtitle text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select c.id, cc.name, cc.subtitle, cc.avatar_url
    from public.conversations c
    left join lateral private.chat_counterpart(
      c.workspace_id,
      case when c.waiter_id = (select auth.uid()) then c.manager_id else c.waiter_id end,
      c.waiter_id = (select auth.uid())
    ) cc on true
   where c.id = any (p_conversations)
     and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()));
$$;

-- Stessa fonte della lista chat: la notifica non deve mai nominare un mittente
-- diverso da quello che si legge aprendo il thread.
create or replace function public.notify_on_new_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c        record;
  v_to     uuid;
  v_sender text;
  v_place  text;
begin
  if new.kind <> 'text' then
    return new;
  end if;
  select cv.workspace_id, cv.waiter_id, cv.manager_id into c
    from public.conversations cv where cv.id = new.conversation_id;
  if c.waiter_id is null then
    return new;
  end if;
  v_to := case when new.sender_id = c.waiter_id then c.manager_id else c.waiter_id end;

  if exists (
    select 1 from public.notifications n
     where n.user_id = v_to and n.type = 'new_message' and n.related_id = new.conversation_id and n.read_at is null
  ) then
    return new;
  end if;

  select cp.name, cp.subtitle into v_sender, v_place
    from private.chat_counterpart(c.workspace_id, new.sender_id, new.sender_id = c.manager_id) cp;
  insert into public.notifications (user_id, type, title, body, related_id)
  values (v_to, 'new_message', 'Nuovo messaggio',
          coalesce(v_sender, 'Qualcuno')
            || coalesce(' (' || v_place || ')', '')
            || ': ' || left(new.content, 80),
          new.conversation_id);
  return new;
end;
$$;

grant execute on function public.get_chat_counterparts(uuid[]) to authenticated;
