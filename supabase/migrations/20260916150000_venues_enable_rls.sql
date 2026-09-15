-- ⚠️ `public.venues` non aveva la row level security attiva.
--
-- Le due policy c'erano ed erano scritte bene (`venues: owner crud` dal
-- 20260910120000, `venues: delegate read` dal 20260916110000). Ma una policy su
-- una tabella con `relrowsecurity = false` non filtra niente: è documentazione.
-- Risultato, verificato con una chiamata REST **senza nessun login**, con la
-- sola anon key che viaggia nel bundle del client:
--
--     GET /rest/v1/venues?select=*
--     → 200, tutti i locali del progetto: nome, indirizzo, città, descrizione,
--       logo e `owner_id`.
--
-- Non è un buco nato oggi, ma dal 16/09/2026 è diventato visibile **e** molto
-- peggio. `getMyVenues()` aveva un `.eq("owner_id", …)` esplicito che mascherava
-- tutto: la F1 l'ha tolto di proposito, perché con i collaboratori il perimetro
-- non è più «le sedi di X» ma «le sedi che vedo io», e quel perimetro è la RLS.
-- Tolto il filtro applicativo senza che la RLS fosse accesa, la select è tornata
-- quello che la query dice: tutte le righe. È così che un account appena
-- registrato si è trovato in lista i due locali di un altro.
--
-- Da qui la lezione, che vale oltre questa tabella: **una policy non è una
-- prova**. La prova è `relrowsecurity`, e la verifica è una GET anonima.
--
-- ⚠️ Prerequisito: 20260916110000 (la policy del delegato).

-- ---------------------------------------------------------------------------
-- 1. Il professionista deve continuare a vedere i locali per cui lavora
-- ---------------------------------------------------------------------------
-- Prima di accendere l'interruttore: con le sole due policy esistenti — titolare
-- e delegato — accendere la RLS **romperebbe tutto il lato professionista**, e lo
-- romperebbe in silenzio. `getMyPendingInvites`, `getMyEmployers`,
-- `getMyDocumentScopes` e `getShiftWithVenue` leggono il locale con un embed
-- (`venue:venues(...)`), e PostgREST non distingue «riga filtrata dalla RLS» da
-- «riga assente»: l'embed torna `null`. Niente errori, niente log — solo i
-- «I tuoi locali» vuoti e le card turno senza nome né logo. È esattamente il
-- guasto che 20260912130000 era andato a riparare sui profili.
--
-- Nessun filtro su `link_status`, di proposito: l'invito **in attesa** è proprio
-- il momento in cui serve sapere quale locale ti sta chiamando, e una scheda
-- chiusa (`left`) resta attaccata allo storico delle ore.
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
  'Le sedi in cui chi chiama è (o è stato) in organico. DEFINER perché dentro una policy su venues una funzione invoker che legge staff_members ricadrebbe nelle policy di quella tabella; setof uuid e non un predicato perché `venues.id in (select …)` non dipende dalla riga e Postgres lo valuta una volta per statement.';

drop policy if exists "venues: staff read" on public.venues;
create policy "venues: staff read"
  on public.venues for select
  to authenticated
  using (venues.id in (select public.my_staff_venue_ids()));

-- ---------------------------------------------------------------------------
-- 2. L'interruttore
-- ---------------------------------------------------------------------------
-- ⚠️ `enable`, non `force`: `force` vale anche per il proprietario della tabella,
-- e tutte le funzioni `security definer` che leggono `venues` (le notifiche, le
-- ore, la chat) girano come `postgres`. Attivarlo le spegnerebbe.
alter table public.venues enable row level security;

-- ---------------------------------------------------------------------------
-- 3. E tutte le altre che fossero nella stessa condizione
-- ---------------------------------------------------------------------------
-- Il sondaggio anonimo del 15/09 ha trovato **solo** `venues` (e
-- `waiter_experiences`, che è pubblica di proposito: è il CV del
-- professionista). Ma le tabelle vuote non si distinguono da quelle protette
-- guardando una risposta a zero righe, quindi il controllo va fatto sul
-- catalogo, non sui dati.
--
-- ⚠️ Il filtro `exists (… pg_policies …)` non è prudenza generica, è la
-- condizione che rende questo blocco sicuro: accende la RLS **solo** dove
-- qualcuno ha già scritto almeno una policy, cioè dove l'intenzione di
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
