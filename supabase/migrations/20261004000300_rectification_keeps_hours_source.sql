-- B02: rettificare le ore non cambia il metodo con cui il turno si è svolto.
--
-- Fino a qui `record_attendance` ricavava `hours_source` dal metodo **attuale**
-- della persona/sede. Dopo un cambio di metodo questo riclassificava i turni
-- già congelati da `set_*_clock_method`: un turno Manuale rettificato dopo il
-- passaggio ad App usciva dal consuntivo; un turno App rettificato e poi
-- azzerato dopo il passaggio a Manuale entrava con le ore pianificate, cioè
-- approvato senza timbratura.
--
-- Il metodo storico della riga, prima dell'UPDATE:
--   manual | manual_auto         → Manuale
--   clock  | clock_expected      → timbratura
--   NULL con worked_hours        → timbratura: senza fonte, delle ore si scrivono
--                                  solo con un metodo non Manuale (backfill di
--                                  20261004000100 e questa stessa funzione)
--   NULL senza worked_hours      → non congelato: vale il metodo corrente, come
--                                  per qualsiasi turno non ancora toccato
--
-- Transizioni della fonte quando la patch contiene `worked_hours`:
--   ore (anche 0), Manuale        → manual
--   ore, timbratura               → NULL (fuori dal consuntivo finché una
--                                  timbratura non viene approvata)
--   null, turno concluso          → manual_auto | clock_expected, lo snapshot che
--                                  avrebbe fissato il cambio di metodo
--   null, turno non concluso      → NULL: seguirà il metodo in vigore
--
-- Nessun backfill: le righe esistenti non cambiano.

create or replace function public.record_attendance(p_assignment uuid, p_patch jsonb)
returns public.shift_assignments language plpgsql security definer set search_path = '' as $$
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
$$;
