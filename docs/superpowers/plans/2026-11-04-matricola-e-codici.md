# Matricola e codici per il consulente — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Matricola sulla scheda della persona e codici dell'azienda per il consulente, riportati nei CSV della pagina Ore e nell'export completo, con un avviso (mai un blocco) quando mancano.

**Architecture:** La matricola è una colonna di `member_hr` scritta da `update_member`; i codici stanno in una tabella chiave-valore per azienda scritta da una RPC. Una RPC di sola lettura (`get_export_codes`) dà al client codici e matricole nel perimetro «Ore»; i costruttori puri di `src/lib/exportBuilders.ts` li uniscono alle righe per `person_id`. Le RPC delle ore non cambiano firma.

**Tech Stack:** Postgres 17 (Supabase; banco `supabase/tests/run.sh`), TypeScript, Expo SDK 56 / React Native, React (Vite) in `web/`, vitest.

**Spec:** [docs/superpowers/specs/2026-11-04-matricola-e-codici-design.md](../specs/2026-11-04-matricola-e-codici-design.md)

## Global Constraints

- **Si lavora su `main`** nel repo principale: niente worktree né rami. I task non committano; a fine piano **un solo commit** su `main` e push (preferenza dell'utente).
- Migration **nuove** con prefisso `20261104…`; `20261103000600`/`000700` sono già applicate: non toccarle.
- RPC `SECURITY DEFINER`, `SET search_path TO ''`, `revoke all … from public, anon`, `grant execute … to authenticated` (solo le pubbliche); aggiornare `supabase/tests/rls/050_surface.sql`.
- Scritture con `private.assert_workspace_operational(workspace)`; letture dentro `private.commercial_readable_workspace_ids()`.
- Errori `raise exception '<codice>'`, tradotti in `src/lib/errors.ts` (`PATTERNS`).
- **«Ore» sull'azienda** = il chiamante ha `hours` su almeno una sede dell'azienda (`exists (select 1 from public.venues v where v.workspace_id = p_workspace and v.id in (select private.venues_where('hours')))`).
- Le RPC esistenti `get_workspace_hours_summary`, `get_workspace_hours_daily`, `get_workspace_absence_summary` **non cambiano firma**.
- Matricola: trim, fino a **30** caratteri, vuota = `null`, **unica** nell'azienda senza distinzione di maiuscole, membri usciti compresi; errore `matricola_taken`; codice troppo lungo: `invalid_code`.
- Codici: chiavi `company`, `work`, `ferie`, `permesso`, `malattia`; trim, fino a **20** caratteri, vuoto = nessun codice.
- CSV: `;`, virgola, BOM, `\r\n`, testo protetto dalle formule (`csvText`).
- Testi esatti: campo «Matricola»; aiuto «Il codice del dipendente nel programma paghe del consulente.»; voce «Codici per il consulente»; aiuto «Te li dà il tuo consulente: sono i codici del suo programma paghe. Puoi lasciarli vuoti.»; campi «Codice azienda», «Lavoro», «Ferie», «Permesso», «Malattia».
- Glossario (`tests/unit/glossary.test.ts`): «dipendente», «team», «sede»; mai «organico», «staff», «locale» nei testi.
- Unit test in ora locale senza offset (CI in UTC).

## Review Focus

1. **Matricola già usata con maiuscole/spazi diversi** («a12 » e «A12»): rifiutata con `matricola_taken`. → test in Task 1.
2. **Matricola di chi è uscito**: resta sua, un nuovo dipendente non la riprende. → test in Task 1.
3. **Collaboratore con «Ore» su una sola sede**: `get_export_codes` non restituisce le matricole di chi lavora solo in altre sedi. → test in Task 2.
4. **Matricola o codice che comincia con `=`/`+`**: nel CSV resta testo. → test in Task 3.
5. **Azienda che non usa i codici**: nessun avviso sui codici mancanti, solo quello delle matricole se qualcuno le ha. → test in Task 3.

---

### Task 1: Matricola nel database e nella scheda

**Files:**
- Create: `supabase/migrations/20261104000000_member_matricola.sql`
- Create: `supabase/tests/rls/157_member_matricola.sql`
- Modify: `src/features/staff/api.ts` (`HR_SELECT` ~riga 69, mappatura ~riga 199, `StaffPersonPatch` ~riga 673), `src/features/staff/types.ts` (`StaffPerson`), `src/lib/errors.ts`
- Modify: `src/app/(manager)/staff/[id].tsx` (accanto al contratto, ~riga 1090), `web/src/staff/StaffDetail.tsx` (~riga 840)
- Modify: `web-site/public/dati-del-team.html:91` (aggiungere «matricola» fra i dati della persona)
- Modify: `src/types/database.ts` (rigenerato)
- Test: `tests/unit/lib/errors.test.ts`

**Interfaces:**
- Produces: colonna `public.member_hr.matricola text null`; `update_member(p_member, p_patch)` accetta la chiave `matricola` con le stesse regole di `note`/`contract_hours` (permesso `staff` sulla persona, `is_restricted_self` blocca il non titolare su di sé); errore `matricola_taken`.
- Produces: `StaffPerson.matricola: string | null`; `StaffPersonPatch.matricola?: string | null`.

- [ ] **Step 1: Test SQL che fallisce** — `157_member_matricola.sql` nello stile di `037_hours_to_fix.sql`: `Ow` scrive «A12» su `M_Emp` → riletta da `member_hr` uguale a «A12»; «  a12 » su `M_Emp2` → `matricola_taken`; la stessa «A12» in un'altra azienda del seed (se il seed non ne ha una, crearla con le RPC esistenti) → accettata; `M_Emp` uscito (con l'RPC di uscita esistente) → «A12» su un terzo membro ancora `matricola_taken`; chi non ha «Team» → `not_allowed`; stringa di 31 caratteri → `invalid_code`; stringa vuota → `null`.
- [ ] **Step 2:** `supabase/tests/run.sh reset && supabase/tests/run.sh test 2>&1 | grep -A3 157` → FAIL.
- [ ] **Step 3: Migration** — colonna, nuova versione di `update_member` (ultimo corpo in `20261005000300_commercial_rpc_guards.sql:185`) che gestisce `matricola` dentro `v_hr_keys`; unicità con `perform 1 from public.workspaces where id = <azienda> for update` e un controllo su `member_hr` unito a `workspace_members` della stessa azienda (`lower(btrim())`, escluso il membro stesso). Intestazione che spiega perché non è un indice (`member_hr` non porta l'azienda).
- [ ] **Step 4:** stesso comando → PASS; poi `supabase/tests/gen-types.sh`.
- [ ] **Step 5: Client** — `matricola` in `HR_SELECT`, nel tipo e nel patch; `PATTERNS` in `errors.ts`: `matricola_taken` → «Questa matricola è già usata da un'altra persona dell'azienda.», `invalid_code` → «Il codice è troppo lungo.»; test in `tests/unit/lib/errors.test.ts` per le due frasi. Campo «Matricola» con l'aiuto esatto nelle due schede, salvato insieme al contratto via `updateStaffPerson`. Riga 91 di `dati-del-team.html`: «…tipo di rapporto, matricola e ore previste dal contratto…».
- [ ] **Step 6:** `npx tsc --noEmit && yarn vitest run tests/unit/lib/errors.test.ts tests/unit/web` → PASS.

---

### Task 2: Codici dell'azienda e lettura per l'export

**Files:**
- Create: `supabase/migrations/20261104000100_export_codes.sql`
- Create: `supabase/tests/rls/158_export_codes.sql`
- Modify: `supabase/tests/rls/050_surface.sql`, `src/types/database.ts` (rigenerato)
- Create: `src/features/assignments/exportCodes.ts` (puro)
- Modify: `src/features/assignments/api.ts`, `src/features/assignments/hooks.ts`, `src/lib/queryKeys.ts`
- Test: `tests/unit/assignments/exportCodes.test.ts`

**Interfaces:**
- Produces (DB): tabella `public.workspace_export_codes(workspace_id uuid references workspaces, key text check (key in ('company','work','ferie','permesso','malattia')), code text not null, updated_at, primary key (workspace_id, key))`, RLS attiva senza policy di scrittura; `public.save_export_codes(p_workspace uuid, p_codes jsonb) returns void` (sostituisce l'insieme: chiave assente o vuota = cancellata; chiave sconosciuta = `invalid_code`); `public.get_export_codes(p_workspace uuid) returns jsonb` = `{"codes": {"company": "…", …}, "matricole": [{"member_id": "…", "matricola": "…"}]}` — matricole solo dei membri con almeno una riga in `venue_members` su una sede in `private.venues_where('hours')` dell'azienda, oppure tutte se il chiamante è titolare; entrambe richiedono «Ore» sull'azienda (`not_allowed` altrimenti).
- Produces (client, `exportCodes.ts`):
  ```ts
  export type ExportCodeKey = "company" | "work" | "ferie" | "permesso" | "malattia";
  export type ExportCodes = { codes: Partial<Record<ExportCodeKey, string>>; matricole: Map<string, string> }; // person_id → matricola
  export function toExportCodes(raw: unknown): ExportCodes;
  export const EXPORT_CODE_LABELS: Record<ExportCodeKey, string>; // «Codice azienda», «Lavoro», «Ferie», «Permesso», «Malattia»
  ```
- Produces: `getExportCodes(workspaceId: string): Promise<ExportCodes>`, `saveExportCodes(workspaceId: string, codes: Partial<Record<ExportCodeKey, string>>): Promise<void>` in `api.ts`; `qk.staff.exportCodes(workspaceId: string)`; `useExportCodes(workspaceId: string | undefined)` e `useSaveExportCodes(workspaceId: string)` in `hooks.ts` (la mutazione invalida `qk.staff.exportCodes`).

- [ ] **Step 1: Test SQL che fallisce** — `158_export_codes.sql`: `Ow` salva `{"company":"AZ1","work":"01","ferie":" FE "}` e rilegge `codes` uguale a `{"company":"AZ1","work":"01","ferie":"FE"}`; salvataggio successivo senza `ferie` → `ferie` sparita; chiave `"straordinario"` → `invalid_code`; codice di 21 caratteri → `invalid_code`; `Co` (senza «Ore») → `not_allowed` su lettura e scrittura; collaboratore con «Ore» solo su V1 (come in `156_hours_daily.sql`) vede in `matricole` chi lavora in V1 e non chi lavora solo in V2; azienda in archivio → la scrittura rifiuta, la lettura no (se il seed non permette di preparare l'archivio, coprirlo con `assert_workspace_operational` come fanno i test esistenti di `080_commercial_enforcement.sql`).
- [ ] **Step 2:** `supabase/tests/run.sh reset && supabase/tests/run.sh test 2>&1 | grep -A3 158` → FAIL.
- [ ] **Step 3:** migration; le due funzioni pubbliche in `050_surface.sql`.
- [ ] **Step 4:** stesso comando → tutti `ok`; `supabase/tests/gen-types.sh`.
- [ ] **Step 5: Test unit che fallisce** — `toExportCodes`: oggetto completo → `codes` e `Map` corretti; `null`/campi mancanti → `{ codes: {}, matricole: new Map() }`; `EXPORT_CODE_LABELS.company === "Codice azienda"`.
- [ ] **Step 6:** implementa client; `yarn vitest run tests/unit/assignments/exportCodes.test.ts && npx tsc --noEmit` → PASS.

---

### Task 3: Codici nei file e avviso

**Files:**
- Modify: `src/lib/exportBuilders.ts` (`buildDailyCsv`, `buildHoursCsv`, `buildAbsencesCsv`)
- Modify: `src/features/assignments/exportCodes.ts` (frase dell'avviso)
- Modify: `web/src/export/fullExportFiles.ts` + `supabase/migrations/20261104000200_full_export_matricola.sql` (`export_workspace_data`: `'matricola', hr.matricola` accanto a `'hr_note'`; ultimo corpo in `20261020000300_workspace_full_export.sql`)
- Test: `tests/unit/assignments/hoursDailyExport.test.ts`, `tests/unit/assignments/hoursExport.test.ts`, `tests/unit/assignments/exportCodes.test.ts`, `tests/unit/fullExportFiles.test.ts`, `supabase/tests/rls/130_workspace_full_export.sql`

**Interfaces:**
- Consumes: `ExportCodes`, `EXPORT_CODE_LABELS` (Task 2); `HoursDailyRow` (`src/features/assignments/hoursDaily.ts`).
- Produces: ultimo parametro facoltativo `codes?: ExportCodes` per `buildDailyCsv(rows, codes?)`, `buildHoursCsv(people, absences, codes?)`, `buildAbsencesCsv(rows, codes?)`; senza `codes` l'output è **identico** a oggi.
- Produces: `exportCodesWarning(input: { personIds: readonly string[]; usedKeys: readonly ExportCodeKey[]; codes: ExportCodes; names: ReadonlyMap<string, string> }): string | null` in `exportCodes.ts`.
- Regole (dallo spec):
  - giornaliero: tre colonne **in testa** `Codice azienda;Matricola;Codice causale`; causale `work`→`codes.work`, `ferie`/`permesso`/`malattia`→ omonime, `to_fix` → vuoto;
  - mensile: `Matricola` subito dopo `Nome`; intestazioni con il codice fra parentesi quando c'è: `Ore lavorate effettive (01)`, `Ferie (FE) - ore riconosciute`, `MAL/Malattia (MAL) - ore riconosciute`, `Permessi (PE) - ore riconosciute`;
  - assenze: `Matricola` dopo `Nome`;
  - `persone.csv`: colonna `Matricola` dopo `Nome`; zod `matricola: text.optional()`;
  - avviso: «N persone senza matricola: nel file la colonna resta vuota.» (1 → «1 persona senza matricola: …») quando qualcuno in `personIds` non ha matricola **e** almeno una matricola esiste nell'azienda o almeno un codice è scritto; «Senza codice: Malattia, Ferie.» per le chiavi in `usedKeys` (più `company`) senza codice, solo se almeno un codice è scritto; le due frasi unite da uno spazio; `null` se niente.

- [ ] **Step 1: Test che falliscono**: righe esatte del giornaliero con codici (lavoro, ferie, to_fix senza codice causale); intestazione esatta del mensile con e senza codici; `Matricola` `=A1` → `'=A1`; output identico a oggi senza `codes` (confronto con la chiamata senza parametro); avviso: nessun codice e nessuna matricola → `null`; due persone su tre senza matricola con una matricola esistente → «2 persone senza matricola: nel file la colonna resta vuota.»; `usedKeys: ["work","malattia"]`, codici `{work:"01"}` → contiene «Senza codice: Codice azienda, Malattia.»; `fullExportFiles` con e senza `matricola`.
- [ ] **Step 2:** `yarn vitest run tests/unit/assignments tests/unit/fullExportFiles.test.ts` → FAIL.
- [ ] **Step 3:** implementa; migration del full export; assert `matricola` in `130_workspace_full_export.sql`.
- [ ] **Step 4:** `yarn vitest run tests/unit/assignments tests/unit/fullExportFiles.test.ts` e `supabase/tests/run.sh reset && supabase/tests/run.sh test` → PASS; `supabase/tests/gen-types.sh`.

---

### Task 4: Pagina Ore (app e dashboard), documentazione, commit

**Files:**
- Modify: `src/app/(manager)/ore.tsx`, `src/lib/export.ts` (passano `codes` ai builder)
- Create: la schermata o il foglio dei codici nell'app (es. `src/app/(manager)/codici-consulente.tsx`, rotta nel gruppo `(manager)`; dopo una rotta nuova rigenerare i tipi delle rotte avviando Metro, vedi memoria `expo-typed-routes-regen`)
- Modify: `web/src/pages/Ore.tsx` (riquadro o finestra dei codici + passaggio di `codes`)
- Modify: `AGENTS.md` («Ore, assenze e maggiorazioni»), `TASKS.md` (spunta il punto 2)

**Interfaces:**
- Consumes: `useExportCodes`, `useSaveExportCodes`, `getExportCodes`, `exportCodesWarning`, `EXPORT_CODE_LABELS` (Task 2-3); `fetchOwnerHoursDaily` (già in `src/features/assignments/hooks.ts`).

- [ ] **Step 1: App.** Voce «Codici per il consulente» vicino ai pulsanti di export (visibile con il permesso «Ore»), che apre il modulo con i cinque campi e l'aiuto esatto; salva con `useSaveExportCodes` e toast d'errore con `errorMessage`. `onExport` legge i codici con `queryClient.fetchQuery({ queryKey: qk.staff.exportCodes(workspaceId), queryFn: …, staleTime: 0 })` e li passa ai tre CSV. Avviso con `exportCodesWarning` sopra i pulsanti, accanto a quello dei certificati: `personIds` = le persone del periodo dopo il filtro, `usedKeys` = `work` se ci sono ore, più le causali con ore o giorni nel riepilogo assenze, `names` dalle righe.
- [ ] **Step 2: Dashboard.** Stessa cosa in `web/src/pages/Ore.tsx`, nello stile dei riquadri della pagina.
- [ ] **Step 3: Documentazione.** `AGENTS.md`: un paragrafo su matricola (`member_hr.matricola`, unica nell'azienda anche fra gli usciti, scritta da `update_member` con «Team») e codici (`workspace_export_codes`, «Ore», chiavi pronte per le maggiorazioni), `get_export_codes` come unica fonte per l'export, avviso che non blocca. `TASKS.md`: spunta «2. Matricola e causali» con la data e «migration `20261104…` da rilasciare».
- [ ] **Step 4: Verifica completa.**
  Run: `npx tsc --noEmit && yarn lint && yarn test:unit && supabase/tests/run.sh reset && supabase/tests/run.sh test`
  Expected: tutto verde; lint con il solo avviso già presente su `main`.
- [ ] **Step 5: Commit e push su `main`** (un solo commit per tutto il piano):
  ```bash
  git add -A && git commit -m "feat(ore): matricola e codici per il consulente negli export" && git push origin main
  ```
  con il trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- [ ] **Step 6: Prova a mano** (all'utente): scrivere una matricola e i codici, esportare giornaliero, mensile e assenze dello stesso mese e aprirli in Excel.
