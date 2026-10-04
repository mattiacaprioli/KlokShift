-- B11: due spostamenti contemporanei della stessa persona non la duplicano.
--
-- `move_assignment` e `reassign` leggevano l'assegnazione di partenza senza
-- lock, la cancellavano senza controllare di averla trovata e poi creavano la
-- destinazione. Due chiamate sulla stessa origine leggevano entrambe la riga;
-- la seconda DELETE aspettava la prima, cancellava zero righe e creava comunque
-- la sua destinazione: la persona finiva su due turni.
--
-- Ordine dei lock (vale per tutti gli ingressi che toccano turno e assegnazioni):
--   1. le righe `shifts` coinvolte, in ordine di id — `update_shift` e il
--      trigger `sync_positions_filled` toccano già prima il turno e poi le
--      assegnazioni; prenderle in ordine evita anche lo stallo fra due
--      spostamenti incrociati (X da S1 a S2 mentre Y va da S2 a S1);
--   2. la riga `shift_assignments` di partenza, `for update`, ricontrollata:
--      se nel frattempo è sparita o ha cambiato turno, `assignment_changed` e
--      nessun effetto (niente gemello, niente assegnazione, niente notifica).
-- I permessi si controllano dopo il lock, sui dati che si stanno per toccare.

create or replace function public.move_assignment(
  p_assignment uuid,
  p_to_shift   uuid default null,
  p_to_date    date default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a           record;
  v_shift     uuid;
  v_from      record;
  v_to_venue  uuid;
  v_to_member uuid;
  v_to_shift  uuid;
  v_role      uuid;
begin
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
$$;

create or replace function public.reassign(p_assignment uuid, p_to_venue_member uuid)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  a       record;
  v_shift uuid;
  v_role  uuid;
begin
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
$$;
