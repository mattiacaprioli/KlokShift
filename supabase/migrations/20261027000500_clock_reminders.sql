-- Promemoria di timbratura (revisione dipendente E10).
--
-- Nessuno avvisava chi dimentica l'entrata o l'uscita: è la causa naturale di
-- «non ha timbrato» e «uscita mancante» nelle «Ore da sistemare». Ogni 5 minuti
-- `private.run_clock_reminders` guarda le timbrature che mancano adesso e manda
-- un promemoria a chi timbra dall'app:
--
--   in             5 minuti dopo l'inizio, se l'entrata non c'è (solo a chi se
--                  ne dimentica, non a tutti prima del turno);
--   out            20 minuti dopo la fine, se l'entrata è ancora aperta;
--   unplanned_out  fuori turno aperto da 10 ore (oltre 16 l'uscita la chiude
--                  solo chi gestisce).
--
-- Decide il database perché è il solo a sapere lo stato vero della timbratura.
-- Ogni ramo legge un intervallo indicizzato; l'azienda operativa si calcola una
-- volta per azienda, non per riga. `private.clock_reminders` impedisce il
-- doppione anche con due esecuzioni sovrapposte. Chi ha spento i promemoria
-- (`notification_prefs.reminders = false`) non riceve né la push né la riga.
--
-- Un promemoria superato si chiude da solo: una timbratura qualsiasi della
-- persona segna letti i suoi promemoria aperti. La push scade dopo un'ora
-- (Edge Function `push`): un «timbra l'entrata» arrivato tardi è rumore.

-- ---------------------------------------------------------------------------
-- Categoria: si spengono a parte dalle notifiche dei turni.
-- ---------------------------------------------------------------------------
create or replace function public.notification_category(t public.notification_type)
returns text language sql immutable set search_path = '' as $$
  select case t
    when 'new_message'      then 'messages'
    when 'staff_invite'     then 'staff'
    when 'staff_response'   then 'staff'
    when 'staff_removed'    then 'staff'
    when 'staff_linked'     then 'staff'
    when 'team_linked'      then 'staff'
    when 'team_joined'      then 'staff'
    when 'team_removed'     then 'staff'
    when 'absence_request'  then 'staff'
    when 'absence_response' then 'staff'
    when 'absence_sick'     then 'staff'
    when 'clock_reminder'   then 'reminders'
    else 'shifts'
  end;
$$;

-- ---------------------------------------------------------------------------
-- Indici: il lavoro legge «i turni di oggi» e «le entrate aperte» di tutte le
-- sedi. `shifts (venue_id, date)` non serve a una lettura per sola data.
-- ---------------------------------------------------------------------------
create index shifts_date_active_idx on public.shifts (date) where status <> 'cancelled';
create index shift_clock_records_open_idx on public.shift_clock_records (clock_in_at)
  where clock_out_at is null and voided_at is null;

-- ---------------------------------------------------------------------------
-- Un promemoria per soggetto, tipo e scadenza. `due_at` nella chiave: un turno
-- spostato riapre il suo. Il soggetto è l'assegnazione (entrata) o la
-- timbratura (uscite): una timbratura annullata e rifatta ha il suo.
-- ---------------------------------------------------------------------------
create table private.clock_reminders (
  subject_id uuid not null,
  kind       text not null check (kind in ('in', 'out', 'unplanned_out')),
  due_at     timestamp not null,
  user_id    uuid not null,
  sent_at    timestamptz not null default now(),
  primary key (subject_id, kind, due_at)
);
create index clock_reminders_sent_idx on private.clock_reminders (sent_at);
revoke all on private.clock_reminders from public, anon, authenticated;

create function private.queue_clock_reminders(p_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
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
$$;

create function private.run_clock_reminders()
returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  v_count := private.queue_clock_reminders(now());
  delete from private.clock_reminders where sent_at < now() - interval '3 days';
  return v_count;
end;
$$;

-- ---------------------------------------------------------------------------
-- Una timbratura (entrata, uscita, anche orari inseriti da chi gestisce) rende
-- superati i promemoria aperti della persona: la campanella non resta con un
-- «Hai timbrato l'entrata?» già fatto.
-- ---------------------------------------------------------------------------
create function private.close_clock_reminders()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and not (old.clock_out_at is null and new.clock_out_at is not null) then
    return null;
  end if;
  update public.notifications n
     set read_at = now()
   where n.type = 'clock_reminder' and n.read_at is null
     and n.user_id = (select m.user_id from public.venue_members vm
                        join public.workspace_members m on m.id = vm.member_id
                       where vm.id = new.venue_member_id);
  return null;
end;
$$;
create trigger shift_clock_records_close_reminders
  after insert or update of clock_out_at on public.shift_clock_records
  for each row execute function private.close_clock_reminders();

revoke all on function private.queue_clock_reminders(timestamptz),
  private.run_clock_reminders(), private.close_clock_reminders()
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ogni 5 minuti; e ogni notte la pulizia dello storico di pg_cron, che con un
-- lavoro ogni 5 minuti crescerebbe di 288 righe al giorno per sempre. Se
-- pg_cron non c'è (banco locale) la migration non si ferma.
-- ---------------------------------------------------------------------------
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('clock-reminders', '*/5 * * * *', 'select private.run_clock_reminders()');
  perform cron.schedule('cron-history-cleanup', '30 3 * * *',
    $q$delete from cron.job_run_details where end_time < now() - interval '7 days'$q$);
exception when others then
  raise notice 'pg_cron non disponibile: promemoria di timbratura non programmati (%).', sqlerrm;
end $$;
