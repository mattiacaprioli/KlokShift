# Sito vetrina «la settimana viva» Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ridisegnare la home di `web-site/` attorno alla settimana dei turni che prende vita in apertura e si trasforma, scorrendo, in conferma → ore → export.

**Architecture:** Un'unica fonte di dati finti della settimana (`mock/week.ts`) alimenta un componente `WeekBoard` usato in apertura, nella storia e in chiusura. La storia è una sezione a due colonne con l'oggetto sticky che cambia forma via Motion (`layoutId` + `AnimatePresence`), guidata da una funzione pura `activeStep`. Le regole decidibili (passo attivo, nav nascosta, dati della settimana, forma del copy) sono funzioni pure con test vitest; il resto si verifica a vista.

**Tech Stack:** Vite 8 + React 19 + Tailwind v4 (già nel sito), `motion@14.9.0` (`motion/react`), vitest 5.

**Spec:** [docs/superpowers/specs/2026-11-15-sito-vetrina-wow-design.md](../specs/2026-11-15-sito-vetrina-wow-design.md)

## Global Constraints

- Copy **solo** in `web-site/src/content/it.ts`, forma in `types.ts`; nessuna stringa nei componenti (gli aria-label dei mock compresi: vengono dal copy).
- Vietato nel copy: recensioni/QR, annunci/candidature, paghe/buste paga/compensi, referral, numeri di tempo risparmiato, testimonianze. Beta dichiarata; nessun acquisto attivo; JSON-LD di `index.html` non si tocca.
- Glossario: team, dipendente, sede; mai «personale», «organico», «staff», «professionista», «planning», «capacità» (`tests/unit/glossary.test.ts`).
- Esempi misti nei mock: reception, magazzino, cassa, sala, pulizie — mai solo ristorazione; nomi di sede generici.
- Niente font/script esterni; `motion` entra nel bundle e si importa **solo** da `web-site/src`.
- Prezzi solo da `shared/pricing.ts`; footer e pagine legali invariati.
- 375px senza scroll orizzontale della pagina; corpo ≥ 16px; `prefers-reduced-motion` → stati finali, nessuna trasformazione legata allo scroll.
- Palette/font/scala di `web-site/src/index.css` invariati. Via eyebrow e stringhe a puntini dalla home; `InvitePage` non si tocca.
- Lavoro su `main`, **un solo commit alla fine** (preferenza del fondatore); non includere i file già modificati fuori da questo lavoro (`src/app/(manager)/(tabs)/turni.tsx`, `src/components/ui/BottomSheet.tsx`, `src/components/ui/Icon.tsx`).
- `yarn`, mai `npm install`.

## Review Focus

1. **Cambio di larghezza a metà storia** (finestra ridimensionata, tablet ruotato attraverso `lg`): il testo resta uno solo, la colonna sticky compare/scompare senza lasciare un passo «bloccato». → verifica a vista nel Task 6.
2. **Salto da ancora** («Guarda come funziona», voci della nav, `#prezzi` dal mobile): si atterra al passo 1 con l'oggetto giusto; attraversare la storia saltando non lascia l'oggetto a metà transizione. → verifica a vista nel Task 6.
3. **Menu mobile aperto o focus da tastiera dentro la nav** mentre si è scrollati: la nav non deve nascondersi. → test `navHidden` nel Task 5.
4. **Reduced motion**: apertura già completa, storia senza morph (cambio istantaneo), nessuna animazione in chiusura. → test `activeStep` resta valido; verifica a vista con emulazione nel Task 6.
5. **375px**: la settimana a 7 giorni non allarga la pagina (scorre dentro il suo riquadro o mostra 3 giorni). → controllo `scrollWidth` nel Task 6.

---

### Task 1: Motion e la settimana finta

**Files:**
- Modify: `package.json`, `yarn.lock` (via `yarn add motion@14.9.0 --exact`)
- Create: `web-site/src/mock/week.ts`
- Test: `tests/unit/web/siteWeek.test.ts`, `tests/unit/web/motionScope.test.ts`

**Interfaces:**
- Produces (`web-site/src/mock/week.ts`):
  - `export type ShiftState = "draft" | "pending" | "confirmed" | "open"`
  - `export type WeekShift = { person: number; day: number; time: string; role: string; state: ShiftState }` — `person` indice in `WEEK_PEOPLE`, `-1` = «Da coprire»; `day` 0–6.
  - `export const WEEK_DAYS: readonly string[]` — 7 etichette «Lun 16» … «Dom 22».
  - `export const WEEK_PEOPLE: readonly { name: string; initials: string; tone: string }[]` — 5 persone: Giulia (Reception), Marco (Magazzino), Sara (Cassa), Luca (Sala), Anna (Pulizie); `tone` = classe Tailwind di sfondo dell'avatar.
  - `export const WEEK_SHIFTS: readonly WeekShift[]` — 18–22 turni; esattamente **un** `open` (sabato sera, Sala) e **un** `pending` (Sara, venerdì, Cassa); gli altri `confirmed`.
  - `export function draftWeek(shifts: readonly WeekShift[]): WeekShift[]` — stessi turni, tutti `draft`.
  - `export function confirmedWeek(shifts: readonly WeekShift[]): WeekShift[]` — tutti `confirmed`, l'`open` assegnato a Luca (indice 3).

- [ ] **Step 0: Peso di partenza** — prima di toccare qualcosa: `yarn site:build` e annota la dimensione gzip del JS principale (`gzip -c web-site/dist/assets/index-*.js | wc -c`). Serve al Task 6.

- [ ] **Step 1: Write the failing tests**

`siteWeek.test.ts` (import da `../../../web-site/src/mock/week`):
- `it("ha sette giorni e cinque persone")`: `WEEK_DAYS.length === 7`, `WEEK_PEOPLE.length === 5`.
- `it("usa ruoli misti, non solo ristorazione")`: i ruoli distinti di `WEEK_SHIFTS` sono ≥ 5 e includono `"Magazzino"`, `"Cassa"`, `"Pulizie"`.
- `it("ha un solo turno da coprire e uno solo da confermare")`: conteggi `open === 1`, `pending === 1`; l'`open` ha `person === -1`, `day === 5`.
- `it("confirmedWeek conferma tutto e copre il buco")`: nessuno stato ≠ `confirmed`, nessun `person === -1`, stessa lunghezza.
- `it("draftWeek mette tutto in bozza senza toccare orari")`: tutti `draft`, `time` invariati.
- `it("nessun turno doppio nella stessa cella")`: coppie `(person, day)` uniche, `-1` compreso.

`motionScope.test.ts`: scansiona ricorsivamente `src/`, `web/src/`, `shared/` (salta `node_modules`) nei `.ts/.tsx` e si aspetta **zero** file che contengono `from "motion` o `from 'motion`; poi si aspetta **almeno uno** in `web-site/src/` (guardia contro lo scanner vuoto).

- [ ] **Step 2: Run tests to verify they fail**

Run: `yarn vitest run tests/unit/web/siteWeek.test.ts tests/unit/web/motionScope.test.ts`
Expected: FAIL — modulo `week` inesistente; `motionScope` fallisce sulla seconda asserzione.

- [ ] **Step 3: Install Motion and implement `week.ts`**

`yarn add motion@14.9.0 --exact`. Verifica nei tipi installati (`node_modules/motion/react`) che esistano `motion`, `AnimatePresence`, `useScroll`, `useMotionValueEvent`, `useReducedMotion`: la 14 è più nuova della documentazione che conosci, i nomi vanno controllati lì. Scrivi `week.ts` con i dati descritti sopra. La seconda asserzione di `motionScope` passerà dal Task 2.

- [ ] **Step 4: Run tests**

Run: `yarn vitest run tests/unit/web/siteWeek.test.ts`
Expected: PASS. (`motionScope` resta rosso fino al Task 2.)

---

### Task 2: `WeekBoard` e la nuova apertura

**Files:**
- Create: `web-site/src/mock/WeekBoard.tsx`
- Modify: `web-site/src/sections/Hero.tsx`, `web-site/src/sections/Sectors.tsx`, `web-site/src/content/types.ts` (`hero`), `web-site/src/content/it.ts` (`hero`)
- Delete: `web-site/src/mock/AgendaMock.tsx` (non più usato)
- Test: `tests/unit/web/siteCopy.test.ts`

**Interfaces:**
- Consumes: `WEEK_*`, `WeekShift`, `ShiftState` (Task 1).
- Produces: `export function WeekBoard(props: { shifts: readonly WeekShift[]; intro?: boolean; mobileDays?: [number, number]; className?: string }): JSX.Element`
  - Griglia «vista per persona» come l'attuale `PlanningMock` (colonna nomi + 7 giorni + riga «Da coprire» se c'è un `open`), dentro `Shot kind="desktop"`.
  - Stati: `confirmed` bordo sinistro verde + pallino; `pending` bordo oro; `open` tratteggio `error`; `draft` tratteggio neutro, testo attenuato.
  - `intro`: all'montaggio i turni cadono a cascata (ritardo ≈ `person*0.12 + day*0.06` s, totale ≤ 1,6 s), poi si accendono i pallini delle conferme; dopo ~4 s il `pending` di Sara diventa confermato con l'avviso «Sara ha confermato venerdì» (testo dal copy `hero.toast`), e il buco del sabato pulsa piano. **Nessun loop.** Con `useReducedMotion()` → stato finale subito, nessun avviso animato.
  - `mobileDays` (default `[4, 6]`): sotto `sm` si vedono solo quei giorni (ven–dom, dove sta il buco); da `sm` tutti e 7.
  - In apertura, da `lg`, leggera prospettiva (`rotateY ≈ -8deg, rotateX ≈ 4deg`), piatta sotto `lg`.

- [ ] **Step 1: Write the failing test** — `siteCopy.test.ts` (import `it as copy` da `../../../web-site/src/content/it`), helper `homeText()` = `JSON.stringify` di tutte le chiavi di `copy` **tranne** `footer` e `invite`:
  - `it("la home non usa stringhe a puntini")`: `homeText()` non contiene `" · "`.
  - `it("la home non promette cose che il prodotto non fa")`: `homeText()` non corrisponde a `/recension|bust[ae] paga|stipend|compens|candidatur|annunc|referral/i`.
  - `it("l'apertura ha l'avviso di conferma")`: `copy.hero.toast` non vuoto.

- [ ] **Step 2: Run to verify it fails** — `yarn vitest run tests/unit/web/siteCopy.test.ts` → FAIL (`hero.note` ha i puntini, `hero.toast` manca).

- [ ] **Step 3: Implement**
  - `types.ts` `hero`: via `eyebrow`, aggiungi `toast: string` e `boardLabel: string` (alt del riquadro). `it.ts`: `note: "In beta. Senza carta, e alla fine della prova non paghi nulla in automatico."`, `toast: "Sara ha confermato venerdì"`, titolo e lead invariati.
  - `Hero.tsx`: niente `Eyebrow`; griglia `lg:grid-cols-12` con testo `lg:col-span-5`, `WeekBoard intro` `lg:col-span-7`; alone oro dietro la griglia (non al centro).
  - `Sectors.tsx`: titolo in frase normale `text-sm text-t3` (via mono/maiuscole/tracking); resta subito sotto l'apertura.

- [ ] **Step 4: Run** — `yarn vitest run tests/unit/web/siteCopy.test.ts tests/unit/web/motionScope.test.ts tests/unit/web/siteWeek.test.ts && yarn site:typecheck` → PASS.

---

### Task 3: La storia

**Files:**
- Create: `web-site/src/story/progress.ts`, `web-site/src/story/StoryVisual.tsx`, `web-site/src/sections/Story.tsx`, `web-site/src/mock/ExportMock.tsx`
- Modify: `web-site/src/mock/ConfirmMock.tsx`, `web-site/src/mock/HoursMock.tsx` (dati misti: Sara · Cassa · «Sede Centro»; persone e ruoli da `WEEK_PEOPLE`), `types.ts` + `it.ts` (`story`), `web-site/src/App.tsx`
- Test: `tests/unit/web/storyProgress.test.ts`, `tests/unit/web/siteCopy.test.ts`

**Interfaces:**
- Consumes: `WeekBoard`, `draftWeek`, `WEEK_SHIFTS` (Task 1–2); `Shot` (esistente).
- Produces:
  - `export function activeStep(progress: number, steps: number): number` in `story/progress.ts`.
  - `export function StoryVisual(props: { step: number }): JSX.Element` — 0: `WeekBoard` con `draftWeek` che diventa pubblicata (tratteggio → pieno); 1: `Shot kind="phone"` con `ConfirmMock`; 2: `Shot kind="phone"` con entrata/uscita poi `HoursMock`; 3: `ExportMock`. La cornice esterna ha `layoutId="story-frame"` (morph desktop → telefono → tabella → file); il contenuto cambia con `AnimatePresence mode="popLayout"`. Con reduced motion: `transition={{ duration: 0 }}`.
  - `export function Story(): JSX.Element` — `<section id="come-funziona">`.
  - Copy: `story: { title: string; steps: { before: string; title: string; body: string }[] }`.

- [ ] **Step 1: Write the failing tests**

`storyProgress.test.ts`:
```ts
it.each([[0,0],[0.24,0],[0.25,1],[0.5,2],[0.999,3],[1,3],[-0.1,0],[1.5,3],[NaN,0]])(
  "activeStep(%s, 4) = %s", (p, s) => expect(activeStep(p, 4)).toBe(s));
```
`siteCopy.test.ts`, aggiungi `it("la storia ha quattro passi completi")`: `copy.story.steps.length === 4`, ogni `before/title/body` non vuoto, ogni `before` inizia con `"Prima:"`.

- [ ] **Step 2: Run to verify they fail** — `yarn vitest run tests/unit/web/storyProgress.test.ts tests/unit/web/siteCopy.test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `activeStep`: `NaN`/negativi → 0, poi `Math.min(steps - 1, Math.floor(progress * steps))`.
  - Copy (`it.ts`), da rileggere con il fondatore a fine lavoro:
    - `title: "Una settimana, dall'inizio alla fine."`
    - 1 · `before: "Prima: il turno scritto nel gruppo, sperando che lo leggano."` · `title: "Prepari in bozza, poi pubblichi."` · `body: "Il team non vede niente finché non sei pronto. Quando pubblichi arriva una notifica a testa."`
    - 2 · `before: "Prima: «hai visto il messaggio?»"` · `title: "Il team conferma con un tocco."` · `body: "Dall'app per i dipendenti, gratuita. Vedi subito chi ha risposto e chi manca."`
    - 3 · `before: "Prima: le ore contate a memoria a fine mese."` · `title: "Si timbra dal telefono."` · `body: "Entrata, uscita e pausa. Le ore del mese si sommano da sole."`
    - 4 · `before: "Prima: il foglio da ricopiare per il consulente."` · `title: "Il consulente riceve tutto."` · `body: "Ore, pause e assenze in PDF o CSV, pronti da mandare."`
  - `Story.tsx`: un solo elenco di passi (il testo non si duplica mai). Da `lg`: due colonne, passi a sinistra alti `min-h-[80vh]` con passo attivo in `text-t1` e gli altri `text-t3`; a destra colonna `sticky top-0 h-screen` con `StoryVisual step={active}`, nascosta sotto `lg`. `active` da `useScroll({ target: sectionRef, offset: ["start center", "end center"] })` + `useMotionValueEvent(…, "change", p => setActive(activeStep(p, 4)))`. Sotto `lg`: ogni passo porta sotto di sé il proprio visual statico (`lg:hidden`, dentro `Reveal`). Numeri 1–4 accanto ai titoli (qui è una sequenza vera).
  - `ExportMock.tsx`: anteprima di un CSV (intestazione Matricola/Persona/Giorno/Voce/Ore, 4 righe con voci «Lavoro» e «Ferie») con due pulsanti finti «PDF» e «CSV»; niente euro.
  - `App.tsx`: `Story` al posto di `Problem` e `HowItWorks`, subito dopo `Sectors`.

- [ ] **Step 4: Run** — `yarn vitest run tests/unit/web && yarn site:typecheck` → PASS.

---

### Task 4: Il resto, calmo

**Files:**
- Create: `web-site/src/sections/Rest.tsx`
- Modify: `web-site/src/ui/Section.tsx` (via prop `eyebrow`; `Eyebrow` resta esportato per `InvitePage`), `web-site/src/sections/Plans.tsx`, `web-site/src/sections/Faq.tsx`, `web-site/src/App.tsx`, `types.ts` + `it.ts` (`rest`; via `problem`, `venue`, `pro`, `how`, `plans.eyebrow`, `faq.eyebrow`)
- Delete: `sections/Problem.tsx`, `sections/HowItWorks.tsx`, `sections/ForVenues.tsx`, `sections/ForPros.tsx`, `mock/PlanningMock.tsx`, `ui/Card.tsx` — ciascuno solo dopo `grep -rn` che non trovi altri import.
- Test: `tests/unit/web/siteCopy.test.ts`

**Interfaces:**
- Produces: `export function Rest(): JSX.Element` — `<Section id="funzioni">`; copy `rest: { title: string; items: { title: string; body: string }[] }`.

- [ ] **Step 1: Write the failing test** — in `siteCopy.test.ts`: `it("il listino dice ancora che siamo in beta")`: `copy.plans.lead` contiene `"beta"` e `copy.plans.title` o `copy.plans.lead` contiene `"lancio"` (il senso dell'ex eyebrow «Listino previsto al lancio» non si perde); `it("il resto ha da sei a otto voci")`.

- [ ] **Step 2: Run to verify it fails** — FAIL (`rest` manca, `lancio` non c'è).

- [ ] **Step 3: Implement**
  - Copy `rest.title: "E poi, tutto il resto."`; voci (titolo · testo):
    - «Più sedi, una persona sola» · «Chi lavora in due sedi ha una scheda sola, e conta una volta.»
    - «Ferie, permessi e malattia» · «Si chiedono dall'app, li approvi tu, e la settimana te li mostra.»
    - «Cambio turno» · «Chi non può chiede il cambio, tu approvi.»
    - «Documenti con le scadenze» · «Contratti e attestati, con l'avviso prima che scadano.»
    - «Giorni di chiusura» · «Ferragosto, ferie della sede, chiuso il lunedì: tutto sul calendario.»
    - «Il team entra con la sua email» · «Aggiungi l'indirizzo: chi si registra con quello trova già la sua sede.»
    - «Modelli di turno» · «Salvi un turno tipo e lo riusi in un tocco.»
  - `plans.lead`: `"Listino previsto al lancio, stesse funzioni in entrambi. In beta si prova gratis: gli acquisti non sono ancora attivi."`
  - `Rest.tsx`: griglia tipografica senza card — `sm:grid-cols-2 lg:grid-cols-3`, ogni voce titolo serif + testo `text-t2`, separatori `border-t border-border`; nessuna icona in cerchio, nessuna ombra.
  - `Plans.tsx` / `Faq.tsx`: niente eyebrow; nessun altro cambio di logica.
  - `App.tsx`: `Nav · Hero · Sectors · Story · Rest · Plans · Faq · FinalCta · Footer · MobileCta`.

- [ ] **Step 4: Run** — `yarn vitest run tests/unit/web tests/unit/glossary.test.ts tests/unit/webPricing.test.ts && yarn site:typecheck && yarn lint` → PASS.

---

### Task 5: Nav che si nasconde e chiusura confermata

**Files:**
- Create: `web-site/src/ui/navScroll.ts`
- Modify: `web-site/src/sections/Nav.tsx`, `web-site/src/sections/FinalCta.tsx`
- Test: `tests/unit/web/navScroll.test.ts`

**Interfaces:**
- Produces: `export function navHidden(s: { prevY: number; y: number; wasHidden: boolean; menuOpen: boolean; focusInside: boolean }): boolean`
  - `menuOpen || focusInside || y <= 80` → `false`; `y - prevY > 4` → `true`; `prevY - y > 4` → `false`; altrimenti `wasHidden`.

- [ ] **Step 1: Write the failing test** — `navScroll.test.ts`: in cima (`y: 40`, scende) → `false`; scende oltre 80 di 10px → `true`; risale di 10px → `false`; tremolio di 2px → mantiene `wasHidden` (entrambi i valori); `menuOpen: true` mentre scende → `false`; `focusInside: true` mentre scende → `false`.

- [ ] **Step 2: Run to verify it fails** — `yarn vitest run tests/unit/web/navScroll.test.ts` → FAIL.

- [ ] **Step 3: Implement**
  - `Nav.tsx`: listener `scroll` passivo con `requestAnimationFrame`, stato `hidden` da `navHidden`; `focusInside` = `headerRef.current?.contains(document.activeElement)`; `translate-y-[-100%]` + transizione 300 ms, nessuna transizione con reduced motion (regola in `index.css`).
  - `FinalCta.tsx`: sopra il titolo `WeekBoard shifts={confirmedWeek(WEEK_SHIFTS)}` statica (niente `intro`), larghezza `max-w-4xl`, centrata; testi invariati.

- [ ] **Step 4: Run** — `yarn vitest run tests/unit/web && yarn site:typecheck && yarn lint` → PASS.

---

### Task 6: Verifica completa e commit

**Files:** nessuno nuovo (solo correzioni emerse).

- [ ] **Step 1: Suite completa** — `yarn test:unit && yarn site:typecheck && yarn lint` → tutto verde.
- [ ] **Step 2: Build e peso** — `yarn site:build`, stessa misura del Task 1 Step 0; atteso aumento ≤ 60 KB gzip. Se è di più, controlla che `motion/react` non porti dentro moduli inutili (import nominati, niente `import *`).
- [ ] **Step 3: Prova a vista** — `yarn site:preview`; con Chrome headless (`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --headless --screenshot --window-size=W,H`) screenshot a 1440×900, 1024×768, 375×812 dell'apertura; leggili e confronta con la bozza A. Poi controlla nel browser del fondatore (chiedigli) storia, salto da ancora (Review Focus 2), ridimensionamento attraverso `lg` (1), reduced motion emulato da DevTools (4).
- [ ] **Step 4: 375px senza scroll orizzontale** — headless `--dump-dom` non basta: con `--remote-debugging-port` o a mano in DevTools, `document.documentElement.scrollWidth <= 375` a 375px (Review Focus 5).
- [ ] **Step 5: Rilettura del copy** — mostra al fondatore le chiavi nuove (`hero.note`, `story`, `rest`, `plans.lead`) e applica le correzioni.
- [ ] **Step 6: Commit unico**

```bash
git add web-site/ tests/unit/web/ package.json yarn.lock docs/superpowers/specs/2026-11-15-sito-vetrina-wow-design.md docs/superpowers/plans/2026-11-15-sito-vetrina-wow.md
git status   # verificare che turni.tsx, BottomSheet.tsx, Icon.tsx NON siano in stage
git commit -m "feat(sito): la settimana viva — apertura animata e storia a scorrimento

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
Niente push: lo chiede il fondatore.
