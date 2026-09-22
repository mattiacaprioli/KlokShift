-- record_attendance is SECURITY DEFINER and returns the updated assignment.
-- Reject patches that cannot perform a supported mutation before looking up
-- the target, so an empty/unknown patch cannot be used as an alternate read.
create or replace function public.record_attendance(p_assignment uuid, p_patch jsonb)
returns public.shift_assignments language plpgsql security definer set search_path = '' as $$
declare
  a        record;
  v_row    public.shift_assignments;
  v_status public.assignment_status;
begin
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  if not (p_patch ?| array['status', 'worked_hours'])
     or exists (
       select 1
         from jsonb_object_keys(p_patch) as key
        where not (key = any (array['status', 'worked_hours']))
     ) then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;

  select x.id, x.venue_id, x.status, x.confirmed_at, vm.member_id into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
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
    worked_hours = case
      when p_patch ? 'worked_hours' then (p_patch ->> 'worked_hours')::numeric
      else x.worked_hours
    end
   where x.id = p_assignment
  returning * into v_row;
  return v_row;
end;
$$;
