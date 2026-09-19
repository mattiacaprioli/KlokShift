-- Turni a cavallo della mezzanotte — la metà server.
--
-- Il client sa già collocare nel tempo un turno notturno: `shiftEndsAt()` in
-- src/lib/format.ts aggiunge un giorno quando la fine non è successiva
-- all'inizio, e `isShiftOver()` decide su quell'istante. Il database invece
-- decideva "concluso" con `s.date < current_date`, che su un turno 22:00–04:00
-- scatta quattro ore prima che il turno finisca davvero.
--
-- Due difetti in una riga sola:
--   1. guarda il **giorno**, non l'istante di fine;
--   2. `current_date` è in **UTC**: in Italia, fra mezzanotte e l'una (le due
--      con l'ora legale), è ancora ieri. Cioè proprio la finestra in cui i turni
--      notturni sono in corso — quella in cui client e server si contraddicono.
--
-- Da qui i due gemelli SQL che mancavano, e le cinque funzioni che li usano.

-- ---------------------------------------------------------------------------
-- Helper: istante di fine reale del turno
-- ---------------------------------------------------------------------------
-- Gemello SQL di `shiftEndsAt()` in src/lib/format.ts, stessa convenzione di
-- `shift_duration_hours` (fine <= inizio ⇒ il turno finisce il giorno dopo).
create or replace function public.shift_ends_at(
  p_date  date,
  p_start time,
  p_end   time
)
returns timestamp
language sql
immutable
set search_path = ''
as $$
  select (p_date + p_end)
    + case when p_end <= p_start then interval '1 day' else interval '0 day' end;
$$;

comment on function public.shift_ends_at(date, time, time) is
  'Istante in cui il turno finisce davvero, +1 giorno se scavalca la mezzanotte. Gemello SQL di shiftEndsAt() nel client: se cambia una, cambiare l''altra.';

-- ---------------------------------------------------------------------------
-- Helper: adesso, nell'ora del locale
-- ---------------------------------------------------------------------------
-- `current_date` e `now()` sul server sono UTC. I turni però sono scritti
-- nell'ora di chi li lavora (`date` + `time`, senza fuso), quindi il confronto
-- va fatto sull'orologio da parete italiano. Il prodotto è solo per l'Italia:
-- il fuso è uno, e sta scritto qui invece che ripetuto in cinque query.
create or replace function public.local_now()
returns timestamp
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'Europe/Rome');
$$;

comment on function public.local_now() is
  'Adesso in ora italiana, da confrontare con shift_ends_at(). Sostituisce current_date, che è UTC e fra mezzanotte e le 2 indica ancora ieri.';

-- ---------------------------------------------------------------------------
-- Pagina Ore: riepilogo per membro dell'organico
-- ---------------------------------------------------------------------------
-- Identica a 20260910120200 salvo il filtro "già concluso".
-- NB: `p_from`/`p_to` restano sulla **data**. Un turno appartiene al giorno in
-- cui inizia, quindi la notte del 31 si conta tutta nel mese che finisce: è la
-- stessa convenzione del calendario e delle liste lato client.
create or replace function public.get_venue_hours_summary(
  p_venue uuid,
  p_from  date,
  p_to    date
)
returns table (
  staff_member_id uuid,
  display_name    text,
  role            text,
  shifts_count    integer,
  hours           numeric
)
language sql
stable
set search_path = ''
as $$
  select
    sm.id,
    sm.display_name,
    sm.role,
    count(*)::int,
    sum(coalesce(
      a.worked_hours,
      public.shift_duration_hours(s.start_time, s.end_time)
    ))
  from public.shift_assignments a
  join public.staff_members sm on sm.id = a.staff_member_id
  join public.shifts s         on s.id  = a.shift_id
  where s.venue_id = p_venue
    and s.kind = 'internal'
    and s.date >= p_from
    and s.date <  p_to
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    and a.status not in ('declined', 'no_show')
  group by sm.id, sm.display_name, sm.role
  order by 5 desc;
$$;

revoke execute on function public.get_venue_hours_summary(uuid, date, date) from anon, public;
grant  execute on function public.get_venue_hours_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheda organico: statistiche di un membro
-- ---------------------------------------------------------------------------
-- Oltre al filtro "già concluso", il mese corrente si calcola sull'ora locale:
-- col UTC, il primo del mese fino alle 2 di notte le statistiche del mese erano
-- ancora quelle del mese prima.
create or replace function public.get_staff_performance(p_staff_member uuid)
returns table (
  past_total     integer,  -- turni conclusi, qualunque esito
  worked_count   integer,  -- svolti (né rifiutati né assenti)
  no_show_count  integer,
  declined_count integer,
  total_hours    numeric,  -- ore sui turni svolti
  month_shifts   integer,  -- svolti nel mese corrente
  month_hours    numeric
)
language sql
stable
set search_path = ''
as $$
  with past as (
    select
      a.status,
      coalesce(
        a.worked_hours,
        public.shift_duration_hours(s.start_time, s.end_time)
      ) as hours,
      s.date
    from public.shift_assignments a
    join public.shifts s on s.id = a.shift_id
    where a.staff_member_id = p_staff_member
      and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
  )
  select
    count(*)::int,
    count(*) filter (where status not in ('declined', 'no_show'))::int,
    count(*) filter (where status = 'no_show')::int,
    count(*) filter (where status = 'declined')::int,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')), 0),
    count(*) filter (
      where status not in ('declined', 'no_show')
        and date >= date_trunc('month', public.local_now())::date
    )::int,
    coalesce(sum(hours) filter (
      where status not in ('declined', 'no_show')
        and date >= date_trunc('month', public.local_now())::date
    ), 0)
  from past;
$$;

revoke execute on function public.get_staff_performance(uuid) from anon, public;
grant  execute on function public.get_staff_performance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheda organico: ultimi turni svolti
-- ---------------------------------------------------------------------------
-- `order by s.date desc, s.start_time desc` resta com'era: è già cronologico
-- all'indietro anche con i turni notturni, perché un turno appartiene al giorno
-- in cui **inizia** (le 22:00 di lunedì vengono prima del pranzo di lunedì, e
-- un turno che parte alle 00:30 chiude la sua giornata). Non "correggerlo".
create or replace function public.get_staff_worked_shifts(
  p_staff_member uuid,
  p_limit        integer default 6
)
returns table (
  id           uuid,
  status       public.assignment_status,
  worked_hours numeric,
  shift_id     uuid,
  title        text,
  date         date,
  start_time   time,
  end_time     time,
  hours        numeric
)
language sql
stable
set search_path = ''
as $$
  select
    a.id, a.status, a.worked_hours,
    s.id, s.title, s.date, s.start_time, s.end_time,
    coalesce(
      a.worked_hours,
      public.shift_duration_hours(s.start_time, s.end_time)
    )
  from public.shift_assignments a
  join public.shifts s on s.id = a.shift_id
  where a.staff_member_id = p_staff_member
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    and a.status not in ('declined', 'no_show')
  order by s.date desc, s.start_time desc
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.get_staff_worked_shifts(uuid, integer) from anon, public;
grant  execute on function public.get_staff_worked_shifts(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- Storico lavoro del professionista
-- ---------------------------------------------------------------------------
-- Identica a 20260911090000 salvo il filtro "già concluso" nei due rami: il
-- turno che sta lavorando adesso non deve comparirgli fra quelli svolti (né
-- essere già conteggiato nelle sue ore) mentre è ancora in sala.
create or replace function private.my_work_history(p_user uuid)
returns table (
  key        text,
  venue_name text,
  logo_url   text,
  title      text,
  date       date,
  start_time time,
  end_time   time,
  hours      numeric,
  kind       text
)
language sql
stable
set search_path = ''
as $$
  -- Turni interni: assegnato e presente (rifiutati e assenti non sono lavoro).
  select
    'asg-' || a.id::text,
    v.name,
    v.logo_url,
    s.title,
    s.date,
    s.start_time,
    s.end_time,
    coalesce(a.worked_hours, public.shift_duration_hours(s.start_time, s.end_time)),
    'staff'
  from public.shift_assignments a
  join public.staff_members sm on sm.id = a.staff_member_id
  join public.shifts s         on s.id  = a.shift_id
  left join public.venues v    on v.id  = s.venue_id
  where sm.waiter_id = p_user
    and a.status not in ('declined', 'no_show')
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()

  union all

  -- Marketplace: candidature accettate su turni ormai passati. Qui non esiste
  -- `worked_hours`, quindi valgono le ore pianificate.
  select
    'app-' || ap.id::text,
    v.name,
    v.logo_url,
    s.title,
    s.date,
    s.start_time,
    s.end_time,
    public.shift_duration_hours(s.start_time, s.end_time),
    'marketplace'
  from public.applications ap
  join public.shifts s      on s.id = ap.shift_id
  left join public.venues v on v.id = s.venue_id
  where ap.waiter_id = p_user
    and ap.status = 'accepted'
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now();
$$;

revoke execute on function private.my_work_history(uuid) from public;
grant  execute on function private.my_work_history(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Notifica "turno revocato": la guardia sui turni passati
-- ---------------------------------------------------------------------------
-- Identica a 20260909193312 salvo la guardia: togliere qualcuno da un turno
-- ancora in corso è una disdetta come le altre, e va notificata. Con il
-- confronto sulla sola data, dopo mezzanotte il turno della notte passava per
-- "storico da correggere" e il professionista non veniva avvisato.
create or replace function public.notify_on_assignment_removed()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_waiter uuid;
  v_venue  text;
  v_date   date;
  v_ends   timestamp;
  v_status public.shift_status;
begin
  -- Aveva già rifiutato: togliergli il turno non è una notizia per lui.
  if old.status = 'declined' then
    return old;
  end if;

  -- Membro dello staff sparito (cascade) o scheda senza account collegato.
  select sm.waiter_id into v_waiter
  from public.staff_members sm
  where sm.id = old.staff_member_id;

  if v_waiter is null then
    return old;
  end if;

  -- È il cameriere stesso ad aver innescato la cancellazione: niente auto-notifica.
  if v_waiter = (select auth.uid()) then
    return old;
  end if;

  -- Il titolo dei turni interni è "Turno · <data>": ridondante nel corpo, si usa
  -- solo la data.
  select v.name, s.date, s.status,
         public.shift_ends_at(s.date, s.start_time, s.end_time)
    into v_venue, v_date, v_status, v_ends
  from public.shifts s
  join public.venues v on v.id = s.venue_id
  where s.id = old.shift_id;

  -- Turno cancellato (cascade) o annullato: se ne occupa un altro trigger.
  if not found or v_status = 'cancelled' then
    return old;
  end if;

  -- Turni già conclusi: qui il gestore sta correggendo lo storico, non disdicendo.
  if v_ends <= public.local_now() then
    return old;
  end if;

  -- related_id resta null di proposito: il cameriere ha appena perso il
  -- permesso di leggere quel turno, quindi la notifica non può puntarci.
  insert into public.notifications (user_id, type, title, body, related_id)
  values (
    v_waiter,
    'shift_unassigned',
    'Turno revocato',
    coalesce(v_venue, 'Un locale') || ' ti ha tolto dal turno del '
      || to_char(v_date, 'DD/MM'),
    null
  );

  return old;
end;
$$;

drop trigger if exists shift_assignments_notify_removed on public.shift_assignments;
create trigger shift_assignments_notify_removed
  after delete on public.shift_assignments
  for each row execute function public.notify_on_assignment_removed();

revoke execute on function public.notify_on_assignment_removed()
  from anon, authenticated, public;

-- ---------------------------------------------------------------------------
-- Cancellazione account: quali turni annullare
-- ---------------------------------------------------------------------------
-- Identica a 20260909195210 salvo il filtro: con `s.date >= current_date` un
-- turno notturno ancora in corso non veniva annullato alla chiusura del locale,
-- e restava lì senza più nessuno a gestirlo.
create or replace function public.delete_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.user_role;
begin
  select role into v_role from public.profiles where id = p_user;
  if not found then
    return;
  end if;

  if v_role = 'waiter' then
    -- Reputazione, candidature e scheda professionale sono dati personali suoi.
    delete from public.reviews            where waiter_id = p_user;
    delete from public.waiter_experiences where waiter_id = p_user;
    delete from public.waiter_profiles    where id        = p_user;
    delete from public.applications       where waiter_id = p_user;

    -- Inviti mai accettati: via. Collaborazioni attive: si slega l'account ma la
    -- scheda resta, altrimenti il locale perde le ore già lavorate.
    delete from public.staff_members
      where waiter_id = p_user and link_status = 'pending';
    update public.staff_members
      set waiter_id = null
      where waiter_id = p_user;
  else
    -- Il locale sopravvive per non distruggere lo storico altrui, ma va chiuso.
    update public.venues
      set closed_at = now()
      where owner_id = p_user and closed_at is null;

    -- I turni non ancora conclusi non avrebbero più nessuno a gestirli.
    -- L'update fa scattare notify_on_shift_change, che avvisa assegnati e
    -- candidati accettati: è il comportamento voluto, non un effetto collaterale.
    update public.shifts s
      set status = 'cancelled'
      where s.venue_id in (select v.id from public.venues v where v.owner_id = p_user)
        and public.shift_ends_at(s.date, s.start_time, s.end_time) > public.local_now()
        and s.status <> 'cancelled';
  end if;

  -- Comuni a entrambi i ruoli.
  delete from public.push_tokens   where user_id = p_user;
  delete from public.notifications where user_id = p_user;

  -- La lapide: nessun dato personale, ma la riga resta perché conversazioni,
  -- turni e locali la referenziano.
  update public.profiles
    set full_name          = 'Utente eliminato',
        avatar_url         = null,
        phone              = null,
        bio                = null,
        city               = null,
        notification_prefs = '{}'::jsonb,
        deleted_at         = now()
    where id = p_user;
end;
$$;

-- `create or replace` non ripristina i privilegi di default, ma li ridichiara
-- qui accanto alla funzione: resta eseguibile solo dalla service_role, come la
-- Edge Function si aspetta.
revoke all on function public.delete_account(uuid) from anon, authenticated, public;
