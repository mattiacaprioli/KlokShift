-- Performance / Disk IO — parte 3: le aggregazioni le fa il database.
--
-- Diverse schermate scaricavano un dataset intero per ricavarne pochi numeri:
-- la pagina Ore si portava a casa ogni assegnazione del mese con due join per
-- sommare in JS (e il selettore offre 12 mesi cliccabili), la scheda di un
-- membro dell'organico scaricava tutta la sua storia per mostrarne quattro
-- statistiche e sei righe, il badge dei messaggi contava su TUTTA `messages`.
--
-- Il modello corretto era già nel progetto: `get_rating_breakdown`
-- (20260705130000) fa il `group by` sul server con un indice dedicato. Queste
-- funzioni lo replicano.
--
-- Salvo `get_chat_unread_count`, sono tutte INVOKER: la RLS resta l'unico
-- guardiano dei dati, esattamente come per le query che sostituiscono. Nessuna
-- allarga ciò che un utente può vedere.

-- ---------------------------------------------------------------------------
-- Helper: durata del turno in ore
-- ---------------------------------------------------------------------------
-- Equivalente SQL di `shiftDurationHours` in src/lib/format.ts, incluso il caso
-- del turno che scavalca la mezzanotte (fine <= inizio ⇒ +24h).
create or replace function public.shift_duration_hours(p_start time, p_end time)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select (
    case
      when extract(epoch from (p_end - p_start)) <= 0
        then extract(epoch from (p_end - p_start)) + 86400
      else extract(epoch from (p_end - p_start))
    end
  ) / 3600.0;
$$;

comment on function public.shift_duration_hours(time, time) is
  'Ore fra due orari, gestendo il turno a cavallo della mezzanotte. Gemello SQL di shiftDurationHours() nel client: se cambia una, cambiare l''altra.';

-- ---------------------------------------------------------------------------
-- Pagina Ore: riepilogo per membro dell'organico
-- ---------------------------------------------------------------------------
-- Ore effettive = `worked_hours` se il ristoratore l'ha corretta a mano,
-- altrimenti la durata pianificata. Rifiutati e assenti non contano (0 ore),
-- e si guardano solo i turni già conclusi.
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
    and s.date <  current_date
    and a.status not in ('declined', 'no_show')
  group by sm.id, sm.display_name, sm.role
  order by 5 desc;
$$;

revoke execute on function public.get_venue_hours_summary(uuid, date, date) from anon, public;
grant  execute on function public.get_venue_hours_summary(uuid, date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- Badge messaggi non letti
-- ---------------------------------------------------------------------------
-- Prima era `count: 'exact'` su tutta `messages` con i soli filtri `read_at is
-- null` e `sender_id <> me`: nessun filtro per conversazione, quindi l'indice
-- esistente era inutilizzabile e la policy "messages: participants read"
-- veniva valutata riga per riga. Ed è montato su ogni schermata.
--
-- DEFINER di proposito: il join su `conversations` fa già lo stesso controllo
-- della policy, quindi rivalutarla per riga sarebbe lavoro doppio. Non prende
-- parametri e legge solo le conversazioni del chiamante: non c'è nulla da
-- passargli per farsi dare i dati di qualcun altro.
create or replace function public.get_chat_unread_count()
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::int
  from public.messages m
  join public.conversations c on c.id = m.conversation_id
  where m.read_at is null
    and m.sender_id <> (select auth.uid())
    and (
      c.waiter_id  = (select auth.uid())
      or c.manager_id = (select auth.uid())
    );
$$;

revoke execute on function public.get_chat_unread_count() from anon, public;
grant  execute on function public.get_chat_unread_count() to authenticated;

-- ---------------------------------------------------------------------------
-- "Da chi ha già lavorato qui"
-- ---------------------------------------------------------------------------
-- Prima scaricava ogni candidatura accettata nella storia del locale, con
-- profilo annidato, per farne la DISTINCT in JavaScript. `distinct on` è
-- esattamente questo, fatto dove costa poco.
--
-- INVOKER: la RLS di `applications` ("manager reads own shifts") limita già il
-- ristoratore ai propri turni, quindi passare l'id di un altro locale non
-- restituisce nulla.
create or replace function public.get_worked_with_waiters(p_venue uuid)
returns table (
  id           uuid,
  full_name    text,
  avatar_url   text,
  primary_role text
)
language sql
stable
set search_path = ''
as $$
  select distinct on (p.id)
    p.id, p.full_name, p.avatar_url, wp.primary_role
  from public.applications a
  join public.shifts s          on s.id  = a.shift_id
  join public.profiles p        on p.id  = a.waiter_id
  left join public.waiter_profiles wp on wp.id = p.id
  where s.venue_id = p_venue
    and a.status = 'accepted'
  order by p.id;
$$;

revoke execute on function public.get_worked_with_waiters(uuid) from anon, public;
grant  execute on function public.get_worked_with_waiters(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheda organico: statistiche di un membro
-- ---------------------------------------------------------------------------
-- Sostituisce il download dell'intera storia di assegnazioni fatto da
-- `StaffHoursSection` e `StaffPerformanceSection` per ricavarne sette numeri.
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
      and s.date < current_date
  )
  select
    count(*)::int,
    count(*) filter (where status not in ('declined', 'no_show'))::int,
    count(*) filter (where status = 'no_show')::int,
    count(*) filter (where status = 'declined')::int,
    coalesce(sum(hours) filter (where status not in ('declined', 'no_show')), 0),
    count(*) filter (
      where status not in ('declined', 'no_show')
        and date >= date_trunc('month', current_date)::date
    )::int,
    coalesce(sum(hours) filter (
      where status not in ('declined', 'no_show')
        and date >= date_trunc('month', current_date)::date
    ), 0)
  from past;
$$;

revoke execute on function public.get_staff_performance(uuid) from anon, public;
grant  execute on function public.get_staff_performance(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Scheda organico: ultimi turni svolti
-- ---------------------------------------------------------------------------
-- La lista mostra le ultime righe, ma PostgREST non sa ordinare le righe padre
-- per una colonna dell'embed (`shift.date`), quindi il client era costretto a
-- scaricare tutto e ordinare in memoria. Qui l'ordine e il limite sono veri.
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
    and s.date < current_date
    and a.status not in ('declined', 'no_show')
  order by s.date desc, s.start_time desc
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.get_staff_worked_shifts(uuid, integer) from anon, public;
grant  execute on function public.get_staff_worked_shifts(uuid, integer) to authenticated;
