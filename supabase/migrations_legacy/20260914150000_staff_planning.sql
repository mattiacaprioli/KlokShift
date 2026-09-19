-- Il planning visto dal professionista: «chi lavora con me» e «chi c'è giovedì».
--
-- Fino a qui il professionista vedeva SOLO sé stesso. Tre muri, tutti sulla
-- stessa condizione `waiter_id = auth.uid()`:
--
--   · "shifts: read marketplace or assigned"        (20260715160000)
--   · "shift_assignments: linked waiter read"       (20260712075549)
--   · "staff_members: linked waiter read"           (20260712070246)
--
-- Il collega, lato client, non esisteva proprio. Ma un turno è un lavoro di
-- squadra: sapere chi c'è stasera, e chi è in turno sabato a cui chiedere un
-- cambio, è informazione di mestiere, non un extra.
--
-- ── Perché una RPC e non tre policy nuove ───────────────────────────────────
--
-- Allargare le tre policy sopra sarebbe stata la strada breve, ed è quella
-- sbagliata per due motivi indipendenti:
--
--   1. `staff_members` porta con sé `phone` e `note` — il numero di telefono e
--      gli appunti che il titolare scrive sulla persona. Una policy di SELECT
--      non sa restringere le colonne: aprire la riga ai colleghi significa
--      aprire anche quelle. (Stesso ragionamento di "staff_member_roles: linked
--      waiter read" in 20260912120000, che resta di proposito stretta.)
--   2. La policy su `shifts` interrogherebbe `shift_assignments`, la cui policy
--      owner interroga a sua volta `shifts`: la ricorsione RLS che
--      `is_my_assigned_shift` esiste apposta per evitare.
--
-- Una funzione DEFINER decide da sé quali colonne escono, e ne escono solo
-- queste: nome, foto, mansione del giorno. Niente telefono, niente note,
-- niente documenti, niente ore, niente compenso.
--
-- ── Cosa NON esce, e perché ────────────────────────────────────────────────
--
-- Lo stato dell'assegnazione. Un collega vede *chi c'è* (assegnato o
-- confermato, indistinguibili), non chi ha rifiutato e non chi è stato segnato
-- assente: `no_show` è un dato disciplinare fra titolare e persona, e farlo
-- leggere ai pari cambierebbe di natura il gesto di registrarlo.

-- ---------------------------------------------------------------------------
-- 1) L'interruttore del titolare
-- ---------------------------------------------------------------------------
-- Default `true`: la feature serve a chi lavora, e pretendere un'azione dal
-- titolare la renderebbe invisibile nella quasi totalità dei locali. Chi non
-- la vuole la spegne dalla scheda della sede, ed è per SEDE e non per azienda
-- perché un hotel e un catering dello stesso gruppo hanno abitudini diverse.
alter table public.venues
  add column if not exists staff_sees_planning boolean not null default true;

comment on column public.venues.staff_sees_planning is
  'Se true (default) chi è in organico attivo vede il planning della sede: turni del periodo e, su ciascuno, i colleghi in turno con nome, foto e mansione del giorno. Non espone mai telefono, note, ore o stato dell''assegnazione.';

-- ---------------------------------------------------------------------------
-- 2) Il planning
-- ---------------------------------------------------------------------------
-- Nessun parametro identifica una sede: la funzione parte da `auth.uid()` e
-- restituisce TUTTE le sedi in cui chi chiama è in organico attivo. È la stessa
-- scelta di `get_my_work_history` — non c'è nulla da passare per farsi dare il
-- planning di un locale altrui — e per giunta risolve in un round trip il caso
-- di chi lavora in due sedi dello stesso titolare (vedi 20260913100000).
--
-- Righe piatte, una per persona in turno. Un turno senza nessuno esce comunque,
-- con i campi della persona a null: «sabato sera non c'è ancora nessuno» è
-- esattamente ciò che si va a cercare.
create or replace function public.get_staff_planning(p_from date, p_to date)
returns table (
  venue_id        uuid,
  venue_name      text,
  venue_logo_url  text,
  shift_id        uuid,
  title           text,
  date            date,
  start_time      time,
  end_time        time,
  staff_member_id uuid,
  person_name     text,
  avatar_url      text,
  role_name       text,
  is_me           boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with me as (select (select auth.uid()) as uid),
  -- Le sedi che il chiamante può guardare. `link_status = 'active'` e non
  -- `<> 'left'`: un invito ancora `pending` non è organico, e mostrargli il
  -- planning prima che accetti significherebbe far leggere i nomi dello staff a
  -- chiunque il titolare abbia solo invitato.
  my_venues as (
    select v.id, v.name, v.logo_url
    from public.staff_members sm
    join public.venues v on v.id = sm.venue_id
    cross join me
    where sm.waiter_id = me.uid
      and sm.link_status = 'active'
      and v.staff_sees_planning
      and v.closed_at is null
  )
  select
    mv.id,
    mv.name,
    mv.logo_url,
    s.id,
    s.title,
    s.date,
    s.start_time,
    s.end_time,
    sm.id,
    sm.display_name,
    p.avatar_url,
    r.name,
    sm.waiter_id is not distinct from me.uid
  from public.shifts s
  join my_venues mv on mv.id = s.venue_id
  cross join me
  -- `assigned`/`confirmed` soltanto: vedi la nota in testa.
  left join public.shift_assignments a
    on a.shift_id = s.id
   and a.status in ('assigned', 'confirmed')
  -- Chi ha lasciato l'organico non lavorerà quel turno: fuori dall'elenco, ma
  -- il turno resta (esce con la persona a null, cioè come da coprire).
  left join public.staff_members sm
    on sm.id = a.staff_member_id
   and sm.link_status <> 'left'
  left join public.profiles p    on p.id = sm.waiter_id
  left join public.venue_roles r on r.id = a.role_id
  where s.kind = 'internal'
    and s.status <> 'cancelled'
    and s.date >= p_from
    -- Il tetto è del server e non del client: `shifts_venue_date_idx` regge un
    -- intervallo di settimane, non una richiesta di dieci anni di planning.
    and s.date <= least(p_to, p_from + 62)
  order by s.date, s.start_time, s.id, sm.display_name;
$$;

comment on function public.get_staff_planning(date, date) is
  'Il planning delle sedi in cui chi chiama è in organico attivo, dal p_from al p_to (max 62 giorni). Una riga per persona in turno; un turno scoperto esce con i campi della persona a null.';

revoke execute on function public.get_staff_planning(date, date) from anon, public;
grant  execute on function public.get_staff_planning(date, date) to authenticated;
