-- Turni in bozza e pubblicazione (parte 2): una bozza non arriva al team.
--
-- Le funzioni DEFINER scavalcano la RLS di `20261103000000_shift_drafts.sql`,
-- quindi ognuna che legge i turni per conto del dipendente, avvisa o conta ore
-- deve escludere le bozze (`published_at is null`) da sé. Elenco ricavato dal
-- banco (funzioni che citano `public.shifts`, `shift_assignments` o
-- `my_work_history`); in fondo, quelle che restano com'erano e perché.
-- Ogni definizione di partenza è quella del banco dopo `run.sh reset`.
--
-- Su una bozza le operazioni del dipendente e le presenze si rifiutano con
-- `shift_draft`; una bozza non si annulla, si elimina (anche se è finita).

create function private.assert_shift_published(p_shift uuid)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.shifts s where s.id = p_shift and s.published_at is null) then
    raise exception 'shift_draft' using errcode = '23514';
  end if;
end;
$$;
revoke all on function private.assert_shift_published(uuid) from public;

-- ---------------------------------------------------------------------------
-- Trigger di notifica: su una bozza tacciono. `notify_on_assignment` esce già
-- da `20261103000000_shift_drafts.sql`. `default_assignment_confirmation`
-- resta com'è: decide lo stato iniziale, non avvisa.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_on_assignment_removed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_user uuid;
  v_venue text;
  v_date date;
  v_status public.shift_status;
  v_published timestamptz;
begin
  if coalesce(current_setting('app.staff_exit', true), '') = '1'
     or coalesce(current_setting('app.unplanned_clock', true), '') = '1'
     or old.status = 'declined' then
    return old;
  end if;
  select m.user_id into v_user
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = old.venue_member_id;
  select v.name, s.date, s.status, s.published_at into v_venue, v_date, v_status, v_published
    from public.shifts s join public.venues v on v.id = s.venue_id where s.id = old.shift_id;
  -- Da una bozza si esce in silenzio: non l'ha mai vista.
  if not found or v_published is null or v_status = 'cancelled' or v_date < public.local_now()::date then
    return old;
  end if;

  perform private.notify(
    v_user, 'shift_unassigned', 'Turno revocato',
    coalesce(v_venue, 'Una sede') || ' ti ha tolto dal turno del ' || to_char(v_date, 'DD/MM')
  );
  return old;
end;
$function$;


CREATE OR REPLACE FUNCTION public.notify_on_assignment_declined()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date;
  v_name text;
begin
  if new.status <> 'declined' or old.status = 'declined' then
    return new;
  end if;
  if exists (select 1 from public.shifts s where s.id = new.shift_id and s.published_at is null) then
    return new;
  end if;
  select s.date into v_date from public.shifts s where s.id = new.shift_id;
  select m.display_name into v_name
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = new.venue_member_id;

  perform private.notify_managers(
    new.venue_id, 'shifts', 'shift_declined', 'Turno rifiutato',
    coalesce(v_name, 'Un dipendente') || ' ha rifiutato il turno del ' || to_char(v_date, 'DD/MM')
      || coalesce(': «' || new.decline_reason || '»', ''),
    new.shift_id
  );
  return new;
end;
$function$;


CREATE OR REPLACE FUNCTION public.notify_on_assignment_reconfirmed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_date date;
  v_name text;
  v_user uuid;
begin
  if old.status <> 'declined' or new.status <> 'confirmed' then
    return new;
  end if;
  if exists (select 1 from public.shifts s where s.id = new.shift_id and s.published_at is null) then
    return new;
  end if;
  select m.display_name, m.user_id into v_name, v_user
    from public.venue_members vm join public.workspace_members m on m.id = vm.member_id
   where vm.id = new.venue_member_id;
  if v_user is distinct from (select auth.uid()) then
    return new;
  end if;
  select s.date into v_date from public.shifts s where s.id = new.shift_id;

  perform private.notify_managers(
    new.venue_id, 'shifts', 'shift_reconfirmed', 'Turno confermato di nuovo',
    coalesce(v_name, 'Un dipendente') || ' aveva rifiutato il turno del '
      || to_char(v_date, 'DD/MM') || ' e ora lo conferma: controlla di non averlo già sostituito',
    new.shift_id
  );
  return new;
end;
$function$;


-- `old.published_at is null` copre sia la modifica di una bozza sia l'update
-- che la pubblica: nessuno dei due avvisa da qui. Di una bozza resta solo
-- l'effetto sui dati di «chiedi conferma»: chi era confermato d'ufficio torna
-- in attesa, come se la bozza fosse nata così (`default_assignment_confirmation`).
-- Il cambio d'orario invece non riapre niente: nessuno ha confermato di persona
-- un turno che non ha visto.
CREATE OR REPLACE FUNCTION public.notify_on_shift_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue text;
  v_type  public.notification_type;
  v_title text;
  v_body  text;
  v_user  uuid;
begin
  if old.published_at is null then
    if new.status <> 'cancelled' and new.require_confirmation and not old.require_confirmation
       and public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments set status = 'assigned', confirmed_at = null
       where shift_id = new.id and status = 'confirmed' and confirmed_at is null
         and venue_member_id not in (select private.my_venue_member_ids());
    end if;
    return new;
  end if;

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
      update public.shift_assignments set status = 'assigned', confirmed_at = null
       where shift_id = new.id and status = 'confirmed' and confirmed_at is null
         and venue_member_id not in (select private.my_venue_member_ids());
    end if;
  else
    v_body := coalesce(v_venue, 'Una sede') || ' ha modificato «' || new.title || '»: ora '
      || to_char(new.date, 'DD/MM') || ' · ' || to_char(new.start_time, 'HH24:MI') || '–' || to_char(new.end_time, 'HH24:MI');
    if public.shift_ends_at(new.date, new.start_time, new.end_time) > public.local_now() then
      update public.shift_assignments set status = 'assigned', confirmed_at = null
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
$function$;


-- ---------------------------------------------------------------------------
-- Lato dipendente: planning dei colleghi, storico (su `my_work_history`
-- poggiano `get_my_work_history_page/_range/_totals` e `get_my_work_totals`,
-- che non leggono i turni per conto loro), promemoria, conflitti con le
-- assenze, persona raffigurata nelle notifiche, fuori turno.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_staff_planning(p_from date, p_to date)
 RETURNS TABLE(venue_id uuid, venue_name text, venue_logo_url text, shift_id uuid, title text, date date, start_time time without time zone, end_time time without time zone, venue_member_id uuid, member_name text, avatar_url text, role_name text, is_me boolean)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
   where s.venue_id in (select private.commercial_readable_venue_ids()) and s.status <> 'cancelled'
     and s.published_at is not null
     and s.date >= p_from and s.date <= least(p_to, p_from + 62)
     and (not s.unplanned or exists (
       select 1 from public.shift_assignments x
        where x.shift_id = s.id and x.attendance_reviewed_at is not null))
   order by s.date, s.start_time, s.id, m.display_name;
$function$;


CREATE OR REPLACE FUNCTION private.my_work_history(p_user uuid)
 RETURNS TABLE(key text, venue_name text, logo_url text, title text, date date, start_time time without time zone, end_time time without time zone, hours numeric, shift_id uuid, role_name text, planned_hours numeric, worked_hours numeric, clock_in_at timestamp with time zone, clock_out_at timestamp with time zone, hours_source text, proposed_hours numeric, counts boolean, pending_reason text, clock_edit text, clock_edit_reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with rows as (
    select a.id, a.worked_hours, a.hours_source, a.attendance_reviewed_at,
           s.id as shift_id, s.title, s.date, s.start_time, s.end_time,
           s.break_minutes, s.break_paid,
           v.name as venue_name, v.logo_url,
           coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
           vr.name as role_name,
           r.id as clock_record_id, r.method as clock_record_method,
           t.clock_in_at, t.clock_out_at
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      left join public.venue_roles vr on vr.id = a.role_id
      left join public.shift_clock_records r
        on r.assignment_id = a.id and r.voided_at is null
      left join lateral private.clock_record_times(r.id) t on r.id is not null
     where m.workspace_id in (select private.commercial_readable_workspace_ids())
       and m.user_id = p_user
       and s.status <> 'cancelled'
       and s.published_at is not null
       and a.status not in ('declined', 'no_show')
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
  ), classified as (
    -- La condizione «conta» di `shifts_count`; `is true` perché con
    -- `hours_source` nullo vale NULL, che il riepilogo legge come «non conta».
    select x.*,
           ((x.worked_hours is not null and
              (x.hours_source = 'manual' or (x.clock_record_id is not null
                and x.attendance_reviewed_at is not null and x.clock_out_at is not null)))
            or (x.worked_hours is null and x.clock_record_id is null and
              (x.hours_source = 'manual_auto' or
                (x.hours_source is null and x.effective_clock_method = 'manual')))
           ) is true as counts
      from rows x
  )
  select 'asg-' || c.id::text, c.venue_name, c.logo_url, c.title, c.date,
         c.start_time, c.end_time,
         case
           when c.counts and c.worked_hours is not null then c.worked_hours
           when c.counts then private.definitive_manual_hours(c.id, null)
           when c.clock_record_id is not null and c.clock_out_at is not null
             then private.clock_record_counted_hours(c.clock_record_id)
           else public.shift_counted_hours(c.start_time, c.end_time, c.break_minutes, c.break_paid)
         end,
         c.shift_id, c.role_name,
         public.shift_counted_hours(c.start_time, c.end_time, c.break_minutes, c.break_paid),
         c.worked_hours,
         c.clock_in_at, c.clock_out_at,
         case
           when c.worked_hours is not null and c.attendance_reviewed_at is not null then 'approved'
           when c.worked_hours is not null then 'adjusted'
           when c.clock_record_id is not null then 'pending'
           else 'planned'
         end,
         case when c.clock_record_id is not null and c.clock_out_at is not null
              then private.clock_record_counted_hours(c.clock_record_id) end,
         c.counts,
         case
           when c.counts then null
           when c.clock_record_id is not null and c.clock_out_at is null then 'missing_out'
           when c.clock_record_id is not null then 'to_approve'
           else 'not_clocked'
         end,
         case
           when c.clock_record_id is null then null
           when c.clock_record_method = 'manual' then 'entered'
           when exists (select 1 from public.shift_clock_corrections k
                         where k.clock_record_id = c.clock_record_id) then 'corrected'
         end,
         (select k.reason from public.shift_clock_corrections k
           where c.clock_record_id is not null and k.clock_record_id = c.clock_record_id
             and k.reason is not null
           order by k.created_at desc, k.id desc limit 1)
    from classified c;
$function$;


CREATE OR REPLACE FUNCTION private.queue_clock_reminders(p_at timestamp with time zone DEFAULT now())
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_now   timestamp := p_at at time zone 'Europe/Rome';
  c       record;
  v_count integer := 0;
begin
  for c in
    with entry as (
      -- Turni cominciati da 5 a 60 minuti fa (e non ancora finiti) senza entrata.
      select 'in'::text as kind, a.id as subject_id, s.date + s.start_time as due_at,
             m.user_id, m.workspace_id, s.id as related_id,
             'Hai timbrato l''entrata?'::text as title,
             v.name || ': il turno delle ' || to_char(s.date + s.start_time, 'HH24:MI')
               || ' è iniziato e l''entrata non risulta. Timbrala dall''app.' as body
        from public.shifts s
        join public.venues v on v.id = s.venue_id
        join public.shift_assignments a on a.shift_id = s.id
        join public.venue_members vm on vm.id = a.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
       where s.date between v_now::date - 1 and v_now::date
         and s.status <> 'cancelled'
         and s.published_at is not null
         and s.date + s.start_time + interval '5 minutes' <= v_now
         and v_now < least(s.date + s.start_time + interval '60 minutes',
                           public.shift_ends_at(s.date, s.start_time, s.end_time))
         and a.status in ('assigned', 'confirmed')
         and coalesce(vm.clock_method, v.clock_method) = 'app'
         and vm.left_at is null
         and m.status = 'active' and m.user_id is not null
         and not exists (select 1 from public.shift_clock_records r
                          where r.assignment_id = a.id and r.voided_at is null)
         -- Già in servizio altrove (anche fuori turno): una timbratura aperta
         -- per volta, e il suo promemoria d'uscita arriva da sé.
         and not exists (
           select 1 from public.shift_clock_records o
             join public.venue_members ovm on ovm.id = o.venue_member_id
             join public.workspace_members om on om.id = ovm.member_id
            where om.user_id = m.user_id
              and o.clock_out_at is null and o.voided_at is null
              and o.clock_in_at > p_at - interval '24 hours'
              and not exists (select 1 from public.shift_clock_corrections k
                               where k.clock_record_id = o.id and k.corrected_out_at is not null))
         -- In ferie o in permesso approvato in quelle ore: gemello di
         -- `shiftOverlapsAbsence` (src/features/absences/conflicts.ts).
         and not exists (
           select 1 from public.staff_absences ab
            where ab.member_id = m.id and ab.status = 'approved'
              and ab.start_date <= s.date + 1 and ab.end_date >= s.date - 1
              and pg_catalog.tsrange(
                    case when ab.start_time is not null and ab.end_time is not null
                         then ab.start_date + ab.start_time else ab.start_date::timestamp end,
                    case when ab.start_time is not null and ab.end_time is not null
                         then ab.start_date + ab.end_time else (ab.end_date + 1)::timestamp end,
                    '[)')
                  && pg_catalog.tsrange(
                    s.date + s.start_time,
                    public.shift_ends_at(s.date, s.start_time, s.end_time), '[)'))
    ), planned_out as (
      -- Entrate pianificate ancora aperte da 20 minuti a 12 ore dopo la fine.
      select 'out'::text, r.id, public.shift_ends_at(s.date, s.start_time, s.end_time),
             m.user_id, m.workspace_id, s.id,
             'Hai timbrato l''uscita?'::text,
             v.name || ': il turno è finito alle ' || to_char(s.date + s.end_time, 'HH24:MI')
               || ' e l''entrata è ancora aperta. Se hai finito, timbra l''uscita.'
        from public.shift_clock_records r
        join public.shift_assignments a on a.id = r.assignment_id
        join public.shifts s on s.id = r.shift_id
        join public.venues v on v.id = s.venue_id
        join public.venue_members vm on vm.id = r.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
       where r.clock_out_at is null and r.voided_at is null
         and r.clock_in_at > p_at - interval '36 hours'
         and s.status <> 'cancelled'
         and s.published_at is not null
         and a.status in ('assigned', 'confirmed')
         and public.shift_ends_at(s.date, s.start_time, s.end_time) + interval '20 minutes' <= v_now
         and v_now < public.shift_ends_at(s.date, s.start_time, s.end_time) + interval '12 hours'
         and m.status = 'active' and m.user_id is not null
         and not exists (select 1 from public.shift_clock_corrections k
                          where k.clock_record_id = r.id and k.corrected_out_at is not null)
    ), unplanned_out as (
      -- Fuori turno aperto da 10 a 16 ore.
      select 'unplanned_out'::text, r.id, (r.clock_in_at at time zone 'Europe/Rome'),
             m.user_id, m.workspace_id, null::uuid,
             'Sei ancora in servizio?'::text,
             v.name || ': hai timbrato fuori turno alle '
               || to_char(r.clock_in_at at time zone 'Europe/Rome', 'HH24:MI')
               || ' e l''entrata è ancora aperta. Se hai finito, timbra l''uscita.'
        from public.shift_clock_records r
        join public.venues v on v.id = r.venue_id
        join public.venue_members vm on vm.id = r.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
       where r.shift_id is null and r.clock_out_at is null and r.voided_at is null
         and r.clock_in_at > p_at - interval '16 hours'
         and r.clock_in_at <= p_at - interval '10 hours'
         and m.status = 'active' and m.user_id is not null
    ), candidates as (
      select * from entry
      union all select * from planned_out
      union all select * from unplanned_out
    ), operational as (
      -- Una volta per azienda: come `assert_workspace_operational`, senza
      -- sollevare. In archivio o in sola lettura non si timbra.
      select w.workspace_id
        from (select distinct workspace_id from candidates) w
        cross join lateral (select private.workspace_access_at(w.workspace_id, p_at) as a) x
       where x.a ->> 'state' = 'migration_pending'
          or coalesce((x.a ->> 'can_operate')::boolean, false)
    )
    select cd.* from candidates cd
      join operational o on o.workspace_id = cd.workspace_id
      join public.profiles p on p.id = cd.user_id
     where (p.notification_prefs ->> 'reminders') is distinct from 'false'
  loop
    insert into private.clock_reminders (subject_id, kind, due_at, user_id)
    values (c.subject_id, c.kind, c.due_at, c.user_id)
    on conflict do nothing;
    if found then
      perform private.notify(c.user_id, 'clock_reminder', c.title, c.body, c.related_id);
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$function$;


CREATE OR REPLACE FUNCTION private.absence_credit_conflict(p_member uuid, p_date date)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select exists (
    select 1 from public.shift_assignments sa
    join public.shifts s on s.id = sa.shift_id
    join public.venue_members vm on vm.id = sa.venue_member_id
    join public.venues v on v.id = s.venue_id
    left join public.shift_clock_records r on r.assignment_id = sa.id and r.voided_at is null
    left join lateral private.clock_record_times(r.id) t on true
    where vm.member_id = p_member and s.status <> 'cancelled'
      and s.published_at is not null
      and sa.status not in ('declined', 'no_show')
      and ((sa.worked_hours > 0 and sa.hours_source = 'manual' and
            (s.date = p_date or (s.end_time <= s.start_time and s.date + 1 = p_date)))
        or (sa.worked_hours is null and r.id is null and
          (sa.hours_source = 'manual_auto' or
            (sa.hours_source is null and coalesce(vm.clock_method, v.clock_method) = 'manual'))
          and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
          and private.definitive_manual_hours(sa.id, null) > 0
          and (s.date = p_date or (s.end_time <= s.start_time and s.date + 1 = p_date)))
        or (sa.worked_hours > 0 and r.id is not null and sa.attendance_reviewed_at is not null
          and t.clock_out_at is not null
          and t.clock_in_at < ((p_date + 1)::timestamp at time zone 'Europe/Rome')
          and t.clock_out_at > (p_date::timestamp at time zone 'Europe/Rome')))
  );
$function$;


CREATE OR REPLACE FUNCTION private.notification_person(p_recipient uuid, p_type notification_type, p_related uuid, p_actor uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_person uuid;
  v_candidates uuid[];
begin
  if p_type in ('staff_linked', 'staff_response') then
    select m.id into v_person from public.workspace_members m where m.id = p_related;
    return v_person;
  end if;

  if p_type in ('new_message', 'absence_request', 'absence_sick', 'shift_change_request')
     and p_related is not null then
    -- Per queste categorie il riferimento è la conversazione: la stessa
    -- controparte che si vede aprendo il thread, anche nelle notifiche storiche.
    select m.id into v_person
      from public.conversations c
      join public.workspace_members m on m.workspace_id = c.workspace_id
       and m.user_id = case when c.user_a = p_recipient then c.user_b else c.user_a end
     where c.id = p_related and p_recipient in (c.user_a, c.user_b);
    return v_person;
  end if;

  if p_actor is null then return null; end if;

  if p_type in ('absence_request', 'absence_sick', 'shift_change_request') then
    -- I collaboratori non ricevono un riferimento al thread del titolare.
    -- L'attore è certo nella nuova notifica; se condivide più aziende gestite
    -- dal destinatario, non si indovina quale scheda raffigurare.
    select array_agg(m.id) into v_candidates
      from public.workspace_members m
     where m.user_id = p_actor
       and p_recipient in (select private.member_managers(
         m.id, case when p_type = 'shift_change_request' then 'shifts' else 'staff' end
       ));
    if cardinality(v_candidates) = 1 then return v_candidates[1]; end if;
  elsif p_type in ('shift_declined', 'shift_reconfirmed') then
    -- Solo la persona che ha risposto: un gestore che modifica una risposta
    -- non deve apparire come il professionista nominato dalla notifica.
    select m.id into v_person
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
     where a.shift_id = p_related
       and s.published_at is not null
       and a.status = case when p_type = 'shift_declined'
                           then 'declined'::public.assignment_status
                           else 'confirmed'::public.assignment_status end
       and m.user_id = p_actor
     limit 1;
    return v_person;
  end if;
  return null;
end;
$function$;


-- Il fuori turno si rifiuta se c'è un turno da timbrare adesso: una bozza non
-- conta, altrimenti il dipendente si sentirebbe dire di timbrare un turno che
-- non vede.
CREATE OR REPLACE FUNCTION public.clock_punch_unplanned(p_venue_member uuid, p_action text, p_role uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS shift_clock_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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

    -- C'è un turno da timbrare: si timbra quello. Una bozza no: non la vede.
    if exists (
      select 1
        from public.shift_assignments a
        join public.shifts s on s.id = a.shift_id
       where a.venue_member_id = r.id
         and s.status <> 'cancelled'
         and s.published_at is not null
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
$function$;


-- ---------------------------------------------------------------------------
-- Ore. Una bozza non produce ore: il punto in cui un'assegnazione «conta»
-- risponde 0, e una bozza non toglie ore a un turno vero che si sovrappone.
-- Poi ogni riepilogo che conta o filtra per conto suo esclude le bozze dalle
-- righe di partenza. `get_hours_to_fix` e `shifts_count` partono dallo stesso
-- insieme di righe, quindi restano l'uno il complemento dell'altro (test 037);
-- la bozza scaduta non è un'ora da sistemare ma un turno mai uscito.
-- `clock_record_is_regular` resta com'è (gemello di `isRegularPendingClock`):
-- il filtro sta in chi lo usa.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION private.effective_assignment_hours(p_assignment uuid, p_venues uuid[] DEFAULT NULL::uuid[])
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with target as (
    select a.id, a.status, a.worked_hours, vm.member_id,
           s.status as shift_status, s.published_at,
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
       and s.published_at is not null
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
    when t.published_at is null then 0
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
$function$;


CREATE OR REPLACE FUNCTION private.definitive_manual_hours(p_assignment uuid, p_venues uuid[] DEFAULT NULL::uuid[])
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with target as (
    select a.id, a.status, a.worked_hours, vm.member_id,
           s.status as shift_status, s.published_at,
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
       and s.published_at is not null
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
    when t.published_at is null then 0
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
$function$;


CREATE OR REPLACE FUNCTION public.get_hours_summary(p_from date, p_to date)
 RETURNS TABLE(member_id uuid, member_name text, venue_id uuid, venue_name text, venue_closed boolean, roles text, shifts_count integer, hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(pg_catalog.array_agg(allowed.venue_id), '{}'::uuid[]) as venue_ids
      from private.venues_where('hours') as allowed(venue_id)
  ), per_venue as (
    select m.id as member_id, m.display_name as member_name,
           v.id as venue_id, v.name as venue_name, v.closed_at as venue_closed_at,
           vm.id as venue_member_id,
           count(*)::integer as shifts_count,
           sum(private.effective_assignment_hours(a.id, scope.venue_ids)) as hours
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      cross join scope
     where s.venue_id in (select private.commercial_readable_venue_ids()) and s.venue_id = any (scope.venue_ids)
       and s.status <> 'cancelled'
       and s.published_at is not null
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
     group by m.id, m.display_name, v.id, v.name, v.closed_at, vm.id
  )
  select r.member_id, r.member_name, r.venue_id, r.venue_name, r.venue_closed_at is not null,
         (select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
            from public.venue_member_roles x join public.venue_roles vr on vr.id = x.role_id
           where x.venue_member_id = r.venue_member_id and vr.archived_at is null),
         r.shifts_count, r.hours
    from per_venue r
   order by sum(r.hours) over (partition by r.member_id) desc, r.member_name, r.venue_name;
$function$;


CREATE OR REPLACE FUNCTION public.get_workspace_hours_summary(p_workspace uuid, p_from date, p_to date)
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
       and s.published_at is not null
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
$function$;


CREATE OR REPLACE FUNCTION public.get_hours_to_fix(p_workspace uuid, p_from date, p_to date)
 RETURNS TABLE(assignment_id uuid, shift_id uuid, date date, start_time time without time zone, end_time time without time zone, title text, venue_id uuid, venue_name text, member_id uuid, member_name text, kind text, hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(array_agg(v.id), '{}'::uuid[]) as venue_ids from public.venues v
    where v.workspace_id in (select private.commercial_readable_workspace_ids())
      and v.workspace_id = p_workspace and v.id in (select private.venues_where('hours'))
  ), rows as (
    select a.id, a.worked_hours, a.hours_source, a.attendance_reviewed_at,
           s.id as shift_id, s.date, s.start_time, s.end_time, s.title,
           s.break_minutes, s.break_paid,
           v.id as venue_id, v.name as venue_name,
           coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
           vm.member_id, m.display_name,
           r.id as clock_record_id, t.clock_out_at
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.workspace_members m on m.id = vm.member_id
      cross join scope
      left join public.shift_clock_records r on r.assignment_id = a.id and r.voided_at is null
      left join lateral private.clock_record_times(r.id) t on true
     where s.venue_id = any(scope.venue_ids) and s.status <> 'cancelled'
       and s.published_at is not null
       and s.date >= p_from and s.date < p_to
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
       and a.status not in ('declined', 'no_show')
  )
  select r.id, r.shift_id, r.date, r.start_time, r.end_time, r.title,
         r.venue_id, r.venue_name, r.member_id, r.display_name,
         case
           when r.clock_record_id is not null and r.clock_out_at is null then 'missing_out'
           when r.clock_record_id is not null then 'to_approve'
           else 'not_clocked'
         end,
         case
           when r.clock_record_id is not null and r.clock_out_at is not null
             then private.clock_record_counted_hours(r.clock_record_id)
           else public.shift_counted_hours(r.start_time, r.end_time, r.break_minutes, r.break_paid)
         end
    from rows r
   -- Il complemento della condizione «conta» del riepilogo (`shifts_count`).
   -- `is not true` e non `not`: con `hours_source` nullo la condizione vale
   -- NULL, che il `filter` del riepilogo legge come «non conta» e un `not`
   -- lascerebbe NULL, cioè fuori anche da qui.
   where (
     (r.worked_hours is not null and
       (r.hours_source = 'manual' or (r.clock_record_id is not null
         and r.attendance_reviewed_at is not null and r.clock_out_at is not null)))
     or (r.worked_hours is null and r.clock_record_id is null and
       (r.hours_source = 'manual_auto' or
         (r.hours_source is null and r.effective_clock_method = 'manual')))
   ) is not true
   order by r.date, r.start_time, r.display_name;
$function$;


CREATE OR REPLACE FUNCTION public.get_member_performance(p_member uuid)
 RETURNS TABLE(past_total integer, worked_count integer, no_show_count integer, declined_count integer, total_hours numeric, month_shifts integer, month_hours numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(pg_catalog.array_agg(allowed.venue_id), '{}'::uuid[]) as venue_ids
      from private.venues_where('hours') as allowed(venue_id)
  ), past as (
    select a.status, private.effective_assignment_hours(a.id, scope.venue_ids) as hours,
           s.date
      from public.shift_assignments a
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.shifts s on s.id = a.shift_id
      cross join scope
     where s.venue_id in (select private.commercial_readable_venue_ids()) and vm.member_id = p_member
       and s.venue_id = any (scope.venue_ids)
       and s.status <> 'cancelled'
       and s.published_at is not null
       and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
  )
  select count(*)::integer,
    count(*) filter (where status not in ('declined', 'no_show'))::integer,
    count(*) filter (where status = 'no_show')::integer,
    count(*) filter (where status = 'declined')::integer,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')), 0),
    count(*) filter (where status not in ('declined', 'no_show')
                       and date >= date_trunc('month', public.local_now())::date)::integer,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')
                                  and date >= date_trunc('month', public.local_now())::date), 0)
    from past;
$function$;


CREATE OR REPLACE FUNCTION public.get_member_worked_shifts(p_member uuid, p_limit integer DEFAULT 6)
 RETURNS TABLE(id uuid, status assignment_status, worked_hours numeric, shift_id uuid, title text, date date, start_time time without time zone, end_time time without time zone, hours numeric, venue_id uuid, venue_name text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with scope as (
    select coalesce(pg_catalog.array_agg(allowed.venue_id), '{}'::uuid[]) as venue_ids
      from private.venues_where('hours') as allowed(venue_id)
  )
  select a.id, a.status, a.worked_hours, s.id, s.title, s.date, s.start_time, s.end_time,
         private.effective_assignment_hours(a.id, scope.venue_ids), v.id, v.name
    from public.shift_assignments a
    join public.venue_members vm on vm.id = a.venue_member_id
    join public.shifts s on s.id = a.shift_id
    join public.venues v on v.id = s.venue_id
    cross join scope
   where s.venue_id in (select private.commercial_readable_venue_ids()) and vm.member_id = p_member
     and v.id = any (scope.venue_ids)
     and s.status <> 'cancelled'
     and s.published_at is not null
     and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
     and a.status not in ('declined', 'no_show')
   order by s.date desc, s.start_time desc
   limit greatest(p_limit, 0);
$function$;


CREATE OR REPLACE FUNCTION public.approve_regular_clock_records(p_workspace uuid, p_from date, p_to date, p_dry_run boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_ids uuid[];
  v_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Lo stesso limite del periodo libero della pagina Ore (MAX_RANGE_DAYS).
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 366 then
    raise exception 'invalid_period' using errcode = '22023';
  end if;
  select coalesce(array_agg(a.id order by s.date, s.start_time, a.id), '{}') into v_ids
    from public.shift_clock_records r
    join public.shift_assignments a on a.id = r.assignment_id
    join public.shifts s on s.id = r.shift_id
    join public.venues v on v.id = r.venue_id
    join public.venue_members vm on vm.id = a.venue_member_id
   where v.workspace_id = p_workspace
     and s.date between p_from and p_to
     and s.published_at is not null
     and r.voided_at is null
     and a.attendance_reviewed_at is null
     and private.can(v.id, 'hours')
     and not private.is_restricted_self(vm.member_id)
     and private.clock_record_is_regular(r.id);
  if p_dry_run then return coalesce(array_length(v_ids, 1), 0); end if;
  foreach v_id in array v_ids loop
    perform public.approve_clock_record(v_id);
  end loop;
  return coalesce(array_length(v_ids, 1), 0);
end;
$function$;


CREATE OR REPLACE FUNCTION private.auto_approve_clock()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.shift_id is null then return new; end if;
  if exists (select 1 from public.shifts s where s.id = new.shift_id and s.published_at is null) then
    return new;
  end if;
  if not exists (select 1 from public.venues v where v.id = new.venue_id and v.clock_auto_approve) then
    return new;
  end if;
  if exists (select 1 from public.venue_members vm
               join public.workspace_members m on m.id = vm.member_id
              where vm.id = new.venue_member_id and m.authority = 'collaborator') then
    return new;
  end if;
  if not private.clock_record_is_regular(new.id) then return new; end if;
  update public.shift_assignments x set
    worked_hours = private.clock_record_counted_hours(new.id),
    hours_source = 'clock',
    attendance_reviewed_at = now(),
    attendance_reviewed_by = null,
    attendance_auto_approved = true
  where x.id = new.assignment_id and x.attendance_reviewed_at is null;
  return new;
end;
$function$;


-- ---------------------------------------------------------------------------
-- Rifiuti `shift_draft`: timbrare, rispondere, chiedere un cambio, presenze e
-- timbrature di chi gestisce, sostituto, stato del turno. Il controllo viene
-- dopo quello sui permessi, così chi non può toccare il turno sente sempre
-- `not_allowed`. `respond_assignment` ha una firma sola nel banco.
-- ---------------------------------------------------------------------------

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
         s.date, s.start_time, s.end_time, s.status as shift_status, s.published_at,
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
  if a.published_at is null then
    raise exception 'shift_draft' using errcode = '23514';
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
$function$;


CREATE OR REPLACE FUNCTION public.respond_assignment(p_assignment uuid, p_status assignment_status, p_reason text DEFAULT NULL::text)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a     record;
  v_row public.shift_assignments;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  if p_status not in ('confirmed', 'declined') then
    raise exception 'invalid_status' using errcode = '23514';
  end if;
  select x.id, x.shift_id, m.user_id, s.status as shift_status, s.published_at into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = x.shift_id
   where x.id = p_assignment;
  if a.id is null or a.user_id is distinct from (select auth.uid()) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.published_at is null then
    raise exception 'shift_draft' using errcode = '23514';
  end if;
  if a.shift_status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if private.shift_is_over(a.shift_id) then
    raise exception 'shift_finished' using errcode = '23514';
  end if;

  update public.shift_assignments
     set status = p_status,
         confirmed_at = case when p_status = 'confirmed' then now() else null end,
         decline_reason = case when p_status = 'declined'
                               then nullif(btrim(left(p_reason, 300)), '') end
   where id = p_assignment
  returning * into v_row;
  return v_row;
end;
$function$;


CREATE OR REPLACE FUNCTION public.request_shift_change(p_assignment uuid, p_reason text, p_kind change_request_kind DEFAULT 'substitution'::change_request_kind, p_start time without time zone DEFAULT NULL::time without time zone, p_end time without time zone DEFAULT NULL::time without time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_me      uuid := (select auth.uid());
  a         record;
  v_owner   uuid;
  v_conv    uuid;
  v_request uuid;
  v_label   text;
  v_user    uuid;
  v_body    text;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shift_assignments x join public.venues v on v.id=x.venue_id where x.id=p_assignment));
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'Scrivi il motivo della richiesta';
  end if;
  if p_kind = 'hours' and (p_start is null or p_end is null) then
    raise exception 'Indica il nuovo orario';
  end if;
  if p_kind = 'hours' and p_start = p_end then
    raise exception 'L''orario di fine non può essere uguale a quello di inizio';
  end if;

  select m.user_id as who, s.id as shift_id, s.date, s.venue_id, ve.workspace_id, x.status,
         s.published_at,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as over
    into a
    from public.shift_assignments x
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.workspace_members m on m.id = vm.member_id
    join public.shifts s on s.id = x.shift_id
    join public.venues ve on ve.id = s.venue_id
   where x.id = p_assignment;
  if a.shift_id is null then
    raise exception 'Assegnazione non trovata';
  end if;
  if a.who is distinct from v_me then
    raise exception 'Non è il tuo turno';
  end if;
  if a.published_at is null then
    raise exception 'shift_draft' using errcode = '23514';
  end if;
  if a.over then
    raise exception 'Il turno è già concluso';
  end if;
  if a.status not in ('assigned', 'confirmed') then
    raise exception 'Questo turno non è più tuo';
  end if;
  -- Una aperta per volta, di qualunque tipo: due card pendenti sullo stesso turno
  -- sono solo un modo per rispondere a una e dimenticare l'altra.
  if exists (
    select 1 from public.shift_change_requests r where r.assignment_id = p_assignment and r.status = 'pending'
  ) then
    raise exception 'Hai già una richiesta aperta su questo turno';
  end if;

  insert into public.shift_change_requests (
    assignment_id, shift_id, shift_date, requested_by, reason, kind, proposed_start_time, proposed_end_time
  ) values (
    p_assignment, a.shift_id, a.date, v_me, btrim(p_reason), p_kind,
    case when p_kind = 'hours' then p_start end, case when p_kind = 'hours' then p_end end
  ) returning id into v_request;

  v_owner := private.workspace_primary_owner(a.workspace_id);
  if v_owner is not null and v_owner <> v_me then
    v_conv := private.conversation_for_pair(a.workspace_id, v_me, v_owner, a.shift_id);
    v_label := case when p_kind = 'hours'
                    then 'Orario diverso (' || to_char(p_start, 'HH24:MI') || '–' || to_char(p_end, 'HH24:MI') || '): '
                    else '' end;
    insert into public.messages (conversation_id, sender_id, content, kind, request_id)
    values (v_conv, v_me, v_label || btrim(p_reason), 'shift_change_request', v_request);
  end if;

  v_body := coalesce(private.member_name(a.workspace_id, v_me), 'Un dipendente')
    || case when p_kind = 'hours' then ' chiede un altro orario il ' else ' chiede di essere sostituito il ' end
    || to_char(a.date, 'DD/MM');
  for v_user in select distinct private.managers_of(a.venue_id, 'shifts') loop
    perform private.notify(
      v_user, 'shift_change_request',
      case when p_kind = 'hours' then 'Richiesta di cambio orario' else 'Richiesta di cambio turno' end,
      v_body, case when v_user = v_owner then v_conv end
    );
  end loop;
  return v_request;
end;
$function$;


CREATE OR REPLACE FUNCTION public.record_attendance(p_assignment uuid, p_patch jsonb)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  a        record;
  v_row    public.shift_assignments;
  v_status public.assignment_status;
  v_manual boolean;
  v_source text;
begin
  if p_patch is null or jsonb_typeof(p_patch) is distinct from 'object' then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  if not (p_patch ?| array['status', 'worked_hours'])
     or exists (select 1 from jsonb_object_keys(p_patch) as key
                 where not (key = any (array['status', 'worked_hours']))) then
    raise exception 'invalid_patch' using errcode = '22023';
  end if;
  perform private.assert_attendance_access(p_assignment);
  select x.id, x.venue_id, x.status, x.confirmed_at, vm.member_id,
         x.worked_hours, x.hours_source, s.published_at,
         coalesce(vm.clock_method, v.clock_method) as effective_clock_method,
         public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as concluded
    into a
    from public.shift_assignments x
    join public.shifts s on s.id = x.shift_id
    join public.venue_members vm on vm.id = x.venue_member_id
    join public.venues v on v.id = x.venue_id
   where x.id = p_assignment
   for update of x;
  if a.id is null or private.is_restricted_self(a.member_id) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if p_patch ? 'status' then
    if not private.can(a.venue_id, 'shifts') then
      raise exception 'not_allowed' using errcode = '42501';
    end if;
    v_status := (p_patch ->> 'status')::public.assignment_status;
  end if;
  if p_patch ? 'worked_hours' and not private.can(a.venue_id, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  if a.published_at is null then
    raise exception 'shift_draft' using errcode = '23514';
  end if;

  v_source := a.hours_source;
  if p_patch ? 'worked_hours' then
    v_manual := case
      when a.hours_source in ('manual', 'manual_auto') then true
      when a.hours_source in ('clock', 'clock_expected') then false
      when a.worked_hours is not null then false
      else a.effective_clock_method = 'manual'
    end;
    v_source := case
      when p_patch ->> 'worked_hours' is not null then
        case when v_manual then 'manual' else null end
      when a.concluded then
        case when v_manual then 'manual_auto' else 'clock_expected' end
      else null
    end;
  end if;

  update public.shift_assignments x set
    status = coalesce(v_status, x.status),
    confirmed_at = case
      when v_status is null then x.confirmed_at
      when v_status in ('assigned', 'declined') then null
      else x.confirmed_at
    end,
    worked_hours = case when p_patch ? 'worked_hours'
      then (p_patch ->> 'worked_hours')::numeric else x.worked_hours end,
    hours_source = v_source,
    attendance_reviewed_at = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_at end,
    attendance_reviewed_by = case when p_patch ? 'worked_hours'
      then null else x.attendance_reviewed_by end
   where x.id = p_assignment
  returning * into v_row;
  return v_row;
end;
$function$;


CREATE OR REPLACE FUNCTION public.enter_clock_record(p_assignment uuid, p_in timestamp with time zone, p_out timestamp with time zone, p_reason text)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  perform private.assert_shift_published(a.shift_id);
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
$function$;


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
  perform private.assert_shift_published(r.shift_id);
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
$function$;


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
  select x.id, x.shift_id, x.venue_id, x.status, vm.member_id, r.id as record_id
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
  perform private.assert_shift_published(a.shift_id);
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
$function$;


CREATE OR REPLACE FUNCTION public.add_shift_worker(p_shift uuid, p_venue_member uuid, p_role uuid DEFAULT NULL::uuid)
 RETURNS shift_assignments
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  s        record;
  v_member uuid;
  v_ex     public.shift_assignments;
  v_row    public.shift_assignments;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select x.id, x.venue_id, x.status, x.unplanned, x.published_at into s
    from public.shifts x where x.id = p_shift for update;
  if s.id is null or not private.can(s.venue_id, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Una bozza scaduta si registra come fatta (persone comprese), non si completa.
  if s.published_at is null then
    raise exception 'shift_draft' using errcode = '23514';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(s.venue_id));
  if s.status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if s.unplanned then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  -- Prima della fine si pianifica: lì valgono notifiche e conferme.
  if not private.shift_is_over(p_shift) then
    raise exception 'shift_not_finished' using errcode = '23514';
  end if;

  -- In organico in QUELLA sede, e attivo (come `assign_one`).
  select vm.member_id into v_member
    from public.venue_members vm
    join public.workspace_members m on m.id = vm.member_id
   where vm.id = p_venue_member and vm.venue_id = s.venue_id
     and vm.left_at is null and m.status = 'active';
  if v_member is null then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;
  if private.is_restricted_self(v_member) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_role_in_venue(p_role, s.venue_id);

  select * into v_ex from public.shift_assignments
   where shift_id = p_shift and venue_member_id = p_venue_member
   for update;
  if v_ex.id is not null then
    if v_ex.status <> 'declined' then
      raise exception 'already_assigned' using errcode = '23505';
    end if;
    -- Aveva rifiutato ed è venuto lo stesso: torna presente, con le ore del
    -- turno come chi viene aggiunto adesso.
    update public.shift_assignments set
      status = 'confirmed',
      confirmed_at = now(),
      role_id = coalesce(p_role, role_id),
      worked_hours = null,
      hours_source = 'manual_auto',
      attendance_reviewed_at = null,
      attendance_reviewed_by = null
    where id = v_ex.id
    returning * into v_row;
    return v_row;
  end if;

  -- Le notifiche delle assegnazioni tacciono come per il fuori turno.
  perform set_config('app.unplanned_clock', '1', true);
  insert into public.shift_assignments (
    shift_id, venue_id, venue_member_id, role_id, status, confirmed_at, hours_source
  ) values (
    p_shift, s.venue_id, p_venue_member, p_role, 'confirmed', now(), 'manual_auto'
  ) returning * into v_row;
  perform set_config('app.unplanned_clock', '', true);
  return v_row;
end;
$function$;


CREATE OR REPLACE FUNCTION public.set_shift_status(p_shift uuid, p_status shift_status)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
  v_unplanned boolean;
  v_draft boolean;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  select s.venue_id, s.unplanned, s.published_at is null into v_venue, v_unplanned, v_draft
    from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Annullare una bozza non ha senso: nessuno l'ha vista, si elimina.
  if v_draft then
    raise exception 'shift_draft' using errcode = '23514';
  end if;
  -- Annullarlo toglierebbe in silenzio la timbratura dal riepilogo: la strada è
  -- annullare la timbratura (`void_clock_record`), che elimina anche il turno.
  if v_unplanned then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  update public.shifts set status = p_status where id = p_shift;
end;
$function$;


-- `delete_shift`: `finished_shift_locked` vale solo per i turni pubblicati.
CREATE OR REPLACE FUNCTION public.delete_shift(p_shift uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_venue uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  select s.venue_id into v_venue from public.shifts s where s.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'shifts') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  -- Il blocco protegge le ore di un turno uscito; una bozza scaduta non ne ha
  -- (non è mai uscita) e per lei «Elimina» è una delle due strade.
  if private.shift_is_over(p_shift)
     and exists (select 1 from public.shifts s where s.id = p_shift and s.published_at is not null)
     and exists (select 1 from public.shift_assignments a where a.shift_id = p_shift) then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;
  delete from public.shifts where id = p_shift;
end;
$function$;


-- Export completo (GDPR): le bozze ci sono, con il loro stato.
CREATE OR REPLACE FUNCTION public.export_workspace_data(p_workspace uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  me public.workspace_members;
  w public.workspaces;
  v_docs boolean;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  select * into me from public.workspace_members
   where workspace_id = p_workspace and user_id = (select auth.uid()) and status = 'active';
  if not found or not (me.authority = 'owner' or (me.authority = 'collaborator'
       and me.can_staff and me.can_hours and me.scope = 'all')) then
    raise exception 'export_not_allowed' using errcode = '42501';
  end if;
  select * into w from public.workspaces where id = p_workspace;
  if w.data_deleted_at is not null
     or coalesce((private.workspace_access_at(p_workspace, now()) ->> 'can_read')::boolean, false) is not true then
    raise exception 'workspace_not_readable' using errcode = '42501';
  end if;
  v_docs := me.authority = 'owner' or me.can_documents;

  return jsonb_build_object(
    'generated_at', now(),
    'workspace', jsonb_build_object('id', w.id, 'name', w.name, 'created_at', w.created_at),
    'documents_included', v_docs,
    'venues', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', v.name, 'address', v.address, 'city', v.city,
        'created_at', v.created_at, 'closed_at', v.closed_at) order by v.created_at, v.id), '[]'::jsonb)
      from public.venues v where v.workspace_id = p_workspace),
    'people', (select coalesce(jsonb_agg(jsonb_build_object(
        'name', m.display_name, 'email', m.email, 'phone', m.phone,
        'authority', m.authority, 'status', m.status, 'joined_at', m.created_at, 'left_at', m.left_at,
        'contract_hours', hr.contract_hours, 'contract_period', hr.contract_period, 'hr_note', hr.note,
        'venues', (select coalesce(jsonb_agg(jsonb_build_object(
              'venue', v.name, 'employment_type', vm.employment_type, 'left_at', vm.left_at,
              'roles', (select coalesce(string_agg(r.name, ', ' order by r.sort_order, r.name), '')
                          from public.venue_member_roles vr join public.venue_roles r on r.id = vr.role_id
                         where vr.venue_member_id = vm.id))
              order by v.created_at, v.id), '[]'::jsonb)
            from public.venue_members vm join public.venues v on v.id = vm.venue_id
           where vm.member_id = m.id))
        order by m.display_name, m.id), '[]'::jsonb)
      from public.workspace_members m left join public.member_hr hr on hr.member_id = m.id
     where m.workspace_id = p_workspace),
    'shifts', (select coalesce(jsonb_agg(jsonb_build_object(
        'date', s.date, 'venue', v.name, 'title', s.title, 'start_time', s.start_time, 'end_time', s.end_time,
        'break_minutes', s.break_minutes, 'break_paid', s.break_paid, 'status', s.status,
        'unplanned', s.unplanned, 'positions_total', s.positions_total, 'description', s.description,
        'published_at', s.published_at)
        order by s.date, s.start_time, v.name, s.id), '[]'::jsonb)
      from public.shifts s join public.venues v on v.id = s.venue_id where v.workspace_id = p_workspace),
    'attendance', (select coalesce(jsonb_agg(x order by x ->> 'date', x ->> 'start_time', x ->> 'person'), '[]'::jsonb) from (
      select jsonb_build_object(
        'date', s.date, 'venue', v.name, 'shift', s.title, 'start_time', s.start_time, 'end_time', s.end_time,
        'person', m.display_name, 'role', r.name, 'status', a.status, 'confirmed_at', a.confirmed_at,
        'clock_method', c.method,
        'clock_in_at', coalesce(k.corrected_in_at, c.clock_in_at),
        'clock_out_at', coalesce(k.corrected_out_at, c.clock_out_at),
        'clock_break_minutes', case when c.id is not null
          then (select b.minutes from private.clock_record_break(c.id) b) end,
        'corrected', k.clock_record_id is not null, 'correction_reason', k.reason,
        'worked_hours', a.worked_hours, 'hours_source', a.hours_source,
        'reviewed_at', a.attendance_reviewed_at, 'auto_approved', a.attendance_auto_approved) as x
        from public.shift_assignments a
        join public.shifts s on s.id = a.shift_id
        join public.venues v on v.id = s.venue_id
        join public.venue_members vm on vm.id = a.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
        left join public.venue_roles r on r.id = a.role_id
        left join lateral (select * from public.shift_clock_records c
                            where c.assignment_id = a.id and c.voided_at is null
                            order by c.clock_in_at desc limit 1) c on true
        left join lateral (select * from public.shift_clock_corrections k
                            where k.clock_record_id = c.id order by k.created_at desc limit 1) k on true
       where v.workspace_id = p_workspace) t),
    'absences', (select coalesce(jsonb_agg(jsonb_build_object(
        'person', m.display_name, 'kind', ab.kind, 'start_date', ab.start_date, 'end_date', ab.end_date,
        'start_time', ab.start_time, 'end_time', ab.end_time, 'status', ab.status,
        'recognized_minutes', (select coalesce(sum(h.minutes), 0) from public.absence_hour_credits h
                                where h.absence_id = ab.id),
        'inps_protocol', ab.inps_protocol, 'note', ab.note, 'resolution_note', ab.resolution_note,
        'created_at', ab.created_at)
        order by ab.start_date, m.display_name, ab.id), '[]'::jsonb)
      from public.staff_absences ab join public.workspace_members m on m.id = ab.member_id
     where m.workspace_id = p_workspace),
    'documents', case when v_docs then (select coalesce(jsonb_agg(jsonb_build_object(
        'person', m.display_name, 'name', d.name, 'mime_type', d.mime_type, 'size_bytes', d.size_bytes,
        'expires_at', d.expires_at, 'created_at', d.created_at, 'storage_path', d.storage_path)
        order by m.display_name, d.created_at, d.id), '[]'::jsonb)
      from public.staff_documents d join public.workspace_members m on m.id = d.member_id
     where m.workspace_id = p_workspace) else null end
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Restano come sono (dall'elenco del banco), e perché.
--
-- Già sistemate da 20261103000000_shift_drafts.sql:
--   public.create_shifts, public.move_assignment, public.notify_on_assignment,
--   private.draft_shift_ids.
-- Scritture che non avvisano da sé: l'avviso è dei trigger qui sopra, che su
-- una bozza tacciono.
--   private.assign_one, public.unassign, public.reassign, public.update_shift,
--   public.set_assignment_role, public.venue_members_release_shifts (toglie
--   anche le bozze future di chi esce, in silenzio), public.delete_account
--   (annulla anche le bozze future: `notify_on_shift_change` tace).
-- Stato iniziale e integrità:
--   public.default_assignment_confirmation, public.shift_assignments_lock_identity,
--   public.sync_positions_filled, public.guard_finished_shift_times (cambiare
--   orari nel passato chiede «Ore» anche su una bozza, va bene così).
-- Controlli di permesso e di finestra commerciale, il controllo sulla bozza è
-- in chi li chiama:
--   private.assert_attendance_access, private.assert_can_touch_assignment,
--   private.assert_clock_completion, private.assert_clock_rectification,
--   private.shift_is_over.
-- Insiemi per la RLS (le bozze le nasconde la policy restrittiva):
--   private.commercial_readable_shift_ids, private.shift_ids_where,
--   private.my_shift_ids.
-- Viste di gestione, che le bozze le mostrano a chi ha «roster»:
--   private.owner_past_shift_matches (filtra già `venues_where('roster')`),
--   public.get_owner_past_shifts_count, public.get_owner_past_shifts_page.
-- Su `my_work_history`, nessuna lettura propria dei turni:
--   public.get_my_work_history_page, public.get_my_work_history_range,
--   public.get_my_work_history_totals, public.get_my_work_totals.
-- Timbrature: su una bozza non ne nascono più (`clock_punch` ed
-- `enter_clock_record` rifiutano), e il fuori turno nasce pubblicato.
--   private.clock_record_break, private.clock_record_counted_hours,
--   private.clock_record_is_regular (gemello di `isRegularPendingClock`: il
--   filtro sta in `approve_regular_clock_records` e `auto_approve_clock`),
--   private.materialize_unplanned_clock, public.close_unplanned_clock,
--   public.correct_clock_break, public.void_clock_record (annullare non
--   produce ore).
-- Cambi turno: su una bozza non nascono (`request_shift_change` rifiuta).
--   public.resolve_shift_change_request, public.withdraw_shift_change_request.
-- Il passato registrato nasce pubblicato (default `now()`):
--   public.record_past_shift.
-- Impostazioni della sede: aggiornano anche le bozze, senza effetti per il
-- team (le ore delle bozze non contano comunque).
--   public.set_member_clock_method, public.set_venue_clock_method,
--   public.set_venue_break_policy.
-- Dati e amministrazione: una bozza è un dato dell'azienda e un segno di
-- attività.
--   private.workspace_data_inventory, public.admin_get_workspace,
--   public.admin_list_activation.
-- ---------------------------------------------------------------------------


