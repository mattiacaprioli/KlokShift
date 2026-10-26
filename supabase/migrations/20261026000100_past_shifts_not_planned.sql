-- Il passato non si pianifica: si registra.
--
-- Fino a qui `create_shifts` accettava turni già finiti, e chi aveva solo
-- «Turni» poteva far contare delle ore senza il permesso «Ore» (con il metodo
-- Manuale il turno concluso vale subito come ore lavorate). Le interfacce non
-- li mandano più — il «+» dei giorni passati apre «Turno già fatto»
-- (`record_past_shift`, 20261026000000) — e qui si chiude il server:
--
--   * `create_shifts` rifiuta un turno già finito (`shift_finished`);
--   * `move_assignment` non fa nascere il gemello nel passato;
--   * `assign_one` mette qualcuno su un turno finito solo con «Ore»
--     (`finished_shift_locked`), la stessa regola che vale per cambiarne data e
--     orari (`guard_finished_shift_times`).
--
-- «Duplica settimana/mese» lascia fuori i turni che cadrebbero nel passato e
-- lo dice prima (web/src/shifts/DuplicatePeriodDialog.tsx).

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
  v_break   integer;
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
    v_break := coalesce((v_plan ->> 'break_minutes')::integer, 0);
    perform private.assert_shift_break(
      (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time, v_break);

    foreach v_date in array v_dates loop
      -- Il passato non si pianifica: si registra (`record_past_shift`, con Ore).
      if public.shift_ends_at(v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time)
         <= public.local_now() then
        raise exception 'shift_finished' using errcode = '23514';
      end if;
      insert into public.shifts (
        venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
        break_minutes
      ) values (
        v_venue, btrim(v_plan ->> 'title'), nullif(btrim(coalesce(v_plan ->> 'description', '')), ''),
        v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time,
        coalesce((v_plan ->> 'require_confirmation')::boolean, false),
        private.positions_for(v_plan -> 'role_targets', jsonb_array_length(v_staff)),
        v_break
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

  select s.venue_id, s.title, s.description, s.start_time, s.end_time, s.require_confirmation,
         s.break_minutes
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
    -- Il gemello è un turno nuovo: nel passato non nasce, come in create_shifts.
    if public.shift_ends_at(p_to_date, v_from.start_time, v_from.end_time) <= public.local_now() then
      raise exception 'shift_finished' using errcode = '23514';
    end if;
    insert into public.shifts (
      venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
      break_minutes
    ) values (
      v_to_venue, v_from.title, v_from.description,
      p_to_date, v_from.start_time, v_from.end_time, v_from.require_confirmation,
      private.positions_for(null::jsonb, 1),
      v_from.break_minutes
    ) returning id into v_to_shift;
  end if;

  perform private.assert_can_touch_assignment(v_to_shift, v_to_member);

  delete from public.shift_assignments where id = p_assignment;
  return private.assign_one(v_to_shift, v_to_member, v_role);
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
  select s.venue_id, s.status, s.unplanned into v_shift from public.shifts s where s.id = p_shift;
  if v_shift.status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  -- Il fuori turno è di chi ha timbrato: nessun altro ci entra, da nessuna
  -- strada (assign, form, move_assignment). Lui nasce con un insert diretto.
  if v_shift.unplanned then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  -- Mettere qualcuno su un turno finito fa contare le sue ore: è una
  -- rettifica, e le rettifiche le fa chi ha Ore (come per data e orari,
  -- `guard_finished_shift_times`).
  if private.shift_is_over(p_shift) and not private.can(v_shift.venue_id, 'hours') then
    raise exception 'finished_shift_locked' using errcode = '42501';
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
