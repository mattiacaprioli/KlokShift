-- Orari inseriti da chi gestisce, per chi timbra dall'app.
--
-- Con la timbratura dall'app le ore contano solo se una timbratura è
-- approvata (20261004000300, B02): scrivere un numero di ore a mano le lascia
-- fuori dal consuntivo. Andava bene finché la timbratura c'era da correggere;
-- se invece la persona non aveva timbrato affatto, quel turno non poteva più
-- contare in nessun modo.
--
-- `enter_clock_record` crea la timbratura che manca con gli orari indicati da
-- chi ha «Ore», con un motivo, e la approva nello stesso passo — come
-- l'«aggiungi timbratura» dei gestionali di turni, che nasce già approvata.
-- La traccia resta: `method = 'manual'` (orari registrati da chi gestisce, non
-- dal telefono) e una correzione con motivo e autore, come ogni rettifica.

create function public.enter_clock_record(
  p_assignment uuid,
  p_in timestamptz,
  p_out timestamptz,
  p_reason text
)
returns public.shift_assignments
language plpgsql security definer set search_path = '' as $$
declare
  a        record;
  v_record uuid;
  v_row    public.shift_assignments;
begin
  perform private.assert_attendance_access(p_assignment);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select x.id, x.shift_id, x.venue_id, x.venue_member_id, x.status, vm.member_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.id = p_assignment
   for update of x;
  if a.id is null or not private.can(a.venue_id, 'hours')
     or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  -- Una timbratura c'è già: si corregge quella (`correct_clock_record`).
  if exists (select 1 from public.shift_clock_records r
              where r.assignment_id = a.id and r.voided_at is null) then
    raise exception 'clock_record_exists' using errcode = '23505';
  end if;
  if p_in is null or p_out is null or p_out <= p_in or p_out > clock_timestamp()
     or p_out - p_in > interval '24 hours' then
    raise exception 'invalid_clock_interval' using errcode = '23514';
  end if;

  insert into public.shift_clock_records (
    assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at, clock_out_at
  ) values (
    a.id, a.shift_id, a.venue_id, a.venue_member_id, 'manual', p_in, p_out
  ) returning id into v_record;
  insert into public.shift_clock_corrections (
    clock_record_id, corrected_in_at, corrected_out_at, reason, corrected_by
  ) values (v_record, p_in, p_out, btrim(p_reason), (select auth.uid()));

  -- Approvata subito, con la stessa regola di `approve_clock_record`: ore dalla
  -- timbratura, pausa quella del turno finché nessuno la corregge.
  update public.shift_assignments x set
    worked_hours = private.clock_record_counted_hours(v_record),
    hours_source = 'clock',
    attendance_reviewed_at = now(),
    attendance_reviewed_by = (select auth.uid())
  where x.id = a.id
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.enter_clock_record(uuid, timestamptz, timestamptz, text)
  from public, anon;
grant execute on function public.enter_clock_record(uuid, timestamptz, timestamptz, text)
  to authenticated;
