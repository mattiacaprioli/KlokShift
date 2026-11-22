# Pagina Ore leggibile sul telefono — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nella pagina Ore dell'app (gestione) ogni persona diventa una riga corta (nome, ore grandi, «Da controllare» se serve) che apre una pagina della persona con tutto il dettaglio; il riepilogo si riduce a un numero grande.

**Architecture:** Nessun dato nuovo: la pagina della persona riusa gli stessi hook della pagina Ore (`useOwnerHoursSummary`, `useOwnerAbsenceSummary`, `useHoursToFix`, `useWorkspaceSurcharges`) con lo stesso `ReportPeriod`, passato nei parametri della rotta, e filtra la persona. Le poche regole nuove (quando una riga è da controllare, periodo ↔ parametri) stanno in un modulo puro testato.

**Tech Stack:** Expo Router (SDK 56), React Native, NativeWind via `@/tw`, React Query, vitest.

**Spec:** `docs/superpowers/specs/2026-11-22-ore-mobile-leggibile-design.md`

## Global Constraints

- Stringhe utente in italiano inline; vocabolario del glossario (team, dipendente, sede): lo verifica `tests/unit/glossary.test.ts`.
- Colori solo dai token (`text-gold`, `text-warning`, `useColors()`): niente `#hex`/`rgba(` (test `colorTokens`).
- Componenti con `className` da `@/tw`; niente `<Link className>`: `Pressable` + `router.push`.
- Nessun calcolo delle ore nuovo: solo `groupHoursByPerson`, `monthlyReportRows`, `breakSummaryText`, `surchargeSummary`, `filterByPeople`.
- Solo app: la dashboard web non cambia.
- `reactCompiler: true`: nessun hook condizionale, nessun return prima degli hook.

## Review Focus

- Persona con sole assenze (0 h lavorate): la riga mostra «0 h» e apre comunque la pagina con le assenze.
- Parametri del periodo mancanti o malformati nella rotta della persona: si torna al mese corrente, mai un crash.
- Persona non più presente nel periodo (dati cambiati, deep link vecchio): la pagina dice «Nessuna ora in questo periodo», non una schermata vuota.
- Periodo «Date» (dal/al) e non solo «Mese»: la pagina della persona mostra lo stesso periodo e le stesse ore della riga.
- Con più sedi, le righe «Ore da sistemare» della persona mostrano la sede come nella pagina Ore.

---

### Task 1: Regole pure (riga da controllare, periodo ↔ parametri)

**Files:**
- Create: `src/features/assignments/hoursPerson.ts`
- Test: `tests/unit/assignments/hoursPerson.test.ts`
- Add (stesso commit): `docs/superpowers/specs/2026-11-22-ore-mobile-leggibile-design.md`, questo piano

**Interfaces:**
- Produces:
  - `needsCheck(row: Pick<MonthlyReportRow, "conflict_hours" | "untracked_hours">): boolean`
  - `periodToParams(p: ReportPeriod): { mese: string } | { dal: string; al: string }`
  - `periodFromParams(params: { mese?: string; dal?: string; al?: string }, now?: Date): ReportPeriod` — mese valido via `monthFromParam`; dal/al validi via `validateRange` (null = valido); altrimenti `{ kind: "month", month: monthKey(now) }`.
  - `NEEDS_CHECK_LABEL = "Da controllare"`

- [ ] **Step 1: Test che falliscono** in `tests/unit/assignments/hoursPerson.test.ts`:
  - `needsCheck({conflict_hours:0, untracked_hours:0})` → `false`; con `conflict_hours: 2` → `true`; con `untracked_hours: 1.5` → `true`.
  - `periodToParams({kind:"month", month:"2026-11"})` → `{ mese: "2026-11" }`; range `2026-11-01`/`2026-11-15` → `{ dal: "2026-11-01", al: "2026-11-15" }`.
  - andata e ritorno: `periodFromParams(periodToParams(p))` uguale a `p` per un mese e per un range.
  - `periodFromParams({}, new Date(2026, 10, 22))` → `{ kind: "month", month: "2026-11" }`; `periodFromParams({ dal: "2026-11-20", al: "2026-11-01" }, …)` (al prima di dal) → mese corrente; `{ mese: "boh" }` → mese corrente.
- [ ] **Step 2:** `npx vitest run tests/unit/assignments/hoursPerson.test.ts` → FAIL (modulo mancante).
- [ ] **Step 3:** Implementa in `src/features/assignments/hoursPerson.ts` (senza import nativi; `monthKey` da `@/lib/format` se è lì, altrimenti da dove lo importa `ore.tsx`).
- [ ] **Step 4:** stesso comando → PASS.
- [ ] **Step 5: Commit** — `feat(hours): regole della riga ore e del periodo nei parametri` (includi spec e piano).

### Task 2: La pagina della persona

**Files:**
- Create: `src/app/(manager)/ore-persona/[id].tsx`
- Modify: `src/app/(manager)/_layout.tsx` (aggiungi `<Stack.Screen name="ore-persona/[id]" options={{ headerShown: false }} />` accanto a `ore`)

**Interfaces:**
- Consumes: Task 1 (`periodFromParams`, `needsCheck`).
- Produces: rotta `/(manager)/ore-persona/<personId>?mese=…` oppure `?dal=…&al=…`; `personId` è `MonthlyReportRow.person_id` (= `workspace_members.id`, lo stesso di `HourToFix.member_id`: verificalo su una riga reale prima di filtrare).

- [ ] **Step 1:** Schermata (`export default`), testata `ScreenHeader` con eyebrow = `periodLabel(period)` e titolo = nome della persona. Dati: gli stessi hook e la stessa catena di `ore.tsx` (`groupHoursByPerson` → `monthlyReportRows`), filtrati con `filterByPeople(…, [id])`; `toFix` filtrato per `member_id === id`; surcharges con `surchargeSummary(rows, id)`.
- [ ] **Step 2:** Contenuto, testi 14–16 pt (`text-sm`/`text-base`, mai `text-xs` per le frasi):
  1. ore lavorate in grande (`text-4xl font-sans-bold text-gold`), sotto «N turni» e ruolo;
  2. card «Dettaglio»: pausa (`breakSummaryText`, con iniziale maiuscola), ogni maggiorazione «di cui», «Assenza riconosciuta X h», «Totale ore coperte X h»;
  3. se `conflict_hours > 0`: «X h di assenza da verificare, escluse dal totale.»; se `untracked_hours > 0`: «X h senza timbratura approvata, escluse dalle ore lavorate.» (`text-warning`);
  4. le sue righe «Ore da sistemare» con lo stesso aspetto e la stessa navigazione al turno di `ore.tsx` (sede mostrata se `isMultiVenue`);
  5. le sue assenze del periodo (ferie, permessi, malattia, certificati) come la card di `ore.tsx`;
  6. link «Apri la scheda nel Team» → `/(manager)/staff/${id}`.
  Caricamento: `ListSkeleton`; errore: `QueryError`; persona assente nei dati: `EmptyState` «Nessuna ora in questo periodo».
- [ ] **Step 3:** `npx tsc --noEmit` → nessun errore (se fallisce solo sulle typed routes, rigenerale col dev server Metro acceso, vedi memoria `expo-typed-routes-regen`).
- [ ] **Step 4:** Prova sul simulatore: apri la rotta per una persona di Da Buffa con `?mese=` del mese corrente; le ore coincidono con la riga della pagina Ore.
- [ ] **Step 5: Commit** — `feat(hours): pagina delle ore di una persona`.

### Task 3: Pagina Ore alleggerita

**Files:**
- Modify: `src/app/(manager)/ore.tsx` (riepilogo ~righe 594–611, elenco persone ~613–647, nota assenze ~652–656)

**Interfaces:**
- Consumes: Task 1 (`needsCheck`, `NEEDS_CHECK_LABEL`, `periodToParams`), Task 2 (rotta).

- [ ] **Step 1: Riepilogo.** Un numero grande (`formatHours(totalHours)`, `text-4xl font-sans-bold text-t1`) con etichetta «Ore lavorate»; sotto, `text-sm text-t3`: «N turni · N persone». Le righe «Assenze riconosciute X h» e «Totale ore coperte X h» (`text-base`) solo se `totalJustified > 0`. Avvisi `totalConflicts` / `totalUntracked`: una riga ciascuno, `text-sm text-warning`, solo se > 0. Il paragrafo «Senza timbratura, le ore…» va dietro un `Pressable` «Come si contano?» (`text-sm text-gold`) che lo mostra/nasconde sul posto (stato locale). Le maggiorazioni escono dal riepilogo.
- [ ] **Step 2: Righe persona.** Ogni riga è un `Pressable` (`accessibilityRole="button"`, label «Ore di <nome>») che fa `router.push({ pathname: "/(manager)/ore-persona/[id]", params: { id: p.person_id, ...periodToParams(period) } })`. Dentro: nome `text-base font-sans-semibold`, sotto ruolo·turni `text-sm text-t3`; a destra ore `text-lg font-sans-bold text-gold` e `Icon chevR`; se `needsCheck(p)` una riga `text-sm font-sans-semibold text-warning` con `NEEDS_CHECK_LABEL`; poi la `ProgressBar`. Rimuovi le righe di pausa, maggiorazioni, «Assenza giustificata · Totale ore coperte» e le due frasi d'avviso.
- [ ] **Step 3: Assenze del periodo.** Sostituisci `ABSENCE_SUMMARY_NOTE` sotto il titolo con una riga breve `text-sm text-t3`: «In giorni di calendario. Il dettaglio è nella pagina di ogni persona.» (la costante resta, la usa il web).
- [ ] **Step 4:** `npx tsc --noEmit && yarn -s lint && npx vitest run` → tutto verde (glossary e colorTokens compresi).
- [ ] **Step 5:** Prova sul simulatore (Da Buffa, novembre): riepilogo con un numero grande; righe corte; tocco su una riga (via navigazione di prova) apre la persona con le stesse ore; export, Maggiorazioni e Codici in fondo come prima.
- [ ] **Step 6: Commit** — `feat(hours): pagina Ore leggibile sul telefono`.
