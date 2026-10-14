-- C13 (audit 2026-10-12): entrate fuori turno orfane e casi concorrenti.
--
-- 1. Un'entrata aperta di una scheda non più attiva (tolto dalla sede, uscito
--    dall'azienda) o di una sede chiusa non blocca più le nuove entrate: chi la
--    possiede non la vede né la chiude. Vale per clock_punch_unplanned e per il
--    controllo gemello di clock_punch (20261012000300, «stesso predicato»).
--    Chiuderla d'ufficio è la decisione D4, non presa qui.
-- 2. Uscita del professionista su un'entrata già chiusa o annullata da chi
--    gestisce le ore → clock_already_closed invece di clock_in_required.
-- 3. close_unplanned_clock su un'entrata già diventata turno → clock_already_closed
--    invece di not_allowed, dopo i controlli di permesso.
--
-- Copie integrali delle ultime definizioni (20261010000000_unplanned_clock.sql,
-- 20261012000300_clock_punch_single_open.sql) con le sole modifiche indicate.
-- I privilegi restano quelli esistenti: CREATE OR REPLACE non li cambia.

create or replace function public.clock_punch_unplanned(
  p_venue_member uuid,
  p_action text,
  p_role uuid default null,
  p_note text default null
)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  r       record;
  v_row   public.shift_clock_records;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('in', 'out') then
    raise exception 'invalid_clock_action' using errcode = '22023';
  end if;

  select vm.id, vm.venue_id, vm.member_id, vm.clock_unplanned, v.workspace_id, v.closed_at,
         coalesce(vm.clock_method, v.clock_method) as effective_method
    into r
    from public.venue_members vm
    join public.venues v on v.id = vm.venue_id
    join public.workspace_members wm on wm.id = vm.member_id
   where vm.id = p_venue_member
     and wm.user_id = (select auth.uid())
     and wm.status = 'active'
     and vm.left_at is null;
  if r.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- L'account, non la scheda: serializza anche sedi e aziende diverse.
  perform 1 from public.profiles where id = (select auth.uid()) for update;

  if p_action = 'in' then
    perform private.assert_workspace_operational(r.workspace_id);
    if r.closed_at is not null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if not r.clock_unplanned then
      raise exception 'clock_unplanned_disabled' using errcode = '42501';
    end if;
    if r.effective_method = 'manual' then
      raise exception 'clock_manual' using errcode = '42501';
    end if;
    if r.effective_method <> 'app' then
      raise exception 'clock_method_unavailable' using errcode = '0A000';
    end if;

    select * into v_row from public.shift_clock_records c
     where c.venue_member_id = r.id and c.shift_id is null and c.voided_at is null;
    if v_row.id is not null then return v_row; end if;

    -- Un'altra entrata aperta, in qualunque sede o azienda: prima si esce da quella.
    -- Non conta quella di una scheda non più attiva o di una sede chiusa: chi la
    -- possiede non la vede né la chiude più (C13). Rimesso in sede, la scheda è
    -- la stessa (place_member riusa la riga) e l'entrata torna a contare.
    if exists (
      select 1
        from public.shift_clock_records c
        join public.venue_members x on x.id = c.venue_member_id
        join public.workspace_members xm on xm.id = x.member_id
        join public.venues xv on xv.id = x.venue_id
        cross join lateral private.clock_record_times(c.id) t
       where xm.user_id = (select auth.uid()) and c.voided_at is null
         and x.left_at is null and xm.status = 'active' and xv.closed_at is null
         and t.clock_out_at is null
         and c.clock_in_at > clock_timestamp() - interval '24 hours'
    ) then
      raise exception 'clock_already_open' using errcode = '23514';
    end if;

    -- C'è un turno da timbrare: si timbra quello.
    if exists (
      select 1
        from public.shift_assignments a
        join public.shifts s on s.id = a.shift_id
       where a.venue_member_id = r.id
         and s.status <> 'cancelled'
         and a.status not in ('declined', 'no_show')
         and public.local_now() >= (s.date + s.start_time) - interval '1 hour'
         and public.local_now() < public.shift_ends_at(s.date, s.start_time, s.end_time)
         and not exists (select 1 from public.shift_clock_records c
                          where c.assignment_id = a.id and c.voided_at is null)
    ) then
      raise exception 'clock_planned_shift' using errcode = '23514';
    end if;

    if p_role is not null and not exists (
      select 1 from public.venue_member_roles x
        join public.venue_roles vr on vr.id = x.role_id
       where x.venue_member_id = r.id and x.role_id = p_role and vr.archived_at is null
    ) then
      raise exception 'role_not_in_venue' using errcode = '23514';
    end if;
    if char_length(v_note) > 500 then
      raise exception 'note_too_long' using errcode = '23514';
    end if;

    insert into public.shift_clock_records (
      venue_id, venue_member_id, method, clock_in_at, role_id, note
    ) values (
      r.venue_id, r.id, r.effective_method, clock_timestamp(), p_role, v_note
    ) returning * into v_row;
    return v_row;
  end if;

  select * into v_row from public.shift_clock_records c
   where c.venue_member_id = r.id and c.shift_id is null and c.voided_at is null
   for update;
  if v_row.id is null then
    -- Retry di un'uscita già riuscita: restituisce quella.
    select c.* into v_row
      from public.shift_clock_records c
      join public.shifts s on s.id = c.shift_id and s.unplanned
     where c.venue_member_id = r.id and c.voided_at is null
       and c.clock_out_at > clock_timestamp() - interval '5 minutes'
     order by c.clock_out_at desc limit 1;
    if v_row.id is not null then return v_row; end if;
    -- Chi gestisce le ore l'ha già chiusa (correzione d'uscita, senza la sua
    -- uscita) o annullata: lo si dice, invece di «prima registra l'entrata».
    if exists (
      select 1
        from public.shift_clock_records c
        left join public.shifts s on s.id = c.shift_id
       where c.venue_member_id = r.id
         and c.clock_in_at > clock_timestamp() - interval '24 hours'
         and c.clock_out_at is null
         and (c.shift_id is null or s.unplanned)
         and (c.voided_at is not null
              or exists (select 1 from public.shift_clock_corrections k
                          where k.clock_record_id = c.id and k.corrected_out_at is not null))
    ) then
      raise exception 'clock_already_closed' using errcode = '23514';
    end if;
    raise exception 'clock_in_required' using errcode = '23514';
  end if;

  perform private.assert_unplanned_attendance(r.workspace_id, v_row.clock_in_at);
  if clock_timestamp() - v_row.clock_in_at > interval '16 hours' then
    raise exception 'clock_open_too_long' using errcode = '23514';
  end if;

  update public.shift_clock_records set clock_out_at = clock_timestamp()
   where id = v_row.id;
  return private.materialize_unplanned_clock(v_row.id);
end;
$$;


create or replace function public.close_unplanned_clock(p_record uuid, p_out timestamptz, p_reason text)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  -- Anche se è già diventata turno: a chi gestisce le ore lo si dice (C13).
  -- Le timbrature di un turno pianificato restano fuori, come prima.
  select x.*, vm.member_id, v.workspace_id into c
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
    left join public.shifts s on s.id = x.shift_id
   where x.id = p_record and x.voided_at is null
     and (x.shift_id is null or s.unplanned)
   for update of x;
  if c.id is null or not private.can(c.venue_id, 'hours')
     or private.is_restricted_self(c.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if c.shift_id is not null then
    raise exception 'clock_already_closed' using errcode = '23514';
  end if;
  perform private.assert_unplanned_attendance(c.workspace_id, c.clock_in_at);
  if p_out is null or p_out <= c.clock_in_at or p_out > clock_timestamp()
     or p_out - c.clock_in_at > interval '24 hours' then
    raise exception 'invalid_clock_interval' using errcode = '23514';
  end if;

  -- L'uscita la scrive una correzione: il record originale resta senza uscita.
  insert into public.shift_clock_corrections (clock_record_id, corrected_out_at, reason, corrected_by)
  values (c.id, p_out, btrim(p_reason), (select auth.uid()));
  return private.materialize_unplanned_clock(c.id);
end;
$$;


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
        join public.venues xv on xv.id = x.venue_id
        cross join lateral private.clock_record_times(c.id) t
       where xm.user_id = (select auth.uid()) and c.voided_at is null
         and x.left_at is null and xm.status = 'active' and xv.closed_at is null
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
