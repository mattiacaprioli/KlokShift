-- Il turno «Fuori turno» nasce con l'istante d'entrata, non con quello d'uscita.
--
-- Il turno e l'assegnazione nascevano all'uscita con `created_at = now()`. Chi
-- entra prima della fine operativa ed esce dopo (o la cui uscita dimenticata la
-- chiude chi gestisce) generava un turno creato dopo quel limite, e
-- `private.assert_attendance_access` rifiuta i record creati dopo la fine
-- operativa: nessuno poteva più rettificarlo, approvarlo o annullarlo, e le ore
-- non arrivavano mai a `worked_hours` né all'export. Il turno pianificato
-- equivalente esisteva già prima e funzionava.
--
-- Il lavoro è iniziato all'entrata: è lì che nasce il turno che lo registra. Il
-- guard resta com'è, usato da molti percorsi. Nessun backfill.

-- Dalla timbratura chiusa al turno: orari al minuto (per difetto, così il turno
-- risulta già concluso; almeno un minuto, perché fine = inizio vorrebbe dire
-- 24 ore), data del giorno di entrata, assegnazione confermata e misurata dalla
-- timbratura. Le ore restano quelle della timbratura, non del turno.
create or replace function private.materialize_unplanned_clock(p_record uuid)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  c       public.shift_clock_records;
  t       record;
  v_in    timestamp;
  v_out   timestamp;
  v_shift uuid;
  v_asg   uuid;
begin
  select * into c from public.shift_clock_records where id = p_record for update;
  if c.id is null or c.shift_id is not null or c.voided_at is not null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into t from private.clock_record_times(c.id);
  if t.clock_out_at is null then
    raise exception 'clock_out_required' using errcode = '23514';
  end if;
  if t.clock_out_at - t.clock_in_at > interval '24 hours' then
    raise exception 'clock_open_too_long' using errcode = '23514';
  end if;

  v_in  := date_trunc('minute', t.clock_in_at at time zone 'Europe/Rome');
  v_out := date_trunc('minute', t.clock_out_at at time zone 'Europe/Rome');
  if v_out <= v_in then v_out := v_in + interval '1 minute'; end if;

  perform set_config('app.unplanned_clock', '1', true);
  -- Turno e assegnazione nascono all'entrata: in archivio restano rettificabili
  -- come il turno pianificato equivalente (vedi assert_attendance_access).
  insert into public.shifts (
    venue_id, title, description, date, start_time, end_time, unplanned, created_at
  ) values (
    c.venue_id, 'Fuori turno', c.note, v_in::date, v_in::time, v_out::time, true, c.clock_in_at
  ) returning id into v_shift;

  insert into public.shift_assignments (
    shift_id, venue_id, venue_member_id, role_id, status, confirmed_at, hours_source, created_at
  ) values (
    v_shift, c.venue_id, c.venue_member_id, c.role_id, 'confirmed', c.clock_in_at, 'clock_expected', c.clock_in_at
  ) returning id into v_asg;
  perform set_config('app.unplanned_clock', '', true);

  update public.shift_clock_records
     set shift_id = v_shift, assignment_id = v_asg
   where id = c.id
  returning * into c;
  return c;
end;
$$;

revoke all on function private.materialize_unplanned_clock(uuid) from public, anon, authenticated;
