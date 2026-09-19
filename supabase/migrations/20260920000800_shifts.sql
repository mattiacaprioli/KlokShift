-- Baseline — 9/N: turni, fabbisogni, assegnazioni.
--
-- Solo turni interni (il marketplace non c'è più): niente `kind`, niente paga
-- oraria, niente candidature. Due cose che prima non erano vincolate lo sono ora
-- dal DB con FK composite:
--   * la persona assegnata deve essere in organico NELLA SEDE del turno
--     (prima lo controllavano solo `reassign` e `can_self_plan`);
--   * la mansione di un fabbisogno o di un'assegnazione deve essere di quella sede.
--
-- Le scritture passano tutte dalle RPC (20260920000900): qui i trigger sono
-- guardie e notifiche, non permessi.

create table public.shifts (
  id                   uuid primary key default gen_random_uuid(),
  venue_id             uuid not null references public.venues (id) on delete cascade,
  title                text not null check (btrim(title) <> ''),
  description          text,
  date                 date not null,
  start_time           time not null,
  end_time             time not null,
  status               public.shift_status not null default 'open',
  -- Se true anche i fissi devono confermare. Il default lo decide il DB in
  -- default_assignment_confirmation, guardando employment_type.
  require_confirmation boolean not null default false,
  -- Posti da coprire (somma del fabbisogno per ruolo, altrimenti le persone
  -- chiamate) e coperti (assegnati attivi, tenuto dal trigger). Li scrive il
  -- server: il client non li calcola più.
  positions_total      integer not null default 1 check (positions_total >= 1),
  positions_filled     integer not null default 0 check (positions_filled >= 0),
  created_at           timestamptz not null default now(),
  constraint shifts_id_venue_uq unique (id, venue_id)
);
create index shifts_venue_date_idx on public.shifts (venue_id, date);
alter table public.shifts enable row level security;

create table public.shift_role_requirements (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid not null,
  venue_id   uuid not null,
  role_id    uuid not null,
  count      integer not null default 1 check (count >= 1),
  created_at timestamptz not null default now(),
  constraint shift_role_requirements_shift_role_uq unique (shift_id, role_id),
  foreign key (shift_id, venue_id) references public.shifts (id, venue_id) on delete cascade,
  foreign key (role_id, venue_id)  references public.venue_roles (id, venue_id) on delete cascade
);
create index shift_role_requirements_shift_idx on public.shift_role_requirements (shift_id);
alter table public.shift_role_requirements enable row level security;

create table public.shift_assignments (
  id              uuid primary key default gen_random_uuid(),
  shift_id        uuid not null,
  venue_id        uuid not null,
  venue_member_id uuid not null,
  status          public.assignment_status not null default 'assigned',
  -- Ore effettive, se diverse da quelle pianificate. Le scrive chi ha «Ore».
  worked_hours    numeric(5,2) check (worked_hours is null or worked_hours >= 0),
  role_id         uuid,
  -- Quando il professionista ha confermato di persona. Null per un fisso
  -- confermato d'ufficio: nessuno ha confermato niente.
  confirmed_at    timestamptz,
  created_at      timestamptz not null default now(),
  constraint shift_assignments_shift_member_uq unique (shift_id, venue_member_id),
  foreign key (shift_id, venue_id)        references public.shifts (id, venue_id) on delete cascade,
  foreign key (venue_member_id, venue_id) references public.venue_members (id, venue_id) on delete cascade,
  -- role_id nullo = chi ha più mansioni e non ne ha ancora scelta una: la FK
  -- composita, con un componente nullo, non controlla (MATCH SIMPLE).
  foreign key (role_id, venue_id) references public.venue_roles (id, venue_id) on delete set null (role_id)
);
create index shift_assignments_member_idx on public.shift_assignments (venue_member_id);
create index shift_assignments_shift_idx on public.shift_assignments (shift_id);
alter table public.shift_assignments enable row level security;

create table public.shift_change_requests (
  id                  uuid primary key default gen_random_uuid(),
  assignment_id       uuid references public.shift_assignments (id) on delete set null,
  shift_id            uuid not null references public.shifts (id) on delete cascade,
  shift_date          date not null,
  requested_by        uuid not null references public.profiles (id) on delete cascade,
  reason              text not null check (btrim(reason) <> ''),
  status              public.change_request_status not null default 'pending',
  resolved_by         uuid references public.profiles (id) on delete set null,
  resolution_note     text,
  created_at          timestamptz not null default now(),
  resolved_at         timestamptz,
  kind                public.change_request_kind not null default 'substitution',
  proposed_start_time time,
  proposed_end_time   time,
  constraint shift_change_requests_hours_ck check (
    (kind = 'hours') = (proposed_start_time is not null and proposed_end_time is not null)
  )
);
create index shift_change_requests_shift_idx on public.shift_change_requests (shift_id);
alter table public.shift_change_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Gli helper che dipendono dai turni
-- ---------------------------------------------------------------------------
create function private.my_shift_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select a.shift_id
    from public.shift_assignments a
   where a.venue_member_id in (select private.my_venue_member_ids());
$$;

create function private.shift_is_over(p_shift uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       from public.shifts s where s.id = p_shift),
    true  -- turno non trovato: si tratta come concluso, cioè si congela
  );
$$;
-- I turni delle sedi su cui ho quel permesso, per le policy delle tabelle figlie
-- (mai una subquery diretta su `shifts`: è una tabella con RLS).
create function private.shift_ids_where(p_perm text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.shifts s where s.venue_id in (select private.venues_where(p_perm));
$$;
grant execute on function private.my_shift_ids(), private.shift_is_over(uuid),
  private.shift_ids_where(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Lettura (le scritture sono solo RPC)
-- ---------------------------------------------------------------------------
grant select on public.shifts, public.shift_role_requirements,
  public.shift_assignments, public.shift_change_requests to authenticated;

create policy "shifts: roster and assignees read" on public.shifts
  for select to authenticated
  using (venue_id in (select private.venues_where('roster')) or id in (select private.my_shift_ids()));

create policy "shift_role_requirements: roster and assignees read" on public.shift_role_requirements
  for select to authenticated
  using (venue_id in (select private.venues_where('roster')) or shift_id in (select private.my_shift_ids()));

create policy "shift_assignments: roster and self read" on public.shift_assignments
  for select to authenticated
  using (venue_id in (select private.venues_where('roster')) or venue_member_id in (select private.my_venue_member_ids()));

create policy "shift_change_requests: managers and requester read" on public.shift_change_requests
  for select to authenticated
  using (
    requested_by = (select auth.uid())
    or shift_id in (select private.shift_ids_where('shifts'))
  );

-- ---------------------------------------------------------------------------
-- Trigger: guardie
-- ---------------------------------------------------------------------------
-- Chi è assegnato e quale turno non si cambiano: per spostare qualcuno si
-- cancella la riga e se ne crea una nuova (così la notifica parte da sé).
create function public.shift_assignments_lock_identity()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.shift_id is distinct from old.shift_id
     or new.venue_member_id is distinct from old.venue_member_id then
    raise exception 'assignment_identity_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger shift_assignments_lock_identity before update on public.shift_assignments
  for each row execute function public.shift_assignments_lock_identity();

-- Stato iniziale di un'assegnazione:
--   * mettersi in turno da sé vale come conferma (è il gesto stesso);
--   * un fisso nasce già confermato, salvo `require_confirmation` sul turno;
--     `confirmed_at` resta null perché nessuno ha confermato niente;
--   * chi passa uno status esplicito sa quello che fa (seed, correzione).
create function public.default_assignment_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_required boolean;
  v_type     public.employment_type;
begin
  if new.venue_member_id in (select private.my_venue_member_ids()) then
    new.status := 'confirmed';
    new.confirmed_at := now();
    return new;
  end if;
  if new.status <> 'assigned' then
    return new;
  end if;

  select s.require_confirmation, vm.employment_type into v_required, v_type
    from public.shifts s cross join public.venue_members vm
   where s.id = new.shift_id and vm.id = new.venue_member_id;

  -- Non trovati (non dovrebbe: ci sono le FK): resta 'assigned', lo stato che
  -- chiede conferma. Fail-closed verso il gesto in più.
  if coalesce(v_required, true) then
    return new;
  end if;
  if v_type = 'fisso' then
    new.status := 'confirmed';
  end if;
  return new;
end;
$$;
create trigger shift_assignments_default_confirmation before insert on public.shift_assignments
  for each row execute function public.default_assignment_confirmation();

-- Se la persona ha una sola mansione, è quella. Con più mansioni resta null: il
-- gestore sceglie, altrimenti la copertura direbbe «coperto» a torto.
create function public.default_assignment_role()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.role_id is null then
    select (array_agg(r.role_id))[1] into new.role_id
      from public.venue_member_roles r
     where r.venue_member_id = new.venue_member_id
    having count(*) = 1;
  end if;
  return new;
end;
$$;
create trigger shift_assignments_default_role before insert on public.shift_assignments
  for each row execute function public.default_assignment_role();

-- I posti coperti sono gli assegnati attivi ('assigned' e 'confirmed' contano
-- uguale: chi deve ancora confermare occupa comunque il posto).
create function public.sync_positions_filled()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_shift uuid := coalesce(new.shift_id, old.shift_id);
begin
  update public.shifts s
     set positions_filled = (
       select count(*) from public.shift_assignments a
        where a.shift_id = v_shift and a.status in ('assigned', 'confirmed')
     )
   where s.id = v_shift;
  return null;
end;
$$;
create trigger shift_assignments_sync_positions
  after insert or update of status or delete on public.shift_assignments
  for each row execute function public.sync_positions_filled();

-- Un turno finito si corregge solo con «Ore», e mai se in servizio c'era chi lo
-- sta correggendo senza essere titolare («non decidi di te stesso»).
-- Con auth.uid() nullo (service role, editor SQL) passa: non c'è nessuno a cui
-- negare qualcosa.
create function public.guard_finished_shift_times()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.date is not distinct from old.date
     and new.start_time is not distinct from old.start_time
     and new.end_time   is not distinct from old.end_time then
    return new;
  end if;
  if public.shift_ends_at(old.date, old.start_time, old.end_time) > public.local_now()
     and public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
    return new;
  end if;
  if (select auth.uid()) is null then
    return new;
  end if;

  if not private.can(old.venue_id, 'hours')
     or not private.can(new.venue_id, 'hours')
     or exists (
       select 1
         from public.shift_assignments a
         join public.venue_members vm on vm.id = a.venue_member_id
         join public.workspace_members m on m.id = vm.member_id
        where a.shift_id = old.id and m.user_id = (select auth.uid()) and m.authority <> 'owner'
     ) then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger shifts_guard_finished_times before update of date, start_time, end_time on public.shifts
  for each row execute function public.guard_finished_shift_times();

-- Chi esce da una sede libera i turni futuri; quelli passati restano (storico).
-- Il flag `app.staff_exit` zittisce le notifiche «turno revocato»: la notizia è
-- una sola («Collaborazione terminata») e la dà chi ha fatto uscire la persona.
create function public.venue_members_release_shifts()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.staff_exit', '1', true);
  delete from public.shift_assignments a
   using public.shifts s
   where a.venue_member_id = new.id and s.id = a.shift_id
     and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now();
  perform set_config('app.staff_exit', '', true);
  return null;
end;
$$;
create trigger venue_members_release_shifts
  after update of left_at on public.venue_members
  for each row when (old.left_at is null and new.left_at is not null)
  execute function public.venue_members_release_shifts();

-- ---------------------------------------------------------------------------
-- Trigger: notifiche (tutte via private.notify, che salta chi ha agito)
-- ---------------------------------------------------------------------------
create function public.notify_on_assignment()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_title text;
  v_venue text;
begin
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
create trigger shift_assignments_notify after insert on public.shift_assignments
  for each row execute function public.notify_on_assignment();

create function public.notify_on_assignment_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid;
  v_venue text;
  v_date date;
  v_status public.shift_status;
begin
  if coalesce(current_setting('app.staff_exit', true), '') = '1' or old.status = 'declined' then
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
create trigger shift_assignments_notify_removed after delete on public.shift_assignments
  for each row execute function public.notify_on_assignment_removed();

create function public.notify_on_assignment_declined()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_date date;
  v_name text;
begin
  if new.status <> 'declined' or old.status = 'declined' then
    return new;
  end if;
  select s.date into v_date from public.shifts s where s.id = new.shift_id;
  select m.display_name into v_name
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = new.venue_member_id;

  perform private.notify_managers(
    new.venue_id, 'shifts', 'shift_declined', 'Turno rifiutato',
    coalesce(v_name, 'Un professionista') || ' ha rifiutato il turno del ' || to_char(v_date, 'DD/MM'),
    new.shift_id
  );
  return new;
end;
$$;
create trigger shift_assignments_notify_declined after update of status on public.shift_assignments
  for each row execute function public.notify_on_assignment_declined();

-- Annullamento, cambio di data/orario, richiesta di conferma: avvisa gli assegnati
-- attivi e, se serve, riapre la conferma. Chi sta modificando NON viene avvisato
-- e non perde la propria conferma: l'orario nuovo l'ha scritto lui.
create function public.notify_on_shift_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_venue text;
  v_type  public.notification_type;
  v_title text;
  v_body  text;
  v_user  uuid;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    v_type := 'shift_cancelled'; v_title := 'Turno annullato';
  elsif new.status <> 'cancelled'
        and (old.date, old.start_time, old.end_time) is distinct from (new.date, new.start_time, new.end_time) then
    v_type := 'shift_updated'; v_title := 'Turno modificato';
  elsif new.status <> 'cancelled' and new.require_confirmation and not old.require_confirmation then
    v_type := 'shift_updated'; v_title := 'Conferma richiesta';
  else
    return new;
  end if;

  select name into v_venue from public.venues where id = new.venue_id;

  if v_type = 'shift_cancelled' then
    v_body := coalesce(v_venue, 'Una sede') || ' ha annullato «' || new.title || '» del ' || to_char(new.date, 'DD/MM');
  elsif v_title = 'Conferma richiesta' then
    v_body := coalesce(v_venue, 'Una sede') || ' chiede la conferma per «' || new.title || '» del ' || to_char(new.date, 'DD/MM');
    -- Solo chi non ha mai confermato di persona: i fissi confermati d'ufficio.
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments set status = 'assigned'
       where shift_id = new.id and status = 'confirmed' and confirmed_at is null
         and venue_member_id not in (select private.my_venue_member_ids());
    end if;
  else
    v_body := coalesce(v_venue, 'Una sede') || ' ha modificato «' || new.title || '»: ora '
      || to_char(new.date, 'DD/MM') || ' · ' || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments set status = 'assigned'
       where shift_id = new.id and status = 'confirmed'
         and venue_member_id not in (select private.my_venue_member_ids());
    end if;
  end if;

  for v_user in
    select distinct m.user_id
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where a.shift_id = new.id and a.status in ('assigned', 'confirmed') and m.user_id is not null
  loop
    perform private.notify(v_user, v_type, v_title, v_body, new.id);
  end loop;
  return new;
end;
$$;
create trigger shifts_notify_change after update on public.shifts
  for each row execute function public.notify_on_shift_change();
