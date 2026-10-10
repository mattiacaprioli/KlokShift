-- Timbratura senza turno. Chi gestisce le ore la abilita per persona e per sede
-- (`venue_members.clock_unplanned`, spenta di default). L'entrata apre una
-- timbratura senza turno (`shift_id` nullo); l'uscita fa nascere il turno
-- «fuori turno» (`shifts.unplanned`) con gli orari timbrati e un'assegnazione
-- da approvare. Da lì in poi correzione, approvazione, riepilogo ed export sono
-- quelli di ogni turno: le ore lavorate restano solo su `shift_assignments`.
--
-- Regole (vedi plans/UNPLANNED-CLOCK.md):
--   * se c'è un turno pianificato in corso o che attacca entro un'ora si timbra
--     quello, non un fuori turno;
--   * una sola timbratura aperta per persona, in tutte le sedi;
--   * oltre 16 ore l'uscita la registra chi gestisce, con un motivo;
--   * mai approvata d'ufficio: il turno nato dalla timbratura è da verificare;
--   * i colleghi lo vedono nel planning solo dopo l'approvazione.

alter table public.venue_members
  add column clock_unplanned boolean not null default false;

alter table public.shifts
  add column unplanned boolean not null default false;

alter table public.shift_clock_records
  alter column shift_id drop not null,
  add column role_id uuid references public.venue_roles (id) on delete set null,
  add column note text check (note is null or (btrim(note) <> '' and char_length(note) <= 500)),
  -- Senza turno non c'è assegnazione: il turno nasce all'uscita.
  add constraint shift_clock_records_unplanned_ck check (shift_id is not null or assignment_id is null);

create unique index shift_clock_records_open_unplanned_uq
  on public.shift_clock_records (venue_member_id)
  where shift_id is null and voided_at is null;

-- ---------------------------------------------------------------------------
-- Notifiche: il turno nato da una timbratura non è un turno «assegnato» né
-- «revocato». Stesso meccanismo di `app.staff_exit`.
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_title text;
  v_venue text;
begin
  if coalesce(current_setting('app.unplanned_clock', true), '') = '1' then
    return new;
  end if;
  select m.user_id into v_user
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = new.venue_member_id;
  select s.title, ve.name into v_title, v_venue
    from public.shifts s join public.venues ve on ve.id = s.venue_id where s.id = new.shift_id;

  perform private.notify(
    v_user, 'shift_assigned', 'Nuovo turno assegnato',
    'Sei stato assegnato a «' || coalesce(v_title, 'un turno') || '» da ' || coalesce(v_venue, 'una sede')
      || case when new.status = 'assigned' then '. Conferma la presenza.' else '' end,
    new.shift_id
  );
  return new;
end;
$$;

create or replace function public.notify_on_assignment_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_venue text;
  v_date date;
  v_status public.shift_status;
begin
  if coalesce(current_setting('app.staff_exit', true), '') = '1'
     or coalesce(current_setting('app.unplanned_clock', true), '') = '1'
     or old.status = 'declined' then
    return old;
  end if;
  select m.user_id into v_user
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = old.venue_member_id;
  select v.name, s.date, s.status into v_venue, v_date, v_status
    from public.shifts s join public.venues v on v.id = s.venue_id where s.id = old.shift_id;
  if not found or v_status = 'cancelled' or v_date < public.local_now()::date then
    return old;
  end if;

  perform private.notify(
    v_user, 'shift_unassigned', 'Turno revocato',
    coalesce(v_venue, 'Una sede') || ' ti ha tolto dal turno del ' || to_char(v_date, 'DD/MM')
  );
  return old;
end;
$$;

-- ---------------------------------------------------------------------------
-- Helper
-- ---------------------------------------------------------------------------

-- Gemello di assert_attendance_access per una timbratura che non ha ancora
-- un'assegnazione: in archivio si chiude solo ciò che era iniziato prima della
-- fine operativa.
create function private.assert_unplanned_attendance(p_workspace uuid, p_clock_in timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare a jsonb;
begin
  if p_workspace is null or not exists (select 1 from public.workspace_members
    where workspace_id = p_workspace and user_id = (select auth.uid()) and status = 'active') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.lock_commercial_workspace(p_workspace);
  a := private.workspace_access_at(p_workspace, clock_timestamp());
  if a->>'state' in ('operational', 'migration_pending') then return; end if;
  if not coalesce((a->>'can_complete_attendance')::boolean, false)
     or p_clock_in > (a->>'operational_until')::timestamptz then
    raise exception 'attendance_window_closed' using errcode = '42501';
  end if;
end;
$$;

-- Dalla timbratura chiusa al turno: orari al minuto (per difetto, così il turno
-- risulta già concluso; almeno un minuto, perché fine = inizio vorrebbe dire
-- 24 ore), data del giorno di entrata, assegnazione confermata e misurata dalla
-- timbratura. Le ore restano quelle della timbratura, non del turno.
create function private.materialize_unplanned_clock(p_record uuid)
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
  insert into public.shifts (
    venue_id, title, description, date, start_time, end_time, unplanned
  ) values (
    c.venue_id, 'Fuori turno', c.note, v_in::date, v_in::time, v_out::time, true
  ) returning id into v_shift;

  insert into public.shift_assignments (
    shift_id, venue_id, venue_member_id, role_id, status, confirmed_at, hours_source
  ) values (
    v_shift, c.venue_id, c.venue_member_id, c.role_id, 'confirmed', c.clock_in_at, 'clock_expected'
  ) returning id into v_asg;
  perform set_config('app.unplanned_clock', '', true);

  update public.shift_clock_records
     set shift_id = v_shift, assignment_id = v_asg
   where id = c.id
  returning * into c;
  return c;
end;
$$;

revoke all on function private.assert_unplanned_attendance(uuid, timestamptz),
  private.materialize_unplanned_clock(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Configurazione
-- ---------------------------------------------------------------------------
create function public.set_member_clock_unplanned(p_venue_member uuid, p_enabled boolean)
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
  -- Accendere apre nuova operatività; spegnere è una revoca, anche in archivio.
  if coalesce(p_enabled, false) then
    perform private.assert_workspace_operational(private.venue_workspace(v_venue));
  end if;
  update public.venue_members set clock_unplanned = coalesce(p_enabled, false)
   where id = p_venue_member
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Timbratura del professionista. Istanti sempre del server; la stessa azione
-- ripetuta è idempotente (doppio tap, retry di rete).
-- ---------------------------------------------------------------------------
create function public.clock_punch_unplanned(
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
    if exists (
      select 1
        from public.shift_clock_records c
        join public.venue_members x on x.id = c.venue_member_id
        join public.workspace_members xm on xm.id = x.member_id
        cross join lateral private.clock_record_times(c.id) t
       where xm.user_id = (select auth.uid()) and c.voided_at is null
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

-- ---------------------------------------------------------------------------
-- Chi gestisce le ore: uscita dimenticata o entrata per errore.
-- ---------------------------------------------------------------------------
create function public.close_unplanned_clock(p_record uuid, p_out timestamptz, p_reason text)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  c record;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select x.*, vm.member_id, v.workspace_id into c
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
   where x.id = p_record and x.shift_id is null and x.voided_at is null
   for update of x;
  if c.id is null or not private.can(c.venue_id, 'hours')
     or private.is_restricted_self(c.member_id) then
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

create function public.void_unplanned_clock(p_record uuid, p_reason text)
returns public.shift_clock_records
language plpgsql security definer set search_path = '' as $$
declare
  c record;
  v_row public.shift_clock_records;
begin
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select x.id, x.venue_id, x.clock_in_at, vm.member_id, v.workspace_id into c
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
   where x.id = p_record and x.shift_id is null and x.voided_at is null
   for update of x;
  if c.id is null or not private.can(c.venue_id, 'hours')
     or private.is_restricted_self(c.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_unplanned_attendance(c.workspace_id, c.clock_in_at);
  update public.shift_clock_records set
    voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = c.id returning * into v_row;
  return v_row;
end;
$$;

-- Annullare la timbratura di un fuori turno toglie anche il turno: esisteva
-- solo perché c'era la timbratura. Il record annullato resta per l'audit.
CREATE OR REPLACE FUNCTION public.void_clock_record(p_assignment uuid, p_reason text)
 RETURNS shift_clock_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_row public.shift_clock_records;
begin
  perform private.assert_attendance_access(p_assignment);
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'reason_required' using errcode = '23514';
  end if;
  select x.*, vm.member_id into r
    from public.shift_clock_records x
    join public.venue_members vm on vm.id = x.venue_member_id
   where x.assignment_id = p_assignment and x.voided_at is null
   for update of x;
  if r.id is null or not private.can(r.venue_id, 'hours')
     or private.is_restricted_self(r.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  update public.shift_clock_records set
    voided_at = now(), voided_by = (select auth.uid()), void_reason = btrim(p_reason)
  where id = r.id returning * into v_row;

  if exists (select 1 from public.shifts s where s.id = r.shift_id and s.unplanned) then
    perform set_config('app.unplanned_clock', '1', true);
    delete from public.shifts s
     where s.id = r.shift_id
       and not exists (select 1 from public.shift_assignments a
                        where a.shift_id = s.id and a.id <> p_assignment);
    delete from public.shift_assignments where id = p_assignment;
    perform set_config('app.unplanned_clock', '', true);
    return v_row;
  end if;

  update public.shift_assignments a set
    worked_hours = case when a.attendance_reviewed_at is not null then null else a.worked_hours end,
    attendance_reviewed_at = null,
    attendance_reviewed_by = null
  where a.id = p_assignment;
  return v_row;
end;
$function$
;

-- ---------------------------------------------------------------------------
-- Letture
-- ---------------------------------------------------------------------------

-- Dove posso timbrare senza turno, e l'eventuale entrata aperta.
create function public.get_my_unplanned_clock()
returns table (
  venue_member_id uuid, venue_id uuid, venue_name text, workspace_name text,
  roles jsonb, open_record_id uuid, clock_in_at timestamptz, role_id uuid, note text
) language sql stable security definer set search_path = '' as $$
  select vm.id, v.id, v.name, w.name,
         coalesce((select jsonb_agg(jsonb_build_object('id', vr.id, 'name', vr.name)
                                    order by vr.sort_order, vr.name)
                     from public.venue_member_roles x
                     join public.venue_roles vr on vr.id = x.role_id
                    where x.venue_member_id = vm.id and vr.archived_at is null), '[]'::jsonb),
         c.id, c.clock_in_at, c.role_id, c.note
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
    join public.workspaces w on w.id = m.workspace_id and w.deleted_at is null
    join public.venues v on v.id = vm.venue_id
    left join public.shift_clock_records c
      on c.venue_member_id = vm.id and c.shift_id is null and c.voided_at is null
   where m.user_id = (select auth.uid()) and m.status = 'active' and vm.left_at is null
     and v.closed_at is null
     -- Spenta dopo un'entrata: l'uscita resta possibile.
     and ((vm.clock_unplanned and coalesce(vm.clock_method, v.clock_method) = 'app')
          or c.id is not null)
   order by w.name, v.name;
$$;

-- Le timbrature senza turno ancora aperte nell'azienda, per chi vede le
-- timbrature (Turni o Ore). `can_manage` dice chi può chiuderle o annullarle.
create function public.get_open_unplanned_clocks(p_workspace uuid)
returns table (
  record_id uuid, venue_id uuid, venue_name text, venue_member_id uuid, member_id uuid,
  member_name text, avatar_url text, clock_in_at timestamptz, role_name text, note text,
  can_manage boolean
) language sql stable security definer set search_path = '' as $$
  select c.id, v.id, v.name, vm.id, m.id, m.display_name, p.avatar_url, c.clock_in_at,
         vr.name, c.note,
         private.can(v.id, 'hours') and not private.is_restricted_self(m.id)
    from public.shift_clock_records c
    join public.venues v on v.id = c.venue_id
    join public.venue_members vm on vm.id = c.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    left join public.profiles p on p.id = m.user_id
    left join public.venue_roles vr on vr.id = c.role_id
   where v.workspace_id = p_workspace
     and c.shift_id is null and c.voided_at is null
     and (v.id in (select private.venues_where('hours'))
          or v.id in (select private.venues_where('shifts')))
   order by c.clock_in_at;
$$;

-- I colleghi vedono il fuori turno solo quando è approvato: prima è una
-- timbratura da verificare, non un turno.
create or replace function public.get_staff_planning(p_from date, p_to date)
returns table (
  venue_id uuid, venue_name text, venue_logo_url text, shift_id uuid, title text,
  date date, start_time time, end_time time, venue_member_id uuid, member_name text,
  avatar_url text, role_name text, is_me boolean
) language sql stable security definer set search_path = '' as $$
  with me as (select (select auth.uid()) as uid),
  my_venues as (
    select v.id, v.name, v.logo_url
      from public.venue_members vm
      join public.workspace_members m on m.id = vm.member_id
      join public.venues v on v.id = vm.venue_id
      cross join me
     where m.user_id = me.uid and m.status = 'active' and vm.left_at is null
       and v.staff_sees_planning and v.closed_at is null
  )
  select mv.id, mv.name, mv.logo_url, s.id, s.title, s.date, s.start_time, s.end_time,
         vm.id, m.display_name, p.avatar_url, r.name,
         m.user_id is not distinct from me.uid
    from public.shifts s
    join my_venues mv on mv.id = s.venue_id
    cross join me
    left join public.shift_assignments a on a.shift_id = s.id and a.status in ('assigned', 'confirmed')
    -- Chi è uscito dalla sede non lavorerà quel turno: il turno resta, la persona no.
    left join public.venue_members vm on vm.id = a.venue_member_id and vm.left_at is null
    left join public.workspace_members m on m.id = vm.member_id
    left join public.profiles p on p.id = m.user_id
    left join public.venue_roles r on r.id = a.role_id
   where s.status <> 'cancelled'
     and s.date >= p_from and s.date <= least(p_to, p_from + 62)
     and (not s.unplanned or exists (
       select 1 from public.shift_assignments x
        where x.shift_id = s.id and x.attendance_reviewed_at is not null))
   order by s.date, s.start_time, s.id, m.display_name;
$$;

grant execute on function
  public.set_member_clock_unplanned(uuid, boolean),
  public.clock_punch_unplanned(uuid, text, uuid, text),
  public.close_unplanned_clock(uuid, timestamptz, text),
  public.void_unplanned_clock(uuid, text),
  public.get_my_unplanned_clock(),
  public.get_open_unplanned_clocks(uuid)
to authenticated;
