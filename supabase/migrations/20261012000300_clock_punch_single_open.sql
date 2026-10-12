-- Una sola timbratura aperta per persona, anche nel verso fuori turno → pianificato.
--
-- clock_punch_unplanned rifiuta un'entrata senza turno se ce n'è già una aperta
-- (`clock_already_open`), ma clock_punch non guardava le entrate senza turno:
-- inventario dalle 14 senza turno, turno alle 18 timbrato senza chiudere il
-- primo, e all'uscita le stesse ore si contavano due volte, entrambe «da
-- verificare», senza alcun segnale.
--
-- Ridefinizione completa dell'ultima versione (20261005000300), guard
-- commerciali e ramo 'out' invariati: cambia solo il ramo 'in', prima
-- dell'insert. Stessa firma, quindi `create or replace` conserva i grant.

CREATE OR REPLACE FUNCTION public.clock_punch(p_assignment uuid, p_action text)
 RETURNS shift_clock_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a        record;
  v_method public.clock_method;
  v_row    public.shift_clock_records;
begin
  perform private.assert_clock_completion(p_assignment,p_action);
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('in', 'out') then
    raise exception 'invalid_clock_action' using errcode = '22023';
  end if;

  select x.id, x.shift_id, x.venue_id, x.venue_member_id, x.status,
         s.date, s.start_time, s.end_time, s.status as shift_status,
         coalesce(vm.clock_method, v.clock_method) as effective_method
    into a
    from public.shift_assignments x
    join public.shifts s on s.id = x.shift_id
    join public.venues v on v.id = x.venue_id
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members wm on wm.id = vm.member_id
   where x.id = p_assignment
     and wm.user_id = (select auth.uid())
     and wm.status = 'active'
     and vm.left_at is null
   for update of x;

  if a.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.shift_status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  if public.local_now()::date < a.date - 1
     or public.local_now()::date > public.shift_ends_at(a.date, a.start_time, a.end_time)::date + 1 then
    raise exception 'clock_wrong_day' using errcode = '23514';
  end if;

  v_method := a.effective_method;
  if v_method = 'manual' then
    raise exception 'clock_manual' using errcode = '42501';
  end if;
  if v_method <> 'app' then
    raise exception 'clock_method_unavailable' using errcode = '0A000';
  end if;

  select r.* into v_row
    from public.shift_clock_records r
   where r.assignment_id = p_assignment and r.voided_at is null
   for update;

  if p_action = 'in' then
    if v_row.id is not null then return v_row; end if;
    -- Una sola timbratura aperta per persona: un'entrata senza turno ancora
    -- aperta, in qualunque sede o azienda, va chiusa prima. Stesso predicato
    -- di clock_punch_unplanned, ristretto alle entrate senza turno (fra due
    -- turni pianificati la regola è la decisione D3). Il lock sull'account
    -- serializza con clock_punch_unplanned; qui arriva dopo quello
    -- sull'assegnazione, là prima di tutto: due chiamate concorrenti della
    -- stessa persona sui due percorsi possono andare in deadlock, che Postgres
    -- rileva facendone fallire una, senza dati incoerenti.
    perform 1 from public.profiles where id = (select auth.uid()) for update;
    if exists (
      select 1
        from public.shift_clock_records c
        join public.venue_members x on x.id = c.venue_member_id
        join public.workspace_members xm on xm.id = x.member_id
        cross join lateral private.clock_record_times(c.id) t
       where xm.user_id = (select auth.uid()) and c.voided_at is null
         and c.shift_id is null and t.clock_out_at is null
         and c.clock_in_at > clock_timestamp() - interval '24 hours'
    ) then
      raise exception 'clock_already_open' using errcode = '23514';
    end if;
    insert into public.shift_clock_records (
      assignment_id, shift_id, venue_id, venue_member_id, method, clock_in_at
    ) values (
      a.id, a.shift_id, a.venue_id, a.venue_member_id, v_method, clock_timestamp()
    ) returning * into v_row;
    return v_row;
  end if;

  if v_row.id is null then
    raise exception 'clock_in_required' using errcode = '23514';
  end if;
  if v_row.clock_out_at is not null then return v_row; end if;
  update public.shift_clock_records set clock_out_at = clock_timestamp() where id = v_row.id
  returning * into v_row;
  return v_row;
end;
$function$
;
