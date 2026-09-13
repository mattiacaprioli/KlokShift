-- Le ore sono della PERSONA, non della sede.
--
-- ── Rettifica dell'ADR di 20260913100000:16-17 ───────────────────────────────
--
-- Quella migration scrive: «Le ore restano per sede perché sono due buste paga
-- diverse». **È sbagliato**, e le migration sono storia immutabile: non si edita,
-- si supera qui.
--
-- Mattia è assunto da UNA azienda. 20 ore al locale di Roma e 20 a quello di
-- Milano non sono due mezze buste paga: sono 40 ore, una busta — e la 41ª è
-- straordinario anche se nessuna delle due sedi da sola arriva a 40. Lo split per
-- sede serve al TITOLARE per allocare il costo del lavoro, non al commercialista
-- per compilare il cedolino.
--
-- Conseguenza sul modello, da tenere a mente ogni volta che si tocca questa zona:
--
--     `staff_members` resta l'unità di ASSEGNAZIONE — il turno si fa in un
--     locale, con i ruoli di quel locale — ma non è più l'unità di RENDICONTO.
--     Il rendiconto è `staff_people`.
--
-- Il lato professionista era già giusto: `private.my_work_history`
-- (20260912090000:210) è per persona, cross-sede, con `venue_name` per riga. Le
-- tre funzioni qui sotto portano il lato gestore allo stesso livello.

-- ---------------------------------------------------------------------------
-- 1) Le ore dell'azienda, con il dettaglio per sede
-- ---------------------------------------------------------------------------
-- **Granularità: righe (persona × sede).** Il totale per persona lo fa il client
-- sommando 1–5 righe. Tre ragioni, la prima decisiva:
--
--   1. `roles` viene da `venue_roles`, che sono PER SEDE. A livello persona la
--      colonna non ha un valore vero: Marco è "Cameriere" a Roma e "Barman" a
--      Milano. La riga (persona × sede) è l'unico livello in cui `roles` è onesto.
--   2. Una chiamata, due livelli: la pagina mostra il totale, la riga espandibile
--      mostra le sedi, e l'export ottiene gratis sia il PDF gerarchico sia il CSV
--      per persona. Una RPC di soli totali costringerebbe a una seconda chiamata
--      per aprire una riga.
--   3. Nessun `grouping sets` da mappare in TypeScript.
--
-- **Nessun `p_owner`**, di proposito: sarebbe un parametro illusorio. La funzione
-- è INVOKER, quindi passando l'id di un altro titolare la RLS restituirebbe zero
-- righe senza spiegare perché — un parametro che accetta valori per cui non può
-- mai funzionare è peggio che non averlo. Il perimetro è `auth.uid()` e non è
-- negoziabile dal client.
--
-- **Le sedi chiuse restano dentro.** Chi ha lavorato a settembre in un locale
-- chiuso il 20 settembre ha quelle ore in busta paga: escluderle significherebbe
-- che chiudere un locale falsifica retroattivamente un cedolino. La colonna
-- `venue_closed` esiste perché la UI lo **dica**, non perché lo nasconda.
create or replace function public.get_owner_hours_summary(
  p_from date,
  p_to   date
)
returns table (
  person_id    uuid,
  person_name  text,
  venue_id     uuid,
  venue_name   text,
  venue_closed boolean,
  roles        text,
  shifts_count integer,
  hours        numeric
)
language sql
stable
set search_path = ''
as $$
  with per_venue as (
    select
      p.id        as person_id,
      p.full_name as person_name,
      v.id        as venue_id,
      v.name      as venue_name,
      v.closed_at as venue_closed_at,
      -- `sm.id` nel group by NON moltiplica le righe: l'unique
      -- `staff_members_venue_person_uq (venue_id, person_id)` (20260913100000)
      -- garantisce una sola appartenenza per coppia. Serve a poter usare sm.id
      -- nella sottoquery dei ruoli, fuori da questa CTE.
      sm.id         as member_id,
      count(*)::int as shifts_count,
      sum(coalesce(
        a.worked_hours,
        public.shift_duration_hours(s.start_time, s.end_time)
      )) as hours
    from public.shift_assignments a
    join public.shifts s         on s.id  = a.shift_id
    join public.venues v         on v.id  = s.venue_id
    join public.staff_members sm on sm.id = a.staff_member_id
    join public.staff_people p   on p.id  = sm.person_id
    -- Il filtro è esplicito e non lasciato alla sola RLS: `"venues: owner crud"`
    -- (20260910120000:209) passa già da owner_id, ma è QUESTO predicato che guida
    -- `venues_owner_idx` → `shifts_venue_date_idx`. Affidare il piano di
    -- esecuzione a una predicate pushdown che non controlliamo è come non avere
    -- un indice.
    where v.owner_id = (select auth.uid())
      and s.kind = 'internal'
      and s.date >= p_from
      and s.date <  p_to
      -- Solo turni conclusi: prima della fine non c'è niente da consuntivare.
      and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
      and a.status not in ('declined', 'no_show')
    group by p.id, p.full_name, v.id, v.name, v.closed_at, sm.id
  )
  select
    r.person_id,
    r.person_name,
    r.venue_id,
    r.venue_name,
    r.venue_closed_at is not null,
    -- Sottoquery e non join, per la stessa ragione di get_venue_hours_summary
    -- (20260912120000:445): un join su staff_member_roles moltiplicherebbe le
    -- righe e count/sum conterebbero ogni turno una volta per mansione. Numeri
    -- gonfiati, e solo per chi ha due ruoli.
    (
      select string_agg(vr.name, ', ' order by vr.sort_order, vr.name)
        from public.staff_member_roles smr
        join public.venue_roles vr on vr.id = smr.role_id
       where smr.staff_member_id = r.member_id
         and vr.archived_at is null
    ),
    r.shifts_count,
    r.hours
  from per_venue r
  -- L'ordine è quello della pagina, e il client NON riordina: le persone per ore
  -- totali decrescenti, e dentro ogni persona le sue sedi in ordine alfabetico.
  -- Se ordinasse il client, la pagina e il file esportato finirebbero per
  -- mostrare due ordini diversi dello stesso mese.
  order by sum(r.hours) over (partition by r.person_id) desc,
           r.person_name,
           r.venue_name;
$$;

comment on function public.get_owner_hours_summary(date, date) is
  'Ore lavorate nell''intervallo per (persona × sede), su TUTTE le sedi del titolare, sedi chiuse incluse. Il totale per persona è la somma delle sue righe: è quello che va in busta paga. Supera get_venue_hours_summary, che vedeva una sede sola.';

revoke execute on function public.get_owner_hours_summary(date, date) from anon, public;
grant  execute on function public.get_owner_hours_summary(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 2) Statistiche della persona, su tutte le sedi
-- ---------------------------------------------------------------------------
-- Identica a `get_staff_performance` (20260912090000:112) salvo il perimetro: il
-- filtro passa da `a.staff_member_id = ?` a `sm.person_id = ?`. Sette numeri che
-- rispondono a «quanto ha lavorato per me» — e "per me" è il titolare, non uno
-- dei suoi indirizzi. Prima un'assenza fatta a Milano non scalfiva il 100% di
-- affidabilità di Roma.
--
-- L'affidabilità (`worked_count / past_total`) resta derivata nel client: è il
-- rapporto di due numeri già qui, e portarla in SQL aggiungerebbe una colonna,
-- una decisione sull'arrotondamento e un secondo posto dove gestire `past_total = 0`.
create or replace function public.get_person_performance(p_person uuid)
returns table (
  past_total     integer,
  worked_count   integer,
  no_show_count  integer,
  declined_count integer,
  total_hours    numeric,
  month_shifts   integer,
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
    join public.staff_members sm on sm.id = a.staff_member_id
    join public.shifts s         on s.id  = a.shift_id
    where sm.person_id = p_person
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

revoke execute on function public.get_person_performance(uuid) from anon, public;
grant  execute on function public.get_person_performance(uuid) to authenticated;

-- Ultimi turni svolti dalla persona, **con la sede**. Senza `venue_name` una lista
-- cross-sede sarebbe illeggibile: due turni lo stesso giovedì alla stessa ora in
-- due locali diversi sembrerebbero un doppione.
create or replace function public.get_person_worked_shifts(
  p_person uuid,
  p_limit  integer default 6
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
  hours        numeric,
  venue_id     uuid,
  venue_name   text
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
    ),
    v.id, v.name
  from public.shift_assignments a
  join public.staff_members sm on sm.id = a.staff_member_id
  join public.shifts s         on s.id  = a.shift_id
  join public.venues v         on v.id  = s.venue_id
  where sm.person_id = p_person
    and public.shift_ends_at(s.date, s.start_time, s.end_time) <= public.local_now()
    and a.status not in ('declined', 'no_show')
  -- `order by s.date desc, s.start_time desc` com'era (20260912090000:196): è già
  -- cronologico all'indietro anche coi turni notturni, perché un turno appartiene
  -- al giorno in cui INIZIA. Non "correggerlo".
  order by s.date desc, s.start_time desc
  limit greatest(p_limit, 0);
$$;

revoke execute on function public.get_person_worked_shifts(uuid, integer) from anon, public;
grant  execute on function public.get_person_worked_shifts(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 3) Le tre vecchie restano un rilascio, deprecate
-- ---------------------------------------------------------------------------
-- Nomi nuovi e non `create or replace` delle vecchie: cambierebbero le colonne
-- del record restituito, servirebbe un `drop function` (che si porta via i grant)
-- e — soprattutto — **l'app già installata le chiama**. Droppare prima che la
-- build nuova sia diffusa romperebbe la pagina Ore a chi non ha aggiornato.
-- Si droppano in una migration successiva, quando la build N-1 è fuori circolazione.
comment on function public.get_venue_hours_summary(uuid, date, date) is
  'DEPRECATA (20260913110100): la pagina Ore è per azienda, non per sede. Usare get_owner_hours_summary. Resta per le build già installate; droppare quando la N-1 è fuori circolazione.';
comment on function public.get_staff_performance(uuid) is
  'DEPRECATA (20260913110100): le ore sono della persona, non dell''appartenenza. Usare get_person_performance. Resta per le build già installate.';
comment on function public.get_staff_worked_shifts(uuid, integer) is
  'DEPRECATA (20260913110100): usare get_person_worked_shifts, che porta anche la sede. Resta per le build già installate.';
