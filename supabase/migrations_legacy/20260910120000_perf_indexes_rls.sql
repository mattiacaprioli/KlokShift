-- Performance / Disk IO — parte 1: indici mancanti + InitPlan sulle policy RLS.
--
-- Contesto: il progetto stava esaurendo il Disk IO budget con un database da
-- 27 MB. Un DB così piccolo non satura l'IO leggendo dati "grandi": lo satura
-- rileggendo per intero le stesse poche tabelle. Causa: schema.sql crea le 8
-- tabelle core senza NEMMENO UN indice. In Postgres le foreign key non sono
-- indicizzate automaticamente, quindi shifts.venue_id, applications.waiter_id,
-- notifications.user_id, venues.owner_id, conversations.manager_id e
-- messages.sender_id erano tutte scansioni sequenziali.
--
-- L'effetto è moltiplicativo, non additivo: gli indici riducono sia le righe
-- lette dalle query sia le righe su cui le policy RLS vengono valutate.
--
-- Nessuna modifica al codice applicativo: solo indici e riscrittura delle
-- policy con la stessa identica logica.

-- ---------------------------------------------------------------------------
-- 1) Indici
-- ---------------------------------------------------------------------------
-- Le tabelle sono piccole: CREATE INDEX semplice va bene. Niente CONCURRENTLY,
-- che non può girare dentro la transazione di `supabase db push`.

-- shifts: nessun indice oltre la PK. Copre il calendario/planning del locale
-- (venue_id + range di date) e il feed marketplace del professionista.
create index if not exists shifts_venue_date_idx
  on public.shifts (venue_id, date);

create index if not exists shifts_marketplace_feed_idx
  on public.shifts (date, start_time)
  where kind = 'marketplace' and status = 'open';

-- applications: waiter_id NON è coperta da applications_shift_id_waiter_id_key,
-- perché è la seconda colonna dell'unique. Ed è la colonna da cui parte l'EXISTS
-- delle policy su profiles/waiter_profiles, valutato per ogni riga di profiles.
create index if not exists applications_waiter_status_idx
  on public.applications (waiter_id, status);

-- Usato dal trigger sync_positions_filled (count degli 'accepted' per turno) e
-- dalla lista candidature del turno.
create index if not exists applications_shift_status_idx
  on public.applications (shift_id, status);

-- notifications: sette trigger ci scrivono dentro e non aveva un solo indice.
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- Badge non letti + dedupe di notify_on_new_message + mark_conversation_read.
create index if not exists notifications_unread_idx
  on public.notifications (user_id, type, related_id)
  where read_at is null;

-- venues.owner_id: gate di ogni schermata del ristoratore (getMyVenue) e ramo
-- manager di chat_counterpart.
create index if not exists venues_owner_idx
  on public.venues (owner_id);

-- conversations: manager_id è la seconda colonna dell'unique, quindi scoperta.
-- shift_id serve al ON DELETE SET NULL quando si cancella un turno.
create index if not exists conversations_manager_idx
  on public.conversations (manager_id);

create index if not exists conversations_shift_idx
  on public.conversations (shift_id);

-- messages: sender_id per la policy "sender update" e il ON DELETE CASCADE.
create index if not exists messages_sender_idx
  on public.messages (sender_id);

-- Badge messaggi non letti: indice parziale, resta minuscolo perché i messaggi
-- letti escono dall'indice.
create index if not exists messages_unread_idx
  on public.messages (conversation_id, sender_id)
  where read_at is null;

-- reviews: due FK ON DELETE SET NULL, oggi seq scan a ogni delete di turno/locale.
create index if not exists reviews_shift_idx
  on public.reviews (shift_id);

create index if not exists reviews_venue_idx
  on public.reviews (venue_id);

-- Ridondante: è il prefisso esatto di messages_conversation_created_id_idx
-- (20260716110100). Due indici da mantenere in scrittura per zero beneficio.
drop index if exists public.messages_conversation_created_idx;

-- ---------------------------------------------------------------------------
-- 2) InitPlan: (select auth.uid())
-- ---------------------------------------------------------------------------
-- `auth.uid()` nudo è volatile per il planner e viene rivalutato PER RIGA.
-- Wrappato in un subselect diventa un InitPlan: valutato una volta sola per
-- query. Le 14 policy qui sotto sono quelle di schema.sql, mai riscritte da
-- allora; le policy create da luglio in poi (staff_members, shift_assignments,
-- shift_role_requirements, waiter_experiences, push_tokens) sono già corrette.
--
-- ⚠️ Le definizioni sono copiate VERBATIM da schema.sql: cambia SOLO auth.uid().
-- Nessuna policy cambia semantica, nessuna cambia il comando (FOR ALL / SELECT /
-- UPDATE / INSERT) né il ruolo (tutte restano TO public, come in origine).

-- applications ---------------------------------------------------------------
drop policy if exists "applications: manager reads own shifts" on public.applications;
create policy "applications: manager reads own shifts"
  on public.applications for select
  using (exists (
    select 1
    from public.shifts s
    join public.venues v on v.id = s.venue_id
    where s.id = applications.shift_id
      and v.owner_id = (select auth.uid())
  ));

drop policy if exists "applications: manager updates status" on public.applications;
create policy "applications: manager updates status"
  on public.applications for update
  using (exists (
    select 1
    from public.shifts s
    join public.venues v on v.id = s.venue_id
    where s.id = applications.shift_id
      and v.owner_id = (select auth.uid())
  ));

drop policy if exists "applications: waiter own crud" on public.applications;
create policy "applications: waiter own crud"
  on public.applications
  using (waiter_id = (select auth.uid()))
  with check (waiter_id = (select auth.uid()));

-- conversations --------------------------------------------------------------
drop policy if exists "conversations: participants only" on public.conversations;
create policy "conversations: participants only"
  on public.conversations
  using (waiter_id = (select auth.uid()) or manager_id = (select auth.uid()))
  with check (waiter_id = (select auth.uid()) or manager_id = (select auth.uid()));

-- messages -------------------------------------------------------------------
drop policy if exists "messages: participants insert" on public.messages;
create policy "messages: participants insert"
  on public.messages for insert
  with check (
    sender_id = (select auth.uid())
    and exists (
      select 1
      from public.conversations c
      where c.id = messages.conversation_id
        and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()))
    )
  );

drop policy if exists "messages: participants read" on public.messages;
create policy "messages: participants read"
  on public.messages for select
  using (exists (
    select 1
    from public.conversations c
    where c.id = messages.conversation_id
      and (c.waiter_id = (select auth.uid()) or c.manager_id = (select auth.uid()))
  ));

drop policy if exists "messages: sender update" on public.messages;
create policy "messages: sender update"
  on public.messages for update
  using (sender_id = (select auth.uid()));

-- notifications --------------------------------------------------------------
drop policy if exists "notifications: own only" on public.notifications;
create policy "notifications: own only"
  on public.notifications
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- profiles -------------------------------------------------------------------
-- Questa era la peggiore: l'EXISTS parte da applications.waiter_id (finora non
-- indicizzata) e veniva valutato per OGNI riga di profiles scansionata.
drop policy if exists "profiles: manager sees applicant profiles" on public.profiles;
create policy "profiles: manager sees applicant profiles"
  on public.profiles for select
  using (
    role = 'waiter'::public.user_role
    and exists (
      select 1
      from public.applications a
      join public.shifts s on s.id = a.shift_id
      join public.venues v on v.id = s.venue_id
      where a.waiter_id = profiles.id
        and v.owner_id = (select auth.uid())
    )
  );

drop policy if exists "profiles: own read/write" on public.profiles;
create policy "profiles: own read/write"
  on public.profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- shifts ---------------------------------------------------------------------
drop policy if exists "shifts: manager crud own" on public.shifts;
create policy "shifts: manager crud own"
  on public.shifts
  using (exists (
    select 1 from public.venues v
    where v.id = shifts.venue_id and v.owner_id = (select auth.uid())
  ))
  with check (exists (
    select 1 from public.venues v
    where v.id = shifts.venue_id and v.owner_id = (select auth.uid())
  ));

-- venues ---------------------------------------------------------------------
drop policy if exists "venues: owner crud" on public.venues;
create policy "venues: owner crud"
  on public.venues
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- waiter_profiles ------------------------------------------------------------
drop policy if exists "waiter_profiles: manager reads applicants" on public.waiter_profiles;
create policy "waiter_profiles: manager reads applicants"
  on public.waiter_profiles for select
  using (exists (
    select 1
    from public.applications a
    join public.shifts s on s.id = a.shift_id
    join public.venues v on v.id = s.venue_id
    where a.waiter_id = waiter_profiles.id
      and v.owner_id = (select auth.uid())
  ));

drop policy if exists "waiter_profiles: own read/write" on public.waiter_profiles;
create policy "waiter_profiles: own read/write"
  on public.waiter_profiles
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- storage.objects ------------------------------------------------------------
-- Stesse policy di 20260705140000_onboarding.sql, con auth.uid() wrappato.
drop policy if exists "certs: owner read" on storage.objects;
create policy "certs: owner read" on storage.objects for select
  to authenticated
  using (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "certs: owner insert" on storage.objects;
create policy "certs: owner insert" on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "certs: owner update" on storage.objects;
create policy "certs: owner update" on storage.objects for update
  to authenticated
  using (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "certs: owner delete" on storage.objects;
create policy "certs: owner delete" on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'certifications'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

-- ---------------------------------------------------------------------------
-- 3) Statistiche
-- ---------------------------------------------------------------------------
-- Senza questo il planner continua a usare le stime vecchie e può ignorare i
-- nuovi indici finché non passa l'autovacuum.
analyze public.shifts;
analyze public.applications;
analyze public.notifications;
analyze public.venues;
analyze public.conversations;
analyze public.messages;
analyze public.profiles;
analyze public.waiter_profiles;
analyze public.reviews;
