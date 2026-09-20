-- ---------------------------------------------------------------------------
-- La chat è dell'azienda, non di una coppia di ruoli
--
-- `conversations` nasceva asimmetrica: un professionista e un gestore, nelle
-- colonne `waiter_id` / `manager_id`. Chi lavora insieme però si parla, e non
-- solo col titolare. Da qui la conversazione è fra **due membri qualsiasi della
-- stessa azienda** — titolari, collaboratori e dipendenti, nello stesso
-- insieme.
--
-- Perché le colonne cambiano nome (in deroga alla regola «i nomi interni
-- waiter/manager non si toccano» di AGENTS.md): non cambia il vocabolario,
-- cambia il significato. Una colonna `manager_id` che contiene un lavapiatti
-- mente a chiunque legga lo schema, e il costo di quella bugia lo paga chi
-- scriverà la prossima policy. La coppia adesso è **non ordinata**: si tiene in
-- ordine canonico (`user_a < user_b`) e un indice unico solo copre entrambi i
-- versi, così «A scrive a B» e «B scrive ad A» sono lo stesso thread.
--
-- Chi «parla a nome dell'azienda» non si legge più da una colonna: si ricava
-- dall'authority (`private.speaks_for_workspace`). È la stessa domanda di
-- prima, posta al posto giusto — e vale anche per le conversazioni fra colleghi,
-- dove la risposta è no da entrambe le parti.
--
-- Le card (cambio turno, assenze) continuano a nascere sul thread col titolare:
-- `conversation_for_pair(workspace, richiedente, titolare)` non cambia
-- destinatario, quindi in una chat fra colleghi non compaiono mai.
-- ---------------------------------------------------------------------------

-- Il titolare può spegnere la chat fra dipendenti: acceso di default, come
-- `venues.staff_sees_planning`. Pretendere un'azione l'avrebbe resa invisibile
-- quasi ovunque; l'interruttore c'è per chi non la vuole in casa.
alter table public.workspaces add column staff_can_chat boolean not null default true;

create policy "workspaces: owners update" on public.workspaces
  for update to authenticated
  using (private.owns_workspace(id))
  with check (private.owns_workspace(id));
-- Solo l'interruttore: il nome dell'azienda e il piano restano alle RPC.
grant update (staff_can_chat) on public.workspaces to authenticated;

-- ---------------------------------------------------------------------------
-- La coppia diventa simmetrica
-- ---------------------------------------------------------------------------
alter table public.conversations drop constraint conversations_pair_uq;
alter table public.conversations drop constraint conversations_distinct_ck;
alter table public.conversations rename column waiter_id to user_a;
alter table public.conversations rename column manager_id to user_b;
-- Le righe esistenti erano (professionista, titolare): si riordinano. La RHS
-- legge i valori vecchi, quindi lo scambio è atomico riga per riga.
update public.conversations set user_a = user_b, user_b = user_a where user_a > user_b;
alter table public.conversations
  add constraint conversations_pair_uq unique (workspace_id, user_a, user_b),
  add constraint conversations_ordered_ck check (user_a < user_b);
alter index conversations_waiter_idx rename to conversations_user_a_idx;
alter index conversations_manager_idx rename to conversations_user_b_idx;
-- I nomi dei vincoli finiscono nei tipi generati: lasciarli indietro vorrebbe
-- dire ritrovarsi `conversations_manager_id_fkey` in `database.ts`.
alter table public.conversations rename constraint conversations_waiter_id_fkey to conversations_user_a_fkey;
alter table public.conversations rename constraint conversations_manager_id_fkey to conversations_user_b_fkey;

create or replace function private.my_conversation_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.conversations c
   where c.user_a = (select auth.uid()) or c.user_b = (select auth.uid());
$$;

-- Parla a nome dell'azienda chi la guida: è l'unico che in chat si porta dietro
-- l'insegna. Un collaboratore è una persona che gestisce, non l'azienda.
create function private.speaks_for_workspace(p_workspace uuid, p_user uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace and m.user_id = p_user
       and m.authority = 'owner' and m.status = 'active'
  );
$$;

drop function private.conversation_for_pair(uuid, uuid, uuid, uuid);
create function private.conversation_for_pair(
  p_workspace uuid, p_one uuid, p_two uuid, p_shift uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_a uuid := least(p_one, p_two);
  v_b uuid := greatest(p_one, p_two);
  v_id uuid;
begin
  insert into public.conversations (workspace_id, user_a, user_b, shift_id)
  values (p_workspace, v_a, v_b, p_shift)
  on conflict (workspace_id, user_a, user_b) do nothing
  returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.conversations c
     where c.workspace_id = p_workspace and c.user_a = v_a and c.user_b = v_b;
  end if;
  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Aprire una conversazione
-- ---------------------------------------------------------------------------
-- Apre (o ritrova) una conversazione.
--   p_member    una persona qualsiasi della stessa azienda (workspace_members.id);
--   p_workspace scorciatoia: il titolare dell'azienda in cui sono attivo.
-- Chi non gestisce niente può scrivere a un altro dipendente solo se l'azienda
-- lascia aperta la chat fra colleghi. Verso chi gestisce (titolare o
-- collaboratore) si scrive sempre: quell'interruttore non deve poter isolare
-- una persona da chi la dirige.
create or replace function public.open_conversation(p_member uuid default null, p_workspace uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  v_them  record;
  v_mine  public.member_authority;
  v_owner uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_member is not null then
    select m.workspace_id, m.user_id, m.authority, m.status into v_them
      from public.workspace_members m where m.id = p_member;
    if v_them.workspace_id is null or v_them.user_id is null
       or v_them.status <> 'active' or v_them.user_id = v_me then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    select m.authority into v_mine from public.workspace_members m
     where m.workspace_id = v_them.workspace_id and m.user_id = v_me and m.status = 'active';
    if v_mine is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;

    if v_mine = 'none' and v_them.authority = 'none'
       and not (select w.staff_can_chat from public.workspaces w where w.id = v_them.workspace_id) then
      raise exception 'chat_disabled' using errcode = '42501';
    end if;

    return private.conversation_for_pair(v_them.workspace_id, v_me, v_them.user_id);
  end if;

  if p_workspace is null or not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = p_workspace and m.user_id = v_me and m.status = 'active'
  ) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_owner := private.workspace_primary_owner(p_workspace);
  if v_owner is null or v_owner = v_me then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return private.conversation_for_pair(p_workspace, v_me, v_owner);
end;
$$;

-- ---------------------------------------------------------------------------
-- La rubrica
-- ---------------------------------------------------------------------------
-- Chi posso raggiungere, in tutte le aziende in cui sono attivo. Serve al
-- «Nuovo messaggio»: la RLS di `profiles` non lascia leggere i colleghi, quindi
-- nome e foto li tira fuori questa (DEFINER). Con la chat fra colleghi spenta
-- restano solo titolari e collaboratori — mai una rubrica vuota.
create function public.get_workspace_contacts()
returns table (
  member_id uuid, user_id uuid, workspace_id uuid, workspace_name text,
  name text, avatar_url text, venues text, is_manager boolean
) language sql stable security definer set search_path = '' as $$
  with me as (
    select m.workspace_id, m.authority
      from public.workspace_members m
     where m.user_id = (select auth.uid()) and m.status = 'active'
  )
  select t.id, t.user_id, w.id, w.name,
         coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(t.display_name), ''), 'Professionista'),
         p.avatar_url,
         (select string_agg(v.name, ', ' order by v.name)
            from public.venue_members vm
            join public.venues v on v.id = vm.venue_id
           where vm.member_id = t.id and vm.left_at is null and v.closed_at is null),
         t.authority <> 'none'
    from me
    join public.workspaces w on w.id = me.workspace_id and w.deleted_at is null
    join public.workspace_members t on t.workspace_id = me.workspace_id
   left join public.profiles p on p.id = t.user_id
   where t.status = 'active' and t.user_id is not null
     and t.user_id <> (select auth.uid())
     and (me.authority <> 'none' or t.authority <> 'none' or w.staff_can_chat)
   order by w.name, 5;
$$;

-- ---------------------------------------------------------------------------
-- Chi è l'altro
-- ---------------------------------------------------------------------------
drop function public.get_chat_counterparts(uuid[]);
drop function private.chat_counterpart(uuid, uuid, boolean);

-- Nome, luogo e foto dell'altra parte. Sempre **una persona** per nome: un
-- messaggio lo scrive qualcuno, e a un marchio non si risponde.
--
-- `p_with_place` lo decide chi guarda, non chi è guardato: a chi guida l'azienda
-- non serve ricordare in che azienda sta (tutti i suoi thread sono quella),
-- mentre per gli altri il thread appartiene a un'azienda — e con due datori di
-- lavoro saperlo è l'unica cosa che distingue due righe uguali.
-- Il luogo è la sede se l'azienda ne ha una sola, altrimenti l'azienda: il
-- thread vale per tutte le sedi, intestarlo a una delle tre sarebbe sbagliato
-- due volte su tre.
create function private.chat_counterpart(p_workspace uuid, p_user uuid, p_with_place boolean)
returns table (name text, subtitle text, avatar_url text)
language plpgsql security definer set search_path = '' as $$
declare
  v_name   text;
  v_avatar text;
  v_place  text;
  v_logo   text;
  v_found  boolean;
  v_owner  boolean;
  v_n      integer;
begin
  select nullif(btrim(p.full_name), ''), p.avatar_url into v_name, v_avatar
    from public.profiles p where p.id = p_user;
  v_found := found;

  select count(*) into v_n from public.venues v
   where v.workspace_id = p_workspace and v.closed_at is null;
  if v_n = 1 then
    select v.name, v.logo_url into v_place, v_logo from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null;
  else
    select w.name into v_place from public.workspaces w where w.id = p_workspace;
    select v.logo_url into v_logo from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null
     order by v.created_at, v.id limit 1;
  end if;

  v_owner := private.speaks_for_workspace(p_workspace, p_user);
  if not v_found and v_name is null then
    -- Account cancellato: resta il thread, non la persona.
    return query select 'Utente eliminato'::text, null::text, null::text;
    return;
  end if;

  -- Senza nome si ricade sull'insegna solo per chi l'azienda la rappresenta, e
  -- allora il sottotitolo sparisce invece di ripeterla.
  if v_name is null and v_owner then
    return query select coalesce(v_place, 'Utente eliminato'), null::text, v_logo;
  else
    return query select coalesce(v_name, 'Professionista'),
                        case when p_with_place then v_place end,
                        coalesce(v_avatar, case when v_owner then v_logo end);
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
      case when c.user_a = (select auth.uid()) then c.user_b else c.user_a end,
      not private.speaks_for_workspace(c.workspace_id, (select auth.uid()))
    ) cc on true
   where c.id = any (p_conversations)
     and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()));
$$;

create or replace function public.get_chat_unread_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.read_at is null and m.sender_id <> (select auth.uid())
     and (c.user_a = (select auth.uid()) or c.user_b = (select auth.uid()));
$$;

-- Stessa fonte della lista chat: la notifica non deve mai nominare un mittente
-- diverso da quello che si legge aprendo il thread. Il luogo dipende da chi
-- riceve, non da chi scrive.
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
  select cv.workspace_id, cv.user_a, cv.user_b into c
    from public.conversations cv where cv.id = new.conversation_id;
  if c.user_a is null then
    return new;
  end if;
  v_to := case when new.sender_id = c.user_a then c.user_b else c.user_a end;

  if exists (
    select 1 from public.notifications n
     where n.user_id = v_to and n.type = 'new_message' and n.related_id = new.conversation_id and n.read_at is null
  ) then
    return new;
  end if;

  select cp.name, cp.subtitle into v_sender, v_place
    from private.chat_counterpart(
      c.workspace_id, new.sender_id,
      not private.speaks_for_workspace(c.workspace_id, v_to)
    ) cp;
  insert into public.notifications (user_id, type, title, body, related_id)
  values (v_to, 'new_message', 'Nuovo messaggio',
          coalesce(v_sender, 'Qualcuno')
            || coalesce(' (' || v_place || ')', '')
            || ': ' || left(new.content, 80),
          new.conversation_id);
  return new;
end;
$$;

grant execute on function
  public.get_chat_counterparts(uuid[]), public.get_workspace_contacts()
to authenticated;
