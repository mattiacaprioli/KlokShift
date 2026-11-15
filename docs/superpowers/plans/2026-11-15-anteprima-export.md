# Anteprima dell'export per il consulente — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sostituire i quattro pulsanti di export della pagina Ore (app e dashboard) con un solo «Esporta per il consulente» che apre un pannello: scelta del file, totali, «Resta fuori o va controllato», prime righe del file (solo dashboard), scarica.

**Architecture:** Le funzioni CSV di `src/lib/exportBuilders.ts` si dividono in `build…Table` (intestazione + righe, celle già nella forma del file) e `tableToCsv`; le funzioni di oggi diventano `tableToCsv(build…Table(…))`, quindi i file non cambiano. Un modulo puro `src/features/assignments/exportPreview.ts` costruisce totali, avvisi e anteprima dalla **stessa** tabella. Dashboard e app hanno ciascuna un componente di presentazione (dialog / BottomSheet) e la pagina Ore legge i dati una volta all'apertura e scarica con quelli.

**Tech Stack:** TypeScript, React 19, React Native (Expo SDK 56, NativeWind via `@/tw`), Vite (dashboard), vitest 5.

**Spec:** [docs/superpowers/specs/2026-11-15-anteprima-export-design.md](../specs/2026-11-15-anteprima-export-design.md)

## Global Constraints

- I file scaricati sono **identici** a oggi: i test esistenti `tests/unit/assignments/hoursExport.test.ts`, `hoursDailyExport.test.ts`, `exportCodes.test.ts`, `monthlyReport.test.ts`, `tests/unit/absences/summary.test.ts` restano verdi **senza cambiarne le attese**.
- Nessun avviso blocca lo scarico. Nessuna RPC o migration nuova.
- Il giornaliero si legge solo all'apertura del pannello, mai con la pagina. Codici, maggiorazioni e giornaliero si leggono **una volta** all'apertura e il file si costruisce con quei dati.
- Dashboard: il PDF apre la finestra **nel clic** di «Stampa», senza `await` prima di `window.open`.
- Testi italiani inline; glossario (`tests/unit/glossary.test.ts`): team, dipendente, sede; mai «personale», «organico», «staff», «planning», «consuntivo».
- Testi fissi: pulsante **«Esporta per il consulente»**; riquadro **«Resta fuori o va controllato»**; formati **«CSV giornaliero»**, **«CSV mensile»**, **«CSV assenze»**, **«PDF da stampare»**; coda della tabella **«e altre N righe nel file»** (N = 1 → «e un'altra riga nel file»).
- Moduli in `src/features/**` e `src/lib/**` usati dalla dashboard restano puri (niente React Native, Expo, Supabase) — `exportPreview.ts` compreso.
- Permessi e disponibilità come oggi (`exportAvailability`, `canAny`, `canRecord`).
- Lavoro su `main`, **un solo commit alla fine**, solo con i file di questo lavoro (un'altra sessione committa in parallelo: niente `git rm`/`git add` lasciati in stage durante il lavoro).
- `yarn`, mai `npm install`.

## Review Focus

1. **Persona con «;» o virgolette nel nome, o nome che inizia con «=»**: l'anteprima mostra la cella come sta nel file (con `csvText`), il file non cambia. → test nel Task 1.
2. **Periodo senza righe** (mese nuovo, persona senza turni): il pannello non si rompe, formati non disponibili spenti con il motivo, totali a zero, tabella vuota. → test nel Task 2 + verifica a vista nel Task 3.
3. **Lettura fallita all'apertura** (rete): messaggio «Export non riuscito. Riprova.» e «Riprova» nel pannello, nessun file mezzo vuoto. → Task 3/4, verifica a mano.
4. **Cambio di persone o periodo mentre il pannello è aperto**: non deve succedere — il pannello usa periodo e persone del momento in cui si apre, e i controlli della pagina sono sotto lo sfondo modale. → verifica a vista nel Task 3.
5. **Giornaliero con maggiorazioni**: le righe «di cui» fanno parte della tabella, nello stesso ordine del file, e contano in «Righe nel file». → test nel Task 1 e 2.

---

### Task 1: Tabelle nei file CSV

**Files:**
- Modify: `src/lib/exportBuilders.ts` (`buildHoursCsv` 218–273, `buildAbsencesCsv` 283–306, `buildDailyCsv` 333–425)
- Test: `tests/unit/assignments/exportTables.test.ts`

**Interfaces:**
- Produces (da `src/lib/exportBuilders.ts`):
  - `export type CsvTable = { header: string[]; rows: string[][] }` — celle **già nella forma del file** (`csvCell`/`csvText` applicati, ore con la virgola, date `gg/mm/aaaa`).
  - `export function tableToCsv(table: CsvTable): string` — `"﻿" + [header.join(";"), ...rows.map(r => r.join(";"))].join("\r\n")`.
  - `export function buildHoursTable(people: PersonHours[], absences?: AbsenceSummaryRow[], codes?: ExportCodes, surcharges?: readonly SurchargeRow[]): CsvTable`
  - `export function buildAbsencesTable(rows: AbsenceSummaryRow[], codes?: ExportCodes): CsvTable`
  - `export function buildDailyTable(rows: HoursDailyRow[], codes?: ExportCodes, surcharges?: readonly SurchargeRow[]): CsvTable` — righe **finali** (lavoro + «di cui» intercalate, stesso ordine di oggi).
  - `buildHoursCsv`, `buildAbsencesCsv`, `buildDailyCsv`: stessa firma, corpo `tableToCsv(build…Table(…))`.

- [ ] **Step 1: Write the failing tests** — `exportTables.test.ts`, riusando le fixture dei test esistenti (importa o ricostruisci le stesse righe di `hoursDailyExport.test.ts` / `hoursExport.test.ts`):
  - `it("il CSV giornaliero è la sua tabella serializzata")`: `tableToCsv(buildDailyTable(rows, codes, surcharges)) === buildDailyCsv(rows, codes, surcharges)` con e senza codici, con e senza maggiorazioni.
  - stessi due casi per `buildHoursTable`/`buildHoursCsv` e `buildAbsencesTable`/`buildAbsencesCsv`.
  - `it("le righe «di cui» stanno nella tabella dopo la loro riga di lavoro")`: con una maggiorazione su una riga di lavoro, `rows.length === dailyRows.length + 1` e la riga successiva al lavoro ha come causale l'etichetta della maggiorazione.
  - `it("le celle della tabella sono quelle del file")`: persona `=Rossi; Mario` → la cella del nome è `"'=Rossi; Mario"` tra virgolette, esattamente come nel CSV.
  - `it("l'intestazione è una cella per colonna")`: `buildDailyTable(rows).header` senza codici ha 11 voci, con codici 14.

- [ ] **Step 2: Run to verify they fail** — `yarn vitest run tests/unit/assignments/exportTables.test.ts` → FAIL (export inesistenti).

- [ ] **Step 3: Implement** — dividi ogni funzione: le righe oggi costruite come `[…].join(";")` diventano array; nel giornaliero `lines`, `surLine` e `out` portano `string[]`. Nessun valore di cella cambia.

- [ ] **Step 4: Run** — `yarn vitest run tests/unit/assignments` → PASS, **compresi** i test esistenti dei file senza modifiche.

---

### Task 2: Il modulo dell'anteprima

**Files:**
- Create: `src/features/assignments/exportPreview.ts`
- Test: `tests/unit/assignments/exportPreview.test.ts`

**Interfaces:**
- Consumes: `CsvTable`, `buildDailyTable`, `buildHoursTable`, `buildAbsencesTable` (Task 1); `monthlyReportRows`, `exportAvailability` (`monthlyReport.ts`); `hoursToFixSummary` (`hoursToFix.ts`); `formatHours` (`@/lib/format`).
- Produces:
  - `export type ExportFormat = "daily" | "monthly" | "absences" | "pdf"`
  - `export const EXPORT_FORMATS: readonly { key: ExportFormat; label: string }[]` — nell'ordine e con le etichette dei Global Constraints.
  - `export type ExportIssueTarget = "to_fix" | "codes" | "absences" | "team"`
  - `export type ExportIssue = { text: string; target: ExportIssueTarget }`
  - `export type ExportPreview = { totals: { label: string; value: string }[]; issues: ExportIssue[]; table: { header: string[]; rows: string[][]; more: number } | null; available: boolean; unavailableReason: string | null }`
  - `export const PREVIEW_ROWS = 5`
  - `export function moreRowsLabel(more: number): string` — `""` se 0, «e un'altra riga nel file», «e altre N righe nel file».
  - `export function buildExportPreview(input: { format: ExportFormat; people: PersonHours[]; absences: AbsenceSummaryRow[]; daily: HoursDailyRow[] | null; codes: ExportCodes; surcharges: SurchargeRow[]; toFix: Pick<HourToFix, "hours">[]; warnings: { codes: string | null; certificates: string | null; contract: string | null }; availability: { monthly: boolean; absences: boolean } }): ExportPreview`

Regole che i test fissano:
- **Totali** — `daily`: «Ore lavorate» (somma `hours` delle righe `work`), «Ferie e permessi» (`ferie`+`permesso`), «Malattia», «Righe nel file» (righe della tabella, «di cui» comprese). `monthly` e `pdf`: dalle righe di `monthlyReportRows(people, absences)`: `worked_hours`, `ferie_hours + permesso_hours`, `malattia_hours`; `monthly` aggiunge «Righe nel file». `absences`: «Ferie» (giorni), «Permessi» (giorni e ore se > 0), «Malattia» (giorni), «Righe nel file». Ore con `formatHours`.
- **Voci**, in quest'ordine, solo se il testo c'è:
  1. `to_fix` (non per `absences`): `${hoursToFixSummary(toFix)}: nel file restano «Da verificare».`
  2. `codes` (solo CSV, non `pdf`): `warnings.codes`
  3. `absences` (solo `absences` e `pdf`, dove c'è la colonna dei certificati): `warnings.certificates`
  4. `team` (non per `absences`): `warnings.contract`
- **Tabella**: `null` per `pdf`; altrimenti `rows` = prime `PREVIEW_ROWS` righe della tabella del formato, `more` = righe restanti.
- **Disponibilità**: `daily`/`monthly`/`pdf` seguono `availability.monthly`, `absences` segue `availability.absences`; se non disponibile `unavailableReason` = «Nessuna ora in questo periodo.» / «Nessuna assenza in questo periodo.» e la tabella è `null`.
- `daily: null` con formato `daily` o `pdf` (righe non ancora lette) → `table: null`, totali del giornaliero assenti per `daily`; la pagina non mostra il pannello pronto finché non sono arrivate.

- [ ] **Step 1: Write the failing tests** — `exportPreview.test.ts`:
  - `it("il giornaliero mostra le prime 5 righe della stessa tabella del file")`: `preview.table.rows` `toEqual(buildDailyTable(daily, codes, surcharges).rows.slice(0, 5))`, `more` = totale − 5.
  - `it("le righe «di cui» contano in Righe nel file")`.
  - `it("i totali del giornaliero sommano lavoro, ferie e permessi, malattia")` con valori attesi da `formatHours`.
  - `it("il mensile e il PDF prendono i totali dal riepilogo")`.
  - `it("le assenze contano i giorni")`.
  - `it("le voci arrivano nell'ordine e solo per i formati giusti")`: tabella parametrica formato → target attesi, con tutti e quattro gli avvisi presenti.
  - `it("senza avvisi la lista è vuota")`.
  - `it("il PDF non ha tabella")`.
  - `it("un formato non disponibile dice perché e non ha tabella")`.
  - `it("moreRowsLabel")`: 0 → `""`, 1 → «e un'altra riga nel file», 183 → «e altre 183 righe nel file».

- [ ] **Step 2: Run to verify they fail** — `yarn vitest run tests/unit/assignments/exportPreview.test.ts` → FAIL.

- [ ] **Step 3: Implement** `exportPreview.ts` (puro, nessun import da React/RN/Supabase).

- [ ] **Step 4: Run** — `yarn vitest run tests/unit/assignments tests/unit/glossary.test.ts` → PASS.

---

### Task 3: Dashboard

**Files:**
- Create: `web/src/hours/ExportDialog.tsx`
- Modify: `web/src/pages/Ore.tsx` (stato e funzioni di export 164–320, intestazione 440–470, avvisi sopra la tabella 470+)

**Interfaces:**
- Consumes: `buildExportPreview`, `EXPORT_FORMATS`, `moreRowsLabel`, tipi (Task 2); `tableToCsv`, `build…Table`, `buildHoursHtml`, nomi file (Task 1 / esistenti).
- Produces: `export function ExportDialog(props: { period: string; peopleLabel: string; format: ExportFormat; onFormat: (f: ExportFormat) => void; state: "loading" | "error" | "ready"; preview: ExportPreview | null; busy: boolean; onRetry: () => void; onDownload: () => void; onIssue: (t: ExportIssueTarget) => void; onClose: () => void }): JSX.Element` — presentazionale, `createPortal` come `ExportCodesDialog`, `role="dialog" aria-modal`, `Esc` chiude, larghezza `max-w-2xl`.

- [ ] **Step 1: `ExportDialog.tsx`** — titolo «Esporta per il consulente», sottotitolo `${period}, ${peopleLabel}`, segmentato dei formati (spento + `unavailableReason` se non disponibile), totali in riga, riquadro «Resta fuori o va controllato» (bordo `warning`, ogni voce con un collegamento: «Ore da sistemare», «Codici per il consulente», «Assenze», «Team»), tabella in `font-mono` con intestazione e righe come stanno nel file + `moreRowsLabel`, piedi «Annulla» / «Scarica CSV» (o «Stampa» per `pdf`). `loading` → `Spinner`; `error` → «Export non riuscito. Riprova.» con «Riprova».
- [ ] **Step 2: `Ore.tsx`** — al posto di CSV mensile / CSV giornaliero / CSV assenze / Stampa-PDF un `Button variant="gold"` «Esporta per il consulente» (spento se né `canExport.monthly` né `canExport.absences`). All'apertura: `Promise.all([fetchExportCodes, fetchWorkspaceSurcharges, fetchOwnerHoursDaily])` (questi ultimi due solo se `canExport.monthly`), stato `loading → ready | error`; formato iniziale `"daily"` (o `"absences"` se il mensile non è disponibile). «Scarica» costruisce il file da quei dati con `tableToCsv(build…Table(…))` e i nomi file di oggi; «Stampa» fa `window.open` come **prima** istruzione del gestore e scrive `buildHoursHtml(…)` con i dati già letti. Via `downloadCsv`, `downloadDailyCsv`, `downloadAbsencesCsv`, `printPdf`, `downloadWithCodes` e gli avvisi certificati/contratto/codici sopra la tabella (passano nel pannello). `onIssue`: `to_fix` chiude e scorre alla sezione «Ore da sistemare»; `codes` chiude e apre `ExportCodesDialog`; `absences` e `team` navigano alle pagine Assenze e Team esistenti.
- [ ] **Step 3: Verifica** — `npx tsc --noEmit -p web` (o il comando di typecheck della dashboard in `package.json`), `yarn lint`, `yarn vitest run tests/unit/assignments`. Poi `yarn web:dev` e screenshot del pannello (seed: account loggabile da memoria `seed-test-data`, se disponibile nel progetto di test; altrimenti chiedere al fondatore una sessione) per Review Focus 2 e 4.

---

### Task 4: App

**Files:**
- Create: `src/features/assignments/ExportSheet.tsx`
- Modify: `src/app/(manager)/ore.tsx` (`onExport` 215–252, avvisi e pulsanti 540–585)

**Interfaces:**
- Consumes: come il Task 3, più `BottomSheet` (`@/components/ui/BottomSheet`), `GoldButton`/`GhostButton`, `Icon`; gli export nativi di oggi `exportDailyCsv`, `exportHoursCsv`, `exportAbsencesCsv`, `exportHoursPdf` (`src/lib/export.ts`).
- Produces: `export function ExportSheet(props: { visible: boolean; period: string; peopleLabel: string; format: ExportFormat; onFormat: (f: ExportFormat) => void; state: "loading" | "error" | "ready"; preview: ExportPreview | null; busy: boolean; onRetry: () => void; onDownload: () => void; onIssue: (t: ExportIssueTarget) => void; onClose: () => void }): JSX.Element` — componenti da `@/tw`, nessuna tabella delle righe.

- [ ] **Step 1: `ExportSheet.tsx`** — stesso contenuto del dialog senza tabella; formati come pillole a capo; pulsante «Scarica e condividi» (`GoldButton`); `dismissable={!busy}`.
- [ ] **Step 2: `ore.tsx`** — un `GoldButton` «Esporta per il consulente» al posto dei quattro; stessa lettura all'apertura del Task 3; «Scarica e condividi» chiama l'export nativo del formato con i dati letti; via gli avvisi sopra i pulsanti. `onIssue`: `to_fix` chiude e scorre alla sezione; `codes` → `router.push("/codici-consulente")`; `absences`/`team` alle rotte esistenti della gestione.
- [ ] **Step 3: Verifica** — `npx tsc --noEmit`, `yarn lint`. Prova a mano nell'app: il simulatore non accetta tocchi (memoria `simulator-no-tap`) → chiedere al fondatore la prova sul telefono/simulatore.

---

### Task 5: Verifica completa e commit

- [ ] **Step 1:** `yarn test:unit && yarn lint && npx tsc --noEmit` → tutto verde.
- [ ] **Step 2:** Revisione finale indipendente del diff (Review Focus sopra), correzioni con test che fallisce prima.
- [ ] **Step 3:** Aggiornare AGENTS.md («Export giornaliero»: un solo «Esporta per il consulente» con anteprima; i file escono da `tableToCsv(build…Table)`).
- [ ] **Step 4: Commit unico, solo questi file**

```bash
git add src/lib/exportBuilders.ts src/features/assignments/exportPreview.ts src/features/assignments/ExportSheet.tsx "src/app/(manager)/ore.tsx" web/src/hours/ExportDialog.tsx web/src/pages/Ore.tsx tests/unit/assignments/exportTables.test.ts tests/unit/assignments/exportPreview.test.ts AGENTS.md docs/superpowers/specs/2026-11-15-anteprima-export-design.md docs/superpowers/plans/2026-11-15-anteprima-export.md
git commit -m "feat(ore): anteprima dell'export per il consulente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- <stessi percorsi>
```
Niente push: lo chiede il fondatore.
