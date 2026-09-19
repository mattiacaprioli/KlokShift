-- Il seme degli accessi delegati: una sola definizione di "può gestire questa sede".
--
-- Oggi "titolare" è una colonna sola, `venues.owner_id`, e una ventina di policy
-- ne ripetono l'espressione parola per parola:
--
--   exists (select 1 from venues v where v.id = … and v.owner_id = (select auth.uid()))
--
-- Finché la regola è "sei il proprietario" quella ripetizione costa poco. Nel
-- momento in cui il titolare può far entrare qualcun altro su una sola sede, e
-- con un permesso solo, ogni copia diventa un posto in cui la regola può restare
-- indietro — e una policy dimenticata qui non è un difetto di UI, è la sede di
-- un altro locale che si vede.
--
-- Questa migration NON cambia niente di visibile: il perimetro guarda solo
-- `owner_id`, esattamente come le policy che sostituisce. Serve a spostare la
-- regola in un posto solo, così che introdurre i delegati sia riscrivere due
-- funzioni invece di venti policy. Stesso schema di
-- `can_access_staff_person_documents` (20260913100100), stesso motivo.
--
-- ⚠️ Il giro di prova dopo questa migration deve essere IDENTICO a prima:
-- turni, staff, ruoli, ore, candidature. Se qualcosa cambia, è un errore di
-- trascrizione, non una feature.

-- ---------------------------------------------------------------------------
-- 1. La regola, in due forme
-- ---------------------------------------------------------------------------
-- Due funzioni e non una, e la differenza è solo di prestazioni — ma di un
-- ordine di grandezza, su un progetto che ha già finito una volta il disk IO.
--
-- `my_venue_ids()` non dipende dalla riga: dentro una policy Postgres la valuta
-- **una volta per statement** (InitPlan) e poi confronta un id contro una lista
-- corta. È la forma da usare in ogni policy.
--
-- `can_manage_venue()` prende una sede e risponde sì/no: serve alle RPC
-- `security definer` (F2), che una sede ce l''hanno già in mano e non guadagnano
-- niente a materializzare una lista.
--
-- ⚠️ `security definer` non è cautela, è obbligatorio: queste funzioni girano
-- DENTRO le policy di `shifts`, `staff_members`, … e leggono `venues`. Una
-- funzione invoker rientrerebbe nelle policy di `venues` ogni volta che viene
-- valutata. `stable` + `set search_path = ''` come tutte le DEFINER del progetto.
--
-- `p_perm` non fa ancora niente: è il parametro che in F1 distinguerà il
-- delegato che può solo fare i turni da quello che vede anche le ore. Sta qui
-- da subito perché aggiungerlo dopo vorrebbe dire riscrivere di nuovo le stesse
-- venti policy. Valori previsti:
--   'any'       — vede la sede (nome, indirizzo): il minimo per capire un turno
--   'shifts'    — turni, assegnazioni, fabbisogni, candidature
--   'staff'     — organico della sede e ruoli assegnati
--   'hours'     — ore lavorate ed export
--   'documents' — documenti delle persone
--   'venue'     — dati della sede e listino ruoli
create or replace function public.my_venue_ids(p_perm text default 'shifts')
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select v.id from public.venues v
   where v.owner_id = (select auth.uid());
$$;

comment on function public.my_venue_ids(text) is
  'Le sedi che chi interroga può gestire con quel permesso. Forma da usare nelle '
  'policy: non dipende dalla riga, quindi Postgres la valuta una volta per statement.';

create or replace function public.can_manage_venue(
  p_venue uuid,
  p_perm  text default 'shifts'
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.venues v
     where v.id = p_venue
       and v.owner_id = (select auth.uid())
  );
$$;

comment on function public.can_manage_venue(uuid, text) is
  'Stessa regola di my_venue_ids() su una sede sola: per le RPC security definer, '
  'che bypassano le policy e devono rifare il controllo da sé.';

-- Le policy le chiamano per conto di chi interroga: devono essere eseguibili
-- dai ruoli REST. Non espongono niente che l''utente non possa già dedurre da
-- una select su `venues`.
grant execute on function public.my_venue_ids(text)          to authenticated;
grant execute on function public.can_manage_venue(uuid, text) to authenticated;
revoke execute on function public.my_venue_ids(text)          from anon, public;
revoke execute on function public.can_manage_venue(uuid, text) from anon, public;

-- ---------------------------------------------------------------------------
-- 2. venues
-- ---------------------------------------------------------------------------
-- `"venues: owner crud"` resta com''è: scrivere una sede è del proprietario e
-- basta, anche dopo F1. Si aggiunge solo una SELECT separata — le policy
-- permissive vanno in OR, quindi oggi è ridondante e domani è la riga che fa
-- comparire la sede delegata nello switcher, senza concedere nessuna scrittura.
drop policy if exists "venues: delegate read" on public.venues;
create policy "venues: delegate read"
  on public.venues for select
  to authenticated
  using (venues.id in (select public.my_venue_ids('any')));

-- ---------------------------------------------------------------------------
-- 3. shifts
-- ---------------------------------------------------------------------------
-- ⚠️ `"shifts: read marketplace or assigned"` (20260715160000) non si tocca: è
-- il lato professionista e non passa da `owner_id`.
drop policy if exists "shifts: manager crud own" on public.shifts;
create policy "shifts: manager crud own"
  on public.shifts
  using (shifts.venue_id in (select public.my_venue_ids('shifts')))
  with check (shifts.venue_id in (select public.my_venue_ids('shifts')));

-- ---------------------------------------------------------------------------
-- 4. shift_assignments
-- ---------------------------------------------------------------------------
drop policy if exists "shift_assignments: owner all" on public.shift_assignments;
create policy "shift_assignments: owner all"
  on public.shift_assignments for all
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
       where s.id = shift_assignments.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
  )
  with check (
    exists (
      select 1 from public.shifts s
       where s.id = shift_assignments.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
  );

-- ---------------------------------------------------------------------------
-- 5. shift_role_requirements
-- ---------------------------------------------------------------------------
-- ⚠️ Il `with check` continua a verificare DUE cose: che il turno sia gestibile
-- e che il ruolo sia dello STESSO locale del turno. Senza il secondo, chi ha due
-- locali attacca un ruolo del locale A a un turno del locale B — nessuna FK lo
-- vieta (vedi 20260912120000).
drop policy if exists "shift_role_requirements: owner all" on public.shift_role_requirements;
create policy "shift_role_requirements: owner all"
  on public.shift_role_requirements for all
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
       where s.id = shift_role_requirements.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
  )
  with check (
    exists (
      select 1
        from public.shifts s
        join public.venue_roles r on r.venue_id = s.venue_id
       where s.id = shift_role_requirements.shift_id
         and r.id = shift_role_requirements.role_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
  );

-- ---------------------------------------------------------------------------
-- 6. venue_roles
-- ---------------------------------------------------------------------------
-- Il listino dei ruoli è un dato della sede, non dei turni: permesso 'venue'.
-- ⚠️ `"venue_roles: staff read"` non si tocca: è il professionista in organico.
drop policy if exists "venue_roles: owner all" on public.venue_roles;
create policy "venue_roles: owner all"
  on public.venue_roles for all
  to authenticated
  using (venue_roles.venue_id in (select public.my_venue_ids('venue')))
  with check (venue_roles.venue_id in (select public.my_venue_ids('venue')));

-- ---------------------------------------------------------------------------
-- 7. staff_member_roles
-- ---------------------------------------------------------------------------
-- Assegnare una mansione a una persona è gestione dell''organico ('staff'), non
-- del listino ('venue'): chi fa i turni deve poterlo fare, chi amministra la
-- sede non necessariamente.
drop policy if exists "staff_member_roles: owner all" on public.staff_member_roles;
create policy "staff_member_roles: owner all"
  on public.staff_member_roles for all
  to authenticated
  using (
    exists (
      select 1 from public.staff_members sm
       where sm.id = staff_member_roles.staff_member_id
         and sm.venue_id in (select public.my_venue_ids('staff'))
    )
  )
  with check (
    exists (
      select 1
        from public.staff_members sm
        join public.venue_roles r on r.venue_id = sm.venue_id
       where sm.id = staff_member_roles.staff_member_id
         and r.id  = staff_member_roles.role_id
         and sm.venue_id in (select public.my_venue_ids('staff'))
    )
  );

-- ---------------------------------------------------------------------------
-- 8. staff_members
-- ---------------------------------------------------------------------------
-- Le quattro policy di 20260914102811 restano quattro: il `for all` era stato
-- spezzato di proposito, perché il DELETE porta una condizione in più (niente
-- assegnazioni = niente storico di ore da difendere). Qui cambia solo il modo
-- in cui si stabilisce chi gestisce la sede.
--
-- ⚠️ `with check` continua a passare da `staff_people`: la persona deve
-- appartenere al titolare della sede. È ciò che impedisce di attaccare alla
-- propria sede la scheda di un''altra azienda, e vale anche per un delegato —
-- che infatti confronta `p.owner_id` con `v.owner_id`, non con `auth.uid()`.
drop policy if exists "staff_members: owner read" on public.staff_members;
create policy "staff_members: owner read"
  on public.staff_members for select
  to authenticated
  using (staff_members.venue_id in (select public.my_venue_ids('staff')));

drop policy if exists "staff_members: owner insert" on public.staff_members;
create policy "staff_members: owner insert"
  on public.staff_members for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.venues v
        join public.staff_people p on p.owner_id = v.owner_id
       where v.id = staff_members.venue_id
         and p.id = staff_members.person_id
         and v.id in (select public.my_venue_ids('staff'))
    )
  );

drop policy if exists "staff_members: owner update" on public.staff_members;
create policy "staff_members: owner update"
  on public.staff_members for update
  to authenticated
  using (staff_members.venue_id in (select public.my_venue_ids('staff')))
  with check (
    exists (
      select 1
        from public.venues v
        join public.staff_people p on p.owner_id = v.owner_id
       where v.id = staff_members.venue_id
         and p.id = staff_members.person_id
         and v.id in (select public.my_venue_ids('staff'))
    )
  );

drop policy if exists "staff_members: owner delete if never worked" on public.staff_members;
create policy "staff_members: owner delete if never worked"
  on public.staff_members for delete
  to authenticated
  using (
    staff_members.venue_id in (select public.my_venue_ids('staff'))
    and not exists (
      select 1 from public.shift_assignments a
       where a.staff_member_id = staff_members.id
    )
  );

-- ---------------------------------------------------------------------------
-- 9. applications
-- ---------------------------------------------------------------------------
-- Il marketplace è stato rimosso dal codice il 12/09: `applications` è inerte e
-- resta in DB. Si riscrive lo stesso, perché una policy inerte che continua a
-- dire `owner_id = auth.uid()` è esattamente il tipo di riga che resta indietro
-- se un giorno la tabella torna viva.
drop policy if exists "applications: manager reads own shifts" on public.applications;
create policy "applications: manager reads own shifts"
  on public.applications for select
  using (exists (
    select 1 from public.shifts s
     where s.id = applications.shift_id
       and s.venue_id in (select public.my_venue_ids('shifts'))
  ));

drop policy if exists "applications: manager updates status" on public.applications;
create policy "applications: manager updates status"
  on public.applications for update
  using (exists (
    select 1 from public.shifts s
     where s.id = applications.shift_id
       and s.venue_id in (select public.my_venue_ids('shifts'))
  ));

-- ---------------------------------------------------------------------------
-- 10. shift_change_requests
-- ---------------------------------------------------------------------------
-- Sola lettura: si scrive solo dalle RPC (`request_shift_change`,
-- `resolve_shift_change_request`), che hanno un controllo proprio da rifare in F2.
drop policy if exists "shift_change_requests: owner read" on public.shift_change_requests;
create policy "shift_change_requests: owner read"
  on public.shift_change_requests for select
  to authenticated
  using (
    exists (
      select 1 from public.shifts s
       where s.id = shift_change_requests.shift_id
         and s.venue_id in (select public.my_venue_ids('shifts'))
    )
  );

-- ---------------------------------------------------------------------------
-- Fuori da questa migration, di proposito
-- ---------------------------------------------------------------------------
-- `staff_people`, `profiles: manager reads own staff`, `waiter_profiles:
-- manager reads own staff` e `can_access_staff_person_documents` sono scopate
-- per AZIENDA (`staff_people.owner_id`), non per sede: non esiste un `venue_id`
-- da passare a queste funzioni. Riscriverle vuol dire decidere cosa vede di una
-- persona chi gestisce una sola delle sue sedi — contratto, documenti, ore
-- altrove — ed è il lavoro di F2, non una trascrizione.
--
-- Le RPC `security definer` (`get_owner_hours_summary`, `remove_staff_member`,
-- `resolve_shift_change_request`, `chat_counterpart`, …) bypassano le policy e
-- ricavano la proprietà da sé: restano a `owner_id = auth.uid()` finché non le
-- si affronta una per una in F2. Finché il perimetro qui sopra guarda solo
-- `owner_id`, le due strade dicono la stessa cosa.
