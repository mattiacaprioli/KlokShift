-- C06 (audit 2026-10-12): un turno «Fuori turno» nasce da una timbratura e
-- descrive lavoro già svolto. Non si sposta, non si annulla e non riceve altre
-- persone; titolo e descrizione restano correggibili. Se è sbagliato si annulla
-- la timbratura. Copie integrali delle ultime definizioni
-- (20261005000300_commercial_rpc_guards.sql) con il solo controllo aggiunto.
-- I privilegi restano quelli esistenti: CREATE OR REPLACE non li cambia.

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
  v_cur    record;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  select s.venue_id, s.unplanned, s.date, s.start_time, s.end_time, s.require_confirmation
    into v_cur from public.shifts s where s.id = p_shift;
  v_venue := v_cur.venue_id;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Un fuori turno descrive lavoro già svolto: si correggono titolo e
  -- descrizione, non data, orari, persone o fabbisogno. Il payload è il turno
  -- intero, quindi conta il valore e non la presenza della chiave.
  if v_cur.unplanned and (
       p_payload ? 'staff' or p_payload ? 'role_targets'
    or (p_payload ->> 'date')::date is distinct from v_cur.date
    or (p_payload ->> 'start_time')::time is distinct from v_cur.start_time
    or (p_payload ->> 'end_time')::time is distinct from v_cur.end_time
    or coalesce((p_payload ->> 'require_confirmation')::boolean, v_cur.require_confirmation)
         is distinct from v_cur.require_confirmation
  ) then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
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
  v_unplanned boolean;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  select s.venue_id, s.unplanned into v_venue, v_unplanned from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Annullarlo toglierebbe in silenzio la timbratura dal riepilogo: la strada è
  -- annullare la timbratura (`void_clock_record`), che elimina anche il turno.
  if v_unplanned then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  update public.shifts set status = p_status where id = p_shift;
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
