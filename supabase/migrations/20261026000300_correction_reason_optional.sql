-- Il motivo di una correzione è facoltativo.
--
-- Fino a qui ogni correzione di una timbratura (orari, pausa, orari inseriti
-- da chi gestisce) chiedeva un motivo scritto. Nell'uso quotidiano — «ha fatto
-- mezz'ora in più» — era un campo da riempire a ogni ritocco. La traccia resta
-- comunque: la correzione è sempre una riga nuova, con autore e ora, e gli
-- orari originali non si toccano. Il motivo, se c'è, si aggiunge a quella.
--
-- Resta obbligatorio dove si toglie qualcosa o si chiude a nome di altri:
-- annullare una timbratura (`void_clock_record`, `void_unplanned_clock`) e
-- chiudere un fuori turno lasciato aperto (`close_unplanned_clock`).

alter table public.shift_clock_corrections
  alter column reason drop not null,
  drop constraint if exists shift_clock_corrections_reason_check,
  add constraint shift_clock_corrections_reason_check
    check (reason is null or btrim(reason) <> '');

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
  ) values (r.id, p_in, p_out, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid()))
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

create or replace function public.correct_clock_break(p_record uuid, p_minutes integer, p_reason text)
returns public.shift_clock_corrections language plpgsql security definer set search_path = '' as $$
declare
  r     public.shift_clock_records;
  t     record;
  v_row public.shift_clock_corrections;
begin
  perform private.assert_clock_rectification(p_record, null, null);
  if p_minutes is null or p_minutes < 0 or p_minutes > 1440 then
    raise exception 'break_invalid' using errcode = '22023';
  end if;
  select * into r from public.shift_clock_records where id = p_record for update;
  if r.id is null or r.voided_at is not null or not private.can(r.venue_id, 'hours')
     or private.is_restricted_self((select vm.member_id from public.venue_members vm where vm.id = r.venue_member_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  select * into t from private.clock_record_times(r.id);
  if t.clock_out_at is not null
     and p_minutes * 60 >= extract(epoch from (t.clock_out_at - t.clock_in_at)) then
    raise exception 'break_too_long' using errcode = '23514';
  end if;
  insert into public.shift_clock_corrections (
    clock_record_id, corrected_break_minutes, reason, corrected_by
  ) values (r.id, p_minutes, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid()))
  returning * into v_row;

  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = r.assignment_id;
  return v_row;
end;
$$;

create or replace function public.enter_clock_record(
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
  ) values (v_record, p_in, p_out, nullif(btrim(coalesce(p_reason, '')), ''), (select auth.uid()));

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
