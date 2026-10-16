-- C24 punto 5 (audit 2026-10-12): la gara fra uscita del professionista e
-- chiusura di chi gestisce le ore dava a chi gestisce `not_allowed` invece di
-- `clock_already_closed` quando l'uscita arrivava per prima. I dati erano già
-- coerenti (un solo turno): cambia solo l'errore, che ora dice la cosa vera.
--
-- Copia integrale dell'ultima definizione (20261012000500_unplanned_orphans.sql)
-- con la sola lettura iniziale riscritta. Stessa firma: i privilegi restano.

create or replace function public.close_unplanned_clock(p_record uuid, p_out timestamptz, p_reason text)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  -- Il lock solo sulla timbratura, senza `shifts` nella condizione: se l'uscita
  -- del professionista la chiude mentre qui si aspetta, Postgres rivaluta la
  -- riga con i dati delle altre tabelle letti **prima** dell'attesa, e il turno
  -- appena nato non c'era ancora: la riga spariva e chi gestisce leggeva
  -- `not_allowed` (C24, concurrency/080).
  select x.*, vm.member_id, v.workspace_id into c
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
   where x.id = p_record and x.voided_at is null
   for update of x;
  if c.id is null or not private.can(c.venue_id, 'hours')
     or private.is_restricted_self(c.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if c.shift_id is not null then
    -- Già diventata turno «Fuori turno»: a chi gestisce lo si dice (C13). Una
    -- query nuova vede il turno anche se è nato durante l'attesa. Le
    -- timbrature di un turno pianificato restano fuori, come prima.
    if exists (select 1 from public.shifts s where s.id = c.shift_id and s.unplanned) then
      raise exception 'clock_already_closed' using errcode = '23514';
    end if;
    raise exception 'not_allowed' using errcode = '42501';
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
