-- M03b. Forward-only: enforcement per aziende classificate; le aziende ancora
-- da classificare mantengono esplicitamente il comportamento precedente.
-- Non è una concessione: plan/capacità/date rimangono sconosciuti.
insert into public.workspace_commercial_state (workspace_id, migration_review_required)
select w.id, true from public.workspaces w
on conflict (workspace_id) do nothing;

create function private.initialize_commercial_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.workspace_commercial_state(workspace_id) values (new.id);
  return new;
end;
$$;
create trigger workspaces_commercial_state after insert on public.workspaces
for each row execute function private.initialize_commercial_state();

-- Tutte le mutazioni di capacità e le concessioni usano workspaces prima
-- delle righe figlie. Non usare l'oracolo dei permessi per i blocchi commerciali:
-- serve ancora per lettura, export, revoca e sicurezza in archivio.
create function private.lock_commercial_workspace(p_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform 1 from public.workspaces where id = p_workspace for update;
  if not found then raise exception 'not_allowed' using errcode = '42501'; end if;
  if not exists (select 1 from public.workspace_commercial_state where workspace_id = p_workspace) then
    raise exception 'workspace_access_unavailable' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_workspace_operational(p_workspace uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare a jsonb;
begin
  if not exists (select 1 from public.workspace_members
    where workspace_id = p_workspace and user_id = (select auth.uid()) and status = 'active') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.lock_commercial_workspace(p_workspace);
  a := private.workspace_access_at(p_workspace, clock_timestamp());
  if a->>'state' = 'migration_pending' then return; end if;
  if not (a->>'can_operate')::boolean then
    raise exception 'workspace_read_only' using errcode = '42501';
  end if;
end;
$$;

-- Nessuna rettifica di nuovi turni/assegnazioni. Devono esistere prima della
-- fine operativa e il turno deve essere già iniziato entro quell'istante.
create function private.assert_attendance_access(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; a jsonb; cutoff timestamptz;
begin
  select x.created_at, s.created_at as shift_created_at,
    (s.date + s.start_time) at time zone 'Europe/Rome' as starts_at, v.workspace_id
    into r from public.shift_assignments x join public.shifts s on s.id = x.shift_id
    join public.venues v on v.id = s.venue_id where x.id = p_assignment;
  if r.workspace_id is null or not exists (select 1 from public.workspace_members
    where workspace_id = r.workspace_id and user_id = (select auth.uid()) and status = 'active') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.lock_commercial_workspace(r.workspace_id);
  a := private.workspace_access_at(r.workspace_id, clock_timestamp());
  if a->>'state' in ('operational', 'migration_pending') then return; end if;
  cutoff := (a->>'operational_until')::timestamptz;
  if not coalesce((a->>'can_complete_attendance')::boolean, false)
     or r.created_at > cutoff or r.shift_created_at > cutoff or r.starts_at > cutoff then
    raise exception 'attendance_window_closed' using errcode = '42501';
  end if;
end;
$$;

-- Capienza: confronta prima/dopo, così un'azienda già oltre limite può
-- ridurre l'organico o collegare la stessa persona a un'altra sede.
create function private.check_commercial_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid; a jsonb; previous_people bigint; previous_venues bigint;
begin
  ws := new.workspace_id;
  if tg_when = 'BEFORE' then
    perform private.lock_commercial_workspace(ws);
    -- Il conteggio prima viene ricostruito nell'AFTER dalla riga OLD/NEW.
    return new;
  end if;
  a := private.workspace_access_at(ws, clock_timestamp());
  if a->>'state' = 'migration_pending' then return new; end if;
  previous_people := (a#>>'{usage,people}')::bigint;
  previous_venues := (a#>>'{usage,venues}')::bigint;
  if tg_table_name = 'venues' then
    if new.closed_at is not null or (tg_op = 'UPDATE' and old.closed_at is null) then return new; end if;
    previous_venues := previous_venues - 1;
    -- Persone che contano soltanto grazie alla sede appena riaperta.
    previous_people := previous_people - (select count(distinct m.id)
      from public.workspace_members m join public.venue_members vm on vm.member_id = m.id
      where vm.venue_id = new.id and vm.left_at is null and m.status in ('active','invited')
        and not exists (select 1 from public.venue_members other_vm join public.venues other_v on other_v.id = other_vm.venue_id
          where other_vm.member_id = m.id and other_vm.left_at is null and other_v.closed_at is null and other_v.id <> new.id));
    if a->>'state' = 'setup' and tg_op = 'INSERT' and previous_venues = 0
       and not exists (select 1 from public.workspace_access_periods where workspace_id = ws)
       and not exists (select 1 from public.workspace_commercial_state where workspace_id = ws and trial_started_at is not null) then
      return new; -- una sola prima sede, ancora nessuna operatività
    end if;
  else
    if new.left_at is not null or (tg_op = 'UPDATE' and old.left_at is null) then return new; end if;
    if not exists (select 1 from public.workspace_members m join public.venues v on v.id = new.venue_id
      where m.id = new.member_id and m.status in ('active','invited') and v.closed_at is null) then return new; end if;
    if not exists (select 1 from public.venue_members vm join public.venues v on v.id = vm.venue_id
      where vm.member_id = new.member_id and vm.left_at is null and v.closed_at is null and vm.id <> new.id) then
      previous_people := previous_people - 1;
    end if;
  end if;
  if not (a->>'can_operate')::boolean then raise exception 'workspace_read_only' using errcode = '42501'; end if;
  if (a#>>'{usage,venues}')::bigint > previous_venues
     and (a#>>'{usage,venues}')::bigint > (a#>>'{limits,venues}')::bigint then
    raise exception 'workspace_venue_capacity' using errcode = '23514';
  end if;
  if (a#>>'{usage,people}')::bigint > previous_people
     and a#>>'{limits,people}' is not null
     and (a#>>'{usage,people}')::bigint > (a#>>'{limits,people}')::bigint then
    raise exception 'workspace_people_capacity' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger venues_commercial_lock before insert or update of closed_at on public.venues
for each row execute function private.check_commercial_capacity();
create trigger venues_commercial_capacity after insert or update of closed_at on public.venues
for each row execute function private.check_commercial_capacity();
create trigger venue_members_commercial_lock before insert or update of left_at on public.venue_members
for each row execute function private.check_commercial_capacity();
create trigger venue_members_commercial_capacity after insert or update of left_at on public.venue_members
for each row execute function private.check_commercial_capacity();

-- Scritture dirette: i trigger restituiscono errori espliciti anche quando una
-- policy UPDATE avrebbe scartato zero righe. Le policy di lettura non cambiano.
create function private.guard_commercial_direct_write()
returns trigger language plpgsql security definer set search_path = '' as $$
declare ws uuid;
begin
  -- Manutenzione fidata (fixture, pulizia account): nessun nuovo grant client.
  if (select auth.uid()) is null and current_setting('role') in ('postgres','service_role') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_table_name = 'venues' then
    ws := new.workspace_id;
    -- La chiusura è una riduzione/sicurezza; non è una ripartenza commerciale.
    if (to_jsonb(new) - 'closed_at') = (to_jsonb(old) - 'closed_at') then return new; end if;
  elsif tg_table_name = 'venue_roles' then
    ws := private.venue_workspace(case when tg_op = 'DELETE' then old.venue_id else new.venue_id end);
  elsif tg_table_name = 'staff_documents' then
    select workspace_id into ws from public.workspace_members where id = new.member_id;
  else
    ws := new.id;
    -- Spegnere la chat è una revoca, disponibile anche in archivio.
    if not new.staff_can_chat then return new; end if;
  end if;
  perform private.assert_workspace_operational(ws);
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger venues_commercial_edit before update of name,address,city,cuisine_type,description,logo_url,staff_sees_planning on public.venues
for each row execute function private.guard_commercial_direct_write();
create trigger venue_roles_commercial_write before insert or update or delete on public.venue_roles
for each row execute function private.guard_commercial_direct_write();
create trigger staff_documents_commercial_write before insert or update on public.staff_documents
for each row execute function private.guard_commercial_direct_write();
create trigger workspaces_commercial_chat before update of staff_can_chat on public.workspaces
for each row execute function private.guard_commercial_direct_write();

create function private.can_upload_member_documents(p_member uuid)
returns boolean language plpgsql volatile security definer set search_path = '' as $$
declare ws uuid; a jsonb;
begin
  if not private.can_access_member_documents(p_member) then return false; end if;
  select workspace_id into ws from public.workspace_members where id = p_member;
  perform private.lock_commercial_workspace(ws);
  a := private.workspace_access_at(ws, clock_timestamp());
  return a->>'state' in ('operational','migration_pending');
end;
$$;
alter policy "staff documents: insert" on storage.objects
with check (bucket_id = 'staff-documents'
  and private.can_upload_member_documents(((storage.foldername(name))[1])::uuid));
grant execute on function private.can_upload_member_documents(uuid) to authenticated;

create function private.assert_clock_completion(p_assignment uuid, p_action text)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; a jsonb; cutoff timestamptz;
begin
  if p_action = 'in' then
    perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x
      join public.venues v on v.id = x.venue_id where x.id = p_assignment));
    return;
  end if;
  perform private.assert_attendance_access(p_assignment);
  select v.workspace_id, c.clock_in_at, c.clock_out_at,
    public.shift_ends_at(s.date,s.start_time,s.end_time) at time zone 'Europe/Rome' as ends_at
    into r from public.shift_assignments x join public.venues v on v.id = x.venue_id
    join public.shifts s on s.id = x.shift_id
    join public.shift_clock_records c on c.assignment_id = x.id and c.voided_at is null
    where x.id = p_assignment;
  a := private.workspace_access_at(r.workspace_id,clock_timestamp());
  cutoff := (a->>'operational_until')::timestamptz;
  if a->>'state' = 'archive' and (r.clock_in_at > cutoff
    or (r.clock_out_at is null and clock_timestamp() >= r.ends_at + interval '24 hours')) then
    raise exception 'attendance_window_closed' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_clock_rectification(p_record uuid, p_in timestamptz, p_out timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare r record; a jsonb;
begin
  select c.assignment_id,c.clock_in_at,v.workspace_id,
    public.shift_ends_at(s.date,s.start_time,s.end_time) at time zone 'Europe/Rome' as ends_at
    into r from public.shift_clock_records c join public.venues v on v.id = c.venue_id
    join public.shifts s on s.id = c.shift_id where c.id = p_record;
  perform private.assert_attendance_access(r.assignment_id);
  a := private.workspace_access_at(r.workspace_id,clock_timestamp());
  if a->>'state' = 'archive' and (r.clock_in_at > (a->>'operational_until')::timestamptz
    or p_in > (a->>'operational_until')::timestamptz or p_out >= r.ends_at + interval '24 hours') then
    raise exception 'attendance_window_closed' using errcode = '42501';
  end if;
end;
$$;

-- Accettare/collegare un invito già conteggiato non aggiunge capacità e resta
-- possibile per leggere l'archivio. Le nuove assegnazioni sono comunque negate.
-- Ridurre permessi/ambito è sicurezza; ampliarli richiede operatività.
create function private.assert_member_access_change(p_member uuid, p_authority public.member_authority,
  p_perms jsonb, p_scope public.venue_scope, p_venues uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare m public.workspace_members;
begin
  select * into m from public.workspace_members where id = p_member;
  if not private.owns_workspace(m.workspace_id) then raise exception 'not_allowed' using errcode = '42501'; end if;
  perform private.lock_commercial_workspace(m.workspace_id);
  if p_authority = 'none' then return; end if;
  if m.authority <> 'collaborator'
    or (coalesce((p_perms->>'shifts')::boolean,false) and not m.can_shifts)
    or (coalesce((p_perms->>'staff')::boolean,false) and not m.can_staff)
    or (coalesce((p_perms->>'hours')::boolean,false) and not m.can_hours)
    or (coalesce((p_perms->>'documents')::boolean,false) and not m.can_documents)
    or (coalesce((p_perms->>'venue')::boolean,false) and not m.can_venue)
    or (m.scope = 'selected' and (p_scope = 'all' or exists (
      select 1 from unnest(p_venues) v where not exists (select 1 from public.member_scope s where s.member_id = m.id and s.venue_id = v)))) then
    perform private.assert_workspace_operational(m.workspace_id);
  end if;
end;
$$;

revoke all on function private.initialize_commercial_state(),
  private.lock_commercial_workspace(uuid), private.assert_workspace_operational(uuid),
  private.assert_attendance_access(uuid), private.check_commercial_capacity(),
  private.guard_commercial_direct_write(), private.assert_clock_completion(uuid,text),
  private.assert_clock_rectification(uuid,timestamptz,timestamptz),
  private.assert_member_access_change(uuid,public.member_authority,jsonb,public.venue_scope,uuid[])
  from public, anon, authenticated;
