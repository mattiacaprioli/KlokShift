-- M03b: RPC correnti con preflight commerciale prima dei lock figli.
-- Autorità e permessi restano verificati dalle stesse RPC; letture e azioni
-- di revoca/uscita/trasferimento non ricevono un gate operativo.

CREATE OR REPLACE FUNCTION public.add_member(p_workspace uuid, p_person jsonb DEFAULT '{}'::jsonb, p_authority member_authority DEFAULT 'none'::member_authority, p_perms jsonb DEFAULT '{}'::jsonb, p_scope venue_scope DEFAULT 'all'::venue_scope, p_venues jsonb DEFAULT '[]'::jsonb, p_self boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_owner   boolean;
  v_name    text := nullif(btrim(coalesce(p_person ->> 'full_name', '')), '');
  v_email   text := nullif(lower(btrim(coalesce(p_person ->> 'email', ''))), '');
  v_member  uuid;
  v_user    uuid;
  v_outcome text;
  v_ws_name text;
  v_scope_venues uuid[] := '{}';
  v_vms     uuid[] := '{}';
  v_item    jsonb;
  v_vm      uuid;
  v_found   record;
  v_hr      record;
  v_hr_keys boolean := (p_person ? 'note') or (p_person ? 'contract_hours') or (p_person ? 'contract_period');
begin
  perform private.assert_workspace_operational(p_workspace);
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.manages_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  v_owner := private.owns_workspace(p_workspace);
  select w.name into v_ws_name from public.workspaces w where w.id = p_workspace;

  if p_self then
    select m.id into v_member
      from public.workspace_members m
     where m.workspace_id = p_workspace and m.user_id = v_uid and m.status = 'active';
    v_outcome := 'self';
  else
    if p_authority = 'owner' then
      raise exception 'use_transfer_ownership' using errcode = '23514';
    end if;
    if p_authority <> 'none' and not v_owner then
      raise exception 'owner_only' using errcode = '42501';
    end if;
    if v_name is null then
      raise exception 'name_required' using errcode = '23514';
    end if;
    if not v_owner and jsonb_array_length(coalesce(p_venues, '[]'::jsonb)) = 0 then
      raise exception 'venues_required' using errcode = '23514';
    end if;

    if v_email is not null then
      select m.id, m.status, m.user_id into v_found
        from public.workspace_members m
       where m.workspace_id = p_workspace and lower(m.email) = v_email;
      v_member := v_found.id;
    end if;

    if v_member is not null then
      v_user := v_found.user_id;
      if v_found.status = 'left' then
        update public.workspace_members
           set status = case
                 when user_id is not null or p_authority <> 'none'
                   then 'invited'::public.member_status
                 else 'active'::public.member_status
               end,
               left_at = null, display_name = v_name
         where id = v_member;
        v_outcome := case when v_user is not null then 'invited_in_app' else 'invite_email' end;
      else
        v_outcome := 'already_member';
      end if;
    else
      if v_email is not null then
        select u.id into v_user from auth.users u
         where lower(u.email) = v_email and u.email_confirmed_at is not null
         order by u.created_at limit 1;
      end if;

      if v_user is not null then
        select m.id into v_member from public.workspace_members m
         where m.workspace_id = p_workspace and m.user_id = v_user;
        if v_member is not null then
          v_outcome := 'already_member';
        end if;
      end if;

      if v_member is null then
        if p_authority <> 'none' and v_email is null and v_user is null then
          raise exception 'email_required' using errcode = '23514';
        end if;

        insert into public.workspace_members (
          workspace_id, user_id, email, display_name, phone, authority, status
        ) values (
          p_workspace, v_user, v_email, v_name, nullif(btrim(coalesce(p_person ->> 'phone', '')), ''),
          'none',
          case when v_user is not null or p_authority <> 'none'
               then 'invited'::public.member_status else 'active'::public.member_status end
        ) returning id into v_member;

        v_outcome := case
          when v_user is not null then 'invited_in_app'
          when v_email is not null then 'invite_email'
          else 'created_manual'
        end;
      end if;
    end if;

    if p_authority <> 'none' and v_outcome <> 'already_member' then
      perform private.apply_access(v_member, p_authority, p_perms, p_scope, '{}');
    end if;

    if v_hr_keys then
      if private.is_restricted_self(v_member) then
        raise exception 'not_allowed' using errcode = '42501';
      end if;

      select h.note, h.contract_hours, h.contract_period into v_hr
        from public.member_hr h where h.member_id = v_member;
      insert into public.member_hr (member_id, note, contract_hours, contract_period)
      values (
        v_member,
        case when p_person ? 'note' then nullif(btrim(coalesce(p_person ->> 'note', '')), '') else v_hr.note end,
        case when p_person ? 'contract_hours' then (p_person ->> 'contract_hours')::numeric else v_hr.contract_hours end,
        case when p_person ? 'contract_period' then p_person ->> 'contract_period' else v_hr.contract_period end
      )
      on conflict (member_id) do update
        set note = excluded.note, contract_hours = excluded.contract_hours,
            contract_period = excluded.contract_period;
    end if;

    if v_outcome = 'invited_in_app' then
      perform private.notify(
        v_user, 'staff_invite',
        case when p_authority = 'none' then 'Invito da ' || v_ws_name else 'Invito a collaborare' end,
        case when p_authority = 'none'
             then v_ws_name || ' ti ha aggiunto al suo organico. Accetta per vedere i tuoi turni.'
             else v_ws_name || ' ti invita a collaborare alla gestione.' end,
        v_member
      );
    end if;
  end if;

  if v_member is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_venues, '[]'::jsonb)) loop
    v_vm := private.place_member(
      v_member, p_workspace, (v_item ->> 'venue_id')::uuid,
      coalesce((v_item ->> 'employment_type')::public.employment_type, 'a_chiamata'),
      case when v_item ? 'role_ids'
           then array(select r::uuid from jsonb_array_elements_text(v_item -> 'role_ids') r) end,
      v_item ? 'role_ids'
    );
    v_vms := v_vms || v_vm;
    if coalesce((v_item ->> 'in_scope')::boolean, false) then
      v_scope_venues := v_scope_venues || (v_item ->> 'venue_id')::uuid;
    end if;
  end loop;

  if p_authority = 'collaborator' and p_scope = 'selected' and not p_self and v_outcome <> 'already_member' then
    perform private.apply_access(v_member, p_authority, p_perms, p_scope, v_scope_venues);
  end if;

  return jsonb_build_object(
    'member_id', v_member, 'outcome', v_outcome, 'venue_member_ids', to_jsonb(v_vms)
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_member(p_member uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m    record;
  v_hr   record;
  v_hr_keys boolean := (p_patch ? 'note') or (p_patch ? 'contract_hours') or (p_patch ? 'contract_period');
begin
  perform private.assert_workspace_operational((select workspace_id from public.workspace_members where id = p_member));
  if not private.can_person(p_member, 'staff') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Chi non è titolare non decide sui propri dati di contratto.
  if v_hr_keys and private.is_restricted_self(p_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  select m.user_id into v_m from public.workspace_members m where m.id = p_member;
  if (p_patch ? 'email') and v_m.user_id is not null then
    raise exception 'email_locked' using errcode = '23514';
  end if;

  update public.workspace_members m set
    display_name = case when p_patch ? 'display_name'
                        then coalesce(nullif(btrim(p_patch ->> 'display_name'), ''), m.display_name)
                        else m.display_name end,
    phone = case when p_patch ? 'phone' then nullif(btrim(coalesce(p_patch ->> 'phone', '')), '') else m.phone end,
    email = case when p_patch ? 'email' then nullif(lower(btrim(coalesce(p_patch ->> 'email', ''))), '') else m.email end
  where m.id = p_member;

  if v_hr_keys then
    select h.note, h.contract_hours, h.contract_period into v_hr
      from public.member_hr h where h.member_id = p_member;
    insert into public.member_hr (member_id, note, contract_hours, contract_period)
    values (
      p_member,
      case when p_patch ? 'note' then nullif(btrim(coalesce(p_patch ->> 'note', '')), '') else v_hr.note end,
      case when p_patch ? 'contract_hours' then (p_patch ->> 'contract_hours')::numeric else v_hr.contract_hours end,
      case when p_patch ? 'contract_period' then p_patch ->> 'contract_period' else v_hr.contract_period end
    )
    on conflict (member_id) do update
      set note = excluded.note, contract_hours = excluded.contract_hours,
          contract_period = excluded.contract_period;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_venue(p_member uuid, p_venue uuid, p_employment_type employment_type DEFAULT 'a_chiamata'::employment_type, p_role_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m record;
begin
  perform private.assert_workspace_operational((select workspace_id from public.workspace_members where id = p_member));
  select m.workspace_id, m.status into v_m from public.workspace_members m where m.id = p_member;
  if v_m.workspace_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_m.status = 'left' then
    raise exception 'member_left' using errcode = '23514';
  end if;
  return private.place_member(p_member, v_m.workspace_id, p_venue, p_employment_type, p_role_ids, p_role_ids is not null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_roles(p_venue_member uuid, p_role_ids uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  perform private.assert_workspace_operational((select workspace_id from public.venue_members where id = p_venue_member));
  select vm.venue_id into v_venue from public.venue_members vm where vm.id = p_venue_member;
  if v_venue is null or not private.can(v_venue, 'staff') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.replace_roles(p_venue_member, p_role_ids);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_venue_clock_method(p_venue uuid, p_method clock_method)
 RETURNS venues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare v_row public.venues;
begin
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_assignments a
     set hours_source = case when v.clock_method = 'manual'
                             then 'manual_auto' else 'clock_expected' end
    from public.shifts s, public.venue_members vm, public.venues v
   where a.shift_id = s.id and a.venue_member_id = vm.id
     and v.id = p_venue and a.venue_id = p_venue
     and vm.clock_method is null and a.worked_hours is null
     and a.hours_source is null
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
  update public.venues set clock_method = p_method where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_clock_method(p_venue_member uuid, p_method clock_method DEFAULT NULL::clock_method)
 RETURNS venue_members
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_row    public.venue_members;
  v_member uuid;
  v_venue  uuid;
  v_old_method public.clock_method;
begin
  perform private.assert_workspace_operational((select workspace_id from public.venue_members where id = p_venue_member));
  select vm.member_id, vm.venue_id, coalesce(vm.clock_method, v.clock_method)
    into v_member, v_venue, v_old_method
    from public.venue_members vm join public.venues v on v.id = vm.venue_id
   where vm.id = p_venue_member;
  if v_venue is null or not private.can(v_venue, 'hours')
     or private.is_restricted_self(v_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_assignments a
     set hours_source = case when v_old_method = 'manual'
                             then 'manual_auto' else 'clock_expected' end
    from public.shifts s
   where a.shift_id = s.id and a.venue_member_id = p_venue_member
     and a.worked_hours is null and a.hours_source is null
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
  update public.venue_members set clock_method = p_method where id = p_venue_member
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_shift(p_shift uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue  uuid;
  v_item   jsonb;
  v_keep   uuid[] := '{}';
  v_active integer := 0;
  v_ex     record;
  v_has_staff boolean := p_payload ? 'staff';
  v_targets jsonb;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_shift_status(p_shift uuid, p_status shift_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  select s.venue_id into v_venue from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shifts set status = p_status where id = p_shift;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.delete_shift(p_shift uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
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
$function$
;

CREATE OR REPLACE FUNCTION public.unassign(p_assignment uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  select x.shift_id, x.venue_member_id into a from public.shift_assignments x where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);
  delete from public.shift_assignments where id = p_assignment;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.reassign(p_assignment uuid, p_to_venue_member uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a       record;
  v_shift uuid;
  v_role  uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  select x.shift_id into v_shift from public.shift_assignments x where x.id = p_assignment;
  if v_shift is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform 1 from public.shifts s where s.id = v_shift for update;

  select x.shift_id, x.venue_member_id, x.role_id
    into a
    from public.shift_assignments x
   where x.id = p_assignment
   for update;
  if a.shift_id is null or a.shift_id <> v_shift then
    raise exception 'assignment_changed' using errcode = '23514';
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
  return private.assign_one(a.shift_id, p_to_venue_member, v_role);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.move_assignment(p_assignment uuid, p_to_shift uuid DEFAULT NULL::uuid, p_to_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a           record;
  v_shift     uuid;
  v_from      record;
  v_to_venue  uuid;
  v_to_member uuid;
  v_to_shift  uuid;
  v_role      uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  if (p_to_shift is null) = (p_to_date is null) then
    raise exception 'invalid_target' using errcode = '23514';
  end if;

  -- Il turno di partenza serve per sapere cosa bloccare; si rilegge dopo.
  select x.shift_id into v_shift from public.shift_assignments x where x.id = p_assignment;
  if v_shift is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_to_shift = v_shift then
    return p_assignment;
  end if;
  perform 1 from public.shifts s
   where s.id in (v_shift, p_to_shift)
   order by s.id
   for update;

  select x.shift_id, x.venue_member_id, x.role_id, vm.member_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.id = p_assignment
   for update of x;
  if a.shift_id is null or a.shift_id <> v_shift then
    raise exception 'assignment_changed' using errcode = '23514';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);

  select s.venue_id, s.title, s.description, s.start_time, s.end_time, s.require_confirmation
    into v_from
    from public.shifts s where s.id = a.shift_id;

  if p_to_shift is not null then
    select s.venue_id into v_to_venue from public.shifts s where s.id = p_to_shift;
    if v_to_venue is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_to_shift := p_to_shift;
  else
    -- Il gemello nasce nella sede del turno di partenza: `update_shift` non
    -- sposta mai un turno di sede, e questo non è il posto per cominciare.
    v_to_venue := v_from.venue_id;
  end if;

  -- La stessa PERSONA nella sede di arrivo (vedi 20260920001600).
  select vm.id into v_to_member
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
   where vm.member_id = a.member_id and vm.venue_id = v_to_venue
     and vm.left_at is null and m.status = 'active';
  if v_to_member is null then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;

  -- La mansione viaggia, come in `reassign`.
  select r.role_id into v_role from public.venue_member_roles r
   where r.venue_member_id = v_to_member and r.role_id = a.role_id;
  if v_role is null then
    select (array_agg(r.role_id))[1] into v_role from public.venue_member_roles r
     where r.venue_member_id = v_to_member
    having count(*) = 1;
  end if;

  if v_to_shift is null then
    if not private.can(v_to_venue, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    insert into public.shifts (
      venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total
    ) values (
      v_to_venue, v_from.title, v_from.description,
      p_to_date, v_from.start_time, v_from.end_time, v_from.require_confirmation,
      private.positions_for(null::jsonb, 1)
    ) returning id into v_to_shift;
  end if;

  perform private.assert_can_touch_assignment(v_to_shift, v_to_member);

  delete from public.shift_assignments where id = p_assignment;
  return private.assign_one(v_to_shift, v_to_member, v_role);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_assignment_role(p_assignment uuid, p_role uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  select x.shift_id, x.venue_id, x.venue_member_id into a from public.shift_assignments x where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);
  perform private.assert_role_in_venue(p_role, a.venue_id);
  update public.shift_assignments set role_id = p_role where id = p_assignment;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.respond_assignment(p_assignment uuid, p_status assignment_status)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a     record;
  v_row public.shift_assignments;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_attendance(p_assignment uuid, p_patch jsonb)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a        record;
  v_row    public.shift_assignments;
  v_status public.assignment_status;
  v_manual boolean;
  v_source text;
begin
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  if not (p_patch ?| array['status', 'worked_hours'])
     or exists (select 1 from jsonb_object_keys(p_patch) as key
                 where not (key = any (array['status', 'worked_hours']))) then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  perform private.assert_attendance_access(p_assignment);
  select x.id, x.venue_id, x.status, x.confirmed_at, vm.member_id,
         x.worked_hours, x.hours_source,
         coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as concluded
    into a
    from public.shift_assignments x
    join public.shifts s on s.id = x.shift_id
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
   where x.id = p_assignment
   for update of x;
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

  v_source := a.hours_source;
  if p_patch ? 'worked_hours' then
    v_manual := case
      when a.hours_source in ('manual', 'manual_auto') then true
      when a.hours_source in ('clock', 'clock_expected') then false
      when a.worked_hours is not null then false
      else a.effective_clock_method = 'manual'
    end;
    v_source := case
      when p_patch ->> 'worked_hours' is not null then
        case when v_manual then 'manual' else null end
      when a.concluded then
        case when v_manual then 'manual_auto' else 'clock_expected' end
      else null
    end;
  end if;

  update public.shift_assignments x set
    status = coalesce(v_status, x.status),
    confirmed_at = case
      when v_status is null then x.confirmed_at
      when v_status in ('assigned', 'declined') then null
      else x.confirmed_at
    end,
    worked_hours = case when p_patch ? 'worked_hours'
      then (p_patch ->> 'worked_hours')::numeric else x.worked_hours end,
    hours_source = v_source,
    attendance_reviewed_at = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_at end,
    attendance_reviewed_by = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_by end
   where x.id = p_assignment
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_clock_record(p_assignment uuid)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
  t record;
  v_row public.shift_assignments;
begin
  perform private.assert_attendance_access(p_assignment);
  select x.id, x.venue_id, x.status, vm.member_id, r.id as record_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.shift_clock_records r on r.assignment_id = x.id and r.voided_at is null
   where x.id = p_assignment
   for update of x, r;
  if a.id is null or not private.can(a.venue_id, 'hours')
     or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  select * into t from private.clock_record_times(a.record_id);
  if t.clock_out_at is null then
    raise exception 'clock_out_required' using errcode = '23514';
  end if;
  update public.shift_assignments x set
    worked_hours = round((extract(epoch from (t.clock_out_at - t.clock_in_at)) / 3600.0) * 4) / 4,
    hours_source = 'clock',
    attendance_reviewed_at = now(),
    attendance_reviewed_by = (select auth.uid())
  where x.id = a.id returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.void_clock_record(p_assignment uuid, p_reason text)
 RETURNS shift_clock_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_row public.shift_clock_records;
begin
  perform private.assert_attendance_access(p_assignment);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select x.*, vm.member_id into r
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.assignment_id = p_assignment and x.voided_at is null
   for update of x;
  if r.id is null or not private.can(r.venue_id, 'hours')
     or private.is_restricted_self(r.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_clock_records set
    voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = r.id returning * into v_row;
  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = p_assignment;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.correct_clock_record(p_record uuid, p_in timestamp with time zone, p_out timestamp with time zone, p_reason text)
 RETURNS shift_clock_corrections
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r public.shift_clock_records;
  t record;
  v_row public.shift_clock_corrections;
begin
  perform private.assert_clock_rectification(p_record,p_in,p_out);
  if p_in is null and p_out is null then
    raise exception 'clock_correction_required' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select * into r from public.shift_clock_records where id = p_record for update;
  if r.id is null or r.voided_at is not null or not private.can(r.venue_id, 'hours')
     or private.is_restricted_self((select vm.member_id from public.venue_members vm where vm.id = r.venue_member_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into t from private.clock_record_times(r.id);
  if coalesce(p_out, t.clock_out_at) is not null
     and coalesce(p_out, t.clock_out_at) <= coalesce(p_in, t.clock_in_at) then
    raise exception 'invalid_clock_interval' using errcode = '23514';
  end if;
  insert into public.shift_clock_corrections (
    clock_record_id, corrected_in_at, corrected_out_at, reason, corrected_by
  ) values (r.id, p_in, p_out, btrim(p_reason), (select auth.uid()))
  returning * into v_row;

  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = r.assignment_id;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.clock_punch(p_assignment uuid, p_action text)
 RETURNS shift_clock_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a        record;
  v_method public.clock_method;
  v_row    public.shift_clock_records;
begin
  perform private.assert_clock_completion(p_assignment,p_action);
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('in', 'out') then
    raise exception 'invalid_clock_action' using errcode = '22023';
  end if;

  select x.id, x.shift_id, x.venue_id, x.venue_member_id, x.status,
         s.date, s.start_time, s.end_time, s.status as shift_status,
         coalesce(vm.clock_method, v.clock_method) as effective_method
    into a
    from public.shift_assignments x
    join public.shifts s on s.id = x.shift_id
    join public.venues v on v.id = x.venue_id
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members wm on wm.id = vm.member_id
   where x.id = p_assignment
     and wm.user_id = (select auth.uid())
     and wm.status = 'active'
     and vm.left_at is null
   for update of x;

  if a.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.shift_status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  if public.local_now()::date < a.date - 1
     or public.local_now()::date > public.shift_ends_at(a.date, a.start_time, a.end_time)::date + 1 then
    raise exception 'clock_wrong_day' using errcode = '23514';
  end if;

  v_method := a.effective_method;
  if v_method = 'manual' then
    raise exception 'clock_manual' using errcode = '42501';
  end if;
  if v_method <> 'app' then
    raise exception 'clock_method_unavailable' using errcode = '0A000';
  end if;

  select r.* into v_row
    from public.shift_clock_records r
   where r.assignment_id = p_assignment and r.voided_at is null
   for update;

  if p_action = 'in' then
    if v_row.id is not null then return v_row; end if;
    insert into public.shift_clock_records (
      assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at
    ) values (
      a.id, a.shift_id, a.venue_id, a.venue_member_id, v_method, clock_timestamp()
    ) returning * into v_row;
    return v_row;
  end if;

  if v_row.id is null then
    raise exception 'clock_in_required' using errcode = '23514';
  end if;
  if v_row.clock_out_at is not null then return v_row; end if;
  update public.shift_clock_records set clock_out_at = clock_timestamp() where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_absence(p_workspace uuid, p_kind absence_kind, p_start date, p_end date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_note text DEFAULT NULL::text, p_inps_protocol text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.assert_workspace_operational(p_workspace);
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
$function$
;

CREATE OR REPLACE FUNCTION public.record_absence(p_member uuid, p_kind absence_kind, p_start date, p_end date, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_note text DEFAULT NULL::text, p_inps_protocol text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_sick     boolean := p_kind = 'malattia';
  v_protocol text := nullif(btrim(coalesce(p_inps_protocol, '')), '');
  v_id       uuid;
begin
  perform private.assert_workspace_operational((select workspace_id from public.workspace_members where id = p_member));
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
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_absence(p_absence uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.assert_workspace_operational((select commercial_member.workspace_id from public.staff_absences commercial_absence join public.workspace_members commercial_member on commercial_member.id=commercial_absence.member_id where commercial_absence.id=p_absence));
  select x.member_id, x.requested_by, x.kind, x.start_date, x.end_date, x.start_time, x.end_time into a
    from public.staff_absences x
   where x.id = p_absence and x.status = 'pending'
   for update;
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
  v_content := v_label || ' ' || private.absence_range_label(a.start_date, a.end_date, a.start_time, a.end_time)
    || case when p_approve then ': approvat' else ': rifiutat' end
    || case when a.kind = 'ferie' then 'e.' else 'o.' end;
  if v_note is not null then
    v_content := v_content || ' ' || v_note;
  end if;

  if v_owner is not null and v_owner <> a.requested_by then
    v_conv := private.conversation_for_pair(v_ws, a.requested_by, v_owner);
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
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_absence(p_absence uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.assert_workspace_operational((select commercial_member.workspace_id from public.staff_absences commercial_absence join public.workspace_members commercial_member on commercial_member.id=commercial_absence.member_id where commercial_absence.id=p_absence));
  select x.member_id, x.requested_by, x.status, x.kind, x.start_date, x.end_date, x.start_time, x.end_time into a
    from public.staff_absences x
   where x.id = p_absence
   for update;
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_absence_inps_protocol(p_absence uuid, p_protocol text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
begin
  perform private.assert_workspace_operational((select commercial_member.workspace_id from public.staff_absences commercial_absence join public.workspace_members commercial_member on commercial_member.id=commercial_absence.member_id where commercial_absence.id=p_absence));
  select x.member_id, x.kind, x.status into a from public.staff_absences x where x.id = p_absence;
  if a.member_id is null
     or not (a.member_id in (select private.my_member_ids()) or private.can_person(a.member_id, 'staff')) then
    raise exception 'Assenza non trovata';
  end if;
  if a.kind <> 'malattia' then
    raise exception 'Il riferimento del certificato medico vale solo per la malattia';
  end if;
  if a.status <> 'approved' then
    raise exception 'Questa malattia è stata annullata';
  end if;
  update public.staff_absences set inps_protocol = nullif(btrim(coalesce(p_protocol, '')), '')
   where id = p_absence;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.request_shift_change(p_assignment uuid, p_reason text, p_kind change_request_kind DEFAULT 'substitution'::change_request_kind, p_start time without time zone DEFAULT NULL::time without time zone, p_end time without time zone DEFAULT NULL::time without time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
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
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_shift_change_request(p_request uuid, p_approve boolean, p_replacement uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me     uuid := (select auth.uid());
  r        record;
  v_owner  uuid;
  v_conv   uuid;
  v_repl   text;
  v_body   text;
  v_content text;
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_pre    record;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_change_requests q join public.shifts s on s.id=q.shift_id join public.venues v on v.id=s.venue_id where q.id=p_request));
  -- Ordine dei lock (come move_assignment/reassign, 20261004000500): turno,
  -- assegnazione, richiesta. Cancellare l'assegnazione aggiorna la richiesta
  -- (`on delete set null`), quindi chi sposta la persona blocca già in
  -- quest'ordine; prenderlo al contrario rischierebbe lo stallo.
  select q.shift_id, q.assignment_id into v_pre
    from public.shift_change_requests q where q.id = p_request;
  if v_pre.shift_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  perform 1 from public.shifts s where s.id = v_pre.shift_id for update;
  perform 1 from public.shift_assignments x where x.id = v_pre.assignment_id for update;

  select q.assignment_id, q.shift_id, q.shift_date, q.requested_by, q.kind,
         q.proposed_start_time as t_start, q.proposed_end_time as t_end,
         ve.id as venue_id, ve.name as venue_name, ve.workspace_id,
         (select vm.member_id from public.shift_assignments x
            join public.venue_members vm on vm.id = x.venue_member_id
           where x.id = q.assignment_id) as member_id
    into r
    from public.shift_change_requests q
    join public.shifts s on s.id = q.shift_id
    join public.venues ve on ve.id = s.venue_id
   where q.id = p_request and q.status = 'pending'
   for update of q;
  if r.shift_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  if not private.can(r.venue_id, 'shifts') or private.is_restricted_self(r.member_id) then
    raise exception 'Non sei tu a decidere su questo turno';
  end if;

  if p_approve and r.kind = 'substitution' and p_replacement is not null then
    select m.display_name into v_repl
      from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
     where vm.id = p_replacement;
  end if;

  update public.shift_change_requests
     set status = (case when p_approve then 'approved' else 'rejected' end)::public.change_request_status,
         resolved_by = v_me, resolved_at = now(), resolution_note = v_note
   where id = p_request;

  if p_approve and r.kind = 'substitution' then
    if r.assignment_id is null then
      null;  -- l'assegnazione è già sparita per altra via: la richiesta si chiude lo stesso
    elsif p_replacement is not null then
      perform public.reassign(r.assignment_id, p_replacement);
    else
      delete from public.shift_assignments where id = r.assignment_id;
    end if;
  end if;

  if not p_approve then
    v_content := case when r.kind = 'hours' then 'Richiesta rifiutata: resta l''orario del turno.'
                      else 'Richiesta rifiutata: il turno resta tuo.' end;
    v_body := coalesce(r.venue_name, 'La sede') || ' ha rifiutato la richiesta del ' || to_char(r.shift_date, 'DD/MM');
  elsif r.kind = 'hours' then
    v_content := 'Orario concordato: ' || to_char(r.t_start, 'HH24:MI') || '–' || to_char(r.t_end, 'HH24:MI') || '.';
    v_body := coalesce(r.venue_name, 'La sede') || ' ha accettato il nuovo orario del ' || to_char(r.shift_date, 'DD/MM');
  else
    v_content := 'Richiesta approvata'
      || case when v_repl is not null then ': al tuo posto ' || v_repl else ': il turno resta scoperto' end || '.';
    v_body := coalesce(r.venue_name, 'La sede') || ' ha approvato il cambio del ' || to_char(r.shift_date, 'DD/MM');
  end if;
  if v_note is not null then
    v_content := v_content || ' ' || v_note;
  end if;

  v_owner := private.workspace_primary_owner(r.workspace_id);
  if v_owner is not null and v_owner <> r.requested_by then
    v_conv := private.conversation_for_pair(r.workspace_id, r.requested_by, v_owner, r.shift_id);
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, v_content, 'shift_change_response', p_request);
  end if;

  perform private.notify(
    r.requested_by, 'shift_change_response',
    case when p_approve then 'Richiesta accettata' else 'Richiesta rifiutata' end, v_body, v_conv
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.withdraw_shift_change_request(p_request uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me    uuid := (select auth.uid());
  r       record;
  v_owner uuid;
  v_conv  uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_change_requests q join public.shifts s on s.id=q.shift_id join public.venues v on v.id=s.venue_id where q.id=p_request));
  select q.requested_by, q.shift_id, ve.workspace_id into r
    from public.shift_change_requests q
    join public.shifts s on s.id = q.shift_id
    join public.venues ve on ve.id = s.venue_id
   where q.id = p_request and q.status = 'pending'
   for update of q;
  if r.shift_id is null then
    raise exception 'Richiesta non trovata o già chiusa';
  end if;
  if r.requested_by is distinct from v_me then
    raise exception 'Non è una tua richiesta';
  end if;

  update public.shift_change_requests set status = 'withdrawn', resolved_by = v_me, resolved_at = now()
   where id = p_request;

  v_owner := private.workspace_primary_owner(r.workspace_id);
  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(r.workspace_id, v_me, v_owner, r.shift_id);
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, 'Richiesta di cambio ritirata.', 'shift_change_response', p_request);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_absence_hour_credit(p_absence uuid, p_date date, p_minutes integer DEFAULT NULL::integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.staff_absences;
begin
  perform private.assert_workspace_operational((select commercial_member.workspace_id from public.staff_absences commercial_absence join public.workspace_members commercial_member on commercial_member.id=commercial_absence.member_id where commercial_absence.id=p_absence));
  select * into a from public.staff_absences where id = p_absence for update;
  if a.id is null or a.status <> 'approved' or a.start_time is not null
     or p_date is null or p_date < a.start_date or p_date > a.end_date
     or not private.can_person(a.member_id, 'hours')
     or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_minutes is not null and (p_minutes <= 0 or p_minutes > 1440) then
    raise exception 'invalid_hours';
  end if;
  if p_minutes is null then
    delete from public.absence_hour_credits where absence_id = p_absence and date = p_date;
  else
    insert into public.absence_hour_credits(absence_id, date, minutes, created_by)
    values (p_absence, p_date, p_minutes, (select auth.uid()))
    on conflict (absence_id, date) do update
      set minutes = excluded.minutes, created_by = excluded.created_by, updated_at = now();
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.set_member_access(p_member uuid, p_authority member_authority, p_perms jsonb DEFAULT '{}'::jsonb, p_scope venue_scope DEFAULT 'all'::venue_scope, p_scope_venues uuid[] DEFAULT '{}'::uuid[])
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_m record;
  v_ws text;
begin
  perform private.assert_member_access_change(p_member,p_authority,p_perms,p_scope,p_scope_venues);
  select m.workspace_id, m.authority, m.user_id, m.status into v_m
    from public.workspace_members m where m.id = p_member;
  if v_m.workspace_id is null or not private.owns_workspace(v_m.workspace_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if v_m.authority = 'owner' or p_authority = 'owner' then
    raise exception 'use_transfer_ownership' using errcode = '23514';
  end if;
  if p_authority = 'collaborator' and (v_m.user_id is null or v_m.status <> 'active') then
    raise exception 'needs_account' using errcode = '23514';
  end if;

  perform private.apply_access(p_member, p_authority, p_perms, p_scope, p_scope_venues);

  select w.name into v_ws from public.workspaces w where w.id = v_m.workspace_id;
  if v_m.authority = 'none' and p_authority = 'collaborator' then
    perform private.notify(v_m.user_id, 'team_linked', 'Ora collabori alla gestione',
      'Puoi gestire ' || v_ws || ' con i permessi che ti sono stati dati.', p_member);
  elsif v_m.authority = 'collaborator' and p_authority = 'none' then
    perform private.notify(v_m.user_id, 'team_removed', 'Accesso alla gestione tolto',
      'Non gestisci più ' || v_ws || '.', p_member);
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.create_shifts(p_plans jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

  for v_venue in select distinct private.venue_workspace((p->>'venue_id')::uuid) from jsonb_array_elements(coalesce(p_plans,'[]'::jsonb)) p order by 1 loop
    perform private.assert_workspace_operational(v_venue);
  end loop;

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
$function$
;

CREATE OR REPLACE FUNCTION private.assign_one(p_shift uuid, p_venue_member uuid, p_role uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shift record;
  v_id    uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_venue_closed(p_venue uuid, p_closed boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not private.owns_workspace(private.venue_workspace(p_venue)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.lock_commercial_workspace(private.venue_workspace(p_venue));
  update public.venues
     set closed_at = case when p_closed then coalesce(closed_at, now()) else null end
   where id = p_venue;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.start_workspace_trial(p_workspace uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := (select auth.uid());
  v_period uuid;
  v_started_at timestamptz;
  v_review_required boolean;
  v_now timestamptz := now();
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Lo stesso lock sarà usato per capacità, variazioni e classificazione.
  perform 1 from public.workspaces w
   where w.id = p_workspace and w.deleted_at is null for update;
  if not found or not private.owns_workspace(p_workspace) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  insert into public.workspace_commercial_state (workspace_id)
  values (p_workspace) on conflict (workspace_id) do nothing;
  select s.trial_started_at, s.migration_review_required
    into v_started_at, v_review_required
    from public.workspace_commercial_state s where s.workspace_id = p_workspace;
  if v_review_required then
    raise exception 'commercial_migration_required' using errcode = '23514';
  end if;

  select p.id into v_period from public.workspace_access_periods p
   where p.workspace_id = p_workspace and p.kind = 'trial';
  if found then
    return v_period;
  end if;
  -- La data rimane una lapide anche se il servizio ha rimosso il periodo.
  if v_started_at is not null then
    raise exception 'trial_already_used' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.venues v
     where v.workspace_id = p_workspace and v.closed_at is null
  ) then
    raise exception 'trial_requires_open_venue' using errcode = '23514';
  end if;

  if (select count(*) from public.venues where workspace_id=p_workspace and closed_at is null) > 1 then
    raise exception 'workspace_venue_capacity' using errcode = '23514';
  end if;
  insert into public.workspace_access_periods (
    workspace_id, kind, plan, venue_limit, starts_at, ends_at, reason
  ) values (
    p_workspace, 'trial', 'team', 1, v_now, v_now + interval '720 hours',
    'Prova iniziale di 30 giorni senza carta'
  ) returning id into v_period;
  update public.workspace_commercial_state
     set trial_started_at = v_now where workspace_id = p_workspace;
  return v_period;
end;
$function$
;
