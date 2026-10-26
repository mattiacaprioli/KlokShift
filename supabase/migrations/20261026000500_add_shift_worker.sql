-- Chi ha lavorato a un turno finito senza esserci segnato: il sostituto.
--
-- In sala capita spesso: era segnato Marco, è venuto Luca, e nessuno l'ha
-- registrato. Su un turno finito il form non si apre più (il passato non si
-- pianifica, 20261026000100), e `assign_one` — che chiede Ore — avviserebbe
-- Luca con «Nuovo turno assegnato · Conferma la presenza» per un turno già
-- fatto. Qui chi ha «Ore» lo aggiunge dalle presenze, con la stessa regola di
-- «Turno già fatto» (`record_past_shift`, 20261026000000):
--
--   * solo su un turno finito, non annullato e non nato da una timbratura;
--   * la persona risulta presente (`confirmed`) e le ore del turno contano
--     subito (`manual_auto`), correggibili dalle presenze;
--   * nessuna notifica: non è un invito;
--   * le proprie ore le aggiunge solo il titolare.
--
-- Chi aveva rifiutato e poi è venuto lo stesso torna presente sulla sua riga
-- (l'indice unico è per turno e persona). Chi è già sul turno, anche segnato
-- assente, si gestisce con Presente/Assente.

create function public.add_shift_worker(
  p_shift uuid,
  p_venue_member uuid,
  p_role uuid default null
)
returns public.shift_assignments
language plpgsql security definer set search_path = '' as $$
declare
  s        record;
  v_member uuid;
  v_ex     public.shift_assignments;
  v_row    public.shift_assignments;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select x.id, x.venue_id, x.status, x.unplanned into s
    from public.shifts x where x.id = p_shift for update;
  if s.id is null or not private.can(s.venue_id, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(s.venue_id));
  if s.status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if s.unplanned then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  -- Prima della fine si pianifica: lì valgono notifiche e conferme.
  if not private.shift_is_over(p_shift) then
    raise exception 'shift_not_finished' using errcode = '23514';
  end if;

  -- In organico in QUELLA sede, e attivo (come `assign_one`).
  select vm.member_id into v_member
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
   where vm.id = p_venue_member and vm.venue_id = s.venue_id
     and vm.left_at is null and m.status = 'active';
  if v_member is null then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;
  if private.is_restricted_self(v_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_role_in_venue(p_role, s.venue_id);

  select * into v_ex from public.shift_assignments
   where shift_id = p_shift and venue_member_id = p_venue_member
   for update;
  if v_ex.id is not null then
    if v_ex.status <> 'declined' then
      raise exception 'already_assigned' using errcode = '23505';
    end if;
    -- Aveva rifiutato ed è venuto lo stesso: torna presente, con le ore del
    -- turno come chi viene aggiunto adesso.
    update public.shift_assignments set
      status = 'confirmed',
      confirmed_at = now(),
      role_id = coalesce(p_role, role_id),
      worked_hours = null,
      hours_source = 'manual_auto',
      attendance_reviewed_at = null,
      attendance_reviewed_by = null
    where id = v_ex.id
    returning * into v_row;
    return v_row;
  end if;

  -- Le notifiche delle assegnazioni tacciono come per il fuori turno.
  perform set_config('app.unplanned_clock', '1', true);
  insert into public.shift_assignments (
    shift_id, venue_id, venue_member_id, role_id, status, confirmed_at, hours_source
  ) values (
    p_shift, s.venue_id, p_venue_member, p_role, 'confirmed', now(), 'manual_auto'
  ) returning * into v_row;
  perform set_config('app.unplanned_clock', '', true);
  return v_row;
end;
$$;

revoke all on function public.add_shift_worker(uuid, uuid, uuid) from public, anon;
grant execute on function public.add_shift_worker(uuid, uuid, uuid) to authenticated;
