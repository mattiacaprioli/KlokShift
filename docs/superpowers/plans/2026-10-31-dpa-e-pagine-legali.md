# DPA e pagine legali — piano di implementazione

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dare a KlokShift un accordo sul trattamento dei dati (art. 28) costruito
sulle clausole tipo UE e accettato in modo esplicito e registrato. Privacy,
termini e rimborsi vanno riscritti per combaciare con lui e con il prodotto
reale. Si aggiungono le pagine sub-responsabili, sicurezza e la scheda per
l'informativa ai dipendenti, più le due correzioni al prodotto che servono
perché i testi dicano il vero (push delle malattie neutre, font in casa).

**Architecture:** L'accettazione è una tabella privata scritta solo da RPC. Si
registra alla creazione dell'azienda (nuovo parametro facoltativo di
`create_workspace`) o da un'RPC dedicata. Un gate lato client (app
`(manager)/_layout.tsx`, web `Dashboard` in `web/src/App.tsx`) blocca la vista di
gestione finché un titolare non ha accettato la versione in vigore; i dipendenti
non sono mai bloccati. Le pagine legali sono HTML statico in
`web-site/public/`, con la versione nel testo. Un test vitest ne verifica la
coerenza (fornitori, versioni, link, promesse vietate).

**Tech Stack:** Supabase/Postgres 17 (migration + banco SQL `supabase/tests`),
Expo Router + React Query (app), Vite + React (dashboard `web/` e sito
`web-site/`), vitest, yarn.

**Spec:** [docs/superpowers/specs/2026-10-31-dpa-e-pagine-legali-design.md](../specs/2026-10-31-dpa-e-pagine-legali-design.md)

## Global Constraints

- **Niente commit né push**: l'utente accorpa e committa da sé. Ogni task finisce con le modifiche pronte e verificate.
- Package manager **yarn** (mai npm). Lint: `yarn lint`. Type-check: `npx tsc --noEmit`. Unit: `yarn vitest run <path>`.
- Migration nuove con timestamp dopo `20261101000600`; **mai modificare una migration già esistente** (il remoto la salterebbe). Dopo una migration: `supabase/tests/run.sh reset && supabase/tests/run.sh test`, poi `supabase/tests/gen-types.sh` per `src/types/database.ts` (mai a mano).
- Scritture solo da RPC `security definer set search_path = ''`, errori `raise exception '<codice>'` tradotti in `src/lib/errors.ts`. Se si aggiunge una funzione eseguibile da `authenticated`, va allineato `supabase/tests/rls/050_surface.sql`.
- Stringhe utente in italiano inline, col glossario (`docs/GLOSSARIO.md`, `tests/unit/glossary.test.ts`): team, dipendente, sede; mai «personale», «professionista», «staff», «datore di lavoro». Il ripiego «Un professionista» negli SQL che si riscrivono diventa «Un dipendente».
- L'app nativa non mostra prezzi né checkout.
- Componenti con `className` da `@/tw`; nessun `<Link className>` per testo tappabile (`Pressable` + `useRouter().push()`); nessun `console.log`.
- Indirizzi esistenti invariati: `privacy.html`, `termini.html`, `rimborsi.html`, `elimina-account.html`.
- Valori fissati dal fondatore: violazione dei dati comunicata **senza ingiustificato ritardo e al massimo entro 48 ore**; nuovo sub-responsabile con **preavviso di 15 giorni**, opposizione → solo disdetta, **senza rimborso**; archivio di **12 mesi** da `operational_until`, poi cancellazione **entro 30 giorni**; blocco delle aziende esistenti al primo accesso; anteprima della chat nelle push **invariata**.
- Versione legale in vigore: **`"1"`**, unica per la coppia termini + DPA. La costante esiste in un solo punto SQL e in un solo punto TS.
- Nessuna promessa di backup finché non esistono; MFA per chi gestisce e controllo delle password violate dichiarati **assenti**.

## Review Focus

1. **Titolare di più aziende, una sola da accettare**: il gate elenca solo quella. Dopo l'accettazione entra senza ricaricare l'app. → test SQL in Task 1, test del gate in Task 3.
2. **Collaboratore in un'azienda da accettare**: vede il blocco con «deve accettare il titolare», senza pulsante. L'RPC gli rifiuta l'accettazione (`owner_only`). → Task 1, Task 3.
3. **Chi è dipendente di W1 (da accettare) e titolare di W2 (accettata)**: la vista di gestione su W2 è libera e la vista lavoro non è mai bloccata. → Task 1 (`get_pending_legal_acceptances` non restituisce W1 a un dipendente), Task 3.
4. **Client vecchio che manda una versione superata**: `legal_version_outdated`, poi il gate si aggiorna e mostra il testo nuovo. → Task 1, Task 2 (errore tradotto).
5. **Cambio account sullo stesso dispositivo**: il gate non usa la risposta dell'utente precedente. La chiave React Query contiene l'id utente. → Task 2.

---

### Task 1: Accettazioni nel database

**Files:**
- Create: `supabase/migrations/20261102000000_legal_acceptances.sql`
- Create: `supabase/tests/rls/150_legal_acceptances.sql`
- Modify: `supabase/tests/rls/050_surface.sql` (nuove funzioni eseguibili)
- Modify: `src/types/database.ts` (rigenerato)

**Interfaces:**
- Produces:
  - `private.legal_acceptances(id uuid pk default gen_random_uuid(), workspace_id uuid not null references public.workspaces on delete cascade, user_id uuid not null references public.profiles, version text not null, accepted_at timestamptz not null default now(), unique (workspace_id, version))`, con RLS attiva e nessuna policy.
  - `private.current_legal_version() returns text`: restituisce `'1'`.
  - `public.accept_legal_terms(p_workspace uuid, p_version text) returns void`.
  - `public.get_pending_legal_acceptances() returns table (workspace_id uuid, workspace_name text, can_accept boolean)`.
  - `public.create_workspace(p_name text, p_legal_version text default null) returns uuid`: sostituisce la versione a un argomento (drop + create, stessi grant).
  - Codici d'errore: `legal_version_outdated`, `owner_only` (esistente), `not_authenticated` (esistente).

- [ ] **Step 1: Scrivere il test SQL `150_legal_acceptances.sql`** (stile di `142_admin_activation.sql`: `begin; … rollback;`, fixture del seed `Ow`/`Co`/`Emp`/`W1`/`W2`). Asserzioni:
  - `tests.login('Ow')`: `get_pending_legal_acceptances()` contiene W1 con `can_accept = true`.
  - `tests.login('Co')`: contiene W1 con `can_accept = false`. `accept_legal_terms(W1,'1')` solleva `owner_only`.
  - `tests.login('Emp')`: contiene W2 (ne è titolare), **non** W1 (lì è solo dipendente).
  - `tests.login('Ow')`: `accept_legal_terms(W1,'0')` solleva `legal_version_outdated`.
  - `accept_legal_terms(W1,'1')` va a buon fine e ripeterlo non solleva (idempotente).
  - Dopo l'accettazione `get_pending_legal_acceptances()` non contiene più W1, né per `Ow` né per `Co`.
  - `create_workspace('Nuova', '1')` restituisce un id che non compare fra le pendenti. `create_workspace('Altra')` (senza versione) restituisce un id che compare.
  - `create_workspace('X', '0')` solleva `legal_version_outdated`.
  - Come `anon`: `get_pending_legal_acceptances()` solleva `permission denied`.

- [ ] **Step 2: Lanciare e vedere fallire**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: FAIL su `150_legal_acceptances.sql` (funzione inesistente).

- [ ] **Step 3: Scrivere la migration.** Le pendenti sono le aziende con `deleted_at is null` in cui il chiamante è membro `status = 'active'` con `authority in ('owner','collaborator')`, senza una riga per `private.current_legal_version()`. In `create_workspace` la riga si inserisce nella stessa transazione, solo se `p_legal_version` non è nullo, dopo averla confrontata con la versione in vigore. Il resto del corpo è identico a `20260920000600_workspace_rpcs.sql:86-118`. `accept_legal_terms` inserisce con `on conflict (workspace_id, version) do nothing`. Grant di esecuzione a `authenticated` come le altre RPC, revoca a `public`/`anon`. Commento in testa: è il registro dell'art. 28, par. 9 (accordo in forma elettronica) e il server non blocca le operazioni, apposta: il blocco è nella vista di gestione, i dipendenti non si fermano.

- [ ] **Step 4: Allineare `050_surface.sql`** alle due nuove funzioni e alla nuova firma di `create_workspace`.

- [ ] **Step 5: Lanciare e vedere passare**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: tutte le suite PASS.

- [ ] **Step 6: Rigenerare i tipi**

Run: `supabase/tests/gen-types.sh && npx tsc --noEmit`
Expected: `src/types/database.ts` contiene `accept_legal_terms`, `get_pending_legal_acceptances` e `create_workspace` con `p_legal_version?`; tsc pulito.

---

### Task 2: Data layer legale condiviso (app + web)

**Files:**
- Create: `src/features/legal/version.ts`, `src/features/legal/api.ts`, `src/features/legal/hooks.ts`, `src/features/legal/gate.ts`
- Modify: `src/features/account/legal.ts` (nuovi indirizzi)
- Modify: `src/features/workspace/api.ts:83-135` (`createWorkspace`, `createFirstVenue`)
- Modify: `src/lib/queryKeys.ts`, `src/lib/errors.ts`
- Test: `tests/unit/account/legal.test.ts`, `tests/unit/legal/gate.test.ts`

**Interfaces:**
- Consumes: le RPC del Task 1.
- Produces:
  - `export const LEGAL_VERSION = "1"` (`version.ts`), gemello **manuale** di `private.current_legal_version()`. Il commento lo dice.
  - `legalUrlsFor()` restituisce in più `dpa`, `subprocessors`, `security`, `teamData` → `/dpa.html`, `/sub-responsabili.html`, `/sicurezza.html`, `/dati-del-team.html`.
  - `type PendingLegal = { workspaceId: string; workspaceName: string; canAccept: boolean }`
  - `getPendingLegalAcceptances(): Promise<PendingLegal[]>` e `acceptLegalTerms(workspaceId: string): Promise<void>` (manda sempre `LEGAL_VERSION`).
  - `usePendingLegalAcceptances(userId: string | undefined)` (chiave `qk.legal.pending(userId)`) e `useAcceptLegalTerms()` (alla riuscita invalida `qk.legal.pending` e tutto ciò che dipende dalle appartenenze, come `useInvalidateEverything`).
  - `legalGate(rows: PendingLegal[]): { blocked: boolean; toAccept: PendingLegal[]; waiting: PendingLegal[] }`: `blocked` se c'è almeno una riga.
  - `createWorkspace(name: string, legalVersion?: string)`. `NewVenueInput` riceve `acceptedLegal?: boolean`, e `createFirstVenue` passa `LEGAL_VERSION` quando è vero.
  - `errors.ts`: `legal_version_outdated` → «I termini sono stati aggiornati. Rileggili e accetta di nuovo.»

- [ ] **Step 1: Scrivere i test che falliscono**
  - `legal.test.ts`: i due `toEqual` esistenti includono le quattro nuove chiavi con gli indirizzi sopra.
  - `gate.test.ts`:
    - `legalGate([])` → `{ blocked: false, toAccept: [], waiting: [] }`;
    - con una riga `canAccept: true` e una `false` → `blocked: true`, una in `toAccept` e una in `waiting`.

- [ ] **Step 2: Lanciare e vedere fallire**

Run: `yarn vitest run tests/unit/account/legal.test.ts tests/unit/legal/gate.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implementare i moduli** con le firme sopra. Le API seguono lo stile di `src/features/workspace/api.ts`: `error` → `throw new Error(error.message)`.

- [ ] **Step 4: Lanciare e vedere passare**

Run: `yarn vitest run tests/unit/account tests/unit/legal && npx tsc --noEmit`
Expected: PASS, tsc pulito.

---

### Task 3: Casella alla creazione e blocco della gestione

**Files:**
- Create: `src/features/legal/LegalAcceptanceScreen.tsx` (app), `web/src/pages/AccettaTermini.tsx` (web)
- Modify: `src/app/(manager)/_layout.tsx`, `web/src/App.tsx` (funzione `Dashboard`, dopo `if (!canManage)`)
- Modify: `src/features/venues/VenueFormView.tsx`, `src/features/workspace/OpenWorkspaceSection.tsx`, `web/src/pages/NotForWaiters.tsx`, e ogni altro chiamante di `useCreateFirstVenue` (cercarli con grep)
- Test: `tests/unit/legal/acceptanceCopy.test.ts`

**Interfaces:**
- Consumes: `usePendingLegalAcceptances`, `useAcceptLegalTerms`, `legalGate`, `LEGAL_URLS`, `acceptedLegal` (Task 2).
- Produces: `export const LEGAL_COPY` in `src/features/legal/copy.ts` (testi condivisi app e web):
  - `checkbox`: «Accetto i termini e l'accordo sul trattamento dei dati per conto dell'azienda.»
  - `title`: «Termini e accordo sul trattamento dei dati»
  - `body`: «Per continuare a gestire {azienda} serve l'accettazione dei termini e dell'accordo sul trattamento dei dati del team. Basta quella di un titolare.»
  - `waiting`: «Il titolare di {azienda} deve accettare i nuovi termini. Finché non lo fa, la gestione resta ferma; i turni e le timbrature del team continuano.»
  - `accept`: «Accetto»

- [ ] **Step 1: Test del testo**: `acceptanceCopy.test.ts` verifica che `LEGAL_COPY` non contenga parole vietate dal glossario. Usare le stesse regex di `tests/unit/glossary.test.ts`, oppure aggiungere `src/features/legal` alla sua scansione se è già coperta da `"src"`. In quel caso questo test si riduce a controllare che `checkbox` contenga «trattamento dei dati».

- [ ] **Step 2: Casella nei form di creazione.** Non preselezionata, con i link a termini e DPA aperti come gli altri link legali dell'app (`legal.ts`) o in una nuova scheda sul web. Il pulsante di creazione è disabilitato finché la casella non è spuntata. La mutation passa `acceptedLegal: true`. Usare la primitive di casella già presente nel design system: cercarla in `src/components/ui` e `web/src/ui`. Se non c'è, `Pressable` + `Icon` in app e `<input type="checkbox">` sul web.

- [ ] **Step 3: Gate.**
  - **App:** in `(manager)/_layout.tsx`, se `legalGate(...).blocked`, si rende `LegalAcceptanceScreen` al posto dello `Stack`. La schermata ha:
    - un riquadro per ogni azienda in `toAccept`, con i link e il pulsante «Accetto»;
    - un riquadro per ogni azienda in `waiting`, solo testo;
    - per chi ha anche la vista lavoro, l'interruttore della vista già esistente, così da poter passare a «lavoro».
  - **Web:** stessa logica nella funzione `Dashboard` con `AccettaTermini`, più il pulsante «Esci».
  - Mentre la query carica, si usa lo stesso scheletro o splash già in uso.
  - In errore: riprova, senza sbloccare.
  - La rotta `/invito` e l'area del fondatore restano davanti al gate, come oggi.

- [ ] **Step 4: Verifica**

Run: `yarn vitest run tests/unit/legal tests/unit/glossary.test.ts && npx tsc --noEmit && yarn lint`
Expected: PASS, nessun errore di lint.

- [ ] **Step 5: Prova a mano sul banco locale o sul progetto di test** (da annotare in `docs/TEST-LEGAL-ACCEPTANCE.md`, stile delle altre `docs/TEST-*`):
  1. Titolare di un'azienda esistente → blocco → «Accetto» → entra.
  2. Collaboratore della stessa azienda prima dell'accettazione → testo d'attesa, nessun pulsante.
  3. Dipendente → nessun blocco.
  4. Nuova azienda dal form con la casella → nessun blocco dopo la creazione.

---

### Task 4: Notifiche delle malattie neutre

**Files:**
- Create: `supabase/migrations/20261102000100_absence_notifications_neutral.sql`
- Modify: `supabase/tests/rls/026_absence_hour_credits.sql`, oppure il test delle assenze che già controlla `request_absence` (cercare `request_absence` in `supabase/tests/rls/`)

**Interfaces:**
- Consumes: le definizioni in vigore di `public.request_absence` e `public.withdraw_absence` (oggi in `20261031000100_absences_out_of_chat.sql`). Va controllato anche `public.resolve_absence`: se il suo testo nomina la malattia, entra in questa migration.
- Produces: testi per `kind = 'malattia'`:
  - titolo «Nuova assenza», testo `<nome> ha comunicato un'assenza <range>`;
  - all'annullamento: `<nome> ha annullato un'assenza <range>`.
  - Ferie e permessi invariati. Ripiego del nome: «Un dipendente».
  - Il tipo `absence_sick` resta: serve all'app per aprire Assenze e alla categoria delle preferenze.

- [ ] **Step 1: Test che fallisce.** Un dipendente comunica una malattia. Per il titolare, la notifica nuova in `public.notifications` ha `title = 'Nuova assenza'` e `body` che non contiene `malattia`, in nessuna maiuscola o minuscola. Dopo `withdraw_absence` su una malattia approvata, il `body` non contiene `malattia`. Una richiesta di ferie conserva `title = 'Richiesta di ferie'`.

- [ ] **Step 2: Lanciare e vedere fallire**

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: FAIL sulle nuove asserzioni.

- [ ] **Step 3: Migration** con `create or replace` delle funzioni, copiate dalla definizione in vigore e cambiate **solo** nei testi. Commento in testa: la push passa da Expo (USA), Apple e Google e compare sullo schermo bloccato, quindi la malattia non si nomina. Il dettaglio sta nella pagina Assenze.

- [ ] **Step 4: Lanciare e vedere passare**, poi `supabase/tests/gen-types.sh` (nessuna differenza attesa nei tipi).

Run: `supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: PASS.

---

### Task 5: Font in casa su sito e dashboard

**Files:**
- Create: `shared/fonts.css`
- Modify: `web/index.html`, `web-site/index.html`, `web-site/invito.html` (via i `<link>` a Google), `web/src/index.css`, `web-site/src/index.css` (import di `../../shared/fonts.css` o il percorso relativo corretto)
- Modify: `package.json` (dev dependency dei font)
- Test: `tests/unit/web/noExternalFonts.test.ts`

**Interfaces:**
- Produces: le stesse famiglie e pesi di oggi.
  - **Fraunces:** asse `opsz` 9–144, `wght` 400/600/700.
  - **Inter:** 400/500/600/700.
  - **IBM Plex Mono:** 500.
  - Sottoinsiemi latin e latin-ext, `font-display: swap`, file serviti dal bundle Vite.

- [ ] **Step 1: Test che fallisce.** `noExternalFonts.test.ts` legge `web/index.html`, `web-site/index.html` e `web-site/invito.html`, più ogni `.css` sotto `web/src`, `web-site/src` e `shared`. Si aspetta che nessuno contenga `fonts.googleapis.com` o `fonts.gstatic.com`.

- [ ] **Step 2: Lanciare e vedere fallire**

Run: `yarn vitest run tests/unit/web/noExternalFonts.test.ts`
Expected: FAIL su 3 file.

- [ ] **Step 3: Aggiungere i font**:
  - `yarn add -D @fontsource/inter @fontsource/ibm-plex-mono` più un pacchetto Fraunces con l'asse `opsz`. Verificare quale pacchetto Fontsource lo include, per esempio la variante «full» di `@fontsource-variable/fraunces`. Se nessuno lo include, usare file woff2 nel repo sotto `shared/fonts/`, con la licenza OFL accanto.
  - Importarli in `shared/fonts.css`.
  - Togliere `preconnect` e `<link>` dai tre HTML.

- [ ] **Step 4: Verifica**

Run: `yarn vitest run tests/unit/web && yarn web:build && yarn site:build && ! grep -rE "fonts\.(googleapis|gstatic)\.com" web/dist web-site/dist`
Expected: test PASS, build riuscite, grep senza risultati. Il percorso di output va confermato in `vite.config` dei due progetti.

- [ ] **Step 5: Prova visiva**: `yarn site:dev` e la dashboard in locale. I titoli in Fraunces e il testo in Inter appaiono come prima. Nel pannello Rete del browser non c'è nessuna richiesta a Google.

---

### Task 6: Elenco dei sub-responsabili verificato

**Files:**
- Create: `web-site/public/sub-responsabili.html`
- Create: `docs/privacy/fornitori.md` (interno: fonti consultate, date, azioni del fondatore)

**Interfaces:**
- Produces: l'elenco nominale, che i Task 7–9 citano con gli stessi nomi. Fornitori attesi:
  - Supabase: database, autenticazione, file e realtime, UE `eu-central-1`;
  - Expo (650 Industries): invio delle push;
  - Apple: APNs;
  - Google: Firebase Cloud Messaging;
  - Resend: email;
  - GitHub: Pages, che ospita sito e dashboard.
  - Paddle **non** è un sub-responsabile: è titolare autonomo. Va in una nota a parte nella pagina. Sentry non compare finché non è attivo.

- [ ] **Step 1: Verifica sulle fonti dei fornitori.** Per ciascuno registrare in `docs/privacy/fornitori.md`, con URL e data di consultazione:
  - ragione sociale e sede;
  - dati che riceve da KlokShift: per Expo, Apple e Google il token del dispositivo, il titolo e il testo della notifica, compresa l'anteprima della chat; per Resend indirizzo e testo delle email;
  - luogo del trattamento;
  - esistenza di un DPA del fornitore e come lo si accetta;
  - garanzia per il trasferimento: certificazione EU-US Data Privacy Framework (da verificare sull'elenco ufficiale dataprivacyframework.gov) oppure clausole tipo.

  **Una garanzia non trovata non si scrive.** Si annota come «da verificare» e si segnala al fondatore prima di pubblicare.

- [ ] **Step 2: Elenco delle azioni del fondatore** in `docs/privacy/fornitori.md`: accettare o firmare i DPA di Supabase (dashboard → Legal), Expo, Resend, GitHub e Google, con una casella da spuntare per ciascuno.

- [ ] **Step 3: Scrivere la pagina.**
  - Stesso `<style>` e struttura di `privacy.html`.
  - In testa: «Versione 1 · in vigore dal <data di pubblicazione>».
  - Una tabella con: fornitore, scopo, dati, luogo, garanzia.
  - Un paragrafo su come avvisiamo di un nuovo fornitore: email ai titolari **15 giorni** prima; chi si oppone può fermare i rinnovi e disdire, **senza rimborso** del periodo già pagato.
  - Uno «Storico delle modifiche» con la sola riga della versione 1.

---

### Task 7: Sicurezza e scheda per l'informativa ai dipendenti

**Files:**
- Create: `web-site/public/sicurezza.html`, `web-site/public/dati-del-team.html`

**Interfaces:**
- Consumes: i fatti del §3 della spec (da ricontrollare se il codice è cambiato) e i nomi del Task 6.
- Produces: i testi che il DPA riprende come Allegato III (`sicurezza.html`) e Allegato II (`dati-del-team.html`).

- [ ] **Step 1: `sicurezza.html`**, «Versione 1».
  - **Misure nostre:**
    - controllo degli accessi riga per riga per persona e azienda;
    - scritture solo da funzioni controllate, verificate da test automatici a ogni modifica;
    - documenti in archivio privato, foto profilo pubbliche;
    - inviti con codice monouso di cui conserviamo solo l'impronta;
    - nessuna posizione GPS;
    - area del fondatore con verifica in due passaggi e registro degli interventi, senza lettura di chat, documenti e note;
    - una sola persona autorizzata ad accedere ai dati (il fondatore), solo per assistenza richiesta, incidenti od obblighi di legge.
  - **Misure del fornitore:** cifratura in transito e a riposo, isolamento, data center UE. Vanno citate dalla documentazione Supabase con la data.
  - **«Cosa non c'è ancora»:**
    - copie di sicurezza (backup) del database: un guasto grave del fornitore può far perdere dati;
    - verifica in due passaggi per titolari e collaboratori;
    - blocco delle password già comparse in violazioni note.
  - **Violazioni:** avviso ai titolari senza ingiustificato ritardo e **al massimo entro 48 ore** da quando ce ne accorgiamo.

- [ ] **Step 2: `dati-del-team.html`**, «Versione 1». Rivolta all'azienda: «Testo da inserire nella tua informativa ai dipendenti». Sezioni:
  - chi è titolare (l'azienda) e chi è responsabile (KlokShift, con i dati di contatto);
  - quali dati, con le categorie del §3. Dati particolari: date di malattia, eventuale protocollo INPS, eventuali certificati caricati;
  - perché: organizzare turni, presenze, ore, assenze, documenti e comunicazioni di lavoro;
  - dove stanno: UE, più i fornitori del Task 6 con il link;
  - le notifiche sul telefono, con l'anteprima dei messaggi, passano da Expo, Apple e Google;
  - quanto si conservano: finché l'azienda usa il servizio, poi 12 mesi di archivio e cancellazione entro 30 giorni; se l'azienda lo chiede, prima;
  - le garanzie sulla malattia: visibile solo a chi gestisce il team; i colleghi vedono l'assenza senza il tipo; notifiche senza la parola. Vanno ricontrollate nel codice (`get_staff_planning` e la visibilità delle assenze) prima di scriverle;
  - a chi chiedere: all'azienda; le richieste che arrivano a KlokShift le giriamo all'azienda.

  Nessuna base giuridica per conto dell'azienda: la sceglie lei. Una frase lo dice.

---

### Task 8: Accordo sul trattamento dei dati (`dpa.html`)

**Files:**
- Create: `web-site/public/dpa.html`

**Interfaces:**
- Consumes: Task 6 e 7 (Allegati II, III e IV per rimando con versione), valori dei Global Constraints.

- [ ] **Step 1: Testo delle clausole.** Riportare fedelmente il testo italiano ufficiale della Decisione di esecuzione (UE) 2021/915 della Commissione, del 4 giugno 2021. Fonte: EUR-Lex, CELEX `32021D0915`, versione IT. Le opzioni:
  - clausola 5 (adesione): inclusa;
  - clausola 7.7: opzione 2, autorizzazione generale, preavviso di **15 giorni**;
  - clausola 9.2: «senza ingiustificato ritardo», con l'aggiunta «e comunque entro 48 ore dal momento in cui ne è venuto a conoscenza»;
  - clausola 10: alla fine, cancellazione o restituzione secondo la scelta del titolare.

  Le opzioni scartate si tolgono, le parentesi quadre si riempiono, la numerazione resta quella ufficiale. In testa una nota breve fuori dalle clausole: cosa sono, che il DPA fa parte dei termini per l'azienda cliente, come si accetta (la casella), versione 1 e data.

- [ ] **Step 2: Allegati.**
  - **I (parti):**
    - titolare: «il Cliente», cioè l'azienda indicata al momento dell'accettazione; nome e chi ha accettato stanno nel registro di KlokShift;
    - responsabile: Mattia Caprioli, ditta individuale, con P. IVA, sede ed email come in `termini.html`.
  - **II:**
    - i contenuti di `dati-del-team.html`, in forma di elenco;
    - durata: contratto + 12 mesi di archivio, che sono l'istruzione predefinita del Cliente; cancellazione entro 30 giorni dalla fine dell'archivio; cancellazione anticipata su richiesta scritta di un titolare;
    - l'anteprima della chat nelle push.
  - **III:** il contenuto di `sicurezza.html`, versione 1, compresa la sezione «Cosa non c'è ancora». Prima le verifiche (clausola 7.6) sulla documentazione; poi, se la documentazione non basta, un'ispezione con preavviso ragionevole.
  - **IV:** l'elenco di `sub-responsabili.html`, versione 1.

- [ ] **Step 3: Coerenza.** Nel DPA si chiama sempre «il Cliente», e «titolare del trattamento» si scrive per intero. «Titolare» da solo indica la persona con `authority = owner` solo dove serve, cioè per chi accetta e riceve gli avvisi. PDF controfirmato su richiesta a info@klokshift.com.

---

### Task 9: Privacy, termini, rimborsi e collegamenti

**Files:**
- Modify: `web-site/public/privacy.html`, `web-site/public/termini.html`, `web-site/public/rimborsi.html`
- Modify: `web-site/src/content/it.ts` (footer `links`), `web-site/public/sitemap.xml`
- Modify: i punti dell'app e della dashboard che elencano i link legali: `src/features/support/supportContent.ts`, `web/src/pages/Impostazioni.tsx`, `web/src/pages/Piano.tsx`. Aggiungere DPA e sicurezza dove oggi compaiono termini e privacy.
- Test: `tests/unit/web/legalPages.test.ts`

**Interfaces:**
- Consumes: Task 2 (`legalUrlsFor`), Task 6–8 (pagine e nomi).

- [ ] **Step 1: Test di coerenza che fallisce** (`legalPages.test.ts`, legge i file da disco):
  - le quattro pagine nuove esistono e contengono `Versione 1`;
  - `privacy.html` non contiene `entro 30 giorni` vicino a `backup`, cioè la regex `/backup[^.]*30 giorni|30 giorni[^.]*backup/i` non trova nulla;
  - ogni fornitore della tabella di `sub-responsabili.html` (Supabase, Expo, Apple, Google, Resend, GitHub) è nominato in `privacy.html`;
  - `privacy.html` non nomina `Google Fonts`;
  - `termini.html` contiene un link a `dpa.html`;
  - `dpa.html` contiene `48 ore` e `15 giorni` e i link alle tre pagine allegate;
  - `it.ts` → `footer.links` contiene `./dpa.html`, `./sub-responsabili.html` e `./sicurezza.html`;
  - `sitemap.xml` contiene le quattro pagine nuove.

- [ ] **Step 2: Lanciare e vedere fallire**

Run: `yarn vitest run tests/unit/web/legalPages.test.ts`
Expected: FAIL.

- [ ] **Step 3: Riscrivere `privacy.html`** in due parti, come al §6.2 della spec:
  - **parte 1:** KlokShift titolare per account, abbonamento, sicurezza e sito, con i fornitori del Task 6. Testo delle notifiche via Expo, Apple e Google. GitHub Pages ospita il sito; niente Google Fonts. **Togliere la promessa sui backup.**
  - **parte 2:** i dati del team, con titolare l'azienda, e il link a `dati-del-team.html`.

  Ricontrollare ogni frase di «Conservazione e cancellazione» contro `supabase/functions/delete-account` e `20261020000000_workspace_data_deletion.sql`.

- [ ] **Step 4: `termini.html`**:
  - §3: chi crea l'azienda accetta termini e DPA per suo conto;
  - §12 diventa «Dati personali»: ruoli, DPA parte integrante, link;
  - §8 con le stesse parole del DPA sull'archivio e i 30 giorni;
  - §16 vale anche per il DPA, nei limiti di legge;
  - §17: una modifica sostanziale ai termini o al DPA chiede una nuova accettazione dopo 30 giorni di preavviso, e fino ad allora la gestione dell'azienda resta ferma.

  Data «Ultimo aggiornamento» nuova. In `rimborsi.html`: allineare il §4 alle parole dell'archivio e la data.

- [ ] **Step 5: Link** in footer, sitemap e nei punti dell'app e della dashboard sopra.

- [ ] **Step 6: Verifica**

Run: `yarn vitest run tests/unit && npx tsc --noEmit && yarn lint && yarn site:build`
Expected: tutto PASS, build riuscita.

---

### Task 10: Documenti interni e allineamento della documentazione

**Files:**
- Create: `docs/privacy/registro-trattamenti.md`, `docs/privacy/procedura-violazione.md`
- Modify: `AGENTS.md` (nuova sezione breve «Dati personali e DPA (2026-10-31)»), `docs/MONETIZATION.md` §9 («validazione privacy/DPA» → stato attuale), `plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md` (riga privacy/ruoli → fatta in locale, con cosa resta)

- [ ] **Step 1: Registro come responsabile** (art. 30, par. 2):
  - nome e contatti del responsabile;
  - categorie di trattamenti per conto dei clienti, dai dati di `dati-del-team.html`;
  - trasferimenti e garanzie, da `docs/privacy/fornitori.md`;
  - misure, rimando a `sicurezza.html` v1;
  - l'elenco dei clienti titolari si ricava dal registro delle accettazioni e non si copia nel documento.

- [ ] **Step 2: Procedura di violazione**:
  - segnali (avvisi Supabase, errori anomali, segnalazioni);
  - cosa raccogliere: cosa, quando, quali aziende, quali dati, quante persone;
  - modello di email ai titolari da mandare **entro 48 ore**;
  - dove si annota: una tabella nel file stesso, art. 33, par. 5;
  - chi la invia: il fondatore.

- [ ] **Step 3: `AGENTS.md`**, in poche righe:
  - i ruoli;
  - la versione legale in due punti gemelli (`private.current_legal_version()` e `LEGAL_VERSION`), che cambiano insieme, con la pagina della versione vecchia ripubblicata come `dpa-vN.html`. Per una modifica sostanziale: prima l'email ai titolari, poi, **dopo i 30 giorni di preavviso**, la migration che alza la versione. È lei a far scattare il blocco;
  - il gate solo lato gestione;
  - malattie mai nominate nelle notifiche;
  - niente font esterni;
  - ogni nuovo fornitore che riceve dati è un sub-responsabile, con 15 giorni di preavviso.

- [ ] **Step 4: Verifica finale**

Run: `yarn vitest run && npx tsc --noEmit && yarn lint && supabase/tests/run.sh reset && supabase/tests/run.sh test`
Expected: tutto PASS. Modifiche lasciate pronte, senza commit. Le due migration si applicano al remoto dalla CI al push su `main`, fatto dall'utente.
