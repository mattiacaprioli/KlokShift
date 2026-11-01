-- Turni in bozza e pubblicazione (parte 3): anteprima, pubblicazione,
-- «Conferma tutti» del dipendente e «Registra come fatto» per la bozza scaduta.
--
--   get_publish_preview(sedi, dal, al)  cosa pubblicherebbe «Pubblica»: le bozze
--       non finite del periodo nelle sedi (null = tutte) dove chi chiama ha
--       «Turni», chi verrà avvisato, quante restano fuori periodo e quante sono
--       scadute. Lo calcola il server, perché il dialogo non prometta avvisi
--       sbagliati.
--   publish_shifts(turni, avvisa)       pubblica, atomico e idempotente (le
--       righe già pubblicate o finite si saltano), con UNA notifica
--       `shift_published` per persona e per azienda; `notified` è il numero di
--       notifiche create.
--   confirm_my_assignments(assegnazioni) «Conferma tutti»: passa da
--       respond_assignment, quindi stesse regole e stessi trigger della conferma
--       singola.
--   record_draft_as_done(turno)         una bozza mai pubblicata e finita
--       diventa lavoro registrato, come `record_past_shift`: serve «Ore», le
--       persone risultano presenti con le ore del turno, nessuna notifica.
--       Eccezione: chi in quelle ore ha una timbratura (la bozza non blocca il
--       fuori turno) resta presente ma da verificare fra le «Ore da sistemare»,
--       perché lo stesso tempo non si conti due volte.
--   private.assignment_clock_overlap(assegnazione)  la regola di quell'eccezione,
--       condivisa con get_hours_to_fix, che per quelle righe dice
--       `clock_overlap` («ha già timbrato in quelle ore») e non `not_clocked`.
--   private.assign_one                   blocca il turno `for share`: chi mette
--       una persona su una bozza mentre un'altra sessione la pubblica aspetta, e
--       il suo trigger vede il turno già pubblicato (e avvisa), oppure la
--       pubblicazione aspetta lui e lo trova fra chi avvisare.
--
-- Nuovi codici d'errore: `shift_not_draft`; riusati `shift_not_finished`,
-- `staff_required`, `not_allowed`, `shift_cancelled`.

-- ---------------------------------------------------------------------------
-- La persona di questa assegnazione ha, nelle ore del turno, una timbratura
-- non annullata di un'altra assegnazione o senza turno, in qualunque sede
-- dell'azienda (un'entrata ancora aperta vale fino ad adesso).
-- ---------------------------------------------------------------------------
create function private.assignment_clock_overlap(p_assignment uuid)
returns boolean
language sql stable set search_path = '' as $$
  select exists (
    select 1
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
      join public.venue_members vm on vm.id = a.venue_member_id
      join public.venue_members other on other.member_id = vm.member_id
      join public.shift_clock_records c on c.venue_member_id = other.id
      cross join lateral private.clock_record_times(c.id) t
     where a.id = p_assignment
       and c.voided_at is null
       and c.assignment_id is distinct from a.id
       and pg_catalog.tstzrange(t.clock_in_at,
             greatest(t.clock_in_at, coalesce(t.clock_out_at, now())), '[)')
           && pg_catalog.tstzrange(
                (s.date + s.start_time) at time zone 'Europe/Rome',
                public.shift_ends_at(s.date, s.start_time, s.end_time) at time zone 'Europe/Rome',
                '[)')
  );
$$;
revoke all on function private.assignment_clock_overlap(uuid) from public, anon;

-- ---------------------------------------------------------------------------
-- Anteprima.
-- ---------------------------------------------------------------------------
create function public.get_publish_preview(p_venues uuid[], p_from date, p_to date)
returns jsonb
language sql stable security definer set search_path = '' as $$
  with scope as (
    select v.id
      from public.venues v
     where (p_venues is null or v.id = any (p_venues))
       and v.id in (select private.venues_where('shifts'))
       and v.workspace_id in (select private.commercial_readable_workspace_ids())
  ), drafts as (
    select s.id, s.date, s.start_time,
           public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now() as finished
      from public.shifts s
     where s.venue_id in (select id from scope)
       and s.published_at is null
       and s.status <> 'cancelled'
  ), target as (
    select d.id, d.date, d.start_time from drafts d
     where not d.finished and d.date between p_from and p_to
  )
  select jsonb_build_object(
    'shift_ids', coalesce((select jsonb_agg(t.id order by t.date, t.start_time, t.id) from target t), '[]'::jsonb),
    'shifts', (select count(*) from target)::integer,
    'people', (select count(distinct m.user_id)
                 from public.shift_assignments a
                 join public.venue_members vm on vm.id = a.venue_member_id
                 join public.workspace_members m on m.id = vm.member_id
                where a.shift_id in (select id from target)
                  and a.status in ('assigned', 'confirmed')
                  and m.user_id is not null
                  and m.user_id is distinct from (select auth.uid()))::integer,
    'outside', (select count(*) from drafts d
                 where not d.finished and (d.date < p_from or d.date > p_to))::integer,
    'expired', (select count(*) from drafts d where d.finished)::integer
  );
$$;

-- ---------------------------------------------------------------------------
-- Pubblicazione.
-- ---------------------------------------------------------------------------
create function public.publish_shifts(p_shifts uuid[], p_notify boolean)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_ids uuid[];
  v_ws uuid;
  v_notified integer := 0;
  p record;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  if p_shifts is null or cardinality(p_shifts) = 0 then
    return jsonb_build_object('published', 0, 'notified', 0);
  end if;

  -- Prima il permesso, senza bloccare niente: chi non può non tiene lock sui
  -- turni degli altri. La sede di un turno non cambia mai (update_shift non
  -- sposta di sede), quindi il controllo resta valido dopo il lock.
  if exists (select 1 from public.shifts s
              where s.id = any (p_shifts) and not private.can(s.venue_id, 'shifts')) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Poi l'azienda, poi i turni: lo stesso ordine di lock di assign_one,
  -- move_assignment, reassign e update_shift (che aprono tutti con
  -- `assert_workspace_operational`, cioè `workspaces for update`). Al contrario,
  -- una pubblicazione e un'assegnazione sulla stessa bozza si bloccherebbero a
  -- vicenda. Il lock dell'azienda è anche ciò che le serializza: chi arriva
  -- secondo vede il lavoro del primo già committato.
  for v_ws in
    select distinct v.workspace_id
      from public.shifts s join public.venues v on v.id = s.venue_id
     where s.id = any (p_shifts)
     order by v.workspace_id
  loop
    perform private.assert_workspace_operational(v_ws);
  end loop;

  -- In ordine di id: due pubblicazioni concorrenti non si incrociano, e la
  -- seconda trova le righe già pubblicate e le salta.
  perform 1 from public.shifts s where s.id = any (p_shifts) order by s.id for update;

  -- Già pubblicate, annullate o finite: si saltano in silenzio. Una bozza
  -- finita non si pubblica più (si elimina o si registra come fatta).
  with done as (
    update public.shifts s
       set published_at = now(), published_by = (select auth.uid())
     where s.id = any (p_shifts)
       and s.published_at is null
       and s.status <> 'cancelled'
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
    returning s.id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from done;

  if coalesce(p_notify, false) and cardinality(v_ids) > 0 then
    -- Una notifica per persona (e per azienda): il luogo è la sede se i suoi
    -- turni sono tutti lì, altrimenti l'azienda.
    for p in
      select m.user_id,
             v.workspace_id,
             count(*)::integer as n,
             count(distinct s.venue_id)::integer as venues,
             min(v.name) as venue_name,
             min(w.name) as workspace_name,
             (array_agg(s.id order by s.date, s.start_time, s.id))[1] as first_id,
             min(s.date) as first_date,
             max(s.date) as last_date,
             bool_or(a.status = 'assigned') as to_confirm
        from public.shift_assignments a
        join public.shifts s on s.id = a.shift_id
        join public.venues v on v.id = s.venue_id
        join public.workspaces w on w.id = v.workspace_id
        join public.venue_members vm on vm.id = a.venue_member_id
        join public.workspace_members m on m.id = vm.member_id
       where a.shift_id = any (v_ids)
         and a.status in ('assigned', 'confirmed')
         and m.user_id is not null
         and m.user_id is distinct from (select auth.uid())
       group by m.user_id, v.workspace_id
    loop
      declare
        v_place text := case when p.venues = 1 then p.venue_name else p.workspace_name end;
        v_first public.shifts;
        v_title text;
        v_body text;
      begin
        if p.n = 1 then
          select * into v_first from public.shifts where id = p.first_id;
          v_title := 'Nuovo turno';
          v_body := v_place || ': un nuovo turno per te, il ' || to_char(v_first.date, 'DD/MM')
            || ' dalle ' || to_char(v_first.start_time, 'HH24:MI')
            || ' alle ' || to_char(v_first.end_time, 'HH24:MI') || '.';
        elsif p.first_date = p.last_date then
          v_title := 'Nuovi turni';
          v_body := v_place || ': ' || p.n || ' nuovi turni per te, il '
            || to_char(p.first_date, 'DD/MM') || '.';
        else
          v_title := 'Nuovi turni';
          v_body := v_place || ': ' || p.n || ' nuovi turni per te, dal '
            || to_char(p.first_date, 'DD/MM') || ' al ' || to_char(p.last_date, 'DD/MM') || '.';
        end if;
        if p.to_confirm then
          v_body := v_body || ' Conferma la presenza.';
        end if;
        -- Chi chiama e gli utenti nulli sono già fuori dalla select: ogni giro
        -- inserisce una notifica, e `notified` le conta una per una.
        perform private.notify(p.user_id, 'shift_published', v_title, v_body, p.first_id);
        v_notified := v_notified + 1;
      end;
    end loop;
  end if;

  return jsonb_build_object('published', cardinality(v_ids), 'notified', v_notified);
end;
$$;

-- ---------------------------------------------------------------------------
-- Conferma tutti.
-- ---------------------------------------------------------------------------
create function public.confirm_my_assignments(p_assignments uuid[])
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_ws uuid;
  v_count integer := 0;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Prima le aziende, come fa respond_assignment per ognuna: lo stesso ordine
  -- di lock (azienda, poi assegnazione) delle altre scritture sui turni.
  for v_ws in
    select distinct x.workspace_id
      from public.shift_assignments a
      join public.venue_members x on x.id = a.venue_member_id
     where a.id = any (p_assignments)
       and a.venue_member_id in (select private.my_venue_member_ids())
       and a.status = 'assigned'
     order by x.workspace_id
  loop
    perform private.assert_workspace_operational(v_ws);
  end loop;
  -- Solo le sue, in attesa, su turni pubblicati, non annullati, non finiti. Il
  -- lock fa sì che un doppio tocco concorrente non le conti due volte.
  for v_id in
    select a.id
      from public.shift_assignments a
      join public.shifts s on s.id = a.shift_id
     where a.id = any (p_assignments)
       and a.venue_member_id in (select private.my_venue_member_ids())
       and a.status = 'assigned'
       and s.published_at is not null
       and s.status <> 'cancelled'
       and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
     order by s.date, s.start_time, a.id
       for update of a
  loop
    perform public.respond_assignment(v_id, 'confirmed', null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Registra come fatto.
-- ---------------------------------------------------------------------------
create function public.record_draft_as_done(p_shift uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare
  s public.shifts;
  v_venue uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  -- Permesso e azienda prima del lock sul turno: stesso ordine di lock delle
  -- altre scritture (azienda, poi turno). La sede di un turno non cambia.
  select x.venue_id into v_venue from public.shifts x where x.id = p_shift;
  if v_venue is null or not private.can(v_venue, 'hours') then
    raise exception 'not_allowed' using errcode = '42501';
  end if;
  perform private.assert_workspace_operational(private.venue_workspace(v_venue));
  select * into s from public.shifts x where x.id = p_shift for update;
  if s.id is null then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  if s.published_at is not null then
    raise exception 'shift_not_draft' using errcode = '23514';
  end if;
  if s.status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  if public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now() then
    raise exception 'shift_not_finished' using errcode = '23514';
  end if;
  if not exists (select 1 from public.shift_assignments a
                  where a.shift_id = s.id and a.status in ('assigned', 'confirmed')) then
    raise exception 'staff_required' using errcode = '23514';
  end if;
  -- Come record_past_shift: un collaboratore non registra le proprie ore.
  if exists (select 1 from public.shift_assignments a
               join public.venue_members vm on vm.id = a.venue_member_id
              where a.shift_id = s.id and a.status in ('assigned', 'confirmed')
                and private.is_restricted_self(vm.member_id)) then
    raise exception 'not_allowed' using errcode = '42501';
  end if;

  -- Prima le assegnazioni, finché il turno è ancora una bozza (ogni trigger
  -- delle assegnazioni tace), e con il silenzio del fuori turno come
  -- record_past_shift. Poi il turno: notify_on_shift_change esce perché la
  -- riga vecchia è una bozza.
  --
  -- Una bozza non blocca la timbratura senza turno (non la si vede): chi in
  -- quelle ore ha timbrato, qui o in un'altra sede dell'azienda, le ha già nella
  -- sua timbratura. Per lui le ore del turno non contano da sole
  -- (`clock_expected` senza timbratura, qualunque sia il metodo della sede): la
  -- riga va fra le «Ore da sistemare» come `clock_overlap`, da verificare,
  -- invece di contare due volte lo stesso tempo.
  perform set_config('app.unplanned_clock', '1', true);
  update public.shift_assignments a
     set status = 'confirmed', confirmed_at = now(),
         hours_source = case when private.assignment_clock_overlap(a.id)
                             then 'clock_expected' else 'manual_auto' end
   where a.shift_id = s.id and a.status in ('assigned', 'confirmed');
  update public.shifts x
     set published_at = now(), published_by = (select auth.uid()),
         recorded_at = now(), recorded_by = (select auth.uid())
   where x.id = s.id;
  perform set_config('app.unplanned_clock', '', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- Ore da sistemare: un motivo in più, `clock_overlap`. L'insieme delle righe
-- non cambia (resta il complemento esatto di `shifts_count`, test 037), cambia
-- solo il perché. Definizione di partenza: quella di 20261103000100.
-- ---------------------------------------------------------------------------
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
           -- Ha timbrato altrove in quelle ore (es. il fuori turno sopra una
           -- bozza registrata come fatta): non «non ha timbrato».
           when private.assignment_clock_overlap(r.id) then 'clock_overlap'
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

-- ---------------------------------------------------------------------------
-- Mettere una persona su un turno: il lock sul turno. move_assignment e
-- reassign bloccano già il turno `for update` prima di arrivare qui;
-- create_shifts, record_past_shift e il fuori turno inseriscono in turni appena
-- nati; add_shift_worker lavora su turni finiti, che non si pubblicano.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.assign_one(p_shift uuid, p_venue_member uuid, p_role uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_shift record;
  v_id    uuid;
begin
  perform private.assert_workspace_operational((select v.workspace_id from public.shifts s join public.venues v on v.id=s.venue_id where s.id=p_shift));
  perform private.assert_can_touch_assignment(p_shift, p_venue_member);
  -- `for share`: serializza con publish_shifts (che blocca `for update`), così
  -- chi entra in una bozza mentre la si pubblica viene avvisato una volta.
  select s.venue_id, s.status, s.unplanned into v_shift from public.shifts s where s.id = p_shift
     for share;
  if v_shift.status = 'cancelled' then
    raise exception 'shift_cancelled' using errcode = '23514';
  end if;
  -- Il fuori turno è di chi ha timbrato: nessun altro ci entra, da nessuna
  -- strada (assign, form, move_assignment). Lui nasce con un insert diretto.
  if v_shift.unplanned then
    raise exception 'unplanned_shift_locked' using errcode = '23514';
  end if;
  -- Mettere qualcuno su un turno finito fa contare le sue ore: è una
  -- rettifica, e le rettifiche le fa chi ha Ore (come per data e orari,
  -- `guard_finished_shift_times`).
  if private.shift_is_over(p_shift) and not private.can(v_shift.venue_id, 'hours') then
    raise exception 'finished_shift_locked' using errcode = '42501';
  end if;
  -- In organico in QUELLA sede, e attivo: la FK composita lo garantirebbe, ma
  -- con un errore illeggibile.
  if not exists (
    select 1 from public.venue_members vm
      join public.workspace_members m on m.id = vm.member_id
     where vm.id = p_venue_member and vm.venue_id = v_shift.venue_id
       and vm.left_at is null and m.status = 'active'
  ) then
    raise exception 'not_in_roster' using errcode = '23514';
  end if;
  perform private.assert_role_in_venue(p_role, v_shift.venue_id);

  insert into public.shift_assignments (shift_id, venue_id, venue_member_id, role_id)
  values (p_shift, v_shift.venue_id, p_venue_member, p_role)
  on conflict (shift_id, venue_member_id) do nothing
  returning id into v_id;
  if v_id is null then
    raise exception 'already_assigned' using errcode = '23505';
  end if;
  return v_id;
end;
$function$;

revoke all on function public.get_publish_preview(uuid[], date, date) from public, anon;
revoke all on function public.publish_shifts(uuid[], boolean) from public, anon;
revoke all on function public.confirm_my_assignments(uuid[]) from public, anon;
revoke all on function public.record_draft_as_done(uuid) from public, anon;
grant execute on function public.get_publish_preview(uuid[], date, date) to authenticated;
grant execute on function public.publish_shifts(uuid[], boolean) to authenticated;
grant execute on function public.confirm_my_assignments(uuid[]) to authenticated;
grant execute on function public.record_draft_as_done(uuid) to authenticated;
