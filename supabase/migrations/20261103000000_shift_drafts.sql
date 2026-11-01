-- Turni in bozza e pubblicazione (parte 1): modello e visibilità.
--
-- `shifts.published_at` null = bozza. IL DEFAULT È «PUBBLICATO» (now()): solo
-- `create_shifts` con `"draft": true` nel piano crea una bozza. Le app già
-- installate non mandano la chiave e devono continuare a creare turni che
-- avvisano come oggi; con il default a bozza creerebbero turni invisibili.
--
-- Le bozze le nasconde la RLS (policy restrittive) a chi non ha «roster»
-- («Turni» o «Team»); le funzioni DEFINER che leggono i turni le escludono
-- per conto loro (migration successive).

alter table public.shifts
  add column published_at timestamptz default now(),
  add column published_by uuid references public.profiles (id) on delete set null;

-- Tutto ciò che esiste oggi è già pubblicato, dal giorno in cui è nato. Gli
-- ultimi trigger utente vanno spenti: `shifts_break_paid_snapshot` riscriverebbe
-- `break_paid` dei turni futuri, e nessuna notifica deve nascere da un backfill.
alter table public.shifts disable trigger user;
update public.shifts set published_at = created_at;
alter table public.shifts enable trigger user;

create index shifts_drafts_idx on public.shifts (venue_id, date) where published_at is null;

-- Serve a policy e funzioni che non possono fare una subquery diretta su `shifts`.
create function private.draft_shift_ids()
returns setof uuid language sql stable security definer set search_path = '' as $$
  select s.id from public.shifts s where s.published_at is null;
$$;
revoke all on function private.draft_shift_ids() from public;
grant execute on function private.draft_shift_ids() to authenticated;

create policy "drafts: managers only" on public.shifts as restrictive for select to authenticated
using (published_at is not null or venue_id in (select private.venues_where('roster')));
create policy "drafts: managers only" on public.shift_assignments as restrictive for select to authenticated
using (shift_id not in (select private.draft_shift_ids()) or venue_id in (select private.venues_where('roster')));
create policy "drafts: managers only" on public.shift_role_requirements as restrictive for select to authenticated
using (shift_id not in (select private.draft_shift_ids()) or venue_id in (select private.venues_where('roster')));
create policy "drafts: managers only" on public.shift_change_requests as restrictive for select to authenticated
using (shift_id not in (select private.draft_shift_ids()) or shift_id in (select private.shift_ids_where('roster')));

-- `create_shifts`: la chiave `draft` del piano. Definizione di partenza dal banco.
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
  v_draft   boolean;
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
    -- Senza la chiave il turno nasce pubblicato: le app già installate non la mandano.
    v_draft := coalesce((v_plan ->> 'draft')::boolean, false);
    v_break := coalesce((v_plan ->> 'break_minutes')::integer, 0);
    perform private.assert_shift_break(
      (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time, v_break);

    foreach v_date in array v_dates loop
      -- Il passato non si pianifica: si registra (`record_past_shift`, con Ore).
      if public.shift_ends_at(v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time)
         <= public.local_now() then
        raise exception 'shift_finished' using errcode = '23514';
      end if;
      insert into public.shifts (
        venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
        break_minutes, published_at, published_by
      ) values (
        v_venue, btrim(v_plan ->> 'title'), nullif(btrim(coalesce(v_plan ->> 'description', '')), ''),
        v_date, (v_plan ->> 'start_time')::time, (v_plan ->> 'end_time')::time,
        coalesce((v_plan ->> 'require_confirmation')::boolean, false),
        private.positions_for(v_plan -> 'role_targets', jsonb_array_length(v_staff)),
        v_break,
        case when v_draft then null else now() end,
        case when v_draft then null else (select auth.uid()) end
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
$function$;

-- `move_assignment`: il gemello eredita lo stato del turno di partenza
-- (pubblicato -> pubblicato, bozza -> bozza).
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
         s.break_minutes, s.published_at, s.published_by
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
    -- Il gemello è un turno nuovo: nel passato non nasce, come in create_shifts.
    if public.shift_ends_at(p_to_date, v_from.start_time, v_from.end_time) <= public.local_now() then
      raise exception 'shift_finished' using errcode = '23514';
    end if;
    insert into public.shifts (
      venue_id, title, description, date, start_time, end_time, require_confirmation, positions_total,
      break_minutes, published_at, published_by
    ) values (
      v_to_venue, v_from.title, v_from.description,
      p_to_date, v_from.start_time, v_from.end_time, v_from.require_confirmation,
      private.positions_for(null::jsonb, 1),
      v_from.break_minutes, v_from.published_at, v_from.published_by
    ) returning id into v_to_shift;
  end if;

  perform private.assert_can_touch_assignment(v_to_shift, v_to_member);

  delete from public.shift_assignments where id = p_assignment;
  return private.assign_one(v_to_shift, v_to_member, v_role);
end;
$function$;

-- Minimo indispensabile perché la bozza non avvisi: il resto dei trigger e delle
-- letture del dipendente arriva con `20261103000100_shift_drafts_silent.sql`.
CREATE OR REPLACE FUNCTION public.notify_on_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
  v_title text;
  v_venue text;
begin
  if coalesce(current_setting('app.unplanned_clock', true), '') = '1' then
    return new;
  end if;
  -- Una bozza non avvisa nessuno: si avvisa quando si pubblica.
  if exists (select 1 from public.shifts s where s.id = new.shift_id and s.published_at is null) then
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
$function$;
