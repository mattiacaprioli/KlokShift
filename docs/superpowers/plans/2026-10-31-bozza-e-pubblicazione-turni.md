# Turni in bozza e pubblicazione — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** i turni nuovi nascono in bozza, invisibili e silenziosi per il team, finché chi gestisce non preme «Pubblica». La pubblicazione manda una notifica per persona.

**Architecture:** `shifts.published_at` (null = bozza) sul modello esistente. Policy RLS **restrittive** nascondono le bozze a chi non ha `roster`. Ogni funzione DEFINER che legge i turni le esclude per conto suo. Nuove RPC: anteprima, pubblicazione, «Conferma tutti», «Registra come fatto». Il promemoria delle bozze gira con pg_cron. Le frasi e le regole pure stanno in `src/features/shifts/drafts.ts`, condiviso fra app e dashboard.

**Tech Stack:** Postgres/Supabase (plpgsql, RLS, pg_cron), Expo SDK 56 + Expo Router + NativeWind, dashboard Vite/React (`web/`), React Query, vitest.

**Spec:** [docs/superpowers/specs/2026-10-31-bozza-e-pubblicazione-turni-design.md](../specs/2026-10-31-bozza-e-pubblicazione-turni-design.md): leggerla prima di ogni task.

## Global Constraints

- **Il default è pubblicato**: `published_at default now()`. Solo `create_shifts` con `"draft": true` nel piano crea una bozza. Le app già installate non mandano la chiave e devono continuare a funzionare come oggi.
- Le migration già esistenti sono **immutabili**: ogni modifica a una funzione è un `CREATE OR REPLACE` completo in una migration nuova. La definizione di partenza si prende **dal banco locale dopo `supabase/tests/run.sh reset`**, con `supabase/tests/run.sh sql "select pg_get_functiondef('public.X'::regprocedure)"`, perché alcune funzioni sono state riscritte da migration dinamiche (es. `20261030000000_glossary_copy.sql`).
- Nomi delle migration in ordine: `20261103000000_shift_drafts.sql`, `…000100_shift_drafts_silent.sql`, `…000200_shift_publish_types.sql`, `…000300_publish_shifts.sql`, `…000400_draft_reminders.sql`.
- Errori nuovi sollevati con `raise exception '<codice>'` e tradotti in `src/lib/errors.ts`: `shift_draft` (operazione non ammessa su una bozza), `shift_not_draft`, `shift_not_finished` (esiste già, va riusato).
- Tipi di notifica nuovi: `shift_published` e `shift_drafts_reminder`. Il prefisso `shift_` è voluto: la dashboard li classifica da sola come «Turni» (`web/src/pages/Notifiche.tsx:39`, `web/src/ui/NotificationIcon.tsx:9`).
- Vocabolario (`docs/GLOSSARIO.md`, `tests/unit/glossary.test.ts`): «team», «dipendente», «sede»; niente «organico», «staff», «professionista».
- Niente `console.log`. Componenti da `@/tw`. Le frasi utente in un modulo solo, mai scritte a mano in un punto.
- `src/types/database.ts` si rigenera con `supabase/tests/gen-types.sh`, mai a mano.
- **Niente commit né push**: li fa l'utente (memoria «Commit li fa l'utente»). Ogni task finisce con il checkpoint verde, non con un commit.
- Comandi di verifica: `supabase/tests/run.sh reset && supabase/tests/run.sh test`, `yarn vitest run <path>`, `npx tsc --noEmit`, `yarn lint`.

## Review Focus

1. **App vecchia senza la chiave `draft`**: crea turni pubblicati che avvisano come oggi. Test in Task 1.
2. **Bozza scaduta e ore**: il metodo «Manuale» fa contare subito un turno concluso senza timbratura (`manual_auto`). Una bozza passata **non** deve contare né comparire in «Ore da sistemare». Test in Task 2.
3. **Collaboratore con «Turni» solo su V1**: l'anteprima non include V2; se gli id contengono una bozza di V2, `publish_shifts` rifiuta tutta la chiamata. Test in Task 4.
4. **Doppio tocco su Pubblica / due gestori insieme**: nessuna notifica doppia, conteggio corretto. Test in Task 4.
5. **Titolare in turno, vista lavoro**: non vede le proprie bozze in agenda, Home e tab bar, anche se la RLS gliele lascia leggere perché ha `roster`. Test in Task 6.

---

### Task 1: Modello e visibilità della bozza

**Files:**
- Create: `supabase/migrations/20261103000000_shift_drafts.sql`
- Create: `supabase/tests/rls/152_shift_drafts.sql`
- Modify: `supabase/tests/seed.sql` (`tests.create_shifts` accetta `"draft"` come la RPC vera)

**Interfaces:**
- Produces: `shifts.published_at timestamptz default now()` (nullable: null = bozza); `shifts.published_by uuid references public.profiles(id) on delete set null`; `private.draft_shift_ids() returns setof uuid` (DEFINER, `stable`, execute ad `authenticated`); chiave di piano `create_shifts`: `"draft": boolean`.

- [ ] **Step 1: Scrivi il test SQL `152_shift_drafts.sql`, prima parte** (stile di `041_clock_reminders.sql`, date future fisse `current_date + 2`). Asserzioni:
  - `Ow` crea con `public.create_shifts` un piano **senza** `draft` per Emma su V1 → `published_at is not null`, `published_by = tests.id('Ow')`, Emma ha 1 notifica `shift_assigned`;
  - `Ow` crea un piano con `"draft": true` per Emma → `published_at is null`, `published_by is null`, **0** notifiche nuove a Emma;
  - come `Emp`: `select count(*) from public.shifts where id = <bozza>` = 0; lo stesso su `shift_assignments`, `shift_role_requirements` e `shift_change_requests` del turno; il turno pubblicato si vede (1);
  - come `Co` (collaboratore con «Turni» su V1) la bozza si vede (1). Come `Co2` (solo «Ore», quindi niente `roster`, che è «Turni» o «Team») non si vede (0), come oggi non vede i turni in lettura diretta;
  - `move_assignment` di Emma da una **bozza** a un giorno vuoto → il gemello ha `published_at is null`; da un turno **pubblicato** → il gemello ha `published_at is not null`.
- [ ] **Step 2: Verifica che fallisca.** `supabase/tests/run.sh reset && supabase/tests/run.sh test` → FAIL su `152_shift_drafts.sql` (colonna inesistente).
- [ ] **Step 3: Scrivi la migration `20261103000000_shift_drafts.sql`.**
  - `alter table public.shifts add column published_at timestamptz default now(), add column published_by uuid references public.profiles (id) on delete set null;` poi `update public.shifts set published_at = created_at;`. L'update tocca `shifts`: verificare che i trigger `after update` non producano notifiche (`notify_on_shift_change` esce perché data e orari non cambiano). Se serve, disattivarli per la durata dell'update con `alter table … disable trigger user`.
  - Indice parziale `shifts_drafts_idx on public.shifts (venue_id, date) where published_at is null`.
  - `private.draft_shift_ids()`: `select s.id from public.shifts s where s.published_at is null`.
  - Policy **restrittive** «drafts: managers only» (`as restrictive for select to authenticated`), nella stessa forma di quelle in `20261005000500_commercial_archive_reads.sql`:
    - `shifts`: `published_at is not null or venue_id in (select private.venues_where('roster'))`;
    - `shift_assignments`, `shift_role_requirements`: `shift_id not in (select private.draft_shift_ids()) or venue_id in (select private.venues_where('roster'))`;
    - `shift_change_requests`: `shift_id not in (select private.draft_shift_ids()) or shift_id in (select private.shift_ids_where('roster'))`.
  - Policy senza `from`: il test 050 §2 lo esige.
  - `create_shifts`: nell'insert di `shifts`, `published_at = case when coalesce((v_plan->>'draft')::boolean, false) then null else now() end`, e `published_by` coerente.
  - `move_assignment`: il gemello copia `published_at`/`published_by` dal turno di partenza.
  - Commento in testa che spiega il default pubblicato (Global Constraints, punto 1).
- [ ] **Step 4: Aggiorna `tests.create_shifts`** in `supabase/tests/seed.sql` con la stessa regola della chiave `draft`.
- [ ] **Step 5: Verifica.** `supabase/tests/run.sh reset && supabase/tests/run.sh test` → tutte verdi, `152` compreso.

### Task 2: Una bozza non arriva al team

**Files:**
- Create: `supabase/migrations/20261103000100_shift_drafts_silent.sql`
- Modify: `supabase/tests/rls/152_shift_drafts.sql` (seconda parte)

**Interfaces:**
- Consumes: `shifts.published_at`, `private.draft_shift_ids()` (Task 1).
- Produces: errore `shift_draft`. `delete_shift` accetta una bozza anche se è finita.

L'elenco delle funzioni da rivedere viene dal banco, con le funzioni che citano `public.shifts`, `shift_assignments` o `my_work_history`. Prima di cominciare va rigenerato, per non perderne nessuna:

```sql
select n.nspname||'.'||p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname in ('public','private') and p.prokind='f'
   and pg_get_functiondef(p.oid) ~ '(public\.shifts\M|shift_assignments|my_work_history)' order by 1;
```

Ogni funzione della lista o finisce in uno dei gruppi qui sotto, o ha una riga di commento nella migration che spiega perché resta com'è (gestione, export, admin).

- [ ] **Step 1: Seconda parte del test 152.** Per una bozza futura con Emma assegnata e per una **bozza scaduta** (la si prepara con `tests.create_shifts` e `"draft": true` su una data passata):
  - **trigger**: `update_shift` della bozza (orari diversi), `assign`/`unassign` di Enzo, `set_assignment_role`, `delete_shift`: 0 notifiche a Emma ed Enzo;
  - **lato dipendente** (come `Emp`): `public.get_staff_planning(d-1, d+1)` non contiene la bozza; `public.get_my_work_totals(…)` e `public.get_my_work_history_page(…)` non la contano; `public.clock_punch(...)` sulla sua assegnazione → `tests.raises(…, 'shift_draft')`; `public.respond_assignment(<id>, 'confirmed')` → `shift_draft`; `public.request_shift_change(...)` → `shift_draft`;
  - **promemoria**: `private.queue_clock_reminders(<5 minuti dopo l'inizio della bozza>)` = 0;
  - **ore** (come `Ow`, sede in metodo «Manuale»): la bozza scaduta non entra in `public.get_workspace_hours_summary(...)` (né ore né `shifts_count`), non entra in `public.get_hours_to_fix(...)`, e `public.get_hours_summary`, `get_member_performance`, `get_member_worked_shifts` non la contano;
  - **scritture di presenza** su una bozza: `record_attendance`, `enter_clock_record`, `add_shift_worker`, `approve_clock_record` → `shift_draft`; `set_shift_status(<bozza>, 'cancelled')` → `shift_draft` (per la bozza si elimina);
  - `delete_shift(<bozza scaduta con persone>)` riesce (per un turno pubblicato finito resta `finished_shift_locked`);
  - **assenze**: `private.absence_credit_conflict` non segnala una bozza come lavoro.
- [ ] **Step 2: Verifica che fallisca.** `run.sh reset && run.sh test` → FAIL su 152.
- [ ] **Step 3: Scrivi la migration.**
  - Trigger: `notify_on_assignment`, `notify_on_assignment_removed`, `notify_on_assignment_declined`, `notify_on_assignment_reconfirmed` escono subito se il turno è una bozza. `notify_on_shift_change` esce se `old.published_at is null`: copre sia la modifica di una bozza sia l'update della pubblicazione stessa.
  - Lato dipendente, aggiungere `s.published_at is not null` a: `get_staff_planning`, `private.my_work_history` (su cui poggiano `get_my_work_history_page/_range/_totals` e `get_my_work_totals`; verificare che nessuna delle quattro legga i turni per conto suo), `private.queue_clock_reminders`, `private.absence_credit_conflict`, `private.notification_person`.
  - Ore: il punto in cui un'assegnazione «conta» (`private.effective_assignment_hours`, `private.definitive_manual_hours`) restituisce «non conta» per una bozza. Poi ogni riepilogo che conta o filtra per conto suo (`get_hours_summary`, `get_workspace_hours_summary`, `get_hours_to_fix`, `get_member_performance`, `get_member_worked_shifts`, `approve_regular_clock_records`, `private.auto_approve_clock`) riceve lo stesso filtro. ⚠️ `get_hours_to_fix` e `shifts_count` restano complementari: il test 037 deve restare verde.
  - Rifiuto `shift_draft` in: `clock_punch`, `respond_assignment` (entrambe le firme), `request_shift_change`, `record_attendance`, `enter_clock_record`, `correct_clock_record`, `approve_clock_record`, `add_shift_worker`, `set_shift_status` (qualsiasi stato su una bozza).
  - `delete_shift`: il controllo `finished_shift_locked` vale solo per i turni pubblicati.
  - `export_workspace_data` (export completo GDPR): deve includere `published_at` dei turni. Se seleziona colonne esplicite, aggiungerla; nel test 152 un'asserzione che la bozza compaia nell'export con `published_at` nullo.
- [ ] **Step 4: Verifica.** `run.sh reset && run.sh test` → tutte verdi.

### Task 3: Tipi di notifica

**Files:**
- Create: `supabase/migrations/20261103000200_shift_publish_types.sql`

**Interfaces:**
- Produces: `notification_type` più `shift_published` e `shift_drafts_reminder`. Categoria `shifts`, quella di default di `public.notification_category`, quindi non va toccata.

- [ ] **Step 1:** `alter type public.notification_type add value if not exists 'shift_published'; … 'shift_drafts_reminder';`. Da solo nel file: il valore nuovo non si può usare nella stessa transazione, come in `20261027000100_shift_reconfirmed_type.sql`.
- [ ] **Step 2: Verifica.** `run.sh reset && run.sh test` → verdi.

### Task 4: Anteprima, pubblicazione, «Conferma tutti», «Registra come fatto»

**Files:**
- Create: `supabase/migrations/20261103000300_publish_shifts.sql`
- Create: `supabase/tests/rls/153_publish_shifts.sql`
- Modify: `supabase/tests/rls/050_surface.sql` (solo se elenca le RPC eseguibili da `authenticated`)

**Interfaces:**
- Consumes: Task 1–3.
- Produces:
  - `public.get_publish_preview(p_venues uuid[], p_from date, p_to date) returns jsonb` → `{ "shift_ids": uuid[], "shifts": int, "people": int, "outside": int, "expired": int }`;
  - `public.publish_shifts(p_shifts uuid[], p_notify boolean) returns jsonb` → `{ "published": int, "notified": int }`;
  - `public.confirm_my_assignments(p_assignments uuid[]) returns integer` (quante confermate);
  - `public.record_draft_as_done(p_shift uuid) returns void`.

Regole:
- **Anteprima**. Le sedi sono `p_venues` ∩ `private.venues_where('shifts')`. `shift_ids` sono le bozze non annullate e **non finite** (`shift_ends_at > local_now()`) con data in `[p_from, p_to]`. `people` = utenti distinti con account collegato fra le assegnazioni attive (`assigned`, `confirmed`) di quei turni, chi chiama escluso. `outside` = bozze non finite delle stesse sedi fuori periodo. `expired` = bozze finite delle stesse sedi.
- **Pubblicazione**. Autenticato. Ogni turno deve stare in una sede con `private.can(venue, 'shifts')`, altrimenti `not_allowed` e niente cambia. `assert_workspace_operational` per ogni azienda toccata. Righe bloccate con `for update` in ordine di id. Quelle già pubblicate o finite si saltano in silenzio, ed è questo che rende idempotente il doppio tocco. Si imposta `published_at = now()`, `published_by = auth.uid()`. Con `p_notify`, **una** `private.notify(user, 'shift_published', …)` per utente sui turni appena pubblicati, con `related_id` = il primo dei suoi turni in ordine di data e ora.
- **Testo della notifica** (esatto). `<luogo>` è il nome della sede se tutti i turni pubblicati di quella persona sono in una sede, altrimenti il nome dell'azienda.
  - 1 turno → titolo `Nuovo turno`, corpo `<luogo>: un nuovo turno per te, il DD/MM dalle HH:MI alle HH:MI.`
  - n > 1 → titolo `Nuovi turni`, corpo `<luogo>: <n> nuovi turni per te, dal DD/MM al DD/MM.`
  - Se almeno una delle sue assegnazioni è `assigned`, si aggiunge ` Conferma la presenza.`
- **Conferma tutti**. Si confermano solo le assegnazioni di chi chiama (`venue_member_id in private.my_venue_member_ids()`), `assigned`, su turni pubblicati, non annullati e non finiti. Per ognuna si chiama `public.respond_assignment(id, 'confirmed', null)`, così valgono le stesse regole e gli stessi trigger della conferma singola. Gli id che non rispettano le condizioni si saltano.
- **Registra come fatto**. Serve `private.can(venue, 'hours')`; il turno deve essere una bozza (`shift_not_draft`), finita (`shift_not_finished`), con almeno un'assegnazione attiva (`staff_required`). Con `app.unplanned_clock = '1'` come in `record_past_shift`: `published_at`, `published_by`, `recorded_at`, `recorded_by` = adesso e chi chiama; le assegnazioni attive diventano `confirmed`, `confirmed_at = now()`, `hours_source = 'manual_auto'`. Nessuna notifica.

- [ ] **Step 1: Scrivi `153_publish_shifts.sql`.** Asserzioni:
  - come `Ow`: tre bozze per Emma nella settimana `d..d+6` di V1, una bozza per Enzo su V2, una bozza fuori periodo, una scaduta → l'anteprima su `[V1,V2]` dà `shifts=4`, `people=2`, `outside=1`, `expired=1`;
  - `publish_shifts(shift_ids, true)` → `published=4`, `notified=2`. Emma ha **1** `shift_published` con titolo `Nuovi turni` e corpo `V1: 3 nuovi turni per te, dal …`; Enzo `Nuovo turno` con `V2: un nuovo turno per te, il …`. Se un'assegnazione è `assigned` il corpo finisce con ` Conferma la presenza.`;
  - con turni di Emma in V1 e V2 pubblicati insieme, `<luogo>` = `W1`;
  - seconda chiamata con gli stessi id → `published=0`, nessuna notifica nuova;
  - `p_notify = false` → `notified=0`, 0 notifiche, ma Emma vede i turni;
  - dopo la pubblicazione, `update_shift` di un orario → `shift_updated` a Emma, come oggi;
  - come `Co` (Turni solo su V1): l'anteprima su `[V1,V2]` non include V2; `publish_shifts([bozza di V2])` → `not_allowed`, la bozza resta bozza;
  - come `Emp`: `publish_shifts` → `not_allowed`; `confirm_my_assignments([le sue 3 + l'assegnazione di Enzo])` → `3`, quella di Enzo intatta; una seconda chiamata → `0`;
  - `record_draft_as_done(<scaduta>)` come `Co2` (Ore) → turno pubblicato con `recorded_at`, assegnazioni `confirmed`/`manual_auto`, nessuna notifica, e le ore compaiono in `get_workspace_hours_summary`; come `Co` (senza Ore) → `not_allowed`; su un turno pubblicato → `shift_not_draft`; su una bozza futura → `shift_not_finished`.
- [ ] **Step 2: Verifica che fallisca.** `run.sh reset && run.sh test` → FAIL su 153.
- [ ] **Step 3: Scrivi la migration** con le regole sopra. `grant execute … to authenticated` sulle quattro RPC e revoke da `public, anon`.
- [ ] **Step 4: Aggiorna `050_surface.sql`** se elenca la superficie eseguibile.
- [ ] **Step 5: Verifica.** `run.sh reset && run.sh test` → verdi.

### Task 5: Promemoria delle bozze

**Files:**
- Create: `supabase/migrations/20261103000400_draft_reminders.sql`
- Modify: `supabase/tests/rls/153_publish_shifts.sql` (in fondo)

**Interfaces:**
- Produces: `private.draft_reminders (shift_id uuid primary key references public.shifts on delete cascade, sent_at timestamptz not null default now())`, `private.queue_draft_reminders(p_at timestamptz default now()) returns integer` (notifiche create), `private.run_draft_reminders() returns integer`. Lavoro pg_cron `draft-reminders`, `'15 * * * *'`.

Regole: sono candidate le bozze non annullate che iniziano in `(p_at, p_at + 24 h]` e non sono ancora in `private.draft_reminders`. L'istante d'inizio si calcola con la stessa espressione di `queue_clock_reminders`, e si saltano le aziende che quella funzione salta. Per ogni sede parte una sola `private.notify_managers(venue, 'shifts', 'shift_drafts_reminder', 'Turni da pubblicare', <corpo>, <primo turno>)`. Corpo:
- 1 turno: `<sede>: «<titolo>» del DD/MM alle HH:MI non è ancora pubblicato. Il team non lo vede.`
- n turni: `<sede>: <n> turni delle prossime 24 ore non sono ancora pubblicati. Il team non li vede.`

Poi i turni si segnano in `private.draft_reminders`. `run_draft_reminders` cancella le righe più vecchie di 3 giorni. Revoke di tutto da `public, anon, authenticated`. Il blocco `cron.schedule` ha lo stesso `exception when others` di `20261027000500_clock_reminders.sql`.

- [ ] **Step 1: Test** in 153:
  - due bozze V1 domani alle 18:00 → `queue_draft_reminders(<oggi alle 18:30>)` = numero di gestori di V1 con «Turni» (Ow, Co), corpo `V1: 2 turni delle prossime 24 ore…`;
  - una seconda chiamata → 0;
  - una bozza fra 30 ore → 0;
  - una bozza pubblicata → 0;
  - Emma non riceve niente;
  - `authenticated` non ha `EXECUTE` sulle due funzioni.
- [ ] **Step 2:** `run.sh test` → FAIL.
- [ ] **Step 3:** scrivi la migration.
- [ ] **Step 4:** `run.sh reset && run.sh test` → verdi.

### Task 6: Tipi, data layer, regole pure, gemelli e notifiche nel client

**Files:**
- Modify: `src/types/database.ts` (rigenerato)
- Create: `src/features/shifts/drafts.ts`
- Create: `tests/unit/shifts/drafts.test.ts`
- Create: `tests/integration/publishShiftsApi.test.ts`
- Modify: `src/features/assignments/api.ts`, `src/features/assignments/hooks.ts`, `src/features/shifts/api.ts`, `src/features/shifts/hooks.ts`, `src/features/shifts/invalidation.ts`, `src/lib/queryKeys.ts`, `src/lib/errors.ts`
- Modify: `src/features/shifts/notify.ts`, `src/features/shifts/moveImpact.ts`, `tests/unit/shifts/notify.test.ts`, `tests/unit/shifts/moveImpact.test.ts`
- Modify: `src/features/notifications/routing.ts`, `tests/unit/notifications/routing.test.ts`, `web/src/lib/notificationRoute.ts`

**Interfaces:**
- Consumes: le RPC del Task 4; `shifts.published_at`.
- Produces (`src/features/shifts/drafts.ts`, senza import React Native):
  - `isDraft(shift: { published_at: string | null }): boolean`
  - `isExpiredDraft(shift: { published_at: string | null } & ShiftTimes, now?: Date): boolean`
  - costanti: `DRAFT_LABEL = "Bozza"`, `EXPIRED_DRAFT_LABEL = "Mai pubblicato"`, `SAVE_DRAFT = "Salva in bozza"`, `SAVE_AND_PUBLISH = "Salva e pubblica"`, `PUBLISH = "Pubblica"`, `PUBLISH_NOTIFY = "Pubblica e avvisa"`, `PUBLISH_SILENT = "Pubblica senza avvisi"`, `CONFIRM_ALL = "Conferma tutti"`, `RECORD_DRAFT = "Registra come fatto"`, `DRAFT_SILENT_LINE = "È una bozza: nessuno viene avvisato finché non la pubblichi."`, `DUPLICATE_AS_DRAFT = "Le copie restano in bozza finché non le pubblichi."`
  - `draftsBannerText(input: { upcoming: number; expired: number; months: string[] }): string | null`, per es. `"12 turni in bozza (dicembre)"`, `"1 turno in bozza (novembre)"`, `"3 turni in bozza (novembre, dicembre) · 1 mai pubblicato"`; `null` se sono tutti zero;
  - `publishPreviewLines(p: PublishPreview): string[]`, per es. `["4 turni", "Avvisiamo 2 persone", "Ci sono altre 1 bozze fuori da questo periodo"]`; la terza riga solo se `outside > 0`, con il singolare giusto («C'è un'altra bozza fuori da questo periodo»);
  - `type PublishPreview = { shift_ids: string[]; shifts: number; people: number; outside: number; expired: number }`.
- Produces (api/hooks):
  - `createInternalShifts(plans, opts?: { draft?: boolean })`: aggiunge `draft: true` a ogni piano;
  - `getPublishPreview(venueIds: string[], from: string, to: string): Promise<PublishPreview>`
  - `publishShifts(shiftIds: string[], notify: boolean): Promise<{ published: number; notified: number }>`
  - `confirmMyAssignments(ids: string[]): Promise<number>`
  - `recordDraftAsDone(shiftId: string): Promise<void>`
  - `getOwnerDrafts(venueIds: string[]): Promise<Pick<Shift, "id" | "venue_id" | "date" | "start_time" | "end_time">[]>`: `from("shifts")` con `.is("published_at", null)` e `.neq("status", "cancelled")`;
  - hook `usePublishPreview`, `usePublishShifts`, `useConfirmMyAssignments`, `useRecordDraftAsDone`, `useOwnerDrafts`; chiave `qk.shifts.drafts(venueIds)`, invalidata da `invalidateAfterShiftWrite`.
  - `useCopyInternalShifts` crea **sempre** bozze.

- [ ] **Step 1: Rigenera i tipi.** `supabase/tests/run.sh reset && supabase/tests/gen-types.sh` → `published_at`, i due tipi di notifica e le quattro RPC compaiono in `src/types/database.ts`.
- [ ] **Step 2: Test unitari che falliscono.**
  - `drafts.test.ts`: `isDraft`, `isExpiredDraft` (ora locale senza offset, memoria «Test e fuso orario in CI»), tutte le forme di `draftsBannerText` e `publishPreviewLines` elencate sopra.
  - `moveImpact.test.ts` / `notify.test.ts`: spostare una **bozza** → `notify.total = 0`, `reopens = []` e `DRAFT_SILENT_LINE` fra le righe; `reassignNotifyPlan` con partenza in bozza → `fromSkip = "draft"`; arrivo in bozza → `notifiesTo = false`; da pubblicato a bozza → revoca sì, arrivo no.
  - `routing.test.ts`: vista lavoro, `shift_published` → `"/(waiter)/(tabs)/turni"`, `shift_drafts_reminder` → `null`; vista gestione, `shift_drafts_reminder` → `"/(manager)/(tabs)/turni"`.
  - `publishShiftsApi.test.ts`, con mock di `supabase` come `tests/integration/recordPastShiftApi.test.ts`: `createInternalShifts(plans, { draft: true })` manda `draft: true` in ogni piano; senza opzione **non** manda la chiave; `publishShifts` / `confirmMyAssignments` / `getPublishPreview` / `recordDraftAsDone` chiamano la RPC con i parametri `p_*` giusti; `getMyAssignedUpcoming`, `getMyDeclinedUpcoming`, `getMyAssignmentsInRange` e `getOwnerTodayAssignments` applicano il filtro `not("shift.published_at", "is", null)` (Review Focus 5).
- [ ] **Step 3:** `yarn vitest run tests/unit/shifts tests/unit/notifications tests/integration/publishShiftsApi.test.ts` → FAIL.
- [ ] **Step 4: Implementa.**
  - `moveImpact.ts`: `shiftMoveImpact` riceve `draft?: boolean`; `moveAssignmentImpact` riceve lo stato bozza di partenza e di arrivo.
  - `notify.ts`: `ReassignSkip` più `"draft"`. Aggiornare il commento «gemello manuale» con il richiamo a `20261103000100`.
  - Errori in `src/lib/errors.ts`: `shift_draft` → «Questo turno è una bozza: pubblicalo prima.»; `shift_not_draft` → «Il turno è già pubblicato.»
  - Filtro `published_at` sulle quattro letture «mie» e su `getOwnerTodayAssignments` (chi è in servizio oggi conta solo i turni pubblicati).
  - `routing.ts`: i rami sopra. `web/src/lib/notificationRoute.ts` va già bene con `/planning?shift=<id>`: verificarlo, senza codice nuovo.
- [ ] **Step 5: Verifica.** `yarn vitest run` (tutto), `npx tsc --noEmit`, `yarn lint` → verdi.

### Task 7: App, vista gestione

**Files:**
- Create: `src/features/shifts/PublishModal.tsx`, `src/features/shifts/DraftsBanner.tsx`
- Modify: `src/features/shifts/ManagerShiftCard.tsx`, `src/app/(manager)/(tabs)/turni.tsx` (pulsante accanto a «Duplica», `:499`), `src/app/(manager)/(tabs)/index.tsx` (banner in Home), `src/features/assignments/StaffShiftForm.tsx` (`:463` pulsanti), `src/features/shifts/DuplicateWeekModal.tsx`, `src/app/(manager)/shift/[id].tsx` (azioni sulla bozza)

**Interfaces:**
- Consumes: Task 6 (`drafts.ts`, hook, `createInternalShifts(…, { draft })`).
- Produces: `<PublishModal venueIds from to visible onClose />` e `<DraftsBanner venueIds onOpen={(date) => void} />`.

- [ ] **Step 1: Card.** Bozza → bordo tratteggiato e `Pill` con `DRAFT_LABEL`. Bozza scaduta → `EXPIRED_DRAFT_LABEL`.
- [ ] **Step 2: Pubblica.** Nella tab Turni, «Pubblica» compare solo con almeno una bozza nella settimana e il permesso «Turni». Apre `PublishModal`, che carica `usePublishPreview` e mostra `publishPreviewLines`, con due pulsanti (`PUBLISH_NOTIFY` gold, `PUBLISH_SILENT`). Gli id pubblicati sono quelli **dell'anteprima**. Alla fine un toast «Pubblicati N turni».
- [ ] **Step 3: Banner** in Home e in cima alla tab Turni da `useOwnerDrafts` + `draftsBannerText`. Il tocco porta alla prima bozza (`goToDay`).
- [ ] **Step 4: Form del nuovo turno.** `SAVE_DRAFT` (gold, primario) crea in bozza; `SAVE_AND_PUBLISH` (secondario) crea in bozza e poi chiama `publishShifts(ids, true)`, con un solo toast. Se la seconda chiamata fallisce, il toast dice che i turni sono salvati in bozza e non pubblicati. La modifica di un turno esistente resta com'è.
- [ ] **Step 5: Duplica settimana** crea bozze e mostra `DUPLICATE_AS_DRAFT`.
- [ ] **Step 6: Dettaglio turno.** Su una bozza «Annulla turno» lascia il posto a «Elimina». Su una bozza scaduta compaiono «Elimina» e, con «Ore», `RECORD_DRAFT` con conferma. Gli avvisi di spostamento usano `moveImpact` con `draft`.
- [ ] **Step 7: Verifica.** `npx tsc --noEmit`, `yarn lint`, `yarn vitest run` → verdi; `npx expo export --platform ios` → bundle ok.

### Task 8: Dashboard web

**Files:**
- Create: `web/src/shifts/PublishDialog.tsx`, `web/src/shifts/DraftsBanner.tsx`
- Modify: `web/src/pages/Planning.tsx` (pulsante accanto a «Duplica», `:596`; `ShiftCell` `:1265`), `web/src/shifts/PeopleWeek.tsx` (chip in bozza), `web/src/shifts/ShiftPanel.tsx` (`:1162` pulsanti; azioni sulla bozza), `web/src/shifts/ShiftDetails.tsx`, `web/src/shifts/DuplicatePeriodDialog.tsx`, `web/src/shifts/MovePersonDialog.tsx`, `web/src/pages/Home.tsx` (banner accanto a `FirstStepsCard`, `:207`)

**Interfaces:**
- Consumes: Task 6.

- [ ] **Step 1:** stesse regole del Task 7 (card, Pubblica sul periodo **visualizzato**, settimana o mese, banner, due pulsanti in creazione, Duplica in bozza, Elimina e «Registra come fatto»), con i componenti `web/src/ui`.
- [ ] **Step 2:** trascinamento e `MovePersonDialog`: `moveImpact` con `draft` per le frasi; `confirmLabel` «Salva e avvisa» solo se qualcuno viene davvero avvisato.
- [ ] **Step 3: Verifica.** `npx tsc --noEmit`, `yarn lint`, `yarn vitest run` → verdi.

### Task 9: «Conferma tutti» per il dipendente

**Files:**
- Modify: `src/app/(waiter)/(tabs)/turni.tsx` (riquadro «N turni da confermare», `:523` e `:590`)

**Interfaces:**
- Consumes: `useConfirmMyAssignments` (Task 6).

- [ ] **Step 1:** con almeno 2 turni in `daConfermare`, accanto al riquadro compare `CONFIRM_ALL`, con una conferma «Confermi N turni?». Chiama `confirmMyAssignments(daConfermare.map((a) => a.id))`, invalida `qk.assignments.all` e mostra il toast «Confermati N turni». Il pulsante resta disattivato mentre la chiamata è in corso.
- [ ] **Step 2: Verifica.** `npx tsc --noEmit`, `yarn lint` → verdi.

### Task 10: Testi d'aiuto e documentazione

**Files:**
- Modify: `AGENTS.md` (sezione nuova «Bozza e pubblicazione (2026-11-03)» dopo «Spostare un turno»), `src/features/shifts/tutorialContent.ts`, `src/features/onboarding/introContent.ts` (se descrive l'avviso dei turni), `web/src/pages/Aiuto.tsx`, `web-site/src/content/it.ts` (solo se la FAQ dice che ogni turno avvisa subito)

- [ ] **Step 1: Sezione in `AGENTS.md`.** Deve dire:
  - il default è pubblicato e perché;
  - la policy restrittiva;
  - l'elenco delle funzioni DEFINER che escludono le bozze;
  - ⚠️ `moveImpact.ts`/`notify.ts` sono gemelli dei trigger anche per la bozza;
  - la bozza scaduta non conta ore;
  - il promemoria orario;
  - i test 152 e 153.
- [ ] **Step 2: Testi d'aiuto** aggiornati: si prepara in bozza, poi si pubblica.
- [ ] **Step 3: Verifica finale.** `supabase/tests/run.sh reset && supabase/tests/run.sh test`, `yarn vitest run` (compreso `glossary.test.ts`), `npx tsc --noEmit`, `yarn lint`, `npx expo export --platform ios` → tutto verde.
- [ ] **Step 4: Prove a mano** da lasciare all'utente, in un elenco nel riepilogo finale:
  - preparo un mese → nessuna notifica;
  - pubblico → una notifica per persona;
  - «Conferma tutti»;
  - bozza dimenticata → promemoria;
  - «Registra come fatto».
