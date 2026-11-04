# Maggiorazioni negli export per il consulente — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Notturno, domenica, festivi e straordinario calcolati in automatico dalle ore che contano, con regole per azienda datate per mese, e riportati come «di cui» nella pagina Ore, nei CSV mensile e giornaliero e nel PDF.

**Architecture:** Le regole sono versioni mensili in una tabella dell'azienda (più il patrono come colonna della sede), scritte da RPC. Una sola funzione SQL privata calcola le porzioni per riga sulle stesse righe di `private.workspace_hour_rows` (rifattorizzata per poter leggere anche fuori dal perimetro di chi legge, solo per la soglia dello straordinario); una RPC nuova le espone. Il client le unisce alle righe esistenti con moduli puri; le RPC delle ore non cambiano firma.

**Tech Stack:** Postgres 17 (Supabase; banco `supabase/tests/run.sh`), TypeScript, Expo SDK 56 / React Native, React (Vite) in `web/`, vitest.

**Spec:** [docs/superpowers/specs/2026-11-04-maggiorazioni-design.md](../specs/2026-11-04-maggiorazioni-design.md)

## Global Constraints

- **Si lavora su `main`** nel repo principale: niente worktree né rami. I task non committano; a fine piano **un solo commit** su `main` e push.
- Migration **nuove** con prefisso `20261104000300`…; tutte quelle esistenti sono applicate: non toccarle (`CREATE OR REPLACE` in una migration nuova).
- RPC `SECURITY DEFINER`, `SET search_path TO ''`, `revoke all … from public, anon`, `grant execute … to authenticated` (solo le pubbliche); letture DEFINER nell'elenco del confine commerciale di `supabase/tests/rls/050_surface.sql`.
- Scritture con `private.assert_workspace_operational(workspace)`; letture dentro `private.commercial_readable_workspace_ids()`.
- Permesso regole: `private.can_workspace_hours(p_workspace)` (chiunque abbia «Ore», anche su una sede). Patrono: «Ore» su quella sede (`venue_id in (select private.venues_where('hours'))`).
- Le RPC `get_workspace_hours_summary`, `get_workspace_hours_daily`, `get_workspace_absence_summary`, `get_export_codes` **non cambiano firma**.
- Percentuale: `> 0` e `<= 300`, al più un decimale; voce spenta = `null`. Fascia notturna di default `22:00`–`06:00`, al quarto d'ora, inizio ≠ fine. Versione = primo giorno del mese.
- Festivi nazionali: 1/1, 6/1, Pasqua, lunedì dell'Angelo, 25/4, 1/5, 2/6, 15/8, 4/10 (solo dal 2026), 1/11, 8/12, 25/12, 26/12; più il patrono della sede della riga. Giorni e fasce in ora di Roma (`Europe/Rome`).
- Una sola voce per minuto: la percentuale più alta; a parità **festivi > domenica > straordinario > notturno**. Porzioni in proporzione `ore che contano / durata dell'intervallo`; arrotondamento al centesimo per riga e voce; l'eventuale centesimo oltre le ore della riga si toglie alla voce con più ore (a parità, l'ordine sopra).
- Codici per il consulente: chiavi nuove `night`, `sunday`, `holiday`, `overtime`, etichette «Notturno», «Domenica», «Festivi», «Straordinario».
- Testi esatti: voce «Maggiorazioni»; righe e intestazioni «Di cui notturno +20%», «Di cui domenica +30%», «Di cui festivi +50%», «Di cui straordinario +25%» (decimale con virgola: «+12,5%»); avviso «N persone senza ore da contratto: lo straordinario non è calcolato.» (1 → «1 persona senza ore da contratto: …»).
- CSV: `;`, virgola, BOM, `\r\n`, `csvText` per il testo, `csvCell` per le intestazioni con codice. Senza maggiorazioni ogni file è **identico** a oggi.
- Glossario (`tests/unit/glossary.test.ts`): «dipendente», «team», «sede»; mai «organico», «staff», «locale», «mansioni» nei testi.
- Unit test in ora locale senza offset (CI in UTC).

## Review Focus

1. **Turno a cavallo della mezzanotte verso una domenica o un festivo** (sabato 20:00–02:00): i minuti dopo la mezzanotte sono domenica. → test in Task 2.
2. **Collaboratore con «Ore» su una sola sede**: lo straordinario di chi lavora anche in un'altra sede usa tutte le sue ore; chi legge vede solo le righe delle sue sedi. → test in Task 2.
3. **Ore corrette a mano più corte del turno** (o pausa non retribuita): la somma delle voci di una riga non supera mai le sue ore. → test in Task 2.
4. **Cambio dell'ora** (notte fra sabato 24 e domenica 25 ottobre 2026): un turno 22:00–06:00 dura 9 ore reali e il notturno le conta tutte. → test in Task 2.
5. **Periodo di due mesi con percentuali diverse per la stessa voce**: due colonne e due righe «di cui» distinte, stesso codice. → test in Task 4.

---

### Task 1: Regole, patrono, festivi e codici nel database

**Files:**
- Create: `supabase/migrations/20261104000300_surcharge_rules.sql`
- Create: `supabase/tests/rls/159_surcharge_rules.sql`
- Modify: `supabase/tests/rls/050_surface.sql`, `supabase/tests/rls/158_export_codes.sql` (chiavi nuove accettate), `src/types/database.ts` (rigenerato)

**Interfaces:**
- Produces (DB):
  - `public.workspace_surcharge_rules(workspace_id uuid references workspaces on delete cascade, valid_from date check (extract(day from valid_from) = 1), night_pct numeric(4,1) null, night_start time not null default '22:00', night_end time not null default '06:00', sunday_pct numeric(4,1) null, holiday_pct numeric(4,1) null, overtime_pct numeric(4,1) null, updated_at timestamptz default now(), primary key (workspace_id, valid_from))`, check sulle percentuali (`> 0 and <= 300`) e `night_start <> night_end`; RLS attiva, nessuna policy, nessun grant.
  - `public.venues.patron_day smallint null`, `patron_month smallint null`, check: entrambi nulli o una data valida (`make_date(2024, patron_month, patron_day)` non deve fallire: 29/2 ammesso).
  - `private.italian_holiday(p_date date, p_venue uuid) returns boolean` (immutabile per la parte nazionale; Pasqua con l'algoritmo di Gauss/Meeus in `private.easter_date(p_year int) returns date`).
  - `private.surcharge_rules_at(p_workspace uuid, p_date date)` → la riga della versione valida per il mese di `p_date` (ultima con `valid_from <= date_trunc('month', p_date)`), nessuna riga prima della prima versione.
  - `public.save_surcharge_rules(p_workspace uuid, p_valid_from date, p_rules jsonb) returns void` — `p_rules` = `{"night_pct":20,"night_start":"22:00","night_end":"06:00","sunday_pct":null,"holiday_pct":50,"overtime_pct":25}`; inserisce o sostituisce la versione di quel mese; `p_valid_from` non primo del mese o fuori dai limiti, percentuale fuori limite o con più di un decimale, fascia non al quarto d'ora o inizio = fine → `invalid_surcharge`.
  - `public.save_venue_patron(p_venue uuid, p_day int, p_month int) returns void` — entrambi nulli = nessun patrono; data impossibile → `invalid_patron`.
  - `public.get_surcharge_rules(p_workspace uuid) returns jsonb` = `{"versions":[{"valid_from":"2026-11-01","night_pct":20,…}], "patrons":[{"venue_id":"…","day":4,"month":10}]}` — versioni in ordine di `valid_from`; patroni delle sedi dove chi legge ha «Ore»; richiede `can_workspace_hours` e azienda leggibile.
  - `workspace_export_codes.key` e `save_export_codes`: chiavi in più `night`, `sunday`, `holiday`, `overtime`.

- [ ] **Step 1: Test SQL che fallisce** — `159_surcharge_rules.sql`, stile `158_export_codes.sql`:
  - `Ow` salva per `2026-11-01` `{"night_pct":20,"sunday_pct":30}` → `get_surcharge_rules` ha una versione con `night_pct = 20`, `night_start = '22:00'`, `holiday_pct` nullo;
  - salva per `2026-12-01` `night_pct 25` → `private.surcharge_rules_at(w1, '2026-11-15')` ha 20, `('2026-12-03')` ha 25, `('2026-10-31')` nessuna riga;
  - risalva `2026-11-01` con `sunday_pct` nullo → la versione di novembre viene sostituita (una sola riga per mese);
  - `0`, `301`, `12.25`, `p_valid_from = '2026-11-02'`, fascia `22:10`, inizio = fine → `invalid_surcharge`;
  - `Co2` (solo «Ore») scrive le regole → ok; `Co` (solo «Turni») → `not_allowed` su lettura e scrittura;
  - patrono: `Ow` su V1 `4/10` → letto in `patrons`; `31/2` → `invalid_patron`; `Co` → `not_allowed`;
  - festivi: `private.italian_holiday` vero per `2026-04-05` (Pasqua), `2026-04-06`, `2027-03-29` (lunedì dell'Angelo 2027), `2026-10-04`, `2026-12-26`; falso per `2025-10-04`, `2026-04-07`; vero per il patrono di V1 e falso per lo stesso giorno su V2;
  - `save_export_codes` accetta `{"night":"NOT","overtime":"STR"}`.
  - Archivio: aggiungere in `080_commercial_enforcement.sql`, accanto ai codici, `save_surcharge_rules` → `workspace_read_only` e `get_surcharge_rules` leggibile.
- [ ] **Step 2:** `supabase/tests/run.sh reset && supabase/tests/run.sh test 2>&1 | grep -B2 -A3 "159\|FALLIT"` → FAIL su 159.
- [ ] **Step 3:** migration (intestazione: regole datate per mese, patrono senza versioni per scelta del fondatore, permesso come i codici); le tre funzioni pubbliche nuove in `050_surface.sql` (`get_surcharge_rules` fra le letture col confine commerciale).
- [ ] **Step 4:** stesso comando → nessun FALLITI; `supabase/tests/gen-types.sh`.

---

### Task 2: Il calcolo

**Files:**
- Create: `supabase/migrations/20261104000400_surcharges.sql`
- Create: `supabase/tests/rls/160_surcharges.sql`
- Modify: `supabase/tests/rls/050_surface.sql`, `src/types/database.ts` (rigenerato)

**Interfaces:**
- Consumes: Task 1 (`surcharge_rules_at`, `italian_holiday`, colonne del patrono).
- Produces (DB):
  - `private.workspace_hour_rows_in(p_workspace uuid, p_from date, p_to date, p_venue_ids uuid[])` — il corpo attuale di `private.workspace_hour_rows` (ultima versione in `20261103000700_hours_daily.sql`) con il perimetro passato come parametro; `private.workspace_hour_rows(p_workspace, p_from, p_to)` diventa una chiamata a lei con le sedi dove chi legge ha «Ore» (stessa firma, stesse colonne, stesso risultato: lo provano i test 037, 156 e 130 invariati).
  - `public.get_workspace_surcharges(p_workspace uuid, p_from date, p_to date) returns table(member_id uuid, member_name text, date date, venue_name text, title text, clock_in text, clock_out text, kind text, percentage numeric, hours numeric)` — `kind` in `night | sunday | holiday | overtime`: una riga per riga di lavoro e voce con ore > 0, `clock_in`/`clock_out` **formattati esattamente come** la riga `work` di `get_workspace_hours_daily` (sono la chiave con cui il client le affianca); più `kind = 'no_contract'` (date, sede, turno, orari, percentuale e ore nulli), una per dipendente (`authority = 'none'`) con ore che contano nel periodo, senza ore da contratto, quando lo straordinario è acceso in almeno un mese del periodo. Ordine: persona, data, entrata, poi voce nell'ordine notturno, domenica, festivi, straordinario.
- Algoritmo (in `private.workspace_surcharge_rows(p_workspace, p_from, p_to)`, `language plpgsql` o `sql`, una sola funzione):
  1. Righe che contano di **tutte** le sedi dell'azienda via `workspace_hour_rows_in` su un intervallo allargato: dall'inizio del mese e della settimana ISO di `p_from` alla fine del mese e della settimana ISO di `p_to - 1`.
  2. Intervallo della riga: timbratura se conta (`clock_in_at`/`clock_out_at` non nulli e non `to_review`), altrimenti `(date + start_time) at time zone 'Europe/Rome'` → fine (fine ≤ inizio = giorno dopo). `ratio = approved_hours * 60 / minuti dell'intervallo`.
  3. Straordinario: `contract_hours`/`contract_period` da `member_hr`; per persona e periodo (`day` = data del turno, `week` = settimana ISO, `month` = mese), righe in ordine di inizio, minuti contati cumulati; i minuti contati oltre la soglia sono la coda della riga, convertita in minuti di intervallo dividendo per `ratio`.
  4. Punti di rottura dentro l'intervallo: mezzanotti locali, inizio e fine della fascia notturna per ogni giorno locale toccato, inizio della coda di straordinario. Ogni tratto fra due punti prende le voci attive (fascia, domenica locale, festivo locale con il patrono della sede della riga, coda), tiene la più alta con la parità dello spec, e si somma per voce. Regole: la versione del mese della **data del turno**. Sconsigliato `generate_series` sui minuti (Disk IO, memoria `supabase-disk-io-perf`).
  5. Ore per voce = minuti × `ratio` / 60, arrotondate al centesimo; correzione del centesimo in più come da Global Constraints.
  6. In uscita solo le righe con `date` in `[p_from, p_to)` e sede nel perimetro di chi legge.
  `get_workspace_surcharges` ripete il controllo `p_workspace in (select private.commercial_readable_workspace_ids())` nel corpo (test 050) e richiede `can_workspace_hours`.

- [ ] **Step 1: Test SQL che fallisce** — `160_surcharges.sql`; turni preparati con `tests.create_shifts` e presenze come in `156_hours_daily.sql`, regole con `save_surcharge_rules`:
  - **esempio dello spec**: regole di novembre notturno 22–6 +20%, domenica +30%; `M_Emp` domenica 8/11/2026 18:00–02:00, pausa 30 min non retribuita → righe `sunday 30 5.62` e `night 20 1.88`; `get_workspace_hours_daily` di quella riga invariato (7.5);
  - **sabato → domenica**: sabato 14/11 20:00–02:00 senza pausa → `night 2.00` (22–24 di sabato) e `sunday 2.00` (00–02 di domenica, +30% batte +20%);
  - **festivo più alto**: `holiday_pct 50`, martedì 8/12/2026 20:00–24:00 → `holiday 4.00`, niente `night` (22–24 è festivo, +50% batte +20%);
  - **parità**: notturno e festivi entrambi 20 → vince festivi;
  - **patrono**: patrono di V1 il 10/11; stesso turno in V1 → `holiday`, in V2 → niente;
  - **ore corrette a mano**: turno 8 h con `worked_hours` scritte a 4 (`set_assignment_presence` o la RPC usata in 037) e fascia tutta notturna → `night 4.00`, mai più delle ore;
  - **cambio dell'ora**: sabato 24/10/2026 22:00–06:00 con regole valide da ottobre → `night 9.00` (9 ore reali);
  - **straordinario settimanale**: `M_Emp` 10 h a settimana; lunedì 16/11 6 h, mercoledì 18/11 6 h → `overtime 2.00` sulla riga di mercoledì, nessuno su lunedì; **mensile** e **giornaliero** con un caso ciascuno;
  - **settimana a cavallo** (solo lo straordinario acceso: l'1/11 è domenica e festivo): contratto 10 h a settimana; giovedì 29/10 8 h, sabato 31/10 4 h (straordinario 2 h il 31/10), domenica 1/11 4 h (straordinario 4 h) → periodo di ottobre: `overtime 2.00` il 31/10; periodo di novembre: `overtime 4.00` l'1/11;
  - **perimetro**: `M_Emp2`, contratto 10 h a settimana, lunedì 16/11 6 h in V2 e mercoledì 18/11 6 h in V1; un collaboratore con «Ore» solo su V1 (come in `156_hours_daily.sql`) vede `overtime 2.00` sulla riga di V1 del 18/11 e nessuna riga di V2;
  - **versioni**: dopo aver salvato dicembre al +25% le righe di novembre restano al 20; salvare di nuovo ottobre accende ottobre;
  - **nessuna regola** → zero righe; voce spenta → nessuna riga di quella voce;
  - **senza contratto**: un dipendente con ore e senza contratto, straordinario acceso → una riga `no_contract`; il titolare in turno senza contratto → nessuna;
  - **bozze e non contati**: un turno in bozza e uno da approvare non producono righe;
  - **permessi**: `Co` (senza «Ore») → `not_allowed`.
- [ ] **Step 2:** `supabase/tests/run.sh reset && supabase/tests/run.sh test 2>&1 | grep -B2 -A3 "160\|FALLIT"` → FAIL su 160.
- [ ] **Step 3:** migration (intestazione: fonte unica, proporzione, più alta vince, perimetro dello straordinario; ⚠️ chi cambia cosa conta in `workspace_hour_rows_in` cambia anche le maggiorazioni); `get_workspace_surcharges` in `050_surface.sql`.
- [ ] **Step 4:** stesso comando → nessun FALLITI (037, 130, 156 compresi); `supabase/tests/gen-types.sh`.

---

### Task 3: Modulo puro, data layer ed errori

**Files:**
- Create: `src/features/assignments/surcharges.ts` (puro)
- Modify: `src/features/assignments/exportCodes.ts` (chiavi ed etichette nuove, `usedExportKeys`)
- Modify: `src/features/assignments/api.ts`, `src/features/assignments/hooks.ts`, `src/lib/queryKeys.ts`, `src/lib/errors.ts`
- Test: `tests/unit/assignments/surcharges.test.ts`, `tests/unit/assignments/exportCodes.test.ts`, `tests/unit/lib/errors.test.ts`

**Interfaces:**
- Consumes: le tre RPC dei Task 1-2.
- Produces (`surcharges.ts`):
  ```ts
  export type SurchargeKind = "night" | "sunday" | "holiday" | "overtime";
  export const SURCHARGE_KINDS: readonly SurchargeKind[]; // night, sunday, holiday, overtime
  export type SurchargeRow = { person_id: string; date: string; venue_name: string | null; title: string | null;
    clock_in: string | null; clock_out: string | null; kind: SurchargeKind; percentage: number; hours: number };
  export type Surcharges = { rows: SurchargeRow[]; noContract: Set<string> }; // person_id senza contratto
  export function toSurcharges(raw: unknown[]): Surcharges;
  export function surchargeLabel(kind: SurchargeKind, pct: number): string; // "Di cui notturno +20%", "+12,5%"
  /** Colonne/righe distinte per voce e percentuale, in ordine di voce poi percentuale. */
  export function surchargeColumns(rows: readonly SurchargeRow[]): { kind: SurchargeKind; percentage: number }[];
  export function surchargeTotals(rows: readonly SurchargeRow[], personId?: string): Map<string, number>; // chiave `${kind}:${pct}`
  export function missingContractWarning(noContract: ReadonlySet<string>, personIds: readonly string[]): string | null;
  export type SurchargeRulesInput = { night_pct: number | null; night_start: string; night_end: string;
    sunday_pct: number | null; holiday_pct: number | null; overtime_pct: number | null };
  export type SurchargeRules = { versions: (SurchargeRulesInput & { valid_from: string })[];
    patrons: { venue_id: string; day: number; month: number }[] };
  export function toSurchargeRules(raw: unknown): SurchargeRules;
  /** Dal testo del campo ("20", "12,5", "") alla percentuale; `invalid` fuori dalle regole. */
  export function parseSurchargePct(input: string): { pct: number | null; invalid: boolean };
  ```
- Produces: in `exportCodes.ts` `ExportCodeKey` += `"night" | "sunday" | "holiday" | "overtime"`, etichette «Notturno», «Domenica», «Festivi», «Straordinario» in `EXPORT_CODE_LABELS` e `EXPORT_CODE_KEYS` (dopo `malattia`); `usedExportKeys(report, absences, surcharges?: readonly SurchargeRow[])` aggiunge le voci con ore.
- Produces: in `api.ts` `getSurchargeRules(workspaceId)`, `saveSurchargeRules(workspaceId, validFrom: string, rules: SurchargeRulesInput)`, `saveVenuePatron(venueId, day: number | null, month: number | null)`, `getWorkspaceSurcharges(workspaceId, period: ReportPeriod): Promise<Surcharges>`; in `queryKeys.ts` `qk.staff.surchargeRules(workspaceId)` e `qk.staff.surcharges(workspaceId, from, to)`; in `hooks.ts` `useSurchargeRules`, `useSaveSurchargeRules(workspaceId)` e `useSaveVenuePatron(workspaceId)` (invalidano regole **e** `["staff","surcharges",workspaceId]`), `useWorkspaceSurcharges(workspaceId, period)`, `fetchWorkspaceSurcharges(queryClient, workspaceId, period)` con `staleTime: 0`.
- Produces: in `errors.ts` `invalid_surcharge` → «Controlla le maggiorazioni: percentuali fra 0 e 300 con al massimo un decimale, fascia al quarto d'ora.», `invalid_patron` → «Questa data del patrono non esiste.» (`invalid_surcharge` **prima** di eventuali pattern che lo contengono).

- [ ] **Step 1: Test che falliscono**:
  - `surchargeLabel("night", 20) === "Di cui notturno +20%"`, `("overtime", 12.5) === "Di cui straordinario +12,5%"`, `("holiday", 50) === "Di cui festivi +50%"`, `("sunday", 30) === "Di cui domenica +30%"`;
  - `surchargeColumns` con night 25, sunday 30, night 20 → `[night 20, night 25, sunday 30]`;
  - `surchargeTotals` somma per voce e percentuale, filtrata per persona;
  - `toSurcharges` separa `no_contract` in `noContract` e scarta righe con `kind` sconosciuto;
  - `missingContractWarning(new Set(["a","b"]), ["a","b","c"]) === "2 persone senza ore da contratto: lo straordinario non è calcolato."`, una → «1 persona …», chi non è fra le persone del periodo non conta, nessuno → `null`;
  - `parseSurchargePct`: `"20"` → 20, `"12,5"` → 12.5, `""` → `null` valido, `"0"`, `"301"`, `"12,25"`, `"abc"` → `invalid`;
  - `EXPORT_CODE_LABELS.night === "Notturno"`; `usedExportKeys([], [], [nightRow])` contiene `"night"`;
  - errori: le due frasi esatte.
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments/surcharges.test.ts tests/unit/assignments/exportCodes.test.ts tests/unit/lib/errors.test.ts` → FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** stesso comando e `npx tsc --noEmit` → PASS.

---

### Task 4: Maggiorazioni nei file

**Files:**
- Modify: `src/lib/exportBuilders.ts` (`buildHoursCsv`, `buildDailyCsv`, `buildHoursHtml`, `buildTimesheetHtml`), `src/lib/export.ts` (i wrapper nativi inoltrano `surcharges`)
- Test: `tests/unit/assignments/hoursExport.test.ts`, `tests/unit/assignments/hoursDailyExport.test.ts`

**Interfaces:**
- Consumes: `SurchargeRow`, `surchargeLabel`, `surchargeColumns`, `surchargeTotals` (Task 3); `ExportCodes` con le chiavi nuove.
- Produces: nuovo ultimo parametro facoltativo `surcharges?: readonly SurchargeRow[]` per `buildHoursCsv(people, absences, codes?, surcharges?)`, `buildDailyCsv(rows, codes?, surcharges?)`, `buildHoursHtml(…, timesheet?, surcharges?)`, `buildTimesheetHtml(rows, bounds, surcharges?)`; assente o vuoto → output **identico** a oggi.
- Regole:
  - mensile: una colonna per `surchargeColumns(surcharges)` subito dopo «Pausa non retribuita esclusa», intestazione `surchargeLabel` + ` (codice)` se c'è il codice della voce, passata da `csvCell`; valore = ore della persona per quella voce e percentuale (`hoursNumber`, 0 se niente);
  - giornaliero: dopo ogni riga `work`, le righe di maggiorazione con la stessa persona, data, sede, turno, entrata e uscita, nell'ordine `surchargeColumns`; causale `surchargeLabel`, ore, codice causale della voce; entrata, uscita, pausa e note vuote; maggiorazioni senza riga `work` corrispondente → in coda alle righe di quella persona e data;
  - PDF: nel riepilogo una colonna per voce e percentuale dopo «Ore lavorate» e una riga di totali; nel cartellino, sotto la riga di ogni persona, una riga per voce e percentuale con le ore per giorno, etichetta `surchargeLabel`.

- [ ] **Step 1: Test che falliscono**:
  - mensile con `[night 20 1.88, sunday 30 5.62]` per «p» → intestazione con `;Pausa non retribuita esclusa;Di cui notturno +20%;Di cui domenica +30%;Ferie` e riga con `;1,88;5,62;`; con `codes.codes.night = "NOT"` → `Di cui notturno +20% (NOT)`;
  - due percentuali di notturno (20 a ottobre, 25 a novembre) → due colonne, stesso codice;
  - senza `surcharges` e con `[]` → identico a `buildHoursCsv([person()])`;
  - giornaliero: la riga di lavoro, poi `…;Di cui domenica +30%;;;;;5,62;` e `…;Di cui notturno +20%;;;;;1,88;` (ordine di `surchargeColumns`: notturno prima di domenica), con i codici il codice causale della voce in terza colonna; somma delle righe `Lavoro` invariata;
  - PDF: `buildHoursHtml` contiene «Di cui notturno +20%» e il valore; il cartellino ha la riga «di cui» sotto la persona;
  - senza maggiorazioni giornaliero e PDF identici.
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments` → FAIL.
- [ ] **Step 3:** implementa.
- [ ] **Step 4:** stesso comando → PASS; `npx tsc --noEmit`.

---

### Task 5: Pagina Ore e impostazioni (app e dashboard), documentazione, commit

**Files:**
- Create: `src/app/(manager)/maggiorazioni.tsx` (registrata in `src/app/(manager)/_layout.tsx`; poi rigenerare i tipi delle rotte avviando Metro: `CI=1 npx expo start --port 8099` finché esiste `.expo/types/router.d.ts`, poi chiuderlo)
- Create: `web/src/hours/SurchargeRulesDialog.tsx`
- Modify: `src/app/(manager)/ore.tsx`, `web/src/pages/Ore.tsx`, `src/app/(manager)/codici-consulente.tsx` e `web/src/hours/ExportCodesDialog.tsx` (solo se le chiavi nuove non compaiono da sole tramite `EXPORT_CODE_KEYS`)
- Modify: `AGENTS.md`, `TASKS.md`, `plans/HOURS-ABSENCES-ADJUSTMENTS.md`

**Interfaces:**
- Consumes: hook e funzioni del Task 3, builder del Task 4, `operationsGate` (`src/features/workspace/access.ts`) come nei moduli dei codici.

- [ ] **Step 1: Modulo delle regole** (app e dashboard, stessi campi e testi):
  - aiuto «Le percentuali le decide il contratto: scrivile come te le dà il consulente. Le ore lavorate non cambiano: le maggiorazioni dicono quante di quelle ore sono notturne, di domenica, festive o di straordinario.»;
  - «Valgono dal mese di» (select dal mese corrente ai 12 precedenti, di default il corrente; i valori iniziali sono quelli della versione valida per quel mese); con un mese passato: «I file dei mesi da {mese} in poi cambiano.»;
  - quattro voci con interruttore e percentuale (`parseSurchargePct`); Notturno con «Dalle» / «Alle» (al quarto d'ora); Straordinario con l'aiuto «Le ore oltre quelle da contratto della scheda, nel periodo del contratto.»;
  - «Santo patrono» per ogni sede in cui chi scrive ha «Ore» (giorno e mese, facoltativo), aiuto «Vale anche per i mesi passati.», salvato con `useSaveVenuePatron`;
  - in archivio i campi sono in sola lettura e al posto di «Salva» compare `gate.reason`;
  - errori con `userErrorMessage`.
- [ ] **Step 2: Pagina Ore.** Voce «Maggiorazioni» accanto a «Codici per il consulente» (app: fuori dal ramo «con dati»; dashboard: pulsante accanto). `useWorkspaceSurcharges` con il periodo della pagina: righe «Di cui …» nel riepilogo del periodo e per persona (solo voci con ore, filtrate dalla scelta delle persone). Avviso `missingContractWarning` accanto agli altri avvisi; `usedExportKeys` riceve le maggiorazioni. Al momento dell'export `fetchWorkspaceSurcharges` (`staleTime: 0`) e passaggio a mensile, giornaliero e PDF (filtrate sulle persone scelte), app e dashboard.
- [ ] **Step 3: Documentazione.** `AGENTS.md`: paragrafo «Maggiorazioni» sotto «Ore, assenze e maggiorazioni» (regole datate per mese, `get_workspace_surcharges` fonte unica, `workspace_hour_rows_in` e la soglia su tutte le sedi, più alta vince, proporzione, patrono senza versioni, chiunque con «Ore»). `TASKS.md`: spunta il punto 3 con la data e «migration `20261104000300`/`000400` da rilasciare». `plans/HOURS-ABSENCES-ADJUSTMENTS.md`: maggiorazioni automatiche calcolate ogni volta, `assignment_adjustments` resta un'idea per quelle a mano.
- [ ] **Step 4: Verifica completa.**
  Run: `npx tsc --noEmit && yarn lint && yarn test:unit && supabase/tests/run.sh reset && supabase/tests/run.sh test`
  Expected: tutto verde; lint con il solo avviso già presente su `main`.
- [ ] **Step 5: Commit e push su `main`** (un solo commit per tutto il piano), messaggio `feat(ore): maggiorazioni per il consulente (notturno, domenica, festivi, straordinario)` con il trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; prima `git fetch` e controllo che `origin/main` non sia avanti.
- [ ] **Step 6: Prova a mano** (all'utente): impostare notturno +20% e domenica +30% da novembre, registrare il turno dell'esempio dello spec, controllare pagina Ore, CSV mensile, giornaliero e PDF.
