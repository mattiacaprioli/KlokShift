-- Performance / Disk IO — parte 5: lo storico lavoro del professionista si pagina.
--
-- "Le mie ore" fondeva due sorgenti, entrambe scaricate per intero:
--   • tutte le assegnazioni interne passate (con turno e locale annidati)
--   • TUTTE le candidature di sempre, poi filtrate a "accettate e passate"
-- e la schermata Profilo faceva lo stesso lavoro per mostrare **due numeri**.
--
-- Il client non poteva paginare da solo: l'ordinamento è per `shifts.date`, che
-- sta in una tabella collegata, e PostgREST non sa ordinare le righe padre per
-- una colonna dell'embed. Serviva l'unione lato server — che è anche il posto
-- giusto dove farla.
--
-- INVOKER (non DEFINER): la RLS resta il guardiano e la semantica è identica a
-- prima. Un professionista vede le proprie assegnazioni ("shift_assignments:
-- linked waiter read"), le proprie candidature ("applications: waiter own crud")
-- e i turni che gli competono ("shifts: read marketplace or assigned"). I turni
-- annullati restano fuori come prima, perché quella policy li esclude.
--
-- Nessun parametro identifica l'utente: si usa auth.uid(), quindi non c'è nulla
-- da passare per farsi dare lo storico di qualcun altro.

-- Sorgente unica delle due funzioni: l'unione delle due storie.
-- `key` replica gli identificatori che il client già usava ('asg-…' / 'app-…'),
-- così le liste restano stabili e le chiavi di React non cambiano.
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
    and s.date < current_date

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
    and s.date < current_date;
$$;

-- Helper interno: non passa da PostgREST (espone solo `public`) e non serve ad
-- anon. `authenticated` invece DEVE poterla eseguire: le due funzioni pubbliche
-- qui sotto sono INVOKER, quindi la chiamano con il ruolo di chi ha fatto la
-- richiesta. Prende `p_user` come parametro, ma essendo INVOKER la RLS non
-- restituirebbe comunque nulla per un utente diverso da chi chiama.
revoke execute on function private.my_work_history(uuid) from public;
grant  execute on function private.my_work_history(uuid) to authenticated;

-- Una pagina di storico, più recente prima.
create or replace function public.get_my_work_history(
  p_limit  integer default 20,
  p_offset integer default 0
)
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
  select *
  from private.my_work_history((select auth.uid()))
  -- `key` come secondo criterio: due turni nello stesso giorno devono avere un
  -- ordine deterministico, altrimenti la paginazione può ripetere o saltare righe.
  order by date desc, key desc
  limit greatest(p_limit, 0)
  offset greatest(p_offset, 0);
$$;

revoke execute on function public.get_my_work_history(integer, integer) from anon, public;
grant  execute on function public.get_my_work_history(integer, integer) to authenticated;

-- I due totali della schermata Profilo e dell'intestazione dello storico.
-- Esistono a parte proprio perché sono l'unica cosa che serve al Profilo: prima
-- per averli si scaricava tutto.
create or replace function public.get_my_work_history_totals()
returns table (
  total_count integer,
  total_hours numeric
)
language sql
stable
set search_path = ''
as $$
  select count(*)::int, coalesce(sum(hours), 0)
  from private.my_work_history((select auth.uid()));
$$;

revoke execute on function public.get_my_work_history_totals() from anon, public;
grant  execute on function public.get_my_work_history_totals() to authenticated;
