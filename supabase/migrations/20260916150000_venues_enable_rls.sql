-- ⚠️ `venues: public read` — l'ultimo residuo del marketplace, e una fuga di dati.
--
-- `public.venues` era leggibile da **chiunque**, senza login, con la sola anon
-- key che viaggia nel bundle del client:
--
--     GET /rest/v1/venues?select=*
--     → 200, tutti i locali del progetto: nome, indirizzo, città, descrizione,
--       logo e `owner_id`.
--
-- Non era la RLS spenta — una POST anonima sulla stessa tabella rispondeva
-- «new row violates row-level security policy», quindi la RLS era ed è attiva.
-- Era una policy, una sola, nata in M1 e mai più toccata:
--
--     CREATE POLICY "venues: public read" ON public.venues
--       FOR SELECT USING (true);          -- supabase/schema.sql:410
--
-- Serviva al marketplace: il professionista che sfogliava i turni aperti doveva
-- vedere di che locale si trattasse. Il marketplace è stato rimosso dal codice
-- il 2026-09-12 e le sue policy sono state chiuse una per una — `shifts: waiter
-- reads non-cancelled` in 20260715160000, `profiles: manager sees applicant
-- profiles` e `waiter_profiles: manager reads applicants` in 20260912130000, le
-- tre di `applications` altrove. Questa è sfuggita, perché `getMyVenues()` aveva
-- un `.eq("owner_id", …)` che la copriva: nessuno vedeva mai righe altrui.
--
-- La F1 dei collaboratori ha tolto quel filtro **di proposito** — con i delegati
-- il perimetro non è più «le sedi di X» ma «le sedi che vedo io», e quel
-- perimetro doveva essere la RLS. Tolto il filtro applicativo sopra una policy
-- `using (true)`, la select ha iniziato a restituire quello che la query dice:
-- tutte le righe. È così che un account appena registrato, senza alcun invito,
-- ha aperto la dashboard trovandosi in lista i due locali di un estraneo.
--
-- La lezione, che vale oltre questa tabella: **le policy giuste non bastano, se
-- accanto ne resta una vecchia**. Sono permissive e vanno in OR: la più larga
-- vince, sempre. Quando si sposta un controllo dal client alla RLS, si guarda
-- l'elenco **completo** delle policy di quella tabella, non solo quella che si
-- sta scrivendo.
--
-- ⚠️ Prerequisito: 20260916110000 (`venues: delegate read`).

-- ---------------------------------------------------------------------------
-- 1. PRIMA il sostituto, poi il drop
-- ---------------------------------------------------------------------------
-- ⚠️ L'ordine non è estetica. `venues: public read` è ciò che oggi fa vedere al
-- **professionista** i locali per cui lavora: droppandola senza rimpiazzo si
-- rompe tutto il suo lato, e si rompe in silenzio. `getMyPendingInvites`,
-- `getMyEmployers`, `getMyDocumentScopes` (src/features/staff/api.ts) e
-- `getShiftWithVenue` (src/features/shifts/api.ts) leggono il locale con un
-- embed `venue:venues(...)`, e PostgREST non distingue «riga filtrata dalla RLS»
-- da «riga assente»: l'embed torna `null`. Niente errori, niente log — solo
-- «I tuoi locali» vuoto e le card turno senza nome né logo. È esattamente il
-- guasto che 20260912130000 era andato a riparare sui profili.
--
-- `setof uuid` e non un predicato booleano `is_my_staff_venue(uuid)`: la forma
-- booleana si legge meglio e sarebbe l'errore, perché dentro una policy dipende
-- dalla riga e Postgres la chiamerebbe una volta per riga. `venues.id in (select
-- …)` non dipende dalla riga e viene valutato una volta per statement
-- (InitPlan). Stessa ragione di `my_venue_ids` (20260916110000) e
-- `my_staff_member_ids` (20260916140000): su questo progetto l'IO del database è
-- già finito una volta.
--
-- `security definer`: dentro una policy su `venues`, una funzione invoker che
-- legge `staff_members` ricadrebbe nelle policy di quella tabella.
create or replace function public.my_staff_venue_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select sm.venue_id from public.staff_members sm
   where sm.waiter_id = (select auth.uid());
$$;

revoke execute on function public.my_staff_venue_ids() from anon, public;
grant  execute on function public.my_staff_venue_ids() to authenticated;

comment on function public.my_staff_venue_ids() is
  'Le sedi in cui chi chiama è (o è stato) in organico. È il perimetro con cui un professionista legge public.venues da quando la lettura pubblica è stata chiusa.';

-- Nessun filtro su `link_status`, di proposito: l'invito **in attesa** è proprio
-- il momento in cui serve sapere quale locale ti sta chiamando, e una scheda
-- chiusa (`left`) resta attaccata allo storico delle ore.
drop policy if exists "venues: staff read" on public.venues;
create policy "venues: staff read"
  on public.venues for select
  to authenticated
  using (venues.id in (select public.my_staff_venue_ids()));

-- ---------------------------------------------------------------------------
-- 2. Il drop
-- ---------------------------------------------------------------------------
drop policy if exists "venues: public read" on public.venues;

-- ---------------------------------------------------------------------------
-- 3. Rete di sicurezza
-- ---------------------------------------------------------------------------
-- Idempotente: su `venues` la RLS è già attiva. Sta qui perché una policy non è
-- una prova — la prova è `relrowsecurity` — e questa riga costa nulla.
alter table public.venues enable row level security;

-- E le altre tabelle che avessero policy ma l'interruttore spento. ⚠️ Il filtro
-- `exists (… pg_policies …)` non è prudenza generica: accende la RLS **solo**
-- dove qualcuno ha già scritto almeno una policy, cioè dove l'intenzione di
-- proteggere c'era ed è rimasta a metà. Una tabella deliberatamente pubblica non
-- ha policy e non viene toccata — accenderle la RLS la renderebbe muta per
-- tutti, che è il modo di rompere qualcosa mentre si crede di ripararlo.
do $$
declare
  r record;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind = 'r'
       and not c.relrowsecurity
       and exists (
         select 1 from pg_policies p
          where p.schemaname = 'public' and p.tablename = c.relname
       )
  loop
    raise notice 'RLS non attiva su public.%: la accendo', r.relname;
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Dire cosa è rimasto
-- ---------------------------------------------------------------------------
-- Le migration descrivono le policy che il repo conosce; la dashboard di
-- Supabase permette di crearne altre a mano, che in nessun file compaiono. Dopo
-- una fuga nata proprio da una policy invisibile, la migration stampa l'elenco
-- vero: devono essere **tre** — `venues: owner crud`, `venues: delegate read`,
-- `venues: staff read`. Qualunque altra riga qui sotto va guardata.
do $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select policyname, cmd, coalesce(qual::text, '—') as qual
      from pg_policies
     where schemaname = 'public' and tablename = 'venues'
     order by policyname
  loop
    n := n + 1;
    raise notice 'venues → % [%] using %', r.policyname, r.cmd, r.qual;
  end loop;
  raise notice 'venues: % policy totali (attese: 3)', n;
end;
$$;
