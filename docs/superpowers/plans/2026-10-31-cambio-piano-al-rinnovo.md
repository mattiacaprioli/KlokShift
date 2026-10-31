# Cambio di piano al rinnovo — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** il titolare programma dalla pagina Piano un cambio di piano/sedi/ciclo che vale dal rinnovo; un lavoro pianificato lo manda a Paddle il giorno prima, con promemoria al titolare e allarme email al fondatore.

**Architecture:** il cambio in attesa vive in una tabella nostra (`public.billing_scheduled_changes`). La richiesta passa da `billing-manage` (anteprima Paddle `do_not_bill` + RPC che registra). pg_cron ogni 10 minuti chiama `private.run_scheduled_billing_changes()`, che prepara promemoria e allarmi e, se c'è lavoro, chiama via pg_net la nuova Edge Function `billing-scheduled`; questa fa la `PATCH` su Paddle e spedisce le email. Un trigger su `billing_subscriptions` chiude o conferma le righe quando arrivano gli avvisi di Paddle. Le aggiunte oltre la capacità futura le blocca `private.check_commercial_capacity`.

**Tech Stack:** Postgres 17 (Supabase, plpgsql, pg_cron, pg_net, Vault), Edge Functions Deno, React + Vite (dashboard `web/`), vitest, banco SQL `supabase/tests/run.sh`.

**Spec:** [docs/superpowers/specs/2026-10-31-cambio-piano-al-rinnovo-design.md](../specs/2026-10-31-cambio-piano-al-rinnovo-design.md) — leggerlo per intero prima di iniziare.

## Global Constraints

- Solo migration **nuove** in `supabase/migrations/`; mai modificare una migration esistente. Le funzioni ridefinite si copiano integralmente dall'ultima definizione con un commento «Copia di X da <file> con …» (stile del repo).
- Le RPC di fatturazione chiamate dalle Edge Function sono **solo `service_role`** (`revoke all … from public, anon, authenticated; grant execute … to service_role`). Le RPC admin usano `private.require_platform_admin` come in `20261019000600_admin_billing_reviews.sql`.
- Errori come `raise exception '<codice>'`; i codici visti dall'utente vanno in `web/src/billing/manage.ts` (`ERRORS`) o `src/lib/errors.ts`.
- Testi utente in italiano e nel glossario di `docs/GLOSSARIO.md`: «team», «persone», «sede», «dipendente»; mai «staff», «organico», «locale».
- **L'app nativa non mostra prezzi né acquisti**: la notifica nell'app è neutra; importi solo sul web e nelle email.
- Finestra d'invio **24 ore** prima del rinnovo; allarme se a **6 ore** dal rinnovo non è inviato; promemoria **7 giorni** prima; lavoro pg_cron **ogni 10 minuti**. Costanti in un solo posto in SQL (`private.billing_schedule_window()` ecc. o costanti nel corpo di una funzione) e richiamate dai test.
- `proration_billing_mode: "do_not_bill"` per la `PATCH` programmata; un articolo che non cambia né tipo né ciclo tiene il suo prezzo attuale.
- Allarme fondatore: email all'indirizzo nella variabile `FOUNDER_ALERT_EMAIL` della funzione `billing-scheduled` (valore: `info@klokshift.com`, mai scritto nel codice).
- **Nessun commit né push**: le modifiche restano nella working tree, i commit li fa il fondatore. Al posto del passo «Commit» c'è «Lascia pronto».
- Dopo ogni migration: `supabase/tests/run.sh reset && supabase/tests/run.sh test` verde, poi `supabase/tests/gen-types.sh` per `src/types/database.ts`.
- Comandi di verifica finali: `yarn lint`, `npx tsc --noEmit`, `yarn web:typecheck`, `yarn test:unit`.

## Review Focus

1. **Codici d'errore che si contengono**: `ERRORS`/`errors.ts` cercano per sottostringa, quindi `workspace_people_capacity` combacia anche con `workspace_people_capacity_scheduled`. Le voci `_scheduled` vanno **prima** di quelle generiche (test in Task 3).
2. **Doppio invio a Paddle**: il cron parte ogni 10 minuti anche se la chiamata precedente è ancora in corso. La presa in carico deve far uscire una riga dalla coda finché non scade (test in Task 4: due `billing_scheduled_claim` di seguito restituiscono la riga una volta sola).
3. **Annullare durante l'invio**: «Annulla il cambio» è ammesso solo fino all'apertura della finestra (24 h prima); dopo, `billing_change_already_sent`, anche se la riga è ancora `pending` (test in Task 1).
4. **Avvisi Paddle dopo il cambio di ciclo**: l'avviso generato dalla `PATCH` mensile→annuale può avere articoli annuali con `billing_cycle` ancora mensile, e `billing_apply_event` lo scarterebbe (`mixed_billing_interval`). La forma reale viene dalla prova di Task 0. Il test in Task 4 riproduce quella forma e verifica che l'avviso non sia `rejected`.
5. **Date nel fuso italiano**: `effective_at` è un istante UTC; pagina, notifica ed email mostrano il giorno in `Europe/Rome` (`private.rome_date`, `dateOnly` lato web). Un rinnovo alle 23:30 UTC è il giorno dopo in Italia (test in Task 5 su `formatReminder`).

---

### Task 0: Prova in sandbox di Paddle (richiede il fondatore)

Serve la chiave API sandbox (`pdl_sdbx_apikey_…`) e un abbonamento sandbox attivo (es. Hotel Tesoro o DA CARLOTTA). Se l'esecutore non ha la chiave, prepara la procedura e si ferma: la eseguono insieme al fondatore.

**Files:**
- Create: `docs/TEST-BILLING-SCHEDULED.md` (procedura e risultati, sullo stile di `docs/TEST-MONETIZATION-M04.md`)

- [ ] **Step 1: Scrivi la procedura** con i comandi `curl` per: leggere l'abbonamento (`GET /subscriptions/{id}`), avvicinare `next_billed_at` (`PATCH` con `next_billed_at` e `proration_billing_mode: "do_not_bill"`, come nella prova del 18/10), applicare gli articoli d'arrivo con `do_not_bill`, ripetere la `GET`.
- [ ] **Step 2: Esegui i cinque casi della spec §9** e annota per ciascuno: `next_billed_at` prima/dopo, `billing_cycle`, `current_billing_period`, transazioni create, avvisi ricevuti (tipo, ordine, esito in `private.billing_events`), importo e periodo del rinnovo.
  1. Team→Base, meno sedi, stesso ciclo.
  2. Mensile→annuale.
  3. Annuale→mensile.
  4. Esito degli avvisi nel webhook (`outcome`, `error`).
  5. Il portale clienti permette il cambio di piano? Si può spegnere?
- [ ] **Step 3: Condizione d'arresto.** Se nel caso 2 o 3 Paddle sposta `next_billed_at`, addebita subito o rifiuta la `PATCH`, **fermati e riporta al fondatore** prima di continuare. In quel caso si procede solo con i cambi a ciclo invariato: `billing_prepare_scheduled_change` rifiuta un ciclo diverso con `billing_interval_change_unavailable`.
- [ ] **Step 4: Lascia pronto** il file con i risultati. Le Task 4 e 5 usano la forma reale degli avvisi registrata qui.

---

### Task 1: Tabella e regole del cambio programmato

**Files:**
- Create: `supabase/migrations/20261101000000_billing_scheduled_changes.sql`
- Create: `supabase/tests/rls/145_billing_scheduled_changes.sql`

**Interfaces:**
- Produces (tabella `public.billing_scheduled_changes`, RLS attiva, nessun grant ai client, `select, update` a `service_role`):
  `id uuid pk`, `subscription_id uuid → billing_subscriptions on delete restrict`, `workspace_id uuid → workspaces on delete restrict`, `environment text ('sandbox'|'live')`, `target_plan text ('base'|'team')`, `target_interval text ('month'|'year')`, `target_extra_venues int 0..999`, `from_items jsonb` e `target_items jsonb` (array `{price_id, quantity}`), `renewal_cents bigint`, `currency text`, `effective_at timestamptz`, `status text ('pending'|'applied'|'confirmed'|'canceled'|'failed')`, `close_reason text null`, `requested_by uuid`, `created_at`, `closed_at`, `closed_by uuid null`, `attempts int default 0`, `next_attempt_at timestamptz default now()`, `last_error_code text`, `applied_at`, `confirmed_at`, `reminder_notified_at`, `reminder_emailed_at`, `reminder_email_attempts int default 0 (0..5)`, `alert_kind text null ('not_sent'|'failed'|'renewal_mismatch')`, `alert_emailed_at`, `alert_email_attempts int default 0 (0..5)`, `reviewed_at`, `reviewed_by`, `review_note`. Indice unico parziale su `subscription_id where status in ('pending','applied')`. `close_reason` ∈ `owner, paused, canceled, past_due, rules_changed, paddle_mismatch, paddle_error, renewal_mismatch`.
- Produces (service role):
  - `public.billing_prepare_scheduled_change(p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_interval text, p_extra_venues integer) returns jsonb` → `{subscription_id, effective_at, current_plan, current_interval, plan_price_id, extra_price_id, known_prices}` (stessa forma di `billing_prepare_change` più `effective_at`, `current_interval`).
  - `public.billing_record_scheduled_change(p_environment text, p_user uuid, p_workspace uuid, p_plan text, p_interval text, p_extra_venues integer, p_from_items jsonb, p_target_items jsonb, p_renewal_cents bigint, p_currency text) returns uuid`: rifà le stesse verifiche e inserisce la riga `pending` con `effective_at = current_period_ends_at`.
  - `public.billing_cancel_scheduled_change(p_environment text, p_user uuid, p_workspace uuid) returns void`: `status = 'canceled'`, `close_reason = 'owner'`, `closed_by = p_user`.
  - `private.billing_open_scheduled_change(p_subscription uuid) returns public.billing_scheduled_changes`: la riga `pending`/`applied` o null.
  - `private.billing_scheduled_rules_error(p_subscription uuid, p_plan text, p_interval text, p_extra integer) returns text`: null se ammesso, altrimenti il codice. Lo usano prepare, record e il runner (Task 4).
- Codici: `billing_change_pending` (c'è già un cambio aperto), `billing_scheduled_not_reduction` (piano o sedi in aumento), `billing_no_change`, `billing_too_close_to_renewal` (meno di 24 h a `current_period_ends_at`), `billing_scheduled_people` (Base con più di 30 persone, secondo `usage.people` di `private.workspace_access_at`), `billing_scheduled_venues` (sedi aperte `usage.venues` > 1 + sedi in più d'arrivo), `billing_price_unavailable`, più quelli esistenti `billing_past_due`, `billing_paused`, `billing_change_scheduled`, `billing_no_subscription`, `not_allowed`; `billing_change_already_sent` per l'annullamento dentro la finestra o a riga `applied`; `billing_nothing_scheduled` per l'annullamento senza riga aperta.
- Ridefinisce `public.billing_prepare_change` (copia da `20261019000000_billing_manage.sql`): con una riga aperta solleva `billing_change_pending` prima degli altri controlli sul cambio.

- [ ] **Step 1: Scrivi la suite `145`** (stile di `105_billing_manage.sql`: `tests.manage_service()` ed eventi `subscription.updated` costruiti a mano). Asserzioni:
  - nessun privilegio `EXECUTE` per `authenticated` sulle tre RPC pubbliche;
  - Team→Base con 30 persone: ok; con 31: `billing_scheduled_people`;
  - meno sedi con le sedi aperte già nella capacità futura: ok; con una sede in più aperta: `billing_scheduled_venues`;
  - Base→Team o più sedi: `billing_scheduled_not_reduction`; la stessa scelta: `billing_no_change`;
  - solo mensile→annuale: ok;
  - periodo che finisce fra 23 ore: `billing_too_close_to_renewal`;
  - con pausa programmata (`scheduled_change` nell'evento): `billing_change_scheduled`;
  - seconda richiesta con una riga aperta: `billing_change_pending`;
  - `billing_prepare_change` (aumento) con una riga aperta: `billing_change_pending`;
  - collaboratore o dipendente: `not_allowed`;
  - annullamento a 25 h: riga `canceled`/`owner`; a 23 h: `billing_change_already_sent`; senza riga: `billing_nothing_scheduled`.
- [ ] **Step 2: Avvia** `supabase/tests/run.sh reset && supabase/tests/run.sh test`. Atteso: FAIL sulla suite 145 (funzioni inesistenti).
- [ ] **Step 3: Scrivi la migration** con le interfacce sopra.
- [ ] **Step 4: Rilancia** i test. Atteso: tutte le suite verdi, comprese `100`, `105` e `110`.
- [ ] **Step 5: Lascia pronto** e rigenera i tipi con `supabase/tests/gen-types.sh`.

---

### Task 2: Annullamenti e conferme dagli avvisi di Paddle

**Files:**
- Create: `supabase/migrations/20261101000100_billing_scheduled_reconcile.sql`
- Modify: `supabase/tests/rls/145_billing_scheduled_changes.sql` (sezione nuova)

**Interfaces:**
- Consumes: tabella e `private.billing_open_scheduled_change` di Task 1.
- Produces: `private.billing_scheduled_reconcile()`, trigger `after update on public.billing_subscriptions for each row`. Non modifica `billing_apply_event`.

Regole del trigger, in quest'ordine, sulla riga aperta dell'abbonamento:
1. Riga `pending`, e `new.scheduled_change_action` non nullo oppure `new.status` diverso da `active`: la riga diventa `canceled`, con `close_reason` = `paused` / `canceled` / `past_due` secondo l'azione o lo stato.
2. Riga `applied` e `new.status` in (`paused`, `canceled`): la riga diventa `canceled` con quel motivo. Con una pausa o disdetta solo programmata resta `applied`: se il titolare annulla la pausa, il rinnovo avviene col piano nuovo, come chiesto.
3. Riga `applied`, `new.status = 'active'` e `new.current_period_starts_at >= effective_at - interval '5 minutes'`:
   - se piano, ciclo e sedi coincidono con l'arrivo, la riga diventa `confirmed`;
   - altrimenti diventa `failed` con `renewal_mismatch` e `alert_kind = 'renewal_mismatch'`.

- [ ] **Step 1: Aggiungi i test** alla suite 145, con eventi `subscription.updated` costruiti come in `105`. Uno per regola, più:
  - una riga `pending` che non tocca nessuna regola resta `pending` dopo un avviso qualunque;
  - una riga `applied` con avviso `past_due` dopo il rinnovo resta `applied`, e diventa `confirmed` col recupero `active`.
- [ ] **Step 2: Verifica** che i test nuovi falliscano: `supabase/tests/run.sh test`.
- [ ] **Step 3: Scrivi il trigger.**
- [ ] **Step 4: Rilancia** i test: tutte le suite verdi.
- [ ] **Step 5: Lascia pronto.**

---

### Task 3: Capacità futura e messaggi

**Files:**
- Create: `supabase/migrations/20261101000200_billing_scheduled_capacity.sql`
- Modify: `src/lib/errors.ts:57-58`
- Modify: `supabase/tests/rls/145_billing_scheduled_changes.sql` (sezione nuova)
- Test: `tests/unit/errors.test.ts` (crearlo se non c'è un test di `userErrorMessage`; altrimenti aggiungere al file esistente)

**Interfaces:**
- Produces: `private.billing_future_limits(p_workspace uuid) returns jsonb` → `{people: int|null, venues: int}` della riga aperta (`people` = 30 se l'arrivo è Base, altrimenti null; `venues` = 1 + sedi in più d'arrivo), oppure null senza riga aperta.
- Ridefinisce `private.check_commercial_capacity()` (copia integrale da `20261005000200_commercial_enforcement.sql`). Dopo i controlli esistenti, con `billing_future_limits` non nullo, solleva `workspace_venue_capacity_scheduled` / `workspace_people_capacity_scheduled` con la stessa logica «cresce rispetto a prima e supera il limite», applicata al limite futuro.

- [ ] **Step 1: Test SQL.**
  - Con Team→Base in attesa e 30 persone, aggiungere una persona a una sede: `workspace_people_capacity_scheduled`.
  - Senza riga aperta la stessa aggiunta passa (Team).
  - Con meno sedi in attesa, riaprire una sede chiusa: `workspace_venue_capacity_scheduled`.
  - Togliere una persona o chiudere una sede resta sempre possibile.
- [ ] **Step 2: Test unit.**
  - `userErrorMessage(new Error("workspace_people_capacity_scheduled"))` restituisce il messaggio nuovo, non quello generico.
  - Stesso controllo per le sedi.
- [ ] **Step 3: Verifica** che entrambi i test falliscano.
- [ ] **Step 4: Implementa la migration.** In `errors.ts` aggiungi le due voci **prima** di quelle generiche, con questo testo esatto:
  - persone: «Hai programmato un piano più piccolo dal prossimo rinnovo: per aggiungere altre persone annullalo dalla pagina Piano sul web.»
  - sedi: «Hai programmato meno sedi dal prossimo rinnovo: per aprirne un'altra annulla il cambio dalla pagina Piano sul web.»
- [ ] **Step 5: Rilancia** `supabase/tests/run.sh test` e `yarn test:unit`. Atteso: verdi.
- [ ] **Step 6: Lascia pronto** e rigenera i tipi.

---

### Task 4: Lavoro pianificato, promemoria e allarmi (SQL)

**Files:**
- Create: `supabase/migrations/20261101000300_billing_scheduled_runner.sql`
- Modify: `supabase/tests/rls/145_billing_scheduled_changes.sql` (sezione nuova)
- Modify: `src/features/notifications/routing.ts`, `src/features/notifications/NotificationList.tsx`, `web/src/lib/notificationRoute.ts`
- Test: `tests/unit/notifications/routing.test.ts`

**Interfaces:**
- Consumes: `private.billing_scheduled_rules_error` (Task 1), `private.rome_date`, `private.notify`, Vault `push_hook_secret` (come `run_archive_reminders`).
- Produces:
  - `alter type public.notification_type add value if not exists 'billing_change_reminder'`;
  - `private.queue_scheduled_billing_work(p_at timestamptz default now()) returns integer`, in quattro passi:
    1. **Promemoria**: righe `pending` con `effective_at - 7 days <= p_at`, `created_at <= effective_at - 7 days` e `reminder_notified_at` null. Notifica a ogni titolare attivo, titolo «Cambia l'abbonamento di {azienda}», testo «Dal {rome_date} cambia il piano dell'azienda. I dettagli sono nella pagina Piano sul web.», poi `reminder_notified_at = p_at`.
    2. **Regole cambiate**: righe `pending` dentro la finestra di 24 h per cui `billing_scheduled_rules_error` non è null, oppure con l'azienda non `operational`. Diventano `failed` con `rules_changed`, `last_error_code` = il codice, `alert_kind = 'failed'`.
    3. **Allarme non inviato**: righe `pending` con `effective_at - 6 hours <= p_at` e `alert_kind` null. Diventano `alert_kind = 'not_sent'`.
    4. Restituisce il numero di righe toccate.
  - `private.run_scheduled_billing_changes() returns void`: chiama `queue_…`. Poi, se ci sono righe da inviare (`pending`, in finestra, `next_attempt_at <= now()`), promemoria email da spedire (`reminder_notified_at` non null, `reminder_emailed_at` null, tentativi < 5) o allarmi da spedire (`alert_kind` non null, `alert_emailed_at` null, tentativi < 5), fa `net.http_post` a `…/functions/v1/billing-scheduled` con `x-push-secret`.
  - `cron.schedule('billing-scheduled-changes', '*/10 * * * *', 'select private.run_scheduled_billing_changes()')` dentro lo stesso blocco `do … exception` di `archive_reminders`.
  - Service role:
    - `public.billing_scheduled_claim(p_environment text, p_limit integer default 10) returns setof public.billing_scheduled_changes`: righe `pending` in finestra con `next_attempt_at <= now()`, `for update skip locked`; porta `next_attempt_at` a `now() + 15 minutes` prima di restituirle.
    - `public.billing_scheduled_result(p_id uuid, p_ok boolean, p_error text, p_permanent boolean) returns void`. Con `ok`: `applied`, `applied_at`. Con errore permanente: `failed`, `close_reason` (`paddle_mismatch` se `p_error` è `paddle_period_moved` o `paddle_items_changed`, altrimenti `paddle_error`) e `alert_kind = 'failed'`. Con errore transitorio: `attempts + 1`, `last_error_code` e `next_attempt_at = now() + least(10 * 2^attempts, 60) minutes`.
- Instradamento della notifica:
  - nell'app: `manager` → `"/(manager)/(tabs)"`, `waiter` → `null`, icona come `archive_reminder`;
  - sul web: `"/piano"`.

- [ ] **Step 1: Test SQL.**
  - **Promemoria**: chiesto 10 giorni prima → nessuna notifica a 8 giorni, una a 7 giorni; chiamare di nuovo non la duplica; chiesto 5 giorni prima → nessuna notifica, mai.
  - **Regole cambiate**: 31 persone dentro la finestra → `failed` con `rules_changed` e `alert_kind = 'failed'`.
  - **Allarme**: a 5 ore → `not_sent`.
  - **Presa in carico**: `billing_scheduled_claim` due volte di seguito restituisce la riga una volta sola (Review Focus 2).
  - **Esiti**: `billing_scheduled_result` con ok, errore permanente e transitorio porta lo stato giusto, e l'attesa cresce (10 → 20 → 40 → 60 minuti).
  - **Privilegi**: nessun `EXECUTE` per `authenticated`.
  - **Cambio di ciclo** (Review Focus 4): l'avviso nella forma registrata in Task 0 dopo la `PATCH` mensile→annuale passa da `billing_apply_event` senza `rejected`.
- [ ] **Step 2: Test unit di routing** per `billing_change_reminder`: manager → `"/(manager)/(tabs)"`, waiter → `null`; sul web → `"/piano"`.
- [ ] **Step 3: Verifica** che i test falliscano.
- [ ] **Step 4: Implementa la migration e l'instradamento.**
  - Se il test di Review Focus 4 fallisce con la forma reale di Task 0, ridefinisci `billing_apply_event` (copia integrale da `20261019000800_paused_items.sql`). Il controllo `mixed_billing_interval` deve accettare articoli dell'intervallo d'arrivo di una riga `applied` di quell'abbonamento, mantenendo `billing_interval` e periodo dell'avviso.
  - Se invece Task 0 mostra che Paddle aggiorna anche `billing_cycle`, non serve toccarla.
- [ ] **Step 5: Rilancia** `supabase/tests/run.sh test` e `yarn test:unit`: verdi.
- [ ] **Step 6: Lascia pronto** e rigenera i tipi.

---

### Task 5: Edge Function `billing-scheduled`

**Files:**
- Create: `supabase/functions/billing-scheduled/logic.ts`
- Create: `supabase/functions/billing-scheduled/index.ts`
- Test: `tests/unit/edge/billingScheduled.test.ts` (stile di `tests/unit/edge/billingManage.test.ts` e `archiveReminders.test.ts`, con `edgeRuntime`/`post` da `./runtime`)

**Interfaces:**
- Consumes: `billing_scheduled_claim`, `billing_scheduled_result` (Task 4); tabella di Task 1 (select/update service role per le email).
- Produces (`logic.ts`, nessun import dall'app):
  - `paddleConfig`: copia da `billing-manage/logic.ts`.
  - `checkScheduledTarget(sub: unknown, row: { effectiveAt: string; fromItems: Item[] }): null | "paddle_not_active" | "paddle_period_moved" | "paddle_items_changed"`.
    - `next_billed_at` deve stare entro ±120 s da `effectiveAt`.
    - Gli articoli attivi e ricorrenti, ordinati, devono coincidere con `fromItems`.
  - `scheduledPatchBody(items: Item[])` → `{ items, proration_billing_mode: "do_not_bill" }`.
  - `isPermanent(code: string): boolean` → vero per i tre codici di `checkScheduledTarget`, falso per gli errori HTTP/rete di Paddle (5xx, 429, 0) e per 4xx diversi da 400/404/422 (che sono permanenti).
  - `formatReminder(row, workspaceName, dashboardUrl): { subject, text, html }` per l'email al titolare.
    - Oggetto: «Dal {gg/mm/aaaa} cambia l'abbonamento di {azienda}».
    - Testo: piano, ciclo, sedi, importo `renewal_cents` in `currency` («IVA compresa»), link `{dashboardUrl}/#/piano`.
  - `formatAlert(row, workspaceName, dashboardUrl): { subject, text, html }` per l'email al fondatore.
    - Oggetto: «[KlokShift] Cambio di piano da controllare: {azienda}».
    - Testo: motivo in italiano per `alert_kind` e `last_error_code`, data del rinnovo, link all'area fondatore.
  - `runScheduled(deps)` con dipendenze iniettabili (come `runReminders` in `archive-reminders`): `claim`, `getSubscription`, `patchSubscription`, `result`, `listReminderEmails`, `listAlertEmails`, `send`, `markReminder`, `markAlert`. Per ogni riga presa in carico fa GET → `checkScheduledTarget` → PATCH → `result`, poi spedisce le email in attesa. Restituisce i conteggi.
- `index.ts`:
  - auth `x-push-secret` contro `PUSH_HOOK_SECRET` (401 se manca o è sbagliato);
  - variabili `PADDLE_API_KEY`, `PADDLE_ENVIRONMENT`, `SMTP_*`, `DASHBOARD_URL`, `FOUNDER_ALERT_EMAIL`;
  - destinatario del promemoria: l'email di `requested_by` se è ancora titolare attivo con email confermata (scelta d'esecuzione: un'email sola, a chi ha chiesto il cambio; la notifica nell'app va comunque a tutti i titolari);
  - nei log solo codici, mai corpi o indirizzi;
  - commento d'intestazione con il deploy: `supabase functions deploy billing-scheduled --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg`.

- [ ] **Step 1: Test unit.**
  - `checkScheduledTarget`: data spostata di 3 minuti → `paddle_period_moved`; articolo in più → `paddle_items_changed`; stesso insieme in ordine diverso → `null`; stato `paused` → `paddle_not_active`.
  - `scheduledPatchBody`: `proration_billing_mode === "do_not_bill"`.
  - `isPermanent`: tabella dei casi.
  - `formatReminder`: `effective_at = "2026-11-17T23:30:00Z"` → l'oggetto contiene «18/11/2026» (Review Focus 5), 29000 centesimi EUR → «290,00 €».
  - `runScheduled` con dipendenze finte: successo → `result(id, true, null, false)`; GET fallito → `result(id, false, "paddle_unavailable", false)`; articoli cambiati → nessuna PATCH e `result(…, "paddle_items_changed", true)`.
  - `index`: senza segreto → 401.
- [ ] **Step 2: Verifica** che i test falliscano: `yarn test:unit tests/unit/edge/billingScheduled.test.ts`.
- [ ] **Step 3: Implementa** `logic.ts` e `index.ts`.
- [ ] **Step 4: Rilancia** i test: verdi.
- [ ] **Step 5: Lascia pronto.** Il deploy e la variabile `FOUNDER_ALERT_EMAIL` li fa il fondatore: annotali in `docs/TEST-BILLING-SCHEDULED.md`.

---

### Task 6: Azioni di `billing-manage` e client web

**Files:**
- Modify: `supabase/functions/billing-manage/logic.ts`, `supabase/functions/billing-manage/index.ts`
- Modify: `web/src/billing/manage.ts`
- Test: `tests/unit/edge/billingManage.test.ts`

**Interfaces:**
- Consumes: `billing_prepare_scheduled_change`, `billing_record_scheduled_change`, `billing_cancel_scheduled_change` (Task 1).
- Produces:
  - `ManageAction` aggiunge `"preview_scheduled_change" | "schedule_change" | "cancel_scheduled_change"`.
  - `ManageRequest` per i primi due: `plan`, `interval: "month" | "year"`, `extraVenues`.
  - `buildScheduledItems(current: unknown, change: PreparedScheduledChange): Item[] | null` in `logic.ts`:
    - stesso ciclo: le regole di `buildItems`, compresa la conservazione dei prezzi invariati;
    - ciclo diverso: tutti gli articoli prendono i prezzi d'arrivo;
    - 0 sedi in più: niente articolo sede.
  - `PreparedScheduledChange` = `PreparedChange` & `{ effectiveAt: string; currentInterval: "month" | "year"; interval: "month" | "year" }`.
  - Flusso in `index.ts` per i due nuovi tipi di cambio:
    1. RPC prepare;
    2. GET Paddle;
    3. `next_billed_at` entro ±120 s da `effectiveAt`, altrimenti `billing_unavailable`;
    4. `buildScheduledItems`;
    5. `PATCH /subscriptions/{id}/preview` con `do_not_bill`;
    6. `previewSummary`: `dueNowCents` deve essere 0, altrimenti `billing_unavailable`;
    7. per `preview_scheduled_change` risposta `{ currency, renewalCents, effectiveAt }`; per `schedule_change` RPC record con gli articoli correnti e quelli d'arrivo, poi `{ ok: true }`.
  - `cancel_scheduled_change`: chiama solo la RPC.
  - `DB_ERRORS` aggiunge, tutti a 409: `billing_change_pending`, `billing_scheduled_not_reduction`, `billing_too_close_to_renewal`, `billing_scheduled_people`, `billing_scheduled_venues`, `billing_change_already_sent`, `billing_nothing_scheduled`, `billing_interval_change_unavailable`.
  - Web `manage.ts`:
    - `previewScheduledChange(sel: ScheduledSelection): Promise<ScheduledPreview>`, `scheduleChange(sel): Promise<{ ok: true }>`, `cancelScheduledChange(workspaceId): Promise<{ ok: true }>`;
    - `ScheduledSelection = { workspaceId; plan; interval; extraVenues }`, `ScheduledPreview = { currency; renewalCents; effectiveAt }`.
  - Web `ERRORS`: togli la voce di `billing_downgrade_unsupported` che rimanda all'email e aggiungi i nuovi codici:
    - `billing_change_pending`: «C'è già un cambio programmato: annullalo prima di farne un altro o di aumentare il piano.»
    - `billing_too_close_to_renewal`: «Mancano meno di 24 ore al rinnovo: per cambiare adesso scrivi a info@klokshift.com.»
    - `billing_change_already_sent`: «Il cambio è già stato inviato per il rinnovo: dopo il rinnovo potrai modificare di nuovo il piano.»
    - `billing_scheduled_people`: «Il piano Base comprende 30 persone: togli dal team chi non lavora più prima di programmare il cambio.»
    - `billing_scheduled_venues`: «Chiudi prima le sedi in più: le sedi aperte devono stare nel piano scelto.»
    - `billing_interval_change_unavailable`: «Il cambio fra mensile e annuale per ora si fa scrivendo a info@klokshift.com.»
    - `billing_scheduled_not_reduction`: «Per aumentare piano o sedi usa il modulo dell'aumento: vale subito.»

- [ ] **Step 1: Test unit** in `billingManage.test.ts`.
  - `parseRequest`: accetta i tre nuovi tipi; rifiuta `interval` diverso da `month`/`year` e `extraVenues` negativo.
  - `buildScheduledItems`:
    - Team→Base mensile con prezzo sede vecchio → tiene `pri_01extraold`;
    - mensile→annuale → tutti prezzi annuali;
    - da 2 sedi in più a 0 → solo il piano;
    - articolo sconosciuto → `null`.
  - `dbError("… billing_scheduled_people …")` → 409.
- [ ] **Step 2: Verifica** che falliscano.
- [ ] **Step 3: Implementa.**
- [ ] **Step 4: Rilancia** `yarn test:unit` e `npx tsc --noEmit`: verdi.
- [ ] **Step 5: Lascia pronto.**

---

### Task 7: Pagina Piano

**Files:**
- Create: `src/features/workspace/scheduledChange.ts` (regole pure condivise, nessun import Expo/RN)
- Modify: `src/features/workspace/billing.ts` (`WorkspaceBilling.pending_change` + parsing)
- Create: `supabase/migrations/20261101000400_workspace_billing_pending.sql` (ridefinisce `get_workspace_billing`, copia da `20261019000700_billing_pause.sql`)
- Modify: `web/src/pages/Piano.tsx`
- Test: `tests/unit/scheduledChange.test.ts`, test del parsing nel file che già copre `parseWorkspaceBilling` (`grep -rl parseWorkspaceBilling tests`); asserzioni SQL in `145`

**Interfaces:**
- Produces:
  - `get_workspace_billing` aggiunge `pending_change: null | { plan, billing_interval, extra_venues, effective_at, renewal_cents, currency, status: "pending" | "applied", cancel_until }`, dove `cancel_until = effective_at - 24 h`.
  - `WorkspaceBilling.pending_change` con lo stesso tipo; `parseWorkspaceBilling` lo valida (un dato incoerente fallisce, come il resto).
  - `scheduledChangeBlocker(input: { current: { plan; interval; extraVenues }; target: { plan; interval; extraVenues }; people: number; openVenues: number }): string | null` restituisce il primo motivo che si applica, con questo testo esatto:
    - «È la stessa scelta che hai già.»
    - «Per aumentare piano o sedi usa il modulo dell'aumento: vale subito.»
    - «Hai {n} persone nel team: il piano Base ne comprende 30.»
    - «Hai {n} sedi aperte: chiudine {n − capacità} prima di ridurre.»
  - `describePlanTarget(t): string`, per esempio «Base · annuale, 1 sede» o «Team · mensile, 3 sedi».
- UI in `SubscriptionCard`:
  - **Modulo `ScheduleChangeForm`**, visibile con abbonamento `active`, nessuna pausa o chiusura programmata e `pending_change` null:
    - scelte: piano (solo quelli ≤ attuale), ciclo, numero di sedi (da 1 all'attuale);
    - sotto le scelte, il messaggio di `scheduledChangeBlocker` (persone e sedi aperte da `access.usage`);
    - pulsante «Vedi l'importo» → `previewScheduledChange`, che mostra «Dal {data}: {describePlanTarget} — {importo} IVA compresa»;
    - pulsante «Programma il cambio» → `scheduleChange`, poi `onAwait` come gli altri.
  - **Riga del cambio in attesa**, al posto del modulo e dell'aumento quando `pending_change` c'è: «Dal {data}: {describePlanTarget} — {importo} IVA compresa».
    - Con `status === "pending"` e prima di `cancel_until`: pulsante «Annulla il cambio» → `cancelScheduledChange`.
    - Altrimenti: «Il cambio è già stato inviato per il rinnovo.»
  - **`UpgradeForm`** nascosto mentre c'è `pending_change`, con la riga «Per aumentare annulla prima il cambio programmato» (finché si può annullare).
  - **Conferme di pausa e chiusura**: con un `pending_change` in stato `pending`, aggiungi «Il cambio programmato dal {data} verrà annullato.»
  - Togli il paragrafo «Per passare a un piano più piccolo… scrivi a info@klokshift.com».

- [ ] **Step 1: Test unit.**
  - `scheduledChangeBlocker`: un caso per ogni messaggio, compresi «Hai 34 persone nel team: il piano Base ne comprende 30.» e «Hai 3 sedi aperte: chiudine 1 prima di ridurre.» (target 2 sedi); scelta valida → `null`.
  - `describePlanTarget`: singolare e plurale.
  - `parseWorkspaceBilling`: con e senza `pending_change`, e uno stato non valido che fallisce.
  - Test SQL in `145`: `get_workspace_billing` restituisce `pending_change` al titolare.
- [ ] **Step 2: Verifica** che falliscano.
- [ ] **Step 3: Implementa** migration, regole, parsing e UI.
- [ ] **Step 4: Verifica.**
  - Lancia `supabase/tests/run.sh test`, `yarn test:unit`, `npx tsc --noEmit` e `yarn lint`: tutti verdi.
  - Lancia anche `yarn web:typecheck`.
  - Apri la pagina in locale (`yarn web:dev`) con un abbonamento sandbox. Se non è possibile, dillo nel resoconto invece di dichiararla provata.
- [ ] **Step 5: Lascia pronto** e rigenera i tipi.

---

### Task 8: Area del fondatore

**Files:**
- Create: `supabase/migrations/20261101000500_admin_scheduled_changes.sql`
- Create: `supabase/tests/rls/146_admin_scheduled_changes.sql`
- Create: `src/features/admin/scheduledChanges.ts`
- Create: `web/src/admin/ScheduledChanges.tsx`
- Modify: `web/src/admin/pages.tsx` (accanto a `<BillingAdjustments …/>` alle righe ~120 e ~436)
- Test: `tests/unit/adminScheduledChanges.test.ts`

**Interfaces:**
- Consumes: tabella (Task 1), `private.run_scheduled_billing_changes` (Task 4), `private.require_platform_admin`.
- Produces:
  - `public.admin_list_scheduled_billing_changes(p_workspace uuid default null, p_attention_only boolean default true, p_limit integer default 50, p_offset integer default 0) returns jsonb`.
    - Ogni voce: `id, workspace_id, workspace_name, environment, status, close_reason, target_plan, target_interval, target_extra_venues, effective_at, renewal_cents, currency, attempts, last_error_code, alert_kind, created_at, applied_at, confirmed_at, reviewed_at, review_note`.
    - «Da verificare» = `alert_kind` non nullo e `reviewed_at` nullo.
  - `public.admin_resolve_scheduled_billing_change(p_id uuid, p_note text) returns void`: nota di 3–500 caratteri, `reviewed_at` / `reviewed_by`.
  - `public.admin_retry_scheduled_billing_change(p_id uuid) returns void`.
    - Ammessa solo con `effective_at > now()` e stato `pending` o `failed` (non per `renewal_mismatch`), altrimenti `scheduled_change_not_retryable`.
    - Riporta la riga a `pending`, con `attempts = 0`, `next_attempt_at = now()`, `alert_kind = null`, `alert_emailed_at = null`, `alert_email_attempts = 0` e `close_reason` / `closed_at` nulli.
    - Poi chiama `private.run_scheduled_billing_changes()`. Le regole le ricontrolla il runner.
    - Se un'altra riga aperta esiste già per l'abbonamento, `billing_change_pending`.
  - Client `scheduledChanges.ts`: `listScheduledChanges`, `resolveScheduledChange`, `retryScheduledChange`, tipo `ScheduledBillingChange` e parsing, sullo stile di `src/features/admin/billing.ts`.
  - Componente `ScheduledChanges({ userId, workspaceId? })` sullo stile di `BillingAdjustments.tsx`, con queste etichette:
    - `not_sent`: «Il cambio non è ancora arrivato a Paddle e il rinnovo è fra meno di 6 ore. Prova a inviarlo di nuovo; se non va, al rinnovo Paddle addebita il piano attuale e la differenza va rimborsata.»
    - `failed`: «Il cambio non si può applicare ({motivo}): il rinnovo avverrà col piano attuale. Avvisa il titolare.»
    - `renewal_mismatch`: «Il rinnovo è avvenuto con un piano diverso da quello programmato: controlla su Paddle e rimborsa la differenza.»
  - Pulsante «Riprova adesso», visibile solo se la riga si può ritentare, e campo nota per chiudere l'avviso.

- [ ] **Step 1: Test SQL (`146`).**
  - Un utente non fondatore riceve l'errore delle altre RPC admin.
  - L'elenco «da verificare» mostra solo righe con allarme non chiuso.
  - Chiudere un avviso con una nota di 2 caratteri fallisce.
  - Il ritentativo di una riga `failed` con rinnovo futuro la riporta a `pending`; con rinnovo passato fallisce con `scheduled_change_not_retryable`.
- [ ] **Step 2: Test unit del parsing.** Un caso valido, più una voce con `alert_kind` sconosciuto che fallisce.
- [ ] **Step 3: Verifica** che i test falliscano.
- [ ] **Step 4: Implementa.**
- [ ] **Step 5: Rilancia** `supabase/tests/run.sh test`, `yarn test:unit`, `npx tsc --noEmit` e `yarn lint`: verdi.
- [ ] **Step 6: Lascia pronto** e rigenera i tipi.

---

### Task 9: Documenti e procedura di prova

**Files:**
- Modify: `docs/MONETIZATION.md` (§2 «Esecuzione attuale»), `plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md` (M09: spunta la riga delle riduzioni con data e migration), `TASKS.md` («Prima dei primi clienti paganti»), `docs/FOUNDER-DASHBOARD.md` (sezione cambi programmati), `docs/TEST-BILLING-SCHEDULED.md`
- Check: `grep -rn "info@klokshift.com" web-site/src web-site/public web/src` per frasi che mandano all'email per riduzioni o cambio di ciclo

- [ ] **Step 1: Aggiorna i documenti.**
  - Riduzioni e cambio di ciclo ora si programmano dalla pagina Piano. Non sono più via email, salvo meno di 24 ore dal rinnovo e il caso di arresto di Task 0.
  - Elenca le operazioni manuali del fondatore:
    1. push su `main` (la CI applica le migration);
    2. `supabase functions deploy billing-scheduled --no-verify-jwt`;
    3. `supabase functions deploy billing-manage`;
    4. variabile `FOUNDER_ALERT_EMAIL`;
    5. verifica di `cron.job` sul remoto;
    6. spegnere il cambio di piano nel portale Paddle, se Task 0 l'ha trovato.
- [ ] **Step 2: Completa la procedura manuale** in `docs/TEST-BILLING-SCHEDULED.md`:
  - programma, poi promemoria (con `effective_at` avvicinato);
  - invio, rinnovo e stato `confirmed`;
  - annulla;
  - pausa con cambio in attesa;
  - allarme simulando l'invio mancato (Edge Function spenta o `PADDLE_API_KEY` errata), con l'email a info@ arrivata e «Riprova adesso».
- [ ] **Step 3: Verifica finale.** `supabase/tests/run.sh reset && supabase/tests/run.sh test`, `yarn test:unit`, `npx tsc --noEmit`, `yarn lint`: tutti verdi, e riporta l'output.
- [ ] **Step 4: Lascia pronto.** Elenca al fondatore i file cambiati e le operazioni manuali di Step 1.
