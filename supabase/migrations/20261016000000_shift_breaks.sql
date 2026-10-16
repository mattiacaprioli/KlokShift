-- Pausa nei turni (2026-10-16, decisione in plans/BREAKS.md).
--
-- La sede decide se la pausa è retribuita (resta nelle ore lavorate) o no (si
-- sottrae e compare a parte). Il turno porta la pausa pianificata e una COPIA
-- della scelta della sede (`shifts.break_paid`): cambiare la scelta vale per i
-- turni non ancora conclusi e non riscrive lo storico, come il congelamento di
-- `hours_source` in `set_venue_clock_method`.
--
-- Il professionista può timbrare inizio e fine pausa. La pausa effettiva di una
-- timbratura è, in ordine: l'ultima correzione di chi gestisce le ore, la somma
-- delle pause timbrate, la pausa pianificata del turno.
--
-- ⚠️ Gemelli manuali in TS: `shiftCountedHours` (src/lib/format.ts) e
-- `effectiveClockBreak` / `clockedHours` (src/features/clock/hours.ts). Se
-- cambia qui, cambiali con lui.

-- ---------------------------------------------------------------------------
-- Scelta della sede
-- ---------------------------------------------------------------------------
-- La regola («turni oltre X minuti: pausa di Y») precompila il form del turno e
-- basta: non si applica da sola né sui turni esistenti.
alter table public.venues
  add column break_paid boolean not null default false,
  add column break_rule_after_minutes integer,
  add column break_rule_minutes integer,
  add constraint venues_break_rule_ck check (
    (break_rule_after_minutes is null) = (break_rule_minutes is null)
    and (break_rule_after_minutes is null or break_rule_after_minutes between 60 and 1440)
    and (break_rule_minutes is null or break_rule_minutes between 5 and 240)
  );

-- ---------------------------------------------------------------------------
-- Pausa pianificata sul turno
-- ---------------------------------------------------------------------------
alter table public.shifts
  add column break_minutes integer not null default 0,
  add column break_paid boolean not null default false,
  add constraint shifts_break_ck check (
    break_minutes between 0 and 240
    and break_minutes < public.shift_duration_hours(start_time, end_time) * 60
  );

-- La copia della scelta nasce dalla sede e non dal client. Un turno che torna
-- nel futuro (data o orari cambiati) riprende la scelta attuale; uno concluso
-- tiene quella con cui si è svolto.
create function private.shift_break_paid_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT'
     or public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
    new.break_paid := coalesce(
      (select v.break_paid from public.venues v where v.id = new.venue_id), false);
  end if;
  return new;
end;
$$;

create trigger shifts_break_paid_snapshot
  before insert or update of date, start_time, end_time on public.shifts
  for each row execute function private.shift_break_paid_snapshot();

create function private.assert_shift_break(p_start time, p_end time, p_minutes integer)
returns void language plpgsql immutable set search_path = '' as $$
begin
  if p_minutes is null or p_minutes < 0 or p_minutes > 240 then
    raise exception 'break_invalid' using errcode = '23514';
  end if;
  if p_minutes >= public.shift_duration_hours(p_start, p_end) * 60 then
    raise exception 'break_too_long' using errcode = '23514';
  end if;
end;
$$;

-- Ore che il turno conta: la durata, meno la pausa se non è retribuita.
create function public.shift_counted_hours(
  p_start time, p_end time, p_break_minutes integer, p_break_paid boolean
)
returns numeric language sql immutable set search_path = '' as $$
  select greatest(0, public.shift_duration_hours(p_start, p_end)
    - case when p_break_paid then 0 else coalesce(p_break_minutes, 0) / 60.0 end);
$$;

-- ---------------------------------------------------------------------------
-- Pause timbrate
-- ---------------------------------------------------------------------------
-- `venue_id` è la copia di quello della timbratura: serve al filtro del realtime.
create table public.shift_clock_breaks (
  id              uuid primary key default gen_random_uuid(),
  clock_record_id uuid not null references public.shift_clock_records (id) on delete cascade,
  venue_id        uuid not null,
  started_at      timestamptz not null,
  ended_at        timestamptz,
  created_at      timestamptz not null default now(),
  constraint shift_clock_breaks_interval_ck check (ended_at is null or ended_at > started_at)
);
create unique index shift_clock_breaks_open_uq
  on public.shift_clock_breaks (clock_record_id) where ended_at is null;
create index shift_clock_breaks_record_idx
  on public.shift_clock_breaks (clock_record_id, started_at);
alter table public.shift_clock_breaks enable row level security;

grant select on public.shift_clock_breaks to authenticated;

create policy "shift_clock_breaks: clock readers read" on public.shift_clock_breaks
  for select to authenticated
  using (clock_record_id in (select private.visible_clock_record_ids()));

-- Inizio e fine pausa aggiornano dal vivo «In pausa dalle…» di chi gestisce.
alter publication supabase_realtime add table public.shift_clock_breaks;

-- Chi gestisce le ore corregge la pausa come entrata e uscita: una riga
-- append-only, l'ultima vince.
alter table public.shift_clock_corrections
  add column corrected_break_minutes integer
    check (corrected_break_minutes is null or corrected_break_minutes between 0 and 1440),
  drop constraint shift_clock_corrections_value_ck,
  add constraint shift_clock_corrections_value_ck check (
    corrected_in_at is not null or corrected_out_at is not null
    or corrected_break_minutes is not null
  );

-- Uscire durante la pausa la chiude: vale per l'uscita del turno e per quella
-- senza turno, che scrivono entrambe `clock_out_at`. Le correzioni d'uscita non
-- toccano le pause: il calcolo le taglia comunque all'uscita effettiva.
create function private.close_open_clock_break()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.shift_clock_breaks b set ended_at = new.clock_out_at
   where b.clock_record_id = new.id and b.ended_at is null
     and b.started_at < new.clock_out_at;
  return null;
end;
$$;

create trigger shift_clock_records_close_break
  after update of clock_out_at on public.shift_clock_records
  for each row when (old.clock_out_at is null and new.clock_out_at is not null)
  execute function private.close_open_clock_break();

-- La pausa effettiva di una timbratura e da dove viene:
-- 'corrected' | 'clocked' | 'planned'. Le pause si tagliano a [entrata, uscita]
-- effettive; con la timbratura ancora aperta una pausa aperta conta fino ad ora.
create function private.clock_record_break(p_record uuid)
returns table (minutes integer, source text)
language sql stable security definer set search_path = '' as $$
  with rec as (
    select r.id, r.shift_id, t.clock_in_at, coalesce(t.clock_out_at, now()) as cap
      from public.shift_clock_records r
      cross join lateral private.clock_record_times(r.id) t
     where r.id = p_record
  ), corrected as (
    select c.corrected_break_minutes as minutes
      from public.shift_clock_corrections c
     where c.clock_record_id = p_record and c.corrected_break_minutes is not null
     order by c.created_at desc, c.id desc
     limit 1
  ), clocked as (
    select count(b.id) as n,
           coalesce(sum(greatest(0, extract(epoch from (
             least(coalesce(b.ended_at, rec.cap), rec.cap)
             - greatest(b.started_at, rec.clock_in_at))))), 0) as seconds
      from rec
      left join public.shift_clock_breaks b on b.clock_record_id = rec.id
  )
  select
    case
      when exists (select 1 from corrected) then (select minutes from corrected)
      when c.n > 0 then round(c.seconds / 60.0)::integer
      else coalesce((select s.break_minutes from public.shifts s where s.id = rec.shift_id), 0)
    end,
    case
      when exists (select 1 from corrected) then 'corrected'
      when c.n > 0 then 'clocked'
      else 'planned'
    end
    from rec cross join clocked c;
$$;

-- Le ore proposte da una timbratura chiusa: arco effettivo meno la pausa se
-- non è retribuita, al quarto d'ora. Unica formula di approvazione e riepilogo.
create function private.clock_record_counted_hours(p_record uuid)
returns numeric language sql stable security definer set search_path = '' as $$
  select greatest(0, round((
           extract(epoch from (t.clock_out_at - t.clock_in_at)) / 3600.0
           - case when coalesce(s.break_paid, v.break_paid) then 0 else b.minutes / 60.0 end
         ) * 4) / 4)
    from public.shift_clock_records r
    join public.venues v on v.id = r.venue_id
    left join public.shifts s on s.id = r.shift_id
    cross join lateral private.clock_record_times(r.id) t
    cross join lateral private.clock_record_break(r.id) b
   where r.id = p_record and t.clock_out_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------------
-- La scelta della sede: chi ha «Ore», come il metodo di timbratura. I turni già
-- conclusi tengono la loro copia.
create function public.set_venue_break_policy(
  p_venue uuid,
  p_paid boolean,
  p_rule_after_minutes integer default null,
  p_rule_minutes integer default null
)
returns public.venues language plpgsql security definer set search_path = '' as $$
declare v_row public.venues;
begin
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_paid is null
     or (p_rule_after_minutes is null) <> (p_rule_minutes is null)
     or p_rule_after_minutes not between 60 and 1440
     or p_rule_minutes not between 5 and 240 then
    raise exception 'break_rule_invalid' using errcode = '22023';
  end if;
  update public.shifts s set break_paid = p_paid
   where s.venue_id = p_venue and s.break_paid is distinct from p_paid
     and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now();
  update public.venues set
    break_paid = p_paid,
    break_rule_after_minutes = p_rule_after_minutes,
    break_rule_minutes = p_rule_minutes
   where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- Inizio e fine pausa del professionista, sulla propria timbratura aperta (con
-- o senza turno). Istanti del server; la stessa azione ripetuta è idempotente.
create function public.clock_break(p_record uuid, p_action text)
returns public.shift_clock_breaks language plpgsql security definer set search_path = '' as $$
declare
  r     record;
  t     record;
  v_row public.shift_clock_breaks;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_action not in ('start', 'end') then
    raise exception 'invalid_clock_action' using errcode = '22023';
  end if;

  perform 1 from public.shift_clock_records where id = p_record for update;
  select c.id, c.voided_at, c.venue_id, v.workspace_id
    into r
    from public.shift_clock_records c
    join public.venues v on v.id = c.venue_id
    join public.venue_members vm on vm.id = c.venue_member_id
    join public.workspace_members wm on wm.id = vm.member_id
   where c.id = p_record
     and wm.user_id = (select auth.uid())
     and wm.status = 'active'
     and vm.left_at is null;
  if r.id is null or r.voided_at is not null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if p_action = 'start' then
    select * into v_row from public.shift_clock_breaks b
     where b.clock_record_id = p_record and b.ended_at is null;
    if v_row.id is not null then return v_row; end if;
    perform private.assert_workspace_operational(r.workspace_id);
    select * into t from private.clock_record_times(p_record);
    if t.clock_out_at is not null then
      raise exception 'clock_already_closed' using errcode = '23514';
    end if;
    insert into public.shift_clock_breaks (clock_record_id, venue_id, started_at)
    values (p_record, r.venue_id, clock_timestamp())
    returning * into v_row;
    return v_row;
  end if;

  update public.shift_clock_breaks b set ended_at = clock_timestamp()
   where b.clock_record_id = p_record and b.ended_at is null
  returning * into v_row;
  if v_row.id is not null then return v_row; end if;
  -- Retry di una fine già riuscita, o pausa chiusa dall'uscita: l'ultima.
  select * into v_row from public.shift_clock_breaks b
   where b.clock_record_id = p_record
   order by b.started_at desc limit 1;
  if v_row.id is null then
    raise exception 'clock_break_not_started' using errcode = '23514';
  end if;
  return v_row;
end;
$$;

-- Correzione della pausa da parte di chi gestisce le ore: stesse regole di
-- correct_clock_record (permesso, non sulla propria riga, motivo, archivio) e
-- come lei riapre l'approvazione.
create function public.correct_clock_break(p_record uuid, p_minutes integer, p_reason text)
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
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
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
  ) values (r.id, p_minutes, btrim(p_reason), (select auth.uid()))
  returning * into v_row;

  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = r.assignment_id;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ridefinizioni: copie integrali delle ultime definizioni con la pausa.
-- I privilegi restano quelli esistenti: CREATE OR REPLACE non li cambia.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_shifts(p_plans jsonb)
 RETURNS uuid[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_plan    jsonb;
  v_venue   uuid;
  v_dates   date[];
  v_date    date;
  v_shift   uuid;
  v_ids     uuid[] := '{}';
  v_staff   jsonb;
  v_item    jsonb;
  v_break   integer;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;

  for v_venue in select distinct private.venue_workspace((p->>'venue_id')::uuid) from jsonb_array_elements(coalesce(p_plans,'[]'::jsonb)) p order by 1 loop
    perform private.assert_workspace_operational(v_venue);
  end loop;

  for v_plan in select * from jsonb_array_elements(coalesce(p_plans, '[]'::jsonb)) loop
    v_venue := (v_plan ->> 'venue_id')::uuid;
    if v_venue is null or not private.can(v_venue, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    if btrim(coalesce(v_plan ->> 'title', '')) = '' then
      raise exception 'title_required' using errcode = '23514';
    end if;

    v_dates := case
      when v_plan ? 'dates' then array(select d::date from jsonb_array_elements_text(v_plan -> 'dates') d)
      else array[(v_plan ->> 'date')::date]
    end;
    v_staff := coalesce(v_plan -> 'staff', '[]'::jsonb);
    v_break := coalesce((v_plan ->> 'break_minutes')::integer, 0);
    perform private.assert_shift_break(
      (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time, v_break);

    foreach v_date in array v_dates loop
      insert into public.shifts (
        venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
        break_minutes
      ) values (
        v_venue, btrim(v_plan ->> 'title'), nullif(btrim(coalesce(v_plan ->> 'description', '')), ''),
        v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time,
        coalesce((v_plan ->> 'require_confirmation')::boolean, false),
        private.positions_for(v_plan -> 'role_targets', jsonb_array_length(v_staff)),
        v_break
      ) returning id into v_shift;

      perform private.replace_requirements(v_shift, v_venue, v_plan -> 'role_targets');
      for v_item in select * from jsonb_array_elements(v_staff) loop
        perform private.assign_one(v_shift, (v_item ->> 'venue_member_id')::uuid, (v_item ->> 'role_id')::uuid);
      end loop;
      v_ids := v_ids || v_shift;
    end loop;
  end loop;
  return v_ids;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.update_shift(p_shift uuid, p_payload jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue  uuid;
  v_item   jsonb;
  v_keep   uuid[] := '{}';
  v_active integer := 0;
  v_ex     record;
  v_has_staff boolean := p_payload ? 'staff';
  v_targets jsonb;
  v_cur    record;
  v_break  integer;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  select s.venue_id, s.unplanned, s.date, s.start_time, s.end_time, s.require_confirmation,
         s.break_minutes
    into v_cur from public.shifts s where s.id = p_shift;
  v_venue := v_cur.venue_id;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Un fuori turno descrive lavoro già svolto: si correggono titolo e
  -- descrizione, non data, orari, persone o fabbisogno. Il payload è il turno
  -- intero, quindi conta il valore e non la presenza della chiave.
  if v_cur.unplanned and (
       p_payload ? 'staff' or p_payload ? 'role_targets'
    or (p_payload ->> 'date')::date is distinct from v_cur.date
    or (p_payload ->> 'start_time')::time is distinct from v_cur.start_time
    or (p_payload ->> 'end_time')::time is distinct from v_cur.end_time
    or coalesce((p_payload ->> 'require_confirmation')::boolean, v_cur.require_confirmation)
         is distinct from v_cur.require_confirmation
    or coalesce((p_payload ->> 'break_minutes')::integer, v_cur.break_minutes)
         is distinct from v_cur.break_minutes
  ) then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  if btrim(coalesce(p_payload ->> 'title', '')) = '' then
    raise exception 'title_required' using errcode = '23514';
  end if;
  v_break := coalesce((p_payload ->> 'break_minutes')::integer, v_cur.break_minutes);
  perform private.assert_shift_break(
    (p_payload ->> 'start_time')::time, (p_payload ->> 'end_time')::time, v_break);

  -- Posti attivi: chi viene aggiunto adesso nasce 'assigned' e conta; chi ha già
  -- rifiutato o è risultato assente non aggiunge posti.
  if v_has_staff then
    for v_item in select * from jsonb_array_elements(p_payload -> 'staff') loop
      select a.status into v_ex from public.shift_assignments a
       where a.shift_id = p_shift and a.venue_member_id = (v_item ->> 'venue_member_id')::uuid;
      if not found or v_ex.status in ('assigned', 'confirmed') then
        v_active := v_active + 1;
      end if;
    end loop;
  else
    select count(*) into v_active from public.shift_assignments a
     where a.shift_id = p_shift and a.status in ('assigned', 'confirmed');
  end if;

  v_targets := case
    when p_payload ? 'role_targets' then p_payload -> 'role_targets'
    else (select coalesce(jsonb_agg(jsonb_build_object('role_id', r.role_id, 'count', r.count)), '[]'::jsonb)
            from public.shift_role_requirements r where r.shift_id = p_shift)
  end;

  update public.shifts set
    title = btrim(p_payload ->> 'title'),
    description = nullif(btrim(coalesce(p_payload ->> 'description', '')), ''),
    date = (p_payload ->> 'date')::date,
    start_time = (p_payload ->> 'start_time')::time,
    end_time = (p_payload ->> 'end_time')::time,
    require_confirmation = coalesce((p_payload ->> 'require_confirmation')::boolean, require_confirmation),
    break_minutes = v_break,
    positions_total = private.positions_for(v_targets, v_active)
  where id = p_shift;

  if p_payload ? 'role_targets' then
    perform private.replace_requirements(p_shift, v_venue, p_payload -> 'role_targets');
  end if;

  if v_has_staff then
    -- Nuovi e cambi di mansione.
    for v_item in select * from jsonb_array_elements(p_payload -> 'staff') loop
      v_keep := v_keep || (v_item ->> 'venue_member_id')::uuid;
      select a.id, a.role_id into v_ex from public.shift_assignments a
       where a.shift_id = p_shift and a.venue_member_id = (v_item ->> 'venue_member_id')::uuid;
      if not found then
        perform private.assign_one(p_shift, (v_item ->> 'venue_member_id')::uuid, (v_item ->> 'role_id')::uuid);
      elsif v_ex.role_id is distinct from (v_item ->> 'role_id')::uuid then
        perform private.assert_can_touch_assignment(p_shift, (v_item ->> 'venue_member_id')::uuid);
        perform private.assert_role_in_venue((v_item ->> 'role_id')::uuid, v_venue);
        update public.shift_assignments set role_id = (v_item ->> 'role_id')::uuid where id = v_ex.id;
      end if;
    end loop;
    -- Tolti.
    for v_ex in
      select a.id, a.venue_member_id from public.shift_assignments a
       where a.shift_id = p_shift and a.venue_member_id <> all (v_keep)
    loop
      perform private.assert_can_touch_assignment(p_shift, v_ex.venue_member_id);
      delete from public.shift_assignments where id = v_ex.id;
    end loop;
  end if;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.move_assignment(p_assignment uuid, p_to_shift uuid DEFAULT NULL::uuid, p_to_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a           record;
  v_shift     uuid;
  v_from      record;
  v_to_venue  uuid;
  v_to_member uuid;
  v_to_shift  uuid;
  v_role      uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  if (p_to_shift is null) = (p_to_date is null) then
    raise exception 'invalid_target' using errcode = '23514';
  end if;

  -- Il turno di partenza serve per sapere cosa bloccare; si rilegge dopo.
  select x.shift_id into v_shift from public.shift_assignments x where x.id = p_assignment;
  if v_shift is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_to_shift = v_shift then
    return p_assignment;
  end if;
  perform 1 from public.shifts s
   where s.id in (v_shift, p_to_shift)
   order by s.id
   for update;

  select x.shift_id, x.venue_member_id, x.role_id, vm.member_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.id = p_assignment
   for update of x;
  if a.shift_id is null or a.shift_id <> v_shift then
    raise exception 'assignment_changed' using errcode = '23514';
  end if;
  perform private.assert_can_touch_assignment(a.shift_id, a.venue_member_id);

  select s.venue_id, s.title, s.description, s.start_time, s.end_time, s.require_confirmation,
         s.break_minutes
    into v_from
    from public.shifts s where s.id = a.shift_id;

  if p_to_shift is not null then
    select s.venue_id into v_to_venue from public.shifts s where s.id = p_to_shift;
    if v_to_venue is null then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_to_shift := p_to_shift;
  else
    -- Il gemello nasce nella sede del turno di partenza: `update_shift` non
    -- sposta mai un turno di sede, e questo non è il posto per cominciare.
    v_to_venue := v_from.venue_id;
  end if;

  -- La stessa PERSONA nella sede di arrivo (vedi 20260920001600).
  select vm.id into v_to_member
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
   where vm.member_id = a.member_id and vm.venue_id = v_to_venue
     and vm.left_at is null and m.status = 'active';
  if v_to_member is null then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;

  -- La mansione viaggia, come in `reassign`.
  select r.role_id into v_role from public.venue_member_roles r
   where r.venue_member_id = v_to_member and r.role_id = a.role_id;
  if v_role is null then
    select (array_agg(r.role_id))[1] into v_role from public.venue_member_roles r
     where r.venue_member_id = v_to_member
    having count(*) = 1;
  end if;

  if v_to_shift is null then
    if not private.can(v_to_venue, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    insert into public.shifts (
      venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
      break_minutes
    ) values (
      v_to_venue, v_from.title, v_from.description,
      p_to_date, v_from.start_time, v_from.end_time, v_from.require_confirmation,
      private.positions_for(null::jsonb, 1),
      v_from.break_minutes
    ) returning id into v_to_shift;
  end if;

  perform private.assert_can_touch_assignment(v_to_shift, v_to_member);

  delete from public.shift_assignments where id = p_assignment;
  return private.assign_one(v_to_shift, v_to_member, v_role);
end;
$function$
;

CREATE OR REPLACE FUNCTION private.effective_assignment_hours(p_assignment uuid, p_venues uuid[] DEFAULT NULL::uuid[])
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with target as (
    select a.id, a.status, a.worked_hours, vm.member_id,
           s.status as shift_status,
           case when s.break_paid then 0 else s.break_minutes end as unpaid_break_minutes,
           s.date + s.start_time as starts_at,
           public.shift_ends_at(s.date, s.start_time, s.end_time) as ends_at
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
     where a.id = p_assignment
  ), later_planned as (
    select pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) as span
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
      cross join target t
     where a.id <> t.id
       and vm.member_id = t.member_id
       and s.status <> 'cancelled'
       and a.status not in ('declined', 'no_show')
       and a.worked_hours is null
       and (p_venues is null or s.venue_id = any (p_venues))
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) && pg_catalog.tsrange(t.starts_at, t.ends_at, '[)')
       and (
         s.date + s.start_time > t.starts_at
         or (s.date + s.start_time = t.starts_at and a.id > t.id)
       )
  )
  select case
    when t.shift_status = 'cancelled' then 0
    when t.status in ('declined', 'no_show') then 0
    when t.worked_hours is not null then t.worked_hours
    else greatest(0, coalesce((
      select sum(
        extract(epoch from (pg_catalog.upper(piece) - pg_catalog.lower(piece)))
      ) / 3600.0
        from pg_catalog.unnest(
          pg_catalog.tsmultirange(
            pg_catalog.tsrange(t.starts_at, t.ends_at, '[)')
          ) - coalesce(
            (select pg_catalog.range_agg(l.span) from later_planned l),
            '{}'::pg_catalog.tsmultirange
          )
        ) as pieces(piece)
    ), 0) - t.unpaid_break_minutes / 60.0)
  end
    from target t;
$function$
;

CREATE OR REPLACE FUNCTION private.definitive_manual_hours(p_assignment uuid, p_venues uuid[] DEFAULT NULL::uuid[])
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with target as (
    select a.id, a.status, a.worked_hours, vm.member_id,
           s.status as shift_status,
           case when s.break_paid then 0 else s.break_minutes end as unpaid_break_minutes,
           s.date + s.start_time as starts_at,
           public.shift_ends_at(s.date, s.start_time, s.end_time) as ends_at
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
     where a.id = p_assignment
  ), later_manual as (
    select pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) as span
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      cross join target t
     where a.id <> t.id
       and vm.member_id = t.member_id
       and s.status <> 'cancelled'
       and a.status not in ('declined', 'no_show')
       and a.worked_hours is null
       -- Solo chi conta a sua volta come Manuale automatico: stesso criterio
       -- del ramo «manual_auto» di get_workspace_hours_summary.
       and not exists (select 1 from public.shift_clock_records r
                        where r.assignment_id = a.id and r.voided_at is null)
       and (a.hours_source = 'manual_auto' or
            (a.hours_source is null and coalesce(vm.clock_method, v.clock_method) = 'manual'))
       and (p_venues is null or s.venue_id = any (p_venues))
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and pg_catalog.tsrange(
             s.date + s.start_time,
             public.shift_ends_at(s.date, s.start_time, s.end_time),
             '[)'
           ) && pg_catalog.tsrange(t.starts_at, t.ends_at, '[)')
       and (
         s.date + s.start_time > t.starts_at
         or (s.date + s.start_time = t.starts_at and a.id > t.id)
       )
  )
  select case
    when t.shift_status = 'cancelled' then 0
    when t.status in ('declined', 'no_show') then 0
    when t.worked_hours is not null then t.worked_hours
    else greatest(0, coalesce((
      select sum(
        extract(epoch from (pg_catalog.upper(piece) - pg_catalog.lower(piece)))
      ) / 3600.0
        from pg_catalog.unnest(
          pg_catalog.tsmultirange(
            pg_catalog.tsrange(t.starts_at, t.ends_at, '[)')
          ) - coalesce(
            (select pg_catalog.range_agg(l.span) from later_manual l),
            '{}'::pg_catalog.tsmultirange
          )
        ) as pieces(piece)
    ), 0) - t.unpaid_break_minutes / 60.0)
  end
    from target t;
$function$
;

CREATE OR REPLACE FUNCTION public.approve_clock_record(p_assignment uuid)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a record;
  t record;
  v_row public.shift_assignments;
begin
  perform private.assert_attendance_access(p_assignment);
  select x.id, x.venue_id, x.status, vm.member_id, r.id as record_id
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.shift_clock_records r on r.assignment_id = x.id and r.voided_at is null
   where x.id = p_assignment
   for update of x, r;
  if a.id is null or not private.can(a.venue_id, 'hours')
     or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.status in ('declined', 'no_show') then
    raise exception 'clock_status_not_allowed' using errcode = '23514';
  end if;
  select * into t from private.clock_record_times(a.record_id);
  if t.clock_out_at is null then
    raise exception 'clock_out_required' using errcode = '23514';
  end if;
  update public.shift_assignments x set
    worked_hours = private.clock_record_counted_hours(a.record_id),
    hours_source = 'clock',
    attendance_reviewed_at = now(),
    attendance_reviewed_by = (select auth.uid())
  where x.id = a.id returning * into v_row;
  return v_row;
end;
$function$
;

CREATE OR REPLACE FUNCTION private.my_work_history(p_user uuid)
 RETURNS TABLE(key text, venue_name text, logo_url text, title text, date date, start_time time without time zone, end_time time without time zone, hours numeric, shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric, clock_in_at timestamp with time zone, clock_out_at timestamp with time zone, hours_source text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select 'asg-' || a.id::text, v.name, v.logo_url, s.title, s.date, s.start_time, s.end_time,
         private.effective_assignment_hours(a.id, null),
         s.id, vr.name,
         public.shift_counted_hours(s.start_time, s.end_time, s.break_minutes, s.break_paid),
         a.worked_hours,
         t.clock_in_at, t.clock_out_at,
         case
           when a.worked_hours is not null and a.attendance_reviewed_at is not null then 'approved'
           when a.worked_hours is not null then 'adjusted'
           when r.id is not null then 'pending'
           else 'planned'
         end
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = a.shift_id
    left join public.venues v on v.id = s.venue_id
    left join public.venue_roles vr on vr.id = a.role_id
    left join public.shift_clock_records r
      on r.assignment_id = a.id and r.voided_at is null
    left join lateral private.clock_record_times(r.id) t on r.id is not null
   where m.workspace_id in (select private.commercial_readable_workspace_ids())
     and m.user_id = p_user
     and s.status <> 'cancelled'
     and a.status not in ('declined', 'no_show')
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$function$
;

-- Il tipo di ritorno cambia (due colonne in più): drop + create + grant.
drop function public.get_workspace_hours_summary(uuid, date, date);

CREATE FUNCTION public.get_workspace_hours_summary(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean, roles text, shifts_count integer, hours numeric, approved_hours numeric, to_review_count integer, proposed_hours numeric, untracked_hours numeric, paid_break_hours numeric, unpaid_break_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(array_agg(v.id), '{}'::uuid[]) as venue_ids from public.venues v
    where v.workspace_id in (select private.commercial_readable_workspace_ids()) and v.workspace_id = p_workspace and v.id in (select private.venues_where('hours'))
  ), rows as (
    select a.*, s.date, v.name as venue_name, v.closed_at,
           s.break_minutes, s.break_paid, b.minutes as clock_break_minutes,
           coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
           vm.member_id, m.display_name,
           r.id as clock_record_id, t.clock_in_at, t.clock_out_at,
           private.effective_assignment_hours(a.id, scope.venue_ids) as legacy_hours,
           scope.venue_ids as scope_venue_ids
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      cross join scope
      left join public.shift_clock_records r on r.assignment_id = a.id and r.voided_at is null
      left join lateral private.clock_record_times(r.id) t on true
      left join lateral private.clock_record_break(r.id) b on true
     where s.venue_id = any(scope.venue_ids) and s.status <> 'cancelled'
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
  ), per_venue as (
    select r.member_id, r.display_name as member_name, r.venue_id, r.venue_name,
           r.closed_at, r.venue_member_id,
           count(*) filter (where (r.worked_hours is not null and
             (r.hours_source = 'manual' or (r.clock_record_id is not null
               and r.attendance_reviewed_at is not null and r.clock_out_at is not null)))
             or (r.worked_hours is null and r.clock_record_id is null and
               (r.hours_source = 'manual_auto' or
                 (r.hours_source is null and r.effective_clock_method = 'manual'))))::integer as shifts_count,
           coalesce(sum(r.legacy_hours), 0) as hours,
           coalesce(sum(case
             when r.worked_hours is not null and
               (r.hours_source = 'manual' or (r.clock_record_id is not null
                 and r.attendance_reviewed_at is not null and r.clock_out_at is not null))
               then r.worked_hours
             when r.worked_hours is null and r.clock_record_id is null and
               (r.hours_source = 'manual_auto' or
                 (r.hours_source is null and r.effective_clock_method = 'manual'))
               then private.definitive_manual_hours(r.id, r.scope_venue_ids)
             else 0 end), 0) as approved_hours,
           count(*) filter (where r.clock_record_id is not null and r.attendance_reviewed_at is null)::integer as to_review_count,
           coalesce(sum(private.clock_record_counted_hours(r.clock_record_id))
             filter (where r.clock_record_id is not null and r.attendance_reviewed_at is null
               and r.clock_out_at is not null), 0) as proposed_hours,
           coalesce(sum(r.worked_hours) filter (where r.worked_hours is not null
             and r.hours_source is distinct from 'manual'
             and (r.clock_record_id is null or r.attendance_reviewed_at is null
               or r.clock_out_at is null)), 0) as untracked_hours,
           -- La pausa delle stesse righe di approved_hours: quella della
           -- timbratura approvata, altrimenti la pianificata.
           coalesce(sum(case
             when r.worked_hours is not null and r.clock_record_id is not null
               and r.attendance_reviewed_at is not null and r.clock_out_at is not null
               then coalesce(r.clock_break_minutes, 0)
             when (r.worked_hours is not null and r.hours_source = 'manual')
               or (r.worked_hours is null and r.clock_record_id is null and
                 (r.hours_source = 'manual_auto' or
                   (r.hours_source is null and r.effective_clock_method = 'manual')))
               then r.break_minutes
             else 0 end) filter (where r.break_paid), 0) / 60.0 as paid_break_hours,
           coalesce(sum(case
             when r.worked_hours is not null and r.clock_record_id is not null
               and r.attendance_reviewed_at is not null and r.clock_out_at is not null
               then coalesce(r.clock_break_minutes, 0)
             when (r.worked_hours is not null and r.hours_source = 'manual')
               or (r.worked_hours is null and r.clock_record_id is null and
                 (r.hours_source = 'manual_auto' or
                   (r.hours_source is null and r.effective_clock_method = 'manual')))
               then r.break_minutes
             else 0 end) filter (where not r.break_paid), 0) / 60.0 as unpaid_break_hours
      from rows r
     group by r.member_id, r.display_name, r.venue_id, r.venue_name, r.closed_at, r.venue_member_id
  )
  select r.member_id, r.member_name, r.venue_id, r.venue_name, r.closed_at is not null,
         (select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
            from public.venue_member_roles x join public.venue_roles vr on vr.id = x.role_id
           where x.venue_member_id = r.venue_member_id and vr.archived_at is null),
         r.shifts_count, r.hours, r.approved_hours, r.to_review_count,
         r.proposed_hours, r.untracked_hours, r.paid_break_hours, r.unpaid_break_hours
    from per_venue r
   order by sum(r.approved_hours) over (partition by r.member_id) desc, r.member_name, r.venue_name;
$function$
;

grant execute on function public.get_workspace_hours_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Privilegi: solo le RPC sono del client; helper e trigger restano privati.
-- ---------------------------------------------------------------------------
revoke all on function
  private.shift_break_paid_snapshot(),
  private.close_open_clock_break(),
  private.assert_shift_break(time, time, integer),
  private.clock_record_break(uuid),
  private.clock_record_counted_hours(uuid)
from public, anon, authenticated;

grant execute on function
  public.set_venue_break_policy(uuid, boolean, integer, integer),
  public.clock_break(uuid, text),
  public.correct_clock_break(uuid, integer, text)
to authenticated;
