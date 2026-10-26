-- Turno già fatto. Chi gestisce le ore registra a posteriori un turno che si è
-- svolto ma non era stato pianificato («mi sono dimenticato di metterlo»):
-- le persone risultano già presenti e le ore del turno contano subito, con la
-- regola del turno concluso senza timbratura (`manual_auto`: orario meno la
-- pausa non retribuita), correggibili poi dalle presenze come ogni altro turno.
--
-- Regole (vedi AGENTS.md «Turno già fatto»):
--   * lo fa chi ha «Ore» sulla sede, non «Turni»: è una registrazione di ore;
--   * solo lavoro già finito: un turno che deve ancora finire si pianifica;
--   * le proprie ore le registra solo il titolare («non decidi di te stesso»);
--   * nessuna notifica di turno assegnato: non è un invito, nessuno deve
--     confermare. Chi registra può chiedere di avvisare con `p_notify`;
--   * il turno resta riconoscibile (`recorded_at`, `recorded_by`).
--
-- Le ore restano solo su `shift_assignments`: nessuna seconda fonte.

alter table public.shifts
  add column recorded_at timestamptz,
  add column recorded_by uuid references public.profiles (id) on delete set null;

comment on column public.shifts.recorded_at is
  'Registrato a posteriori da chi gestisce le ore (record_past_shift): non era stato pianificato.';

create function public.record_past_shift(
  p_venue uuid,
  p_date date,
  p_start time,
  p_end time,
  p_break_minutes integer,
  p_title text,
  p_note text,
  p_staff jsonb,
  p_notify boolean default false
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_shift uuid;
  v_item  jsonb;
  v_vm    uuid;
  v_role  uuid;
  v_member uuid;
  v_count integer;
  v_venue_name text;
  v_user  uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_venue is null or not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));

  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'title_required' using errcode = '23514';
  end if;
  if p_date is null or p_start is null or p_end is null or p_start = p_end then
    raise exception 'shift_times_invalid' using errcode = '23514';
  end if;
  -- Solo lavoro già svolto: quello che deve ancora finire si pianifica, e chi
  -- vi lavora riceve la notifica e conferma come sempre.
  if public.shift_ends_at(p_date, p_start, p_end) > public.local_now() then
    raise exception 'shift_not_finished' using errcode = '23514';
  end if;
  if jsonb_typeof(p_staff) is distinct from 'array' or jsonb_array_length(p_staff) = 0 then
    raise exception 'staff_required' using errcode = '23514';
  end if;
  v_count := jsonb_array_length(p_staff);
  perform private.assert_shift_break(p_start, p_end, coalesce(p_break_minutes, 0));

  -- Le notifiche delle assegnazioni tacciono come per il fuori turno: è lavoro
  -- già svolto, non un turno da confermare.
  perform set_config('app.unplanned_clock', '1', true);

  insert into public.shifts (
    venue_id, title, description, date, start_time, end_time,
    require_confirmation, positions_total, break_minutes, recorded_at, recorded_by
  ) values (
    p_venue, btrim(p_title), nullif(btrim(coalesce(p_note, '')), ''),
    p_date, p_start, p_end,
    false, v_count, coalesce(p_break_minutes, 0), now(), (select auth.uid())
  ) returning id into v_shift;

  for v_item in select * from jsonb_array_elements(p_staff) loop
    v_vm := (v_item ->> 'venue_member_id')::uuid;
    v_role := nullif(v_item ->> 'role_id', '')::uuid;
    -- In organico in QUELLA sede, e attivo (come `assign_one`).
    select vm.member_id into v_member
      from public.venue_members vm
      join public.workspace_members m on m.id = vm.member_id
     where vm.id = v_vm and vm.venue_id = p_venue
       and vm.left_at is null and m.status = 'active';
    if v_member is null then
      raise exception 'not_in_roster' using errcode = '23514';
    end if;
    if private.is_restricted_self(v_member) then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    perform private.assert_role_in_venue(v_role, p_venue);

    insert into public.shift_assignments (
      shift_id, venue_id, venue_member_id, role_id, status, confirmed_at, hours_source
    ) values (
      v_shift, p_venue, v_vm, v_role, 'confirmed', now(), 'manual_auto'
    )
    on conflict (shift_id, venue_member_id) do nothing;
    if not found then
      raise exception 'already_assigned' using errcode = '23505';
    end if;
  end loop;

  perform set_config('app.unplanned_clock', '', true);

  if coalesce(p_notify, false) then
    select v.name into v_venue_name from public.venues v where v.id = p_venue;
    for v_user in
      select m.user_id
        from public.shift_assignments a
        join public.venue_members vm on vm.id = a.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
       where a.shift_id = v_shift and m.user_id is not null
    loop
      perform private.notify(
        v_user, 'shift_assigned', 'Turno registrato',
        coalesce(v_venue_name, 'La sede') || ' ha registrato il tuo turno del '
          || to_char(p_date, 'DD/MM') || ', ' || to_char(p_start, 'HH24:MI')
          || '–' || to_char(p_end, 'HH24:MI') || '.',
        v_shift
      );
    end loop;
  end if;

  return v_shift;
end;
$$;

revoke all on function public.record_past_shift(uuid, date, time, time, integer, text, text, jsonb, boolean)
  from public, anon;
grant execute on function public.record_past_shift(uuid, date, time, time, integer, text, text, jsonb, boolean)
  to authenticated;
