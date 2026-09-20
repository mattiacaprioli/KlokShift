-- Baseline — 11/N: conversazioni e assenze.
--
-- Chat: una conversazione per (azienda, professionista, gestore). Scritture
-- solo via RPC. Le colonne restano `waiter_id` / `manager_id` (nomi interni:
-- non si rinominano) ma sono account, non ruoli di sistema.
-- Assenze: sulla PERSONA (membro dell'azienda), non sulla sede — un permesso o
-- una malattia valgono dovunque la persona lavori. Malattia SENZA nota (GDPR).

-- ---------------------------------------------------------------------------
-- Conversazioni e messaggi
-- ---------------------------------------------------------------------------
create table public.conversations (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  waiter_id    uuid not null references public.profiles (id) on delete cascade,
  manager_id   uuid not null references public.profiles (id) on delete cascade,
  shift_id     uuid references public.shifts (id) on delete set null,
  created_at   timestamptz not null default now(),
  constraint conversations_pair_uq unique (workspace_id, waiter_id, manager_id),
  constraint conversations_distinct_ck check (waiter_id <> manager_id)
);
create index conversations_waiter_idx on public.conversations (waiter_id);
create index conversations_manager_idx on public.conversations (manager_id);
alter table public.conversations enable row level security;

-- Le assenze, prima: i messaggi ne portano un riferimento.
create table public.staff_absences (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.workspace_members (id) on delete cascade,
  kind            public.absence_kind not null,
  start_date      date not null,
  end_date        date not null,
  start_time      time,
  end_time        time,
  -- Mai per la malattia: è un dato sanitario. Lo impone il vincolo, non la UI.
  note            text,
  inps_protocol   text,
  status          public.absence_status not null default 'pending',
  requested_by    uuid references public.profiles (id) on delete set null,
  resolved_by     uuid references public.profiles (id) on delete set null,
  resolved_at     timestamptz,
  resolution_note text,
  created_at      timestamptz not null default now(),
  constraint staff_absences_range_ck check (end_date >= start_date),
  constraint staff_absences_times_pair_ck check ((start_time is null) = (end_time is null)),
  constraint staff_absences_hourly_ck check (
    start_time is null or (kind = 'permesso' and start_date = end_date and end_time > start_time)
  ),
  constraint staff_absences_protocol_ck check (kind = 'malattia' or inps_protocol is null),
  constraint staff_absences_sick_no_note_ck check (kind <> 'malattia' or note is null)
);
create index staff_absences_member_idx on public.staff_absences (member_id, start_date);
alter table public.staff_absences enable row level security;

create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id       uuid not null references public.profiles (id) on delete cascade,
  content         text not null check (btrim(content) <> ''),
  read_at         timestamptz,
  created_at      timestamptz not null default now(),
  kind            public.message_kind not null default 'text',
  request_id      uuid references public.shift_change_requests (id) on delete set null,
  absence_id      uuid references public.staff_absences (id) on delete set null
);
create index messages_conversation_idx on public.messages (conversation_id, created_at);
create index messages_unread_idx on public.messages (conversation_id) where read_at is null;
alter table public.messages enable row level security;

create function private.my_conversation_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select c.id from public.conversations c
   where c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid());
$$;
grant execute on function private.my_conversation_ids() to authenticated;

grant select on public.conversations, public.messages, public.staff_absences to authenticated;
-- Un messaggio di testo lo scrive chi partecipa. Le card (kind, request_id,
-- absence_id) le scrivono solo le RPC: fuori dal GRANT.
grant insert (conversation_id, sender_id, content) on public.messages to authenticated;

create policy "conversations: participants read" on public.conversations
  for select to authenticated using (id in (select private.my_conversation_ids()));
create policy "messages: participants read" on public.messages
  for select to authenticated using (conversation_id in (select private.my_conversation_ids()));
create policy "messages: participants insert" on public.messages
  for insert to authenticated
  with check (sender_id = (select auth.uid()) and conversation_id in (select private.my_conversation_ids()));

-- Il riferimento «chi gestisce» nella chat è il titolare più anziano dell'azienda.
create function private.workspace_primary_owner(p_workspace uuid)
returns uuid language sql stable security definer set search_path = '' as $$
  select m.user_id from public.workspace_members m
   where m.workspace_id = p_workspace and m.authority = 'owner'
     and m.status = 'active' and m.user_id is not null
   order by m.created_at, m.id limit 1;
$$;

create function private.conversation_for_pair(
  p_workspace uuid, p_waiter uuid, p_manager uuid, p_shift uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  insert into public.conversations (workspace_id, waiter_id, manager_id, shift_id)
  values (p_workspace, p_waiter, p_manager, p_shift)
  on conflict (workspace_id, waiter_id, manager_id) do nothing
  returning id into v_id;
  if v_id is null then
    select c.id into v_id from public.conversations c
     where c.workspace_id = p_workspace and c.waiter_id = p_waiter and c.manager_id = p_manager;
  end if;
  return v_id;
end;
$$;

-- Apre (o ritrova) una conversazione.
--   p_member    il titolare scrive a una persona dell'azienda (deve avere un account);
--   p_workspace il professionista scrive al titolare dell'azienda in cui è attivo.
-- La chat non è per i collaboratori: è fra il professionista e chi è titolare.
create function public.open_conversation(p_member uuid default null, p_workspace uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me     uuid := (select auth.uid());
  v_m      record;
  v_owner  uuid;
begin
  if v_me is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  if p_member is not null then
    select m.workspace_id, m.user_id into v_m from public.workspace_members m where m.id = p_member;
    if v_m.workspace_id is null or not private.owns_workspace(v_m.workspace_id)
       or v_m.user_id is null or v_m.user_id = v_me then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    return private.conversation_for_pair(v_m.workspace_id, v_m.user_id, v_me);
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

-- Nome e foto dell'altra parte. Lato gestione: la sede se ce n'è una sola
-- (come sempre «Trattoria da Mario»), altrimenti l'azienda. Lato professionista:
-- il suo profilo.
create function private.chat_counterpart(p_workspace uuid, p_user uuid, p_is_manager boolean)
returns table (name text, avatar_url text) language plpgsql security definer set search_path = '' as $$
declare
  v_n integer;
begin
  if p_is_manager then
    select count(*) into v_n from public.venues v where v.workspace_id = p_workspace and v.closed_at is null;
    if v_n = 1 then
      return query select v.name, v.logo_url from public.venues v
                    where v.workspace_id = p_workspace and v.closed_at is null;
    else
      return query select w.name,
                          (select v.logo_url from public.venues v where v.workspace_id = p_workspace
                            and v.closed_at is null order by v.created_at, v.id limit 1)
                     from public.workspaces w where w.id = p_workspace;
    end if;
  else
    return query select coalesce(nullif(btrim(p.full_name), ''), 'Professionista'), p.avatar_url
                   from public.profiles p where p.id = p_user;
  end if;
  if not found then
    return query select 'Utente eliminato'::text, null::text;
  end if;
end;
$$;

create function public.get_chat_counterparts(p_conversations uuid[])
returns table (conversation_id uuid, name text, avatar_url text)
language sql stable security definer set search_path = '' as $$
  select c.id, cc.name, cc.avatar_url
    from public.conversations c
    left join lateral private.chat_counterpart(
      c.workspace_id,
      case when c.waiter_id = (select auth.uid()) then c.manager_id else c.waiter_id end,
      c.waiter_id = (select auth.uid())
    ) cc on true
   where c.id = any (p_conversations)
     and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()));
$$;

create function public.get_chat_unread_count()
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer
    from public.messages m
    join public.conversations c on c.id = m.conversation_id
   where m.read_at is null and m.sender_id <> (select auth.uid())
     and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()));
$$;

-- Letta la conversazione, letta la notifica (e si ri-arma la dedupe del trigger).
create function public.mark_conversation_read(p_conversation uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_conversation not in (select private.my_conversation_ids()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.messages set read_at = now()
   where conversation_id = p_conversation and sender_id <> (select auth.uid()) and read_at is null;
  update public.notifications set read_at = now()
   where user_id = (select auth.uid()) and type = 'new_message'
     and related_id = p_conversation and read_at is null;
end;
$$;

-- Un messaggio di testo avvisa l'altra parte, una notifica alla volta finché non
-- la si legge.
create function public.notify_on_new_message()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  c        record;
  v_to     uuid;
  v_sender text;
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

  select cp.name into v_sender from private.chat_counterpart(c.workspace_id, new.sender_id, new.sender_id = c.manager_id) cp;
  insert into public.notifications (user_id, type, title, body, related_id)
  values (v_to, 'new_message', 'Nuovo messaggio', coalesce(v_sender, 'Qualcuno') || ': ' || left(new.content, 80), new.conversation_id);
  return new;
end;
$$;
create trigger messages_notify after insert on public.messages
  for each row execute function public.notify_on_new_message();

grant execute on function
  public.open_conversation(uuid, uuid), public.get_chat_counterparts(uuid[]),
  public.get_chat_unread_count(), public.mark_conversation_read(uuid)
to authenticated;

-- ---------------------------------------------------------------------------
-- Assenze
-- ---------------------------------------------------------------------------
create policy "staff_absences: requester and managers read" on public.staff_absences
  for select to authenticated
  using (member_id in (select private.my_member_ids()) or private.can_person(member_id, 'staff'));

-- Chi gestisce una persona: i titolari dell'azienda e chi ha quel permesso in una
-- sede in cui la persona lavora. Sostituisce absence_managers.
create function private.member_managers(p_member uuid, p_perm text default 'staff')
returns setof uuid language sql stable security definer set search_path = '' as $$
  select o.user_id
    from public.workspace_members m
    join public.workspace_members o on o.workspace_id = m.workspace_id
   where m.id = p_member and o.authority = 'owner' and o.status = 'active' and o.user_id is not null
  union
  select g.user_id
    from public.venue_members vm
    join private.member_venue_grants g on g.venue_id = vm.venue_id
   where vm.member_id = p_member and vm.left_at is null and p_perm = any (g.perms);
$$;

create function private.absence_range_label(p_start date, p_end date, p_start_time time, p_end_time time)
returns text language sql immutable set search_path = '' as $$
  select case
    when p_start = p_end and p_start_time is not null then
      'il ' || to_char(p_start, 'DD/MM') || ' dalle ' || to_char(p_start_time, 'HH24:MI')
        || ' alle ' || to_char(p_end_time, 'HH24:MI')
    when p_start = p_end then 'il ' || to_char(p_start, 'DD/MM')
    else 'dal ' || to_char(p_start, 'DD/MM') || ' al ' || to_char(p_end, 'DD/MM')
  end;
$$;

-- I messaggi di errore di queste due sono per l'utente: restano in italiano.
create function private.absence_validate(
  p_kind public.absence_kind, p_start date, p_end date, p_start_time time, p_end_time time, p_inps text
) returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_start is null or p_end is null then
    raise exception 'Indica le date';
  end if;
  if p_end < p_start then
    raise exception 'La data di fine viene prima di quella di inizio';
  end if;
  if (p_start_time is null) <> (p_end_time is null) then
    raise exception 'Indica sia l''ora di inizio sia quella di fine';
  end if;
  if p_start_time is not null then
    if p_kind <> 'permesso' then raise exception 'Solo un permesso può essere a ore'; end if;
    if p_start <> p_end then raise exception 'Un permesso a ore vale per un giorno solo'; end if;
    if p_end_time <= p_start_time then raise exception 'L''ora di fine deve venire dopo quella di inizio'; end if;
  end if;
  if p_kind <> 'malattia' and nullif(btrim(coalesce(p_inps, '')), '') is not null then
    raise exception 'Il protocollo INPS vale solo per la malattia';
  end if;
end;
$$;

create function private.absence_assert_no_overlap(
  p_member uuid, p_start date, p_end date, p_start_time time, p_end_time time
) returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (
    select 1 from public.staff_absences a
     where a.member_id = p_member and a.status in ('pending', 'approved')
       and a.start_date <= p_end and a.end_date >= p_start
       and (a.start_time is null or p_start_time is null
            or (a.start_time < p_end_time and p_start_time < a.end_time))
  ) then
    raise exception 'C''è già un''assenza in quelle date';
  end if;
end;
$$;

-- Il professionista chiede (ferie, permesso) o comunica (malattia, approvata
-- d'ufficio: il certificato copre anche i giorni passati). Card in chat al
-- titolare + una notifica a chi gestisce lo staff.
create function public.request_absence(
  p_workspace uuid, p_kind public.absence_kind, p_start date, p_end date,
  p_start_time time default null, p_end_time time default null,
  p_note text default null, p_inps_protocol text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me       uuid := (select auth.uid());
  v_member   uuid;
  v_owner    uuid;
  v_note     text := nullif(btrim(coalesce(p_note, '')), '');
  v_protocol text := nullif(btrim(coalesce(p_inps_protocol, '')), '');
  v_sick     boolean := p_kind = 'malattia';
  v_id       uuid;
  v_conv     uuid;
  v_range    text;
  v_label    text;
  v_type     public.notification_type;
  v_title    text;
  v_body     text;
  v_user     uuid;
begin
  perform private.absence_validate(p_kind, p_start, p_end, p_start_time, p_end_time, v_protocol);

  select m.id into v_member from public.workspace_members m
   where m.workspace_id = p_workspace and m.user_id = v_me and m.status = 'active';
  if v_member is null then
    raise exception 'Non fai parte dell''organico di questa azienda';
  end if;
  if not v_sick and p_start < public.local_now()::date then
    raise exception 'Non puoi chiedere un''assenza per giorni già passati';
  end if;
  perform private.absence_assert_no_overlap(v_member, p_start, p_end, p_start_time, p_end_time);

  insert into public.staff_absences (
    member_id, kind, start_date, end_date, start_time, end_time, note, inps_protocol,
    status, requested_by, resolved_at
  ) values (
    v_member, p_kind, p_start, p_end, p_start_time, p_end_time,
    case when v_sick then null else v_note end, case when v_sick then v_protocol end,
    (case when v_sick then 'approved' else 'pending' end)::public.absence_status, v_me,
    case when v_sick then now() end
  ) returning id into v_id;

  v_range := private.absence_range_label(p_start, p_end, p_start_time, p_end_time);
  v_label := case p_kind when 'ferie' then 'Ferie' when 'permesso' then 'Permesso' else 'Malattia' end;
  v_owner := private.workspace_primary_owner(p_workspace);

  -- Il titolare che chiede le proprie ferie non ha con chi parlarne: niente card.
  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(p_workspace, v_me, v_owner);
    -- `content` porta la versione testuale per chi non sa rendere la card.
    -- Mai la nota sulla malattia, che comunque non esiste.
    insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
    values (v_conv, v_me,
      v_label || ' ' || v_range || case when not v_sick and v_note is not null then ': ' || v_note else '' end,
      'absence_request', v_id);
  end if;

  v_type := (case when v_sick then 'absence_sick' else 'absence_request' end)::public.notification_type;
  v_title := case p_kind when 'ferie' then 'Richiesta di ferie' when 'permesso' then 'Richiesta di permesso'
                         else 'Malattia comunicata' end;
  v_body := coalesce((select p.full_name from public.profiles p where p.id = v_me), 'Un professionista')
    || case p_kind when 'ferie' then ' chiede le ferie ' when 'permesso' then ' chiede un permesso '
                   else ' è in malattia ' end || v_range;

  -- Al titolare col riferimento alla chat, agli altri senza: un collaboratore non
  -- ha accesso alla conversazione.
  for v_user in select distinct private.member_managers(v_member, 'staff') loop
    perform private.notify(v_user, v_type, v_title, v_body, case when v_user = v_owner then v_conv end);
  end loop;
  return v_id;
end;
$$;

-- Chi gestisce registra un'assenza (nasce approvata). Non su sé stesso, a meno
-- che sia titolare: un collaboratore le sue le chiede come chiunque altro.
create function public.record_absence(
  p_member uuid, p_kind public.absence_kind, p_start date, p_end date,
  p_start_time time default null, p_end_time time default null,
  p_note text default null, p_inps_protocol text default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_sick     boolean := p_kind = 'malattia';
  v_protocol text := nullif(btrim(coalesce(p_inps_protocol, '')), '');
  v_id       uuid;
begin
  perform private.absence_validate(p_kind, p_start, p_end, p_start_time, p_end_time, v_protocol);
  if not private.can_person(p_member, 'staff') or private.is_restricted_self(p_member) then
    raise exception 'Persona non trovata';
  end if;
  perform private.absence_assert_no_overlap(p_member, p_start, p_end, p_start_time, p_end_time);

  insert into public.staff_absences (
    member_id, kind, start_date, end_date, start_time, end_time, note, inps_protocol,
    status, resolved_by, resolved_at
  ) values (
    p_member, p_kind, p_start, p_end, p_start_time, p_end_time,
    case when v_sick then null else nullif(btrim(coalesce(p_note, '')), '') end,
    case when v_sick then v_protocol end,
    'approved', (select auth.uid()), now()
  ) returning id into v_id;
  return v_id;
end;
$$;

create function public.resolve_absence(p_absence uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  a       record;
  v_ws    uuid;
  v_owner uuid;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_label text;
  v_content text;
  v_conv  uuid;
begin
  select x.member_id, x.requested_by, x.kind, x.start_date, x.end_date, x.start_time, x.end_time into a
    from public.staff_absences x where x.id = p_absence and x.status = 'pending';
  if a.member_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  if not private.can_person(a.member_id, 'staff') or private.is_restricted_self(a.member_id) then
    raise exception 'Non sei tu a decidere su questa richiesta';
  end if;

  update public.staff_absences
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.absence_status,
         resolved_by = v_me, resolved_at = now(), resolution_note = v_note
   where id = p_absence;

  if a.requested_by is null then
    return;
  end if;

  select m.workspace_id into v_ws from public.workspace_members m where m.id = a.member_id;
  v_owner := private.workspace_primary_owner(v_ws);
  v_label := case a.kind when 'ferie' then 'Ferie' else 'Permesso' end;
  -- «Ferie» è femminile plurale, «Permesso» maschile singolare.
  v_content := v_label || ' ' || private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time)
    || case when p_approve then ': approvat' else ': rifiutat' end
    || case when a.kind = 'ferie' then 'e.' else 'o.' end;
  if v_note is not null then
    v_content := v_content || ' ' || v_note;
  end if;

  if v_owner is not null and v_owner <> a.requested_by then
    v_conv := private.conversation_for_pair(v_ws, a.requested_by, v_owner);
    -- Risponde «l'azienda»: il messaggio esce a nome del titolare anche se a
    -- decidere è stato un collaboratore.
    insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
    values (v_conv, v_owner, v_content, 'absence_response', p_absence);
  end if;

  perform private.notify(
    a.requested_by, 'absence_response',
    case
      when a.kind = 'ferie' and p_approve then 'Ferie approvate'
      when a.kind = 'ferie' then 'Ferie rifiutate'
      when p_approve then 'Permesso approvato'
      else 'Permesso rifiutato'
    end,
    v_label || ' ' || private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time),
    v_conv
  );
end;
$$;

create function public.withdraw_absence(p_absence uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me    uuid := (select auth.uid());
  a       record;
  v_ws    uuid;
  v_owner uuid;
  v_range text;
  v_label text;
  v_conv  uuid;
  v_body  text;
  v_user  uuid;
begin
  select x.member_id, x.requested_by, x.status, x.kind, x.start_date, x.end_date, x.start_time, x.end_time into a
    from public.staff_absences x where x.id = p_absence;
  if a.member_id is null then
    raise exception 'Assenza non trovata';
  end if;
  if a.requested_by is distinct from v_me then
    raise exception 'Non è una tua richiesta';
  end if;
  if a.status not in ('pending', 'approved') then
    raise exception 'Questa richiesta è già chiusa';
  end if;
  if a.status = 'approved' and a.start_date <= public.local_now()::date then
    raise exception 'L''assenza è già cominciata: parlane con il titolare';
  end if;

  update public.staff_absences set status = 'withdrawn', resolved_by = v_me, resolved_at = now()
   where id = p_absence;

  select m.workspace_id into v_ws from public.workspace_members m where m.id = a.member_id;
  v_owner := private.workspace_primary_owner(v_ws);
  v_range := private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time);
  v_label := case a.kind when 'ferie' then 'Ferie' when 'permesso' then 'Permesso' else 'Malattia' end;

  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(v_ws, v_me, v_owner);
    insert into public.messages (conversation_id, sender_id, content, kind, absence_id)
    values (v_conv, v_me,
      case when a.status = 'pending'
           then 'Richiesta ritirata: ' || lower(v_label) || ' ' || v_range || '.'
           else v_label || ' ' || v_range || ': annullat'
                || case a.kind when 'ferie' then 'e' when 'permesso' then 'o' else 'a' end || '.'
      end,
      'absence_response', p_absence);
  end if;

  if a.status = 'approved' then
    v_body := coalesce((select p.full_name from public.profiles p where p.id = v_me), 'Un professionista')
      || ' ha annullato: ' || lower(v_label) || ' ' || v_range;
    for v_user in select distinct private.member_managers(a.member_id, 'staff') loop
      perform private.notify(v_user, 'absence_response', 'Assenza annullata', v_body,
        case when v_user = v_owner then v_conv end);
    end loop;
  end if;
end;
$$;

-- Il protocollo INPS lo aggiunge chi ha comunicato la malattia o chi gestisce.
create function public.set_absence_inps_protocol(p_absence uuid, p_protocol text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a record;
begin
  select x.member_id, x.kind, x.status into a from public.staff_absences x where x.id = p_absence;
  if a.member_id is null
     or not (a.member_id in (select private.my_member_ids()) or private.can_person(a.member_id, 'staff')) then
    raise exception 'Assenza non trovata';
  end if;
  if a.kind <> 'malattia' then
    raise exception 'Il protocollo INPS vale solo per la malattia';
  end if;
  if a.status <> 'approved' then
    raise exception 'Questa malattia è stata annullata';
  end if;
  update public.staff_absences set inps_protocol = nullif(btrim(coalesce(p_protocol, '')), '')
   where id = p_absence;
end;
$$;

-- Chi è assente in un periodo, per il planning: le assenze delle persone che posso vedere.
create function public.get_absence_availability(p_from date, p_to date)
returns table (
  id uuid, member_id uuid, start_date date, end_date date,
  start_time time, end_time time, status public.absence_status
) language sql stable security definer set search_path = '' as $$
  select a.id, a.member_id, a.start_date, a.end_date, a.start_time, a.end_time, a.status
    from public.staff_absences a
   where a.status in ('pending', 'approved')
     and a.start_date <= p_to and a.end_date >= p_from
     and a.member_id in (select private.visible_member_ids())
   order by a.start_date;
$$;

-- Riepilogo per l'export: giorni e ore di assenza approvata nel periodo [p_from, p_to).
-- Solo per le persone di cui posso vedere le ore.
create function public.get_absence_summary(p_from date, p_to date)
returns table (
  member_id uuid, member_name text, ferie_days integer, permesso_days integer,
  permesso_hours numeric, malattia_days integer, inps_protocols text
) language sql stable security definer set search_path = '' as $$
  with clipped as (
    select a.member_id, a.kind, a.start_time, a.end_time, a.inps_protocol,
           (least(a.end_date, p_to - 1) - greatest(a.start_date, p_from) + 1) as days
      from public.staff_absences a
     where a.status = 'approved' and a.start_date < p_to and a.end_date >= p_from
       and (
         a.member_id in (
           select w.id from public.workspace_members w
            where w.workspace_id in (select private.my_workspace_ids('owner'))
         )
         or exists (
           select 1 from public.venue_members vm
            where vm.member_id = a.member_id and vm.venue_id in (select private.venues_where('hours'))
         )
       )
  )
  select m.id, m.display_name,
    coalesce(sum(c.days) filter (where c.kind = 'ferie'), 0)::integer,
    coalesce(sum(c.days) filter (where c.kind = 'permesso' and c.start_time is null), 0)::integer,
    round(coalesce(sum(extract(epoch from (c.end_time - c.start_time)) / 3600)
             filter (where c.kind = 'permesso' and c.start_time is not null), 0), 2),
    coalesce(sum(c.days) filter (where c.kind = 'malattia'), 0)::integer,
    string_agg(c.inps_protocol, ', ' order by c.inps_protocol)
      filter (where c.kind = 'malattia' and c.inps_protocol is not null)
    from clipped c join public.workspace_members m on m.id = c.member_id
   group by m.id, m.display_name
   order by m.display_name;
$$;

grant execute on function
  public.request_absence(uuid, public.absence_kind, date, date, time, time, text, text),
  public.record_absence(uuid, public.absence_kind, date, date, time, time, text, text),
  public.resolve_absence(uuid, boolean, text), public.withdraw_absence(uuid),
  public.set_absence_inps_protocol(uuid, text),
  public.get_absence_availability(date, date), public.get_absence_summary(date, date)
to authenticated;
