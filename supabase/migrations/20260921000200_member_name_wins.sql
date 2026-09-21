-- ---------------------------------------------------------------------------
-- Dentro l'azienda vince il nome della scheda
--
-- Una persona ha due nomi: `workspace_members.display_name`, che scrive chi la
-- mette in organico, e `profiles.full_name`, che si dà da sola. L'aggancio
-- dell'account non tocca il primo, e le due strade leggevano fonti diverse:
-- staff, turni, ore ed export la scheda («Andrea»), chat, rubrica e notifiche
-- il profilo («Andreina»). Il titolare vedeva due persone dove ce n'era una.
--
-- Da qui, dentro un'azienda, il nome è sempre quello della scheda: è quello che
-- finisce nell'export delle ore e nei documenti, e lo governa chi gestisce.
-- Il profilo resta il ripiego quando in quell'azienda la scheda non c'è; la foto
-- resta quella del profilo. All'aggancio, se i due nomi differiscono, la
-- notifica al titolare lo dice.
-- ---------------------------------------------------------------------------

-- Il nome di una persona dentro un'azienda. Anche le schede `left`: un thread
-- vecchio deve continuare a nominare chi c'era.
create function private.member_name(p_workspace uuid, p_user uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select nullif(btrim(m.display_name), '') from public.workspace_members m
      where m.workspace_id = p_workspace and m.user_id = p_user
      order by (m.status = 'left'), m.created_at desc limit 1),
    (select nullif(btrim(p.full_name), '') from public.profiles p where p.id = p_user)
  );
$$;

create or replace function private.chat_counterpart(p_workspace uuid, p_user uuid, p_with_place boolean)
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
  select p.avatar_url into v_avatar
    from public.profiles p where p.id = p_user;
  v_found := found;
  v_name := private.member_name(p_workspace, p_user);

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

create or replace function public.get_workspace_contacts()
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
         coalesce(nullif(btrim(t.display_name), ''), nullif(btrim(p.full_name), ''), 'Professionista'),
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

create or replace function public.request_absence(
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
  v_body := coalesce(private.member_name(p_workspace, v_me), 'Un professionista')
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

create or replace function public.withdraw_absence(p_absence uuid)
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
    v_body := coalesce(private.member_name(v_ws, v_me), 'Un professionista')
      || ' ha annullato: ' || lower(v_label) || ' ' || v_range;
    for v_user in select distinct private.member_managers(a.member_id, 'staff') loop
      perform private.notify(v_user, 'absence_response', 'Assenza annullata', v_body,
        case when v_user = v_owner then v_conv end);
    end loop;
  end if;
end;
$$;

create or replace function public.request_shift_change(
  p_assignment uuid, p_reason text,
  p_kind public.change_request_kind default 'substitution',
  p_start time default null, p_end time default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_me      uuid := (select auth.uid());
  a         record;
  v_owner   uuid;
  v_conv    uuid;
  v_request uuid;
  v_label   text;
  v_user    uuid;
  v_body    text;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Scrivi il motivo della richiesta';
  end if;
  if p_kind = 'hours' and (p_start is null or p_end is null) then
    raise exception 'Indica il nuovo orario';
  end if;
  if p_kind = 'hours' and p_start = p_end then
    raise exception 'L''orario di fine non può essere uguale a quello di inizio';
  end if;

  select m.user_id as who, s.id as shift_id, s.date, s.venue_id, ve.workspace_id, x.status,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as over
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = x.shift_id
    join public.venues ve on ve.id = s.venue_id
   where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'Assegnazione non trovata';
  end if;
  if a.who is distinct from v_me then
    raise exception 'Non è il tuo turno';
  end if;
  if a.over then
    raise exception 'Il turno è già concluso';
  end if;
  if a.status not in ('assigned', 'confirmed') then
    raise exception 'Questo turno non è più tuo';
  end if;
  -- Una aperta per volta, di qualunque tipo: due card pendenti sullo stesso turno
  -- sono solo un modo per rispondere a una e dimenticare l'altra.
  if exists (
    select 1 from public.shift_change_requests r where r.assignment_id = p_assignment and r.status = 'pending'
  ) then
    raise exception 'Hai già una richiesta aperta su questo turno';
  end if;

  insert into public.shift_change_requests (
    assignment_id, shift_id, shift_date, requested_by, reason, kind, proposed_start_time, proposed_end_time
  ) values (
    p_assignment, a.shift_id, a.date, v_me, btrim(p_reason), p_kind,
    case when p_kind = 'hours' then p_start end, case when p_kind = 'hours' then p_end end
  ) returning id into v_request;

  v_owner := private.workspace_primary_owner(a.workspace_id);
  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(a.workspace_id, v_me, v_owner, a.shift_id);
    v_label := case when p_kind = 'hours'
                    then 'Orario diverso (' || to_char(p_start, 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI') || '): '
                    else '' end;
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, v_label || btrim(p_reason), 'shift_change_request', v_request);
  end if;

  v_body := coalesce(private.member_name(a.workspace_id, v_me), 'Un professionista')
    || case when p_kind = 'hours' then ' chiede un altro orario il ' else ' chiede di essere sostituito il ' end
    || to_char(a.date, 'DD/MM');
  for v_user in select distinct private.managers_of(a.venue_id, 'shifts') loop
    perform private.notify(
      v_user, 'shift_change_request',
      case when p_kind = 'hours' then 'Richiesta di cambio orario' else 'Richiesta di cambio turno' end,
      v_body, case when v_user = v_owner then v_conv end
    );
  end loop;
  return v_request;
end;
$$;

create or replace function private.link_member_invites(p_user uuid)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_email text;
  v_confirmed timestamptz;
  v_linked integer := 0;
  r record;
  v_owner uuid;
  v_profile text;
begin
  select lower(u.email), u.email_confirmed_at into v_email, v_confirmed
    from auth.users u where u.id = p_user;
  if v_email is null or v_confirmed is null then
    return 0;
  end if;
  select nullif(btrim(p.full_name), '') into v_profile from public.profiles p where p.id = p_user;

  for r in
    select m.id, m.workspace_id, m.display_name, w.name as workspace_name
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
     where m.user_id is null and lower(m.email) = v_email and m.status <> 'left'
       for update of m
  loop
    if exists (
      select 1 from public.workspace_members x
       where x.workspace_id = r.workspace_id and x.user_id = p_user
    ) then
      -- Questo account è già in azienda con un'altra scheda: non si fonde da sé,
      -- lo decide il titolare.
      update public.workspace_members set link_conflict_at = now() where id = r.id;
      continue;
    end if;

    update public.workspace_members set user_id = p_user where id = r.id;
    v_linked := v_linked + 1;

    for v_owner in
      select m.user_id from public.workspace_members m
       where m.workspace_id = r.workspace_id and m.authority = 'owner'
         and m.status = 'active' and m.user_id is not null
    loop
      perform private.notify(
        v_owner, 'staff_linked', 'Scheda collegata',
        r.display_name || ' ha creato l''account'
          || case when v_profile is not null and lower(v_profile) <> lower(btrim(r.display_name))
                  then ' (sul profilo: ' || v_profile || ')' else '' end
          || ' ed è stato collegato alla sua scheda.',
        r.id
      );
    end loop;
  end loop;

  return v_linked;
end;
$$;
