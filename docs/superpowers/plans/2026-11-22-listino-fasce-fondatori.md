# Listino a tre fasce e clienti fondatori: piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sostituire Base/Team (30 persone / senza limite) con le fasce Piccola/Media/Grande (15/40/100) in server, Paddle, dashboard, sito e app, e aggiungere lo sconto «clienti fondatori» (−30% per 24 mesi alle prime 30 aziende che pagano).

**Architecture:** il limite di persone passa da sei `case when plan = 'base' then 30` sparsi a **una** funzione SQL, `private.plan_people_limit`, con un gemello manuale TypeScript (`src/features/workspace/planBands.ts`). Le chiavi interne restano `base` (Piccola) e `team` (Media); si aggiungono `large` (Grande) e, solo per le concessioni del fondatore, `custom` (senza limite). Lo sconto è uno sconto Paddle **senza scadenza propria**: lo applica il checkout, lo conferma l'avviso firmato e lo toglie KlokShift alla data `ends_at` che decide il database, così pausa e cambio di ciclo non spostano i 24 mesi.

**Tech Stack:** Postgres/Supabase (migration plpgsql, banco `supabase/tests/run.sh`), Edge Functions Deno (`supabase/functions/*/logic.ts` testate da vitest in `tests/unit/edge`), React/Vite (`web/`), Expo (`src/`), Paddle Billing API.

**Spec:** [docs/MONETIZATION.md](../../MONETIZATION.md), §2 («Listino a tre fasce», «Passaggio al listino a fasce», conteggio, superamento) e §2-bis («Clienti fondatori»).

Il piano ha **due parti rilasciabili da sole**: la Parte A (fasce) funziona senza la B; la Parte B (fondatori) presuppone la A.

## Global Constraints

- Fasce: `base` = **Piccola**, fino a **15** persone, 29 €/mese, 290 €/anno; `team` = **Media**, fino a **40**, 49 €/490 €; `large` = **Grande**, fino a **100**, 89 €/890 €; sede aggiuntiva 15 €/150 € per tutte.
- `custom` = «Su misura», persone senza limite: **solo** sulle concessioni del fondatore (`workspace_access_periods`), mai in `billing_prices`, checkout o cambi di piano.
- Contano solo le persone **attive** in organico (regola già in vigore: non va peggiorata).
- Avviso «vicino al limite» a **limite − 2** persone (era 28 con 30).
- Prova: fascia **Grande** (`large`), una sede, 720 ore.
- Fondatori: **30** aziende, **−30%** su fascia e sedi aggiuntive, mensile e annuale, **24 mesi di calendario** (Europe/Rome) dal primo addebito; preavviso **60 giorni** prima della fine; non dopo un'uscita (azienda con un abbonamento precedente); non si somma alla gratuità a vita.
- Le migration già applicate **non si toccano**: ogni funzione cambiata si ricopia integralmente dall'**ultima** definizione in una migration nuova (`CREATE OR REPLACE`, stessa firma).
- L'app nativa non mostra prezzi né sconti (App Store 3.1.3): solo nomi di fascia e limiti.
- Stringhe utente in italiano, glossario (`docs/GLOSSARIO.md`): «persone», «sede», mai «piano Team». Il test `tests/unit/glossary.test.ts` deve restare verde.
- Chiave API Paddle mai nella chat: i passi su Paddle li fa l'utente dalla dashboard o dal suo terminale.
- Lavoro su `main`, **un solo commit alla fine**, quando l'utente lo chiede (niente commit per task, niente worktree o rami).

## Review Focus

1. **Azienda già sopra la soglia nuova** (es. 20 persone su `base`): resta operativa, nessuno viene tolto, si blocca solo la 21ª aggiunta → test in Task A1.
2. **Concessione a vita «Team» di Da Buffa con più di 40 persone**: dopo la migration resta senza limite (`custom`) → test in Task A1.
3. **Riduzione sotto la capacità**: Grande→Media con 41 persone e Media→Piccola con 16 rifiutate, sia subito sia al rinnovo → test in Task A1.
4. **Seconda volta**: un'azienda con un abbonamento disdetto che ricompra non riceve lo sconto fondatori → test in Task B1.
5. **Limite Paddle raggiunto** (31° acquisto in contemporanea): il checkout parte a prezzo pieno e la pagina non promette lo sconto → test in Task B2.

---

## Parte A: le tre fasce

### Task A0: catalogo Paddle sandbox (a mano, lo fa l'utente)

**Files:**
- Modify: `docs/TEST-BILLING-SCHEDULED.md` (sezione nuova «Catalogo a fasce, 22/11»)

**Interfaces:**
- Produces: due `price_id` sandbox nuovi (`large` mese, `large` anno) da usare nel Task A1.

- [ ] **Step 1:** in Paddle sandbox, rinominare i prodotti «Base» → «Piccola» e «Team» → «Media» (il nome compare in checkout e fatture). I prezzi 29/290 e 49/490 restano gli stessi `price_id`.
- [ ] **Step 2:** creare il prodotto «Grande» con due prezzi EUR, tasse escluse: 89 € ogni mese e 890 € ogni anno, `custom_data` vuoto.
- [ ] **Step 3:** annotare i due `pri_…` nel documento. Fatto quando entrambi gli id sono scritti lì.

### Task A1: fasce nel database

**Files:**
- Create: `supabase/migrations/20261122000100_plan_bands.sql`
- Create: `supabase/tests/rls/147_plan_bands.sql`
- Modify: i test esistenti che contano su 30 o su `team` senza limite (almeno `050_commercial_capacity.sql`, `060_founder_concessions.sql`, `070_workspace_access.sql`, `095_founder_concessions.sql`, `100_billing.sql`, `105_billing_manage.sql`, `145_billing_scheduled_changes.sql`)

**Interfaces:**
- Consumes: i `price_id` del Task A0.
- Produces:
  - `private.plan_people_limit(p_plan text) returns integer` (immutable): `base` 15, `team` 40, `large` 100, `custom` null, altro → eccezione `billing_invalid_selection`.
  - `private.plan_rank(p_plan text) returns integer` (immutable): `base` 1, `team` 2, `large` 3. Serve per dire «aumento» o «riduzione»; `custom` non ha rango e va rifiutato.
  - `access.limits.people` = `plan_people_limit(plan)`. La forma del JSON non cambia.

- [ ] **Step 1: scrivere il test che fallisce** `147_plan_bands.sql`, con queste asserzioni (`tests.eq`):
  - `plan_people_limit('base') = 15`, `('team') = 40`, `('large') = 100`, `('custom') is null`.
  - Azienda con abbonamento `base` e 20 persone attive: `workspace_access_at(...)->>'state' = 'operational'`, aggiungere la 21ª persona solleva `workspace_people_capacity`, le 20 restano (`count` invariato).
  - Persona uscita (`status = 'left'`) non conta in `usage.people`.
  - `billing_prepare_change` da `large` a `team` con 41 persone → `workspace_people_capacity`; `billing_prepare_scheduled_change` da `team` a `base` con 16 persone → `workspace_people_capacity`; da `team` a `large` con 41 persone → accettato.
  - Dopo la migration, un periodo `complimentary_lifetime` che era `team` ha `plan = 'custom'` e `limits.people` nullo con 45 persone; una prova attiva che era `team` è `large`.
  - `start_workspace_trial` su un'azienda nuova crea un periodo `large`.
  - `admin_workspace_flags`: segnala «vicino al limite» a 13/15 e non a 12/15.
- [ ] **Step 2:** `supabase/tests/run.sh reset && supabase/tests/run.sh test` → FAIL su `plan_people_limit` inesistente.
- [ ] **Step 3: scrivere la migration.** Nell'ordine:
  1. Allargare i `check` su `workspace_access_periods.plan` (`'base','team','large','custom'`), `billing_prices.item` (`+ 'large'`), `billing_subscriptions.plan`, `billing_checkouts.plan`, `billing_scheduled_changes.target_plan` (`+ 'large'`). Togliere e ricreare il vincolo col suo nome (leggerlo da `pg_constraint`).
  2. Le due funzioni `plan_people_limit` e `plan_rank`.
  3. Ricopiare dall'ultima definizione, cambiando solo le righe indicate:
     - `private.workspace_access_at`, da `20261019000300_renewal_margin.sql` (riga `v_people_limit := …`).
     - `private.admin_workspace_flags`, da `20261006000100` (`='30' … >=28` → `usage >= limit - 2`, con il limite non nullo).
     - `public.admin_apply_workspace_action`, da `20261006000200` (accetta `base|team|large|custom` per `grant_lifetime`; il controllo `>30` diventa `> plan_people_limit(p_plan)`).
     - `public.billing_prepare_checkout`, da `20261018000000` (`p_plan in ('base','team','large')`, controllo persone con la funzione).
     - `public.billing_prepare_change` e `public.billing_prepare_scheduled_change`, `private.billing_scheduled_rules_error`, `public.billing_record_scheduled_change`, da `20261101000000` (liste di piani e confronti `team`/`base` → `plan_rank`).
     - `private.billing_future_limits`, da `20261101000200`.
     - `public.billing_apply_event`, da `20261019000800` (filtri `bp.item in ('base','team','large')`; `max(bp.item)` resta corretto, perché c'è al massimo una voce di fascia).
     - `public.start_workspace_trial`, da `20261012000800` (`'team'` → `'large'`).
  4. Dati: `update workspace_access_periods set plan = 'large' where kind = 'trial' and plan = 'team'`, e `set plan = 'custom' where kind in ('complimentary_lifetime','complimentary_temporary','transition') and plan = 'team'`. Per ogni riga di concessione toccata, una riga in `private.admin_operations` con `action = 'plan_band_migration'` (allargare quel `check`), `actor_id` nullo (rendere la colonna nullable solo per quell'azione, con un `check`), motivo «Listino a fasce del 22/11: perimetro senza limite mantenuto», prima e dopo dallo snapshot.
  5. `insert into private.billing_prices` dei due prezzi sandbox `large`.
- [ ] **Step 4:** `supabase/tests/run.sh reset && supabase/tests/run.sh test` → tutto PASS, compresi i test esistenti aggiornati (le soglie di 30 diventano 15; un `team` «senza limite» diventa `custom` o `large`, a seconda di cosa il test vuole provare).
- [ ] **Step 5:** `supabase/tests/gen-types.sh` per rigenerare `src/types/database.ts`.

### Task A2: Edge Functions

**Files:**
- Modify: `supabase/functions/billing-checkout/logic.ts`, `supabase/functions/billing-manage/logic.ts`, `supabase/functions/billing-scheduled/logic.ts`
- Test: `tests/unit/edge/` (i test esistenti di queste tre funzioni)

**Interfaces:**
- Produces: in ogni `logic.ts`, il tipo locale `type BillingPlan = "base" | "team" | "large"` e `const PLAN_LABEL: Record<BillingPlan, string> = { base: "Piccola", team: "Media", large: "Grande" }`. Le Edge Functions non importano dal bundle dell'app: il doppione è voluto.

- [ ] **Step 1: test che falliscono:** `parseSelection({ ..., plan: "large" })` restituisce la selezione; `plan: "custom"` → null; l'etichetta del riepilogo di `billing-scheduled` per `large` è `"Grande"` (prima `"Base"`/`"Team"`).
- [ ] **Step 2:** `yarn vitest run tests/unit/edge` → FAIL.
- [ ] **Step 3:** sostituire le unioni `"base" | "team"` e i controlli `raw.plan !== …` con `BillingPlan`, e le etichette con `PLAN_LABEL`.
- [ ] **Step 4:** `yarn vitest run tests/unit/edge` → PASS.

### Task A3: fasce nel codice condiviso (app e dashboard)

**Files:**
- Create: `src/features/workspace/planBands.ts`
- Modify: `shared/pricing.ts`, `src/features/workspace/access.ts:22,149-150`, `src/features/workspace/billing.ts:10`, `src/features/workspace/scheduledChange.ts:8,22-25,38`, `src/features/admin/controls.ts:16,49`, `src/features/admin/types.ts:56,81`, `src/features/admin/finance.ts:30`, `src/features/admin/scheduledChanges.ts:28`
- Test: `tests/unit/workspace/planBands.test.ts` (nuovo), `tests/unit/scheduledChange.test.ts`, `tests/unit/webPricing.test.ts`, `tests/unit/customerCommercial.test.ts`

**Interfaces:**
- Produces:
  - `export type SalePlan = "base" | "team" | "large"` e `export type AccessPlan = SalePlan | "custom"`.
  - `export const PLAN_BANDS: Record<AccessPlan, { label: string; people: number | null }>` = `{ base: {label:"Piccola",people:15}, team: {label:"Media",people:40}, large: {label:"Grande",people:100}, custom: {label:"Su misura",people:null} }`. Gemello **manuale** di `private.plan_people_limit`: dirlo nell'intestazione del file.
  - `export function planRank(p: SalePlan): 1 | 2 | 3`.
  - `export function planOptionLabel(p: AccessPlan): string` → `"Piccola · fino a 15 persone"`, `"Su misura · senza limite di persone"`.
  - `shared/pricing.ts`: `PLAN_PRICES` con la chiave `large: { monthly: 89, annual: 890 }`, `PricingPlan = keyof typeof PLAN_PRICES`. Niente import di `planBands.ts` da `shared/` verso l'app nativa: `shared/` resta solo web.

- [ ] **Step 1: test che falliscono:** `PLAN_BANDS.base.people === 15`, `.team.people === 40`, `.large.people === 100`, `.custom.people === null`; `planOptionLabel("large") === "Grande · fino a 100 persone"`; `quotePlan("large","annual",3).total === 1190`; `quotePlan("large","monthly",5).total === 149`; `scheduledChange` rifiuta `team`→`base` con 16 persone e `large`→`team` con 41; la validazione di `access.ts` accetta `{plan:"large",limits:{people:100}}` e `{plan:"custom",limits:{people:null}}`, e rifiuta `{plan:"base",limits:{people:30}}`.
- [ ] **Step 2:** `yarn vitest run tests/unit/workspace tests/unit/scheduledChange.test.ts tests/unit/webPricing.test.ts tests/unit/customerCommercial.test.ts` → FAIL.
- [ ] **Step 3:** implementare. `access.ts:149` diventa `access.limits.people !== PLAN_BANDS[access.plan].people`; `BASE_PEOPLE` in `scheduledChange.ts` sparisce a favore di `PLAN_BANDS`; gli `z.enum` diventano `["base","team","large"]` (o `+ "custom"` dove si leggono periodi o concessioni: `types.ts:56`, `controls.ts`).
- [ ] **Step 4:** stessi comandi → PASS; `npx tsc --noEmit` → nessun errore.

### Task A4: pagina Piano e area del fondatore

**Files:**
- Modify: `web/src/pages/Piano.tsx:59,133,221,341-367,406-450,468-492`, `web/src/billing/checkout.ts:14`, `web/src/billing/manage.ts:13-14`, `web/src/admin/WorkspaceActions.tsx:33-122`, `web/src/admin/pages.tsx:238,275,289,370`
- Test: i test esistenti di `tests/unit/web/` che toccano Piano e admin (`grep -l "Team ·\|fino a 30" tests/unit`)

**Interfaces:**
- Consumes: `PLAN_BANDS`, `planOptionLabel`, `planRank`, `SalePlan` (Task A3).

- [ ] **Step 1: test che falliscono** (aggiornare quelli che si aspettano «Base · fino a 30 persone»): il selettore d'acquisto mostra le tre opzioni `planOptionLabel`, nascondendo quelle con `PLAN_BANDS[p].people < usage.people`; il selettore «aumenta» mostra solo le fasce con `planRank` maggiore di quella attuale; quello «dal prossimo rinnovo» solo quelle minori o uguali; i misuratori dell'admin usano `limits.people === null` per «Senza limite», non `plan === 'team'`; la concessione offre quattro `RadioCard` (Piccola, Media, Grande, Su misura); con la fascia Grande e `usage.people >= 98` la pagina Piano mostra «Oltre 100 persone serve un accordo su misura: scrivi a info@klokshift.com» al posto del selettore d'aumento.
- [ ] **Step 2:** `yarn vitest run tests/unit/web tests/unit/admin*` → FAIL.
- [ ] **Step 3:** implementare sostituendo ogni ternario `base ? "Base" : "Team"` con `PLAN_BANDS[x].label`.
- [ ] **Step 4:** stessi test → PASS; `yarn lint` → pulito.

### Task A5: sito vetrina

**Files:**
- Modify: `web-site/src/content/it.ts:149-215` (tre schede, FAQ della prova: «piano Team» → «fascia Grande»)
- Test: `tests/unit/web/siteCopy.test.ts`, `tests/unit/webPricing.test.ts`

- [ ] **Step 1: test che falliscono:** il contenuto ha tre piani con `amount` da `PLAN_PRICES.base|team|large`, dettagli «Fino a 15 persone nell'intera azienda», «Da 16 a 40 persone», «Da 41 a 100 persone»; una riga «Oltre 100 persone o più di 5 sedi: scrivici» con `info@klokshift.com`; nessuna stringa contiene «Team» come nome di piano.
- [ ] **Step 2:** `yarn vitest run tests/unit/web/siteCopy.test.ts tests/unit/webPricing.test.ts` → FAIL.
- [ ] **Step 3:** aggiornare `it.ts`. Il badge «Per iniziare» va su Piccola, «Consigliato» su Media; il JSON-LD resta senza offerte acquistabili.
- [ ] **Step 4:** test → PASS; `yarn site:dev` e controllo a occhio della sezione prezzi a 375 px e a 1280 px (tre schede leggibili, niente scorrimento orizzontale).

### Task A6: documenti e rilascio della Parte A

**Files:**
- Modify: `docs/MONETIZATION.md` (§2: «Non è ancora nel codice» → «Nel codice dal …, da rilasciare»), `AGENTS.md` (paragrafo del listino: 29/49 € con 30 dipendenti → le tre fasce)

- [ ] **Step 1:** aggiornare i due testi.
- [ ] **Step 2:** verifica completa: `npx tsc --noEmit && yarn lint && yarn vitest run && supabase/tests/run.sh reset && supabase/tests/run.sh test` → tutto verde.
- [ ] **Step 3:** prova a mano in sandbox (nuova azienda di test, perché Hotel Tesoro non c'è più): prova → acquisto Piccola → aumento a Grande → riduzione a Media al rinnovo; annotare l'esito in `docs/TEST-BILLING-SCHEDULED.md`.
- [ ] **Step 4:** avvisare l'utente: la migration va con la CI su `main`; le tre Edge Functions vanno pubblicate a mano (`deploy_edge_function`) **subito dopo** la migration, perché le vecchie rifiutano `large`.

---

## Parte B: clienti fondatori

### Task B0: prova dello sconto in sandbox (a mano, lo fa l'utente con il suo terminale)

**Files:**
- Create: `docs/TEST-BILLING-FOUNDERS.md`

**Interfaces:**
- Produces: `discount_id` sandbox (`dsc_…`) e l'esito delle cinque verifiche qui sotto. **Se la verifica 3 fallisce, fermarsi**: il disegno di B1–B3 dipende da lei.

- [ ] **Step 1:** creare in Paddle sandbox lo sconto «Clienti fondatori»: `type: percentage`, `amount: "30"`, `recurring: true`, `maximum_recurring_intervals: null`, `usage_limit: 30`, `enabled_for_checkout: false` (nessun codice digitabile), `restrict_to` = i sei `price_id` di fascia e i due della sede aggiuntiva.
- [ ] **Step 2:** verificare e annotare: (1) una transazione creata con `discount_id` mostra −30% su fascia e sedi; (2) i rinnovi non consumano `usage_limit`, i nuovi acquisti sì; (3) `PATCH /subscriptions/{id}` con `"discount": null` toglie lo sconto dal rinnovo successivo senza addebiti; (4) un aumento immediato (`billing-manage`) mantiene lo sconto anche sul conguaglio; (5) il cambio programmato in due PATCH (`billing-scheduled`) lo mantiene. Annotare anche il codice d'errore di Paddle quando `usage_limit` è esaurito.

### Task B1: sconto nel database

**Files:**
- Create: `supabase/migrations/20261122000200_founder_offers.sql`
- Create: `supabase/tests/rls/148_founder_offers.sql`

**Interfaces:**
- Consumes: `discount_id` del Task B0; le funzioni ricopiate nel Task A1 (si ricopiano **da lì**).
- Produces:
  - `private.billing_discounts(environment, discount_id text check (~ '^dsc_[a-z0-9]+$'), kind text check (kind = 'founder'), selectable boolean)`, chiusa ai client come `billing_prices`.
  - `public.workspace_founder_offers(workspace_id uuid pk → workspaces, source text check (in 'auto','founder'), status text check (in 'reserved','active','ended'), reserved_at, activated_at, ends_at, ended_at, subscription_id uuid, end_notice_at timestamptz)`, RLS attiva e nessun accesso diretto.
  - `private.founder_seats_taken() returns integer` = righe `active` + `ended` + `reserved` con `source = 'founder'`.
  - `billing_prepare_checkout` restituisce anche `'discount_id'` (testo o null): non nullo se l'azienda ha un posto `reserved`, oppure se non ha **mai** avuto una riga in `billing_subscriptions` e `founder_seats_taken() < 30`.
  - `billing_apply_event`: se l'abbonamento ha `data.discount.id` fra quelli `founder`, crea o aggiorna la riga `active` con `activated_at` = inizio del primo periodo e `ends_at` = quella data più 24 mesi di calendario (Europe/Rome, come l'archivio in `workspace_access_at`). Se lo sconto sparisce da un abbonamento con la riga `active`, la segna `ended`.
  - `public.get_founder_offer(p_workspace uuid) returns jsonb` `{status, ends_at, percent: 30, eligible}`, solo per il titolare attivo; `eligible` = il prossimo checkout avrebbe lo sconto.
  - `admin_apply_workspace_action` accetta l'azione `grant_founder_offer` (allargare il `check` di `admin_operations`): crea una riga `reserved`/`founder`; la rifiuta con `founder_seats_full` se i posti sono finiti e con `founder_offer_not_eligible` se l'azienda ha già avuto un abbonamento o una gratuità a vita.
  - `private.queue_founder_offer_notices()`, lavoro pg_cron giornaliero `founder-offer-notices`: a `ends_at − 60 giorni` una notifica `founder_offer_ending` (nuovo valore di `notification_type`) ai titolari attivi, una volta sola (`end_notice_at`).
  - `public.billing_founder_offers_due(p_environment text) returns setof jsonb` (solo service role): righe `active` con `ends_at <= now() + interval '24 hours'`, `{workspace_id, paddle_subscription_id, ends_at}`.

- [ ] **Step 1: test che falliscono** in `148_founder_offers.sql`:
  - Azienda nuova senza abbonamenti: `billing_prepare_checkout(...)->>'discount_id'` = il `dsc_` sandbox.
  - Con 30 righe `active`: `discount_id` nullo.
  - Azienda con un abbonamento `canceled` precedente: `discount_id` nullo.
  - Avviso `subscription.created` con `discount.id` founder e periodo dal 2026-12-01: riga `active`, `ends_at = '2028-12-01 00:00 Europe/Rome'`.
  - Avviso successivo senza `discount`: riga `ended`.
  - Un secondo avviso `subscription.created` uguale (ripetuto da Paddle) non duplica e non sposta `ends_at`.
  - `grant_founder_offer` con 30 posti presi → `founder_seats_full`.
  - `queue_founder_offer_notices` a `ends_at − 60 giorni` crea una notifica; richiamata, nessuna seconda.
  - Un collaboratore non legge `get_founder_offer` (`not_allowed`), un client non esegue `billing_founder_offers_due`.
- [ ] **Step 2:** `supabase/tests/run.sh reset && supabase/tests/run.sh test` → FAIL.
- [ ] **Step 3:** scrivere la migration; testo della notifica, senza importi: titolo «Lo sconto fondatori finisce il {data}», corpo «Dal rinnovo successivo si paga il listino in vigore. Puoi cambiare o disdire dalla pagina Piano.» (`{data}` in formato `d MMMM yyyy` italiano, come le altre notifiche con data).
- [ ] **Step 4:** test → PASS; `gen-types.sh`.

### Task B2: checkout con lo sconto

**Files:**
- Modify: `supabase/functions/billing-checkout/logic.ts` (tipo `PreparedCheckout` e parser), `supabase/functions/billing-checkout/index.ts:~107` (corpo di `POST /transactions`)
- Test: `tests/unit/edge/` (test di `billing-checkout`)

**Interfaces:**
- Consumes: `discount_id` da `billing_prepare_checkout` (Task B1).
- Produces: `PreparedCheckout = { checkoutId; items; discountId: string | null }`; `export function isDiscountLimitError(paddleError: unknown): boolean` (codice annotato nel Task B0); la risposta al browser porta `founder: boolean`, vero solo se la transazione creata ha lo sconto.

- [ ] **Step 1: test che falliscono:** il parser accetta `discount_id: "dsc_01abc"` e `null`, e rifiuta `"pri_…"`; `isDiscountLimitError` è vero sull'errore annotato e falso su un 400 generico; il corpo della transazione include `discount_id` solo se non nullo.
- [ ] **Step 2:** `yarn vitest run tests/unit/edge` → FAIL.
- [ ] **Step 3:** implementare. Se Paddle risponde con `isDiscountLimitError`, ripetere **una volta** la creazione senza `discount_id` e rispondere `founder: false`.
- [ ] **Step 4:** test → PASS.

### Task B3: fine dello sconto a 24 mesi

**Files:**
- Modify: `supabase/functions/billing-scheduled/index.ts`, `supabase/functions/billing-scheduled/logic.ts`, la migration del Task B1 (o una nuova se B1 è già applicata) per far chiamare la funzione anche a `billing_founder_offers_due`
- Test: `tests/unit/edge/` (test di `billing-scheduled`)

**Interfaces:**
- Consumes: `billing_founder_offers_due` (Task B1).
- Produces: `export function founderEndRequest(row: { paddle_subscription_id: string }): { path: string; body: { discount: null } }`.

- [ ] **Step 1: test che falliscono:** `founderEndRequest({paddle_subscription_id:"sub_01x"})` → `{ path: "/subscriptions/sub_01x", body: { discount: null } }`; il runner salta le righe senza `paddle_subscription_id`.
- [ ] **Step 2:** `yarn vitest run tests/unit/edge` → FAIL.
- [ ] **Step 3:** a ogni giro del runner già esistente, dopo i cambi programmati, mandare il PATCH per ogni riga dovuta. Lo stato `ended` lo scrive solo l'avviso firmato che arriva dopo (Task B1), non il runner.
- [ ] **Step 4:** test → PASS.

### Task B4: lo sconto nella pagina Piano, nell'area del fondatore e sul sito

**Files:**
- Modify: `shared/pricing.ts`, `web/src/pages/Piano.tsx`, `web/src/billing/checkout.ts`, `src/features/workspace/billing.ts` (lettura di `get_founder_offer`), `web/src/admin/WorkspaceActions.tsx`, `web-site/src/content/it.ts` (una FAQ), il componente che traduce i `notification_type` in testo e destinazione (cercare `shift_drafts_reminder` in `src/features/notifications/`)
- Test: `tests/unit/webPricing.test.ts`, `tests/unit/web/siteCopy.test.ts`, test di notifiche e Piano esistenti

**Interfaces:**
- Consumes: `get_founder_offer` (B1), `founder` nella risposta del checkout (B2).
- Produces: `shared/pricing.ts` → `export const FOUNDER_OFFER = { percent: 30, months: 24, seats: 30 } as const` e `quotePlan(plan, cycle, venues, { founder?: boolean })`, con `total` scontato e arrotondato al centesimo e `listTotal` pieno.

- [ ] **Step 1: test che falliscono:** `quotePlan("team","monthly",1,{founder:true})` → `total 34.3`, `listTotal 49`; `quotePlan("large","annual",2,{founder:true}).total === 728`; la pagina Piano con `eligible: true` mostra «Sconto fondatori: −30% per 24 mesi» accanto al totale, e con `status: 'active'` mostra «Sconto fondatori fino al {ends_at}»; con `founder: false` dal checkout il riepilogo non mostra lo sconto; la notifica `founder_offer_ending` apre la pagina Piano sulla dashboard e, nell'app nativa, la schermata dello stato dell'azienda **senza importi**; la FAQ del sito dice «Le prime 30 aziende che pagano hanno il 30% di sconto per 24 mesi» senza contatore dei posti (anon non legge il database).
- [ ] **Step 2:** `yarn vitest run` sui file indicati → FAIL.
- [ ] **Step 3:** implementare; nell'area del fondatore aggiungere il pulsante «Riserva posto fondatori» (azione `grant_founder_offer`, motivo obbligatorio come le altre azioni) e il numero di posti presi nel riepilogo.
- [ ] **Step 4:** test → PASS; `npx tsc --noEmit && yarn lint`.

### Task B5: documenti e rilascio della Parte B

**Files:**
- Modify: `docs/MONETIZATION.md` §2-bis (stato), `docs/TEST-BILLING-FOUNDERS.md` (procedura completa), `AGENTS.md` (una riga sotto «Monetizzazione»)

- [ ] **Step 1:** verifica completa come nel Task A6, Step 2.
- [ ] **Step 2:** prova a mano in sandbox: acquisto con sconto → aumento → cambio di ciclo al rinnovo (lo sconto resta) → spostare `ends_at` a ieri con SQL di test → il runner toglie lo sconto → il rinnovo successivo è a prezzo pieno; annotare l'esito.
- [ ] **Step 3:** prima del live, ricreare lo sconto nell'account Paddle live con gli stessi parametri e inserire il suo `dsc_` con una migration (come per i prezzi live).
