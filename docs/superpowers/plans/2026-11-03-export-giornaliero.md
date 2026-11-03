# Export giorno per giorno — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CSV giornaliero e cartellino nel PDF della pagina Ore (app e dashboard), con gli stessi totali del mensile, più la correzione del conflitto del permesso a ore.

**Architecture:** Il database dà le righe del giorno da **una sola fonte**: una funzione `private.workspace_hour_rows` su cui si appoggiano sia il riepilogo esistente (`get_workspace_hours_summary`) sia la nuova `get_workspace_hours_daily`, così i totali coincidono per costruzione; ogni riga è arrotondata al centesimo in SQL. Il client ha due costruttori puri in `src/lib/exportBuilders.ts` (CSV e griglia HTML), condivisi da app e dashboard; le righe si scaricano al tocco del pulsante.

**Tech Stack:** Postgres 17 (Supabase, migration SQL + banco `supabase/tests/run.sh`), TypeScript, React Native/Expo SDK 56, React (Vite) per `web/`, vitest.

**Spec:** [docs/superpowers/specs/2026-11-03-export-giornaliero-design.md](../specs/2026-11-03-export-giornaliero-design.md)

## Global Constraints

- **Niente commit**: l'utente accorpa e committa da sé. Ogni task finisce con le modifiche pronte e i test verdi.
- Migration **nuove** (`20261103000600_…`, `20261103000700_…`), mai toccare una migration esistente.
- Funzioni di lettura: `SECURITY DEFINER`, `SET search_path TO ''`, `grant execute … to authenticated`; `anon` non esegue niente (`supabase/tests/rls/050_surface.sql` deve restare verde).
- Ogni funzione che legge turni per conto d'altri esclude le **bozze** (`s.published_at is not null`), i turni annullati, i futuri (`shift_ends_at(...) <= local_now()`), `declined` e `no_show`.
- Perimetro: `private.commercial_readable_workspace_ids()`, `private.venues_where('hours')`, come i riepiloghi attuali.
- Tipi DB: `supabase/tests/gen-types.sh`, mai a mano.
- CSV: `;`, decimali con la virgola, BOM UTF-8, `\r\n`, testo protetto dalle formule (`csvText`), date `gg/mm/aaaa`, orari `hh:mm`.
- Ore al **centesimo** (due decimali, zeri finali tolti: `7,5`, `7,33`, `8`) in tutti gli export.
- Glossario: «sede», «team», «dipendente»; niente «organico», «staff», «locale» nei testi (`tests/unit/glossary.test.ts`).
- **Note** solo frasi di KlokShift, mai il testo libero di un'assenza; la malattia non porta testo libero; il conflitto dice solo «Da verificare».
- Unit test con istanti in ora locale senza offset (la CI gira in UTC).

## Review Focus

1. **Due turni lo stesso giorno** (spezzato pranzo/sera): due righe nel CSV, una casella con la somma nel cartellino. → test in Task 5 e Task 6.
2. **Turno notturno** (22:00–04:00): una riga sulla data d'inizio, uscita `04:00`; il permesso a ore del mattino dopo non va in conflitto se non si sovrappone. → test in Task 1 e Task 2.
3. **Periodo a cavallo di due mesi** (filtro «dal–al» fino a 366 giorni): una griglia per mese, totali di quel mese. → test in Task 6.
4. **Persona scelta senza righe** nel periodo e **nome con caratteri da formula** (`=`, `+`): niente riga vuota nel cartellino, testo protetto nel CSV. → test in Task 5 e Task 6.
5. **Collaboratore con «Ore» su una sola sede**: non vede le righe delle altre sedi, e la nota di un conflitto nato in una sede che non vede dice solo «Da verificare». → test in Task 2.

---

### Task 1: Il permesso a ore va in conflitto solo se si sovrappone

**Files:**
- Create: `supabase/migrations/20261103000600_absence_hourly_conflict.sql`
- Create: `supabase/tests/rls/155_absence_hourly_conflict.sql`

**Interfaces:**
- Produces: `private.absence_hours_conflict(p_member uuid, p_date date, p_start time, p_end time) returns boolean` — vero se `[p_date+p_start, p_date+p_end)` (ora di Roma) si sovrappone a un intervallo di lavoro approvato della persona.
- Produces: `public.get_workspace_absence_summary` ridefinita (stessa firma e stesse colonne di `20261031000000`), con il ramo del permesso orario che usa la nuova funzione e ogni credito arrotondato al centesimo (`round(c.minutes / 60.0, 2)`, `round(durata, 2)`).

- [ ] **Step 1: Scrivi il test SQL che fallisce**

`155_absence_hourly_conflict.sql`, nello stile di `037_hours_to_fix.sql` (`begin; do $$ … $$; rollback;`). In V2 (senza timbratura: il turno finito conta da sé) per `M_Emp2`, a `d := current_date - 3`:
- turno 09:00–15:00, permesso a ore 15:00–17:00 → `permesso_recognized_hours = 2`, `conflict_hours = 0` («i bordi che si toccano non sono un conflitto»);
- turno 09:00–15:00, permesso 14:00–16:00 → `permesso_recognized_hours = 0`, `conflict_hours = 2`;
- turno notturno a `d - 1` 22:00–04:00, permesso a `d` 08:00–10:00 → nessun conflitto;
- turno notturno a `d - 1` 22:00–04:00, permesso a `d` 03:00–05:00 → conflitto;
- ferie a giornata su `d` con credito 480 minuti e un turno quel giorno → `conflict_hours = 8` (regola dei giorni invariata);
- credito di 470 minuti (7,8333 h) → `ferie_hours = 7.83`.

Ogni caso in un mese distinto o con persone distinte, così le somme non si mescolano. Chiamate con `tests.login('Ow')`, `public.record_absence(...)`, `public.set_absence_hour_credit(...)`, `tests.create_shifts(...)`.

- [ ] **Step 2: Esegui e verifica che fallisce**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test 2>&1 | grep -A3 155`
Expected: FAIL sul caso «bordi che si toccano» (oggi `conflict_hours = 2`).

- [ ] **Step 3: Scrivi la migration**

`private.absence_hours_conflict`: gli stessi tre rami di `private.absence_credit_conflict` (ultima versione in `20261103000100_shift_drafts_silent.sql:472`), ma confrontando **intervalli** e non date: per la timbratura approvata `t.clock_in_at < fine and t.clock_out_at > inizio`; per il turno senza timbratura `(s.date + s.start_time) at time zone 'Europe/Rome' < fine and public.shift_ends_at(s.date, s.start_time, s.end_time) > inizio`. `language sql stable security definer set search_path = ''`. Intestazione: gemella di `shiftOverlapsAbsence` (`src/features/absences/conflicts.ts`) e chiamanti elencati (solo `get_workspace_absence_summary`; da Task 2 anche `private.workspace_absence_rows`). Poi `create or replace` di `get_workspace_absence_summary` con il ramo `where a.start_time is not null` che chiama la nuova funzione e i crediti arrotondati per riga.

- [ ] **Step 4: Esegui e verifica che passa**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: tutti i file `ok`, compreso `155` e `026_absence_hour_credits`.

---

### Task 2: Righe del giorno dal database, una sola fonte col riepilogo

**Files:**
- Create: `supabase/migrations/20261103000700_hours_daily.sql`
- Create: `supabase/tests/rls/156_hours_daily.sql`
- Modify: `src/types/database.ts` (rigenerato)

**Interfaces:**
- Consumes: `private.absence_hours_conflict` (Task 1).
- Produces: `private.workspace_hour_rows(p_workspace uuid, p_from date, p_to date)` — una riga per assegnazione nel perimetro del riepilogo, con: `assignment_id, member_id, member_name, venue_id, venue_name, venue_closed boolean, venue_member_id, date, title, start_time, end_time, clock_in_at timestamptz, clock_out_at timestamptz, counted boolean, approved_hours numeric, legacy_hours numeric, to_review boolean, proposed_hours numeric, untracked_hours numeric, break_minutes integer, break_paid boolean, paid_break_hours numeric, unpaid_break_hours numeric`. Ogni grandezza in ore è arrotondata al centesimo **qui**.
- Produces: `public.get_workspace_hours_summary` ridefinita come aggregato di `private.workspace_hour_rows` (stessa firma e colonne).
- Produces: `public.get_workspace_hours_daily(p_workspace uuid, p_from date, p_to date) returns table(member_id uuid, member_name text, date date, kind text, venue_name text, title text, clock_in text, clock_out text, break_minutes integer, break_paid boolean, hours numeric, note text)`:
  - `kind` ∈ `'work'` (righe `counted`), `'to_fix'` (le righe di `public.get_hours_to_fix` sullo stesso periodo, con `note` = il suo `kind`, `hours` nullo), `'ferie' | 'permesso' | 'malattia'` (una riga per persona e giorno di ogni assenza approvata tagliata sul periodo; ore = credito del giorno o durata del permesso orario, nulle se mancano o in conflitto; `note = 'conflict'` se in conflitto, `note = 'hourly:HH:MM-HH:MM'` per il permesso orario);
  - `clock_in`/`clock_out` = `to_char(... at time zone 'Europe/Rome', 'HH24:MI')` della timbratura, altrimenti l'orario del turno; vuoti per le assenze;
  - `break_minutes` = la pausa contata nel riepilogo per quella riga (timbrata se approvata, altrimenti la pianificata).
  - Ordine: `member_name, member_id, date, clock_in nulls last, kind`.

- [ ] **Step 1: Scrivi il test SQL che fallisce**

`156_hours_daily.sql`, sul modello di `037_hours_to_fix.sql` (stessa preparazione: V1 a timbratura `app` con un turno non timbrato, uno senza uscita, uno da approvare, uno inserito da `Co2`; V2 manuale con un turno; in più un turno spezzato 10:00–14:00 + 18:00–22:00 in V2 per `M_Emp2`, una bozza, un turno annullato, ferie con credito su un giorno e senza su un altro, un permesso a ore in conflitto). Asserzioni:
- per ogni `member_id`, `sum(hours) filter (kind = 'work')` = `sum(approved_hours)` del riepilogo; lo stesso per `paid_break_hours`/`unpaid_break_hours` ricavate dalle righe `work`;
- per ogni persona, `sum(hours) filter (kind = 'ferie')` = `ferie_hours` di `get_workspace_absence_summary`, idem `permesso`/`malattia`;
- `count(*) filter (kind = 'to_fix')` = `count(*)` di `get_hours_to_fix` sullo stesso periodo, con le stesse `note`;
- il turno spezzato dà **due** righe `work` lo stesso giorno;
- bozza e turno annullato non compaiono;
- il giorno di ferie senza credito compare con `hours is null`; il credito in conflitto con `hours is null and note = 'conflict'`;
- `tests.login('Co')` (senza «Ore») → zero righe; un collaboratore con «Ore» solo su V1 non vede righe `work` di V2;
- `get_workspace_hours_summary` restituisce gli stessi valori di prima su 037 (lanciare anche `037`).

- [ ] **Step 2: Esegui e verifica che fallisce**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test 2>&1 | grep -A3 156`
Expected: FAIL con `function public.get_workspace_hours_daily(...) does not exist`.

- [ ] **Step 3: Scrivi la migration**

Sposta il CTE `rows` e le espressioni per riga di `get_workspace_hours_summary` (ultima versione: `20261103000100_shift_drafts_silent.sql:911`) dentro `private.workspace_hour_rows`, con `round(…, 2)` per riga; riscrivi il riepilogo come `group by` sopra di essa (stesso `order by`, stesse colonne, ruoli come oggi). Le assenze del giornaliero vengono da un `generate_series(greatest(start_date, p_from), least(end_date, p_to - 1), '1 day')` sullo stesso CTE `clipped` del riepilogo assenze (stesso perimetro), unito ai crediti per data. Intestazione della migration: «`get_workspace_hours_summary` e `get_workspace_hours_daily` leggono la stessa `private.workspace_hour_rows`: una regola nuova su cosa conta va lì, non in una delle due»; ricorda il filtro delle bozze. `grant execute on function public.get_workspace_hours_daily(uuid, date, date) to authenticated`.

- [ ] **Step 4: Esegui i test SQL e rigenera i tipi**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test && supabase/tests/gen-types.sh`
Expected: tutti `ok` (anche `050_surface`, `037`, `155`, `156`); `src/types/database.ts` contiene `get_workspace_hours_daily`.

---

### Task 3: Righe del giorno nel client

**Files:**
- Create: `src/features/assignments/hoursDaily.ts`
- Modify: `src/features/assignments/api.ts` (dopo `getOwnerHoursSummary`, ~riga 828)
- Modify: `src/lib/queryKeys.ts:193` (accanto a `ownerHours`)
- Modify: `src/features/assignments/hoursToFix.ts:22` (esporta le etichette)
- Test: `tests/unit/assignments/hoursDaily.test.ts`

**Interfaces:**
- Consumes: la RPC del Task 2.
- Produces, in `hoursDaily.ts` (puro, nessun import di Supabase/Expo/React):
  ```ts
  export type DailyKind = "work" | "to_fix" | "ferie" | "permesso" | "malattia";
  export type HoursDailyRow = {
    person_id: string; person_name: string; date: string; kind: DailyKind;
    venue_name: string | null; title: string | null;
    clock_in: string | null; clock_out: string | null;
    break_minutes: number | null; break_paid: boolean | null;
    hours: number | null; note: string | null;
  };
  export function toHoursDailyRows(rows: DbDailyRow[]): HoursDailyRow[];
  ```
  (`member_id` → `person_id`, `member_name` → `person_name`, `numeric` → `number` con `Number()`, `null` resta `null`), così `filterByPeople` di `reportPeriod.ts` funziona tale e quale.
- Produces in `api.ts`: `getOwnerHoursDaily(workspaceId: string, { start, end }: { start: string; end: string }): Promise<HoursDailyRow[]>`.
- Produces in `queryKeys.ts`: `qk.staff.ownerHoursDaily(workspaceId: string, period: string)` = `["staff", "ownerHoursDaily", workspaceId, period]`.
- Produces in `hoursToFix.ts`: `export const HOUR_TO_FIX_KIND_LABEL` (oggi `KIND_LABEL`, non esportata).

- [ ] **Step 1: Test che fallisce**: `toHoursDailyRows` converte `"7.83"` in `7.83`, lascia `hours: null`, rinomina `member_id`/`member_name`.
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments/hoursDaily.test.ts` → FAIL (modulo mancante).
- [ ] **Step 3:** implementa i quattro punti sopra.
- [ ] **Step 4:** `yarn vitest run tests/unit/assignments && npx tsc --noEmit` → PASS.

---

### Task 4: Ore al centesimo negli export

**Files:**
- Modify: `src/lib/exportBuilders.ts:15-18` (`hoursNumber`)
- Test: `tests/unit/assignments/hoursExport.test.ts:105`

**Interfaces:**
- Produces: `hoursNumber(h)` arrotonda a **due** decimali e toglie gli zeri finali: `7.25 → "7,25"`, `7.5 → "7,5"`, `8 → "8"`, `7.8333 → "7,83"`. Vale per CSV mensile, CSV assenze, PDF e i nuovi export.

- [ ] **Step 1:** nel test esistente cambia `expect(csv).toContain(";7,3;")` in `";7,25;"` e aggiungi un caso `hours: 7.8333` → `";7,83;"`.
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments/hoursExport.test.ts` → FAIL.
- [ ] **Step 3:** cambia `hoursNumber`.
- [ ] **Step 4:** `yarn vitest run tests/unit` → PASS (correggi gli altri test che fissavano un decimale, se ce ne sono, solo nel valore atteso).

---

### Task 5: CSV giornaliero

**Files:**
- Modify: `src/lib/exportBuilders.ts` (accanto a `buildAbsencesCsv` e `absencesFileName`)
- Test: `tests/unit/assignments/hoursDailyExport.test.ts`

**Interfaces:**
- Consumes: `HoursDailyRow` (Task 3), `HOUR_TO_FIX_KIND_LABEL` (Task 3), `hoursNumber` (Task 4).
- Produces:
  ```ts
  export function buildDailyCsv(rows: HoursDailyRow[]): string;
  export function dailyFileName(companyName: string, periodLabel: string, ext: string, selection?: readonly string[]): string; // prefisso "ore-giornaliere"
  ```
- Intestazione esatta: `Data;Persona;Sede;Turno;Causale;Entrata;Uscita;Pausa (min);Pausa retribuita;Ore;Note`.
- Causale: `work` → «Lavoro», `to_fix` → «Da verificare», `ferie` → «Ferie», `permesso` → «Permesso», `malattia` → «Malattia».
- Pausa retribuita: «Sì» / «No» / vuoto.
- Note: `to_fix` → `HOUR_TO_FIX_KIND_LABEL[note]`; `conflict` → «Da verificare»; `hourly:15:00-17:00` → «Dalle 15:00 alle 17:00»; altrimenti vuoto.
- Ore vuote quando `hours` è `null`. Ordine delle righe come arrivano (l'ordine lo dà la RPC).

- [ ] **Step 1: Test che falliscono**:
  - intestazione esatta e BOM;
  - due righe `work` lo stesso giorno per la stessa persona restano due righe;
  - riga `to_fix` con nota «Non ha timbrato» e ore vuote;
  - riga `ferie` con `hours: null` → `…;Ferie;;;;;;` (ore vuote);
  - `conflict` → nota «Da verificare»; `hourly:15:00-17:00` → «Dalle 15:00 alle 17:00»;
  - nome `=SOMMA(A1)` → `'=SOMMA(A1)`; data `2026-11-05` → `05/11/2026`; `7.83` → `7,83`;
  - `dailyFileName("Osteria", "Novembre 2026", "csv")` → `ore-giornaliere-osteria-novembre-2026.csv`.
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments/hoursDailyExport.test.ts` → FAIL.
- [ ] **Step 3:** implementa con `csvText`/`csvCell` e `exportFileName` esistenti.
- [ ] **Step 4:** stesso comando → PASS.

---

### Task 6: Cartellino nel PDF

**Files:**
- Modify: `src/lib/exportBuilders.ts` (`buildHoursHtml` e una nuova funzione)
- Test: `tests/unit/assignments/hoursDailyExport.test.ts`

**Interfaces:**
- Consumes: `HoursDailyRow`, `hoursNumber`.
- Produces:
  ```ts
  export function buildTimesheetHtml(rows: HoursDailyRow[], bounds: { start: string; end: string }): string; // end esclusa
  ```
  e un parametro finale facoltativo `timesheet?: { rows: HoursDailyRow[]; start: string; end: string }` di `buildHoursHtml`: se c'è, il cartellino va dopo le tabelle esistenti, su pagina nuova.
- Regole (dal design):
  - una `<table>` per **mese di calendario** dentro `[start, end)`, ciascuna su pagina nuova (`page-break-before: always`) con titolo «Presenze · novembre 2026»;
  - persone in riga solo se hanno righe in quel mese, per nome; sotto il nome la sede se le righe `work` ne hanno una, «N sedi» se di più;
  - colonne dei giorni con iniziale (`L M M G V S D`, calcolata con `Date.UTC`) e numero; sabato e domenica con classe `we` (grigio);
  - casella: somma delle ore `work` del giorno; `F`, `P`, `M` per le assenze con le ore sotto se ci sono; `P <ore>` sotto le ore se c'è lavoro e permesso; `?` per `to_fix` o un'assenza in conflitto (mai sommato);
  - colonne finali del mese: Lavoro, Ferie, Permessi, Malattia (ore; la malattia senza ore in «N gg»), più «N gg senza ore» per ferie/permessi senza credito;
  - legenda sotto ogni griglia; nomi passati da `escapeHtml`.

- [ ] **Step 1: Test che falliscono**:
  - due righe `work` (4 h + 4 h) lo stesso giorno → casella `8`;
  - periodo `2026-10-25`–`2026-11-05` → due tabelle, «ottobre 2026» e «novembre 2026», ognuna con i propri totali;
  - `to_fix` → `?` e il totale Lavoro non cambia;
  - `2026-11-07` (sabato) ha la classe `we`;
  - persona con righe solo a ottobre non compare nella griglia di novembre;
  - `<script>` nel nome esce come `&lt;script&gt;`;
  - `buildHoursHtml(...)` senza `timesheet` è identico a oggi (nessun «Presenze ·»).
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments/hoursDailyExport.test.ts` → FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** stesso comando → PASS.

---

### Task 7: Pulsanti in app e dashboard, documentazione

**Files:**
- Modify: `src/lib/export.ts` (nuova `exportDailyCsv`; `exportHoursPdf` accetta `timesheet?`)
- Modify: `src/app/(manager)/ore.tsx:179-195` e `:486-499`
- Modify: `web/src/pages/Ore.tsx:179-210` e `:336-351`
- Modify: `AGENTS.md` (sezione «Ore, assenze e maggiorazioni»), `TASKS.md` (spunta il punto 1)

**Interfaces:**
- Consumes: `getOwnerHoursDaily`, `qk.staff.ownerHoursDaily`, `toHoursDailyRows`, `buildDailyCsv`, `dailyFileName`, `buildHoursHtml(…, timesheet)`, `filterByPeople`, `periodBounds`, `periodKey`.
- Produces: `exportDailyCsv(companyName: string, periodLabel: string, rows: HoursDailyRow[], selection?: readonly string[]): Promise<void>` in `src/lib/export.ts`, sul modello di `exportAbsencesCsv`.

- [ ] **Step 1: App.** In `onExport` aggiungi `kind === "daily"`; per `"daily"` e `"pdf"` scarica le righe con `queryClient.fetchQuery({ queryKey: qk.staff.ownerHoursDaily(workspaceId, periodKey(period)), queryFn: () => getOwnerHoursDaily(workspaceId, periodBounds(period)) })`, filtra con `filterByPeople(rows, selection)`, e passa il risultato a `exportDailyCsv` o a `exportHoursPdf(..., { rows, ...periodBounds(period) })`. Nuovo `GhostButton` «Esporta CSV giornaliero» sotto «Esporta CSV mensile», visibile con `canExport.monthly`. L'errore resta il toast «Export non riuscito. Riprova.».
- [ ] **Step 2: Dashboard.** Stessa cosa in `web/src/pages/Ore.tsx`: `Button` «CSV giornaliero» fra «CSV mensile» e «CSV assenze», disabilitato con `!canExport.monthly` e mentre scarica; `printPdf` diventa `async`, aspetta le righe e passa `timesheet` a `buildHoursHtml`.
- [ ] **Step 3: Documentazione.** In `AGENTS.md`, dentro «Ore, assenze e maggiorazioni», un paragrafo: export giornaliero (CSV + cartellino), `private.workspace_hour_rows` fonte unica di riepilogo e giornaliero, `private.absence_hours_conflict` gemella di `shiftOverlapsAbsence`, ore al centesimo arrotondate per riga in SQL. In `TASKS.md` spunta «1. CSV giornaliero» con la data e la nota «migration `20261103000600`/`000700` da rilasciare».
- [ ] **Step 4: Verifica completa.**
  Run: `npx tsc --noEmit && yarn lint && yarn vitest run && supabase/tests/run.sh reset && supabase/tests/run.sh test`
  Expected: tutto verde (compresi `glossary.test.ts` e `050_surface`).
- [ ] **Step 5: Prova a mano** (da segnalare all'utente se non si può fare qui): sulla dashboard in locale, stesso mese, scaricare CSV mensile, CSV giornaliero e PDF; la somma delle ore «Lavoro» di una persona nel giornaliero è uguale alle «Ore lavorate effettive» del mensile.
