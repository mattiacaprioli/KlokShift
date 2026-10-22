-- Pausa fissa, non timbrata (2026-10-22, plans/BREAKS.md § «Pausa fissa»).
--
-- Molte sedi la pausa non la fanno timbrare: «10–19 con un'ora di pausa» e
-- basta. La sede sceglie se il professionista timbra la pausa
-- (`venues.break_clocked`, acceso di default: nessun cambiamento per chi c'è
-- già) e chi gestisce le ore può fare un'eccezione per una persona in quella
-- sede (`venue_members.break_clocked`, null = come la sede).
--
-- La scelta si COPIA sulla timbratura all'entrata (`shift_clock_records`), non
-- sul turno: il turno ha più persone, la timbratura una sola, e cambiare la
-- regola non riscrive le timbrature già fatte — come `break_paid` e
-- `hours_source`.
--
-- Con la pausa fissa `clock_break` rifiuta l'inizio pausa: la timbratura non ha
-- pause timbrate e `private.clock_record_break` cade da sé sulla pausa
-- pianificata del turno (o sulla correzione di chi gestisce). Il calcolo delle
-- ore non cambia, e nemmeno i suoi gemelli TS.

alter table public.venues
  add column break_clocked boolean not null default true;

alter table public.venue_members
  add column break_clocked boolean;

alter table public.shift_clock_records
  add column break_clocked boolean not null default true;

-- La copia nasce dalla persona o dalla sede, mai dal client.
create function private.clock_record_break_clocked_snapshot()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.break_clocked := coalesce(
    (select coalesce(vm.break_clocked, v.break_clocked)
       from public.venue_members vm
       join public.venues v on v.id = vm.venue_id
      where vm.id = new.venue_member_id),
    true);
  return new;
end;
$$;

create trigger shift_clock_records_break_clocked_snapshot
  before insert on public.shift_clock_records
  for each row execute function private.clock_record_break_clocked_snapshot();

-- ---------------------------------------------------------------------------
-- Configurazione: chi ha «Ore», come la scelta retribuita/non retribuita.
-- Due RPC a parte, e non un parametro in più su `set_venue_break_policy`: le
-- app già installate continuano a chiamare quella con la firma di prima.
-- ---------------------------------------------------------------------------
create function public.set_venue_break_clocked(p_venue uuid, p_clocked boolean)
returns public.venues language plpgsql security definer set search_path = '' as $$
declare v_row public.venues;
begin
  perform private.assert_workspace_operational(private.venue_workspace(p_venue));
  if not private.can(p_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_clocked is null then
    raise exception 'break_rule_invalid' using errcode = '22023';
  end if;
  update public.venues set break_clocked = p_clocked
   where id = p_venue
  returning * into v_row;
  if v_row.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  return v_row;
end;
$$;

-- null = come la sede; true/false = eccezione per questa persona in questa sede.
create function public.set_member_break_clocked(p_venue_member uuid, p_clocked boolean default null)
returns public.venue_members language plpgsql security definer set search_path = '' as $$
declare
  v_row    public.venue_members;
  v_member uuid;
  v_venue  uuid;
begin
  select vm.member_id, vm.venue_id into v_member, v_venue
    from public.venue_members vm where vm.id = p_venue_member;
  if v_venue is null or not private.can(v_venue, 'hours')
     or private.is_restricted_self(v_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(v_venue));
  update public.venue_members set break_clocked = p_clocked
   where id = p_venue_member
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Inizio e fine pausa: con la pausa fissa l'inizio è rifiutato. La fine resta
-- com'era (idempotente, e senza pause aperte risponde `clock_break_not_started`).
-- Copia integrale di 20261016000000 con il solo controllo nuovo.
-- ---------------------------------------------------------------------------
create or replace function public.clock_break(p_record uuid, p_action text)
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
  select c.id, c.voided_at, c.venue_id, c.break_clocked, v.workspace_id
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
    if not r.break_clocked then
      raise exception 'break_not_clocked' using errcode = '42501';
    end if;
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

-- ---------------------------------------------------------------------------
-- La timbratura senza turno aperta dice anche se la pausa si timbra, perché la
-- card del professionista sappia se mostrare il pulsante. Il tipo di ritorno
-- cambia (una colonna in coda): drop + create + grant. Corpo di
-- 20261012000100, confine d'archivio compreso (050_surface lo controlla).
-- ---------------------------------------------------------------------------
drop function public.get_my_unplanned_clock();

create function public.get_my_unplanned_clock()
returns table (
  venue_member_id uuid, venue_id uuid, venue_name text, workspace_name text,
  roles jsonb, open_record_id uuid, clock_in_at timestamptz, role_id uuid, note text,
  break_clocked boolean
) language sql stable security definer set search_path = '' as $$
  select vm.id, v.id, v.name, w.name,
         coalesce((select jsonb_agg(jsonb_build_object('id', vr.id, 'name', vr.name)
                                    order by vr.sort_order, vr.name)
                     from public.venue_member_roles x
                     join public.venue_roles vr on vr.id = x.role_id
                    where x.venue_member_id = vm.id and vr.archived_at is null), '[]'::jsonb),
         c.id, c.clock_in_at, c.role_id, c.note,
         -- Aperta: la copia della timbratura; non ancora: la regola di adesso.
         coalesce(c.break_clocked, vm.break_clocked, v.break_clocked)
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
    join public.venues v on v.id = vm.venue_id
    left join public.shift_clock_records c
      on c.venue_member_id = vm.id and c.shift_id is null and c.voided_at is null
   where m.user_id = (select auth.uid()) and m.status = 'active' and vm.left_at is null
     and v.closed_at is null
     and v.id in (select private.commercial_readable_venue_ids())
     -- Si propone solo se l'azienda opera; spenta (o in archivio) dopo un'entrata,
     -- l'uscita resta possibile.
     and ((vm.clock_unplanned and coalesce(vm.clock_method, v.clock_method) = 'app'
           and coalesce((private.workspace_access_at(w.id, clock_timestamp())->>'can_operate')::boolean, false))
          or c.id is not null)
   order by w.name, v.name;
$$;

-- ---------------------------------------------------------------------------
-- Privilegi
-- ---------------------------------------------------------------------------
revoke all on function private.clock_record_break_clocked_snapshot()
  from public, anon, authenticated;

revoke all on function
  public.set_venue_break_clocked(uuid, boolean),
  public.set_member_break_clocked(uuid, boolean),
  public.get_my_unplanned_clock()
from public, anon;

grant execute on function
  public.set_venue_break_clocked(uuid, boolean),
  public.set_member_break_clocked(uuid, boolean),
  public.get_my_unplanned_clock()
to authenticated;
