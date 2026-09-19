-- Baseline — 10/N: RPC dei turni e delle assegnazioni.
--
-- Sostituiscono createInternalShift(s), updateInternalShift (6+ statement non
-- atomici), updateAssignmentStatus, setAssignmentPresence, reassignShiftAssignment
-- e le vecchie policy `shift_assignments: owner all / delegate self *`.
--
-- La regola «non decidi di te stesso, a meno che tu sia il titolare» è una
-- funzione (private.is_restricted_self) chiamata da ogni punto che tocca una
-- persona: qui sotto, nei trigger di guardia e nelle RPC dei membri.
--   * mettersi/togliersi da un turno: chi ha «Turni» può farlo su sé stesso solo
--     finché il turno non è finito;
--   * presenze e ore proprie: solo il titolare;
--   * confermare/rifiutare il proprio turno: sempre, è il gesto del professionista.

-- ---------------------------------------------------------------------------
-- Interni
-- ---------------------------------------------------------------------------
create function private.assert_can_touch_assignment(p_shift uuid, p_venue_member uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue  uuid;
  v_member uuid;
begin
  select s.venue_id into v_venue from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select vm.member_id into v_member from public.venue_members vm where vm.id = p_venue_member;
  if private.is_restricted_self(v_member) and private.shift_is_over(p_shift) then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;
end;
$$;

create function private.assert_role_in_venue(p_role uuid, p_venue uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_role is not null and not exists (
    select 1 from public.venue_roles r where r.id = p_role and r.venue_id = p_venue
  ) then
    raise exception 'role_not_in_venue' using errcode = '23514';
  end if;
end;
$$;

create function private.assign_one(p_shift uuid, p_venue_member uuid, p_role uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_shift record;
  v_id    uuid;
begin
  perform private.assert_can_touch_assignment(p_shift, p_venue_member);
  select s.venue_id, s.status into v_shift from public.shifts s where s.id = p_shift;
  if v_shift.status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  -- In organico in QUELLA sede, e attivo: la FK composita lo garantirebbe, ma
  -- con un errore illeggibile.
  if not exists (
    select 1 from public.venue_members vm
      join public.workspace_members m on m.id = vm.member_id
     where vm.id = p_venue_member and vm.venue_id = v_shift.venue_id
       and vm.left_at is null and m.status = 'active'
  ) then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;
  perform private.assert_role_in_venue(p_role, v_shift.venue_id);

  insert into public.shift_assignments (shift_id, venue_id, venue_member_id, role_id)
  values (p_shift, v_shift.venue_id, p_venue_member, p_role)
  on conflict (shift_id, venue_member_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_assigned' using errcode = '23505';
  end if;
  return v_id;
end;
$$;

-- Posti da coprire: la somma del fabbisogno per ruolo se c'è (chiamare qualcuno
-- in più non aggiunge posti), altrimenti le persone chiamate. Almeno uno.
create function private.positions_for(p_targets jsonb, p_active_staff integer)
returns integer language sql immutable set search_path = '' as $$
  select greatest(1, case
    when coalesce((select sum((t ->> 'count')::integer)
                     from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) t
                    where (t ->> 'count')::integer > 0), 0) > 0
      then (select sum((t ->> 'count')::integer)
              from jsonb_array_elements(p_targets) t where (t ->> 'count')::integer > 0)
    else p_active_staff
  end)::integer;
$$;

create function private.replace_requirements(p_shift uuid, p_venue uuid, p_targets jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  t jsonb;
begin
  delete from public.shift_role_requirements where shift_id = p_shift;
  for t in select * from jsonb_array_elements(coalesce(p_targets, '[]'::jsonb)) loop
    if coalesce((t ->> 'count')::integer, 0) > 0 then
      perform private.assert_role_in_venue((t ->> 'role_id')::uuid, p_venue);
      insert into public.shift_role_requirements (shift_id, venue_id, role_id, count)
      values (p_shift, p_venue, (t ->> 'role_id')::uuid, (t ->> 'count')::integer);
    end if;
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Turni
-- ---------------------------------------------------------------------------
-- p_plans: [{venue_id, title, description?, date | dates[], start_time, end_time,
--            require_confirmation?, role_targets?[{role_id,count}],
--            staff?[{venue_member_id, role_id?}]}]
-- Tutto o niente: un errore a metà non lascia turni senza fabbisogno o persone.
-- La sede sta sul piano e non sulla chiamata: una settimana duplicata può
-- contenere sedi diverse.
create function public.create_shifts(p_plans jsonb)
returns uuid[] language plpgsql security definer set search_path = '' as $$
declare
  v_plan    jsonb;
  v_venue   uuid;
  v_dates   date[];
  v_date    date;
  v_shift   uuid;
  v_ids     uuid[] := '{}';
  v_staff   jsonb;
  v_item    jsonb;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  for v_plan in select * from jsonb_array_elements(coalesce(p_plans, '[]'::jsonb)) loop
    v_venue := (v_plan ->> 'venue_id')::uuid;
    if v_venue is null or not private.can(v_venue, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if btrim(coalesce(v_plan ->> 'title', '')) = '' then
      raise exception 'title_required' using errcode = '23514';
    end if;

    v_dates := case
      when v_plan ? 'dates' then array(select d::date from jsonb_array_elements_text(v_plan -> 'dates') d)
      else array[(v_plan ->> 'date')::date]
    end;
    v_staff := coalesce(v_plan -> 'staff', '[]'::jsonb);

    foreach v_date in array v_dates loop
      insert into public.shifts (
        venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total
      ) values (
        v_venue, btrim(v_plan ->> 'title'), nullif(btrim(coalesce(v_plan ->> 'description', '')), ''),
        v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time,
        coalesce((v_plan ->> 'require_confirmation')::boolean, false),
        private.positions_for(v_plan -> 'role_targets', jsonb_array_length(v_staff))
      ) returning id into v_shift;

      perform private.replace_requirements(v_shift, v_venue, v_plan -> 'role_targets');
      for v_item in select * from jsonb_array_elements(v_staff) loop
        perform private.assign_one(v_shift, (v_item ->> 'venue_member_id')::uuid, (v_item ->> 'role_id')::uuid);
      end loop;
      v_ids := v_ids || v_shift;
    end loop;
  end loop;
  return v_ids;
end;
$$;

-- Modifica completa: campi base, fabbisogno e assegnati (diff). Se la data o
-- l'orario cambiano, i trigger avvisano gli assegnati e riaprono la conferma.
-- p_payload: {title, date, start_time, end_time, description?, require_confirmation?,
--             role_targets?[], staff?[{venue_member_id, role_id?}]}
-- Le chiavi `role_targets` e `staff` assenti lasciano invariato quel pezzo.
create function public.update_shift(p_shift uuid, p_payload jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue  uuid;
  v_item   jsonb;
  v_keep   uuid[] := '{}';
  v_active integer := 0;
  v_ex     record;
  v_has_staff boolean := p_payload ? 'staff';
  v_targets jsonb;
begin
  select s.venue_id into v_venue from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if btrim(coalesce(p_payload ->> 'title', '')) = '' then
    raise exception 'title_required' using errcode = '23514';
  end if;

  -- Posti attivi: chi viene aggiunto adesso nasce 'assigned' e conta; chi ha già
  -- rifiutato o è risultato assente non aggiunge posti.
  if v_has_staff then
    for v_item in select * from jsonb_array_elements(p_payload -> 'staff') loop
      select a.status into v_ex from public.shift_assignments a
       where a.shift_id = p_shift and a.venue_member_id = (v_item ->> 'venue_member_id')::uuid;
      if not found or v_ex.status in ('assigned', 'confirmed') then
        v_active := v_active + 1;
      end if;
    end loop;
  else
    select count(*) into v_active from public.shift_assignments a
     where a.shift_id = p_shift and a.status in ('assigned', 'confirmed');
  end if;

  v_targets := case
    when p_payload ? 'role_targets' then p_payload -> 'role_targets'
    else (select coalesce(jsonb_agg(jsonb_build_object('role_id', r.role_id, 'count', r.count)), '[]'::jsonb)
            from public.shift_role_requirements r where r.shift_id = p_shift)
  end;

  update public.shifts set
    title = btrim(p_payload ->> 'title'),
    description = nullif(btrim(coalesce(p_payload ->> 'description', '')), ''),
    date = (p_payload ->> 'date')::date,
    start_time = (p_payload ->> 'start_time')::time,
    end_time = (p_payload ->> 'end_time')::time,
    require_confirmation = coalesce((p_payload ->> 'require_confirmation')::boolean, require_confirmation),
    positions_total = private.positions_for(v_targets, v_active)
  where id = p_shift;

  if p_payload ? 'role_targets' then
    perform private.replace_requirements(p_shift, v_venue, p_payload -> 'role_targets');
  end if;

  if v_has_staff then
    -- Nuovi e cambi di mansione.
    for v_item in select * from jsonb_array_elements(p_payload -> 'staff') loop
      v_keep := v_keep || (v_item ->> 'venue_member_id')::uuid;
      select a.id, a.role_id into v_ex from public.shift_assignments a
       where a.shift_id = p_shift and a.venue_member_id = (v_item ->> 'venue_member_id')::uuid;
      if not found then
        perform private.assign_one(p_shift, (v_item ->> 'venue_member_id')::uuid, (v_item ->> 'role_id')::uuid);
      elsif v_ex.role_id is distinct from (v_item ->> 'role_id')::uuid then
        perform private.assert_can_touch_assignment(p_shift, (v_item ->> 'venue_member_id')::uuid);
        perform private.assert_role_in_venue((v_item ->> 'role_id')::uuid, v_venue);
        update public.shift_assignments set role_id = (v_item ->> 'role_id')::uuid where id = v_ex.id;
      end if;
    end loop;
    -- Tolti.
    for v_ex in
      select a.id, a.venue_member_id from public.shift_assignments a
       where a.shift_id = p_shift and a.venue_member_id <> all (v_keep)
    loop
      perform private.assert_can_touch_assignment(p_shift, v_ex.venue_member_id);
      delete from public.shift_assignments where id = v_ex.id;
    end loop;
  end if;
end;
$$;

create function public.set_shift_status(p_shift uuid, p_status public.shift_status)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue uuid;
begin
  select s.venue_id into v_venue from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shifts set status = p_status where id = p_shift;
end;
$$;

-- Un turno finito resta: è storico, ore, presenze.
create function public.delete_shift(p_shift uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_venue uuid;
begin
  select s.venue_id into v_venue from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if private.shift_is_over(p_shift)
     and exists (select 1 from public.shift_assignments a where a.shift_id = p_shift) then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;
  delete from public.shifts where id = p_shift;
end;
$$;

-- ---------------------------------------------------------------------------
-- Assegnazioni
-- ---------------------------------------------------------------------------
create function public.assign(p_shift uuid, p_venue_member uuid, p_role uuid default null)
returns uuid language sql security definer set search_path = '' as $$
  select private.assign_one(p_shift, p_venue_member, p_role);
$$;

create function public.unassign(p_assignment uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a record;
begin
  select x.shift_id, x.venue_member_id into a from public.shift_assignments x where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);
  delete from public.shift_assignments where id = p_assignment;
end;
$$;

-- Sposta il turno su un'altra persona: cancella e ricrea nella stessa transazione
-- (così la notifica «turno assegnato» parte da sola). La mansione viaggia: la
-- stessa se la nuova persona la sa fare, altrimenti la sua unica mansione,
-- altrimenti nessuna — sceglierne una a caso direbbe «coperto» quando non lo è.
create function public.reassign(p_assignment uuid, p_to_venue_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a      record;
  v_role uuid;
  v_new  uuid;
begin
  select x.shift_id, x.venue_member_id, x.role_id into a from public.shift_assignments x where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.venue_member_id = p_to_venue_member then
    return p_assignment;
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);

  select r.role_id into v_role from public.venue_member_roles r
   where r.venue_member_id = p_to_venue_member and r.role_id = a.role_id;
  if v_role is null then
    select (array_agg(r.role_id))[1] into v_role from public.venue_member_roles r
     where r.venue_member_id = p_to_venue_member
    having count(*) = 1;
  end if;

  delete from public.shift_assignments where id = p_assignment;
  v_new := private.assign_one(a.shift_id, p_to_venue_member, v_role);
  return v_new;
end;
$$;

create function public.set_assignment_role(p_assignment uuid, p_role uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a record;
begin
  select x.shift_id, x.venue_id, x.venue_member_id into a from public.shift_assignments x where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);
  perform private.assert_role_in_venue(p_role, a.venue_id);
  update public.shift_assignments set role_id = p_role where id = p_assignment;
end;
$$;

-- Il professionista conferma o rifiuta il PROPRIO turno (anche il titolare che
-- è in turno: è la stessa persona). Non su un turno finito o annullato.
create function public.respond_assignment(p_assignment uuid, p_status public.assignment_status)
returns public.shift_assignments language plpgsql security definer set search_path = '' as $$
declare
  a     record;
  v_row public.shift_assignments;
begin
  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  select x.id, x.shift_id, m.user_id, s.status as shift_status into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = x.shift_id
   where x.id = p_assignment;
  if a.id is null or a.user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.shift_status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if private.shift_is_over(a.shift_id) then
    raise exception 'shift_finished' using errcode = '23514';
  end if;

  update public.shift_assignments
     set status = p_status,
         confirmed_at = case when p_status = 'confirmed' then now() else null end
   where id = p_assignment
  returning * into v_row;
  return v_row;
end;
$$;

-- Presenze e ore di chi ha lavorato. Restituisce la riga aggiornata: il client
-- vede subito cosa è stato scritto, e un rifiuto è un errore, non un 200 muto.
-- p_patch: {status?, worked_hours?}. `status` richiede «Turni», `worked_hours`
-- «Ore». Sulla propria riga: solo il titolare.
--   'confirmed' impostato da chi gestisce = «c'era»: non fa comparire una conferma
--   del professionista (confirmed_at resta com'era). 'assigned' e 'declined'
--   azzerano confirmed_at; 'no_show' non tocca niente.
create function public.record_attendance(p_assignment uuid, p_patch jsonb)
returns public.shift_assignments language plpgsql security definer set search_path = '' as $$
declare
  a      record;
  v_row  public.shift_assignments;
  v_status public.assignment_status;
begin
  select x.id, x.venue_id, x.status, x.confirmed_at, vm.member_id into a
    from public.shift_assignments x join public.venue_members vm on vm.id = x.venue_member_id
   where x.id = p_assignment;
  if a.id is null or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_patch ? 'status' then
    if not private.can(a.venue_id, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_status := (p_patch ->> 'status')::public.assignment_status;
  end if;
  if p_patch ? 'worked_hours' and not private.can(a.venue_id, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  update public.shift_assignments x set
    status = coalesce(v_status, x.status),
    confirmed_at = case
      when v_status is null then x.confirmed_at
      when v_status in ('assigned', 'declined') then null
      else x.confirmed_at
    end,
    worked_hours = case when p_patch ? 'worked_hours' then (p_patch ->> 'worked_hours')::numeric else x.worked_hours end
   where x.id = p_assignment
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function
  public.create_shifts(jsonb), public.update_shift(uuid, jsonb),
  public.set_shift_status(uuid, public.shift_status), public.delete_shift(uuid),
  public.assign(uuid, uuid, uuid), public.unassign(uuid), public.reassign(uuid, uuid),
  public.set_assignment_role(uuid, uuid),
  public.respond_assignment(uuid, public.assignment_status),
  public.record_attendance(uuid, jsonb)
to authenticated;
