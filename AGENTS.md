# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v56.0.0/ before writing any code.

---

# KlokShift

Gestione dei turni per il settore dell'ospitalità (mercato italiano): ristoranti, hotel, catering, discoteche, pub e agenzie di eventi. Le **sedi** organizzano i turni con il proprio organico; i **professionisti** confermano i turni assegnati, tengono il conto delle ore. Pagamenti automatici dal web e dashboard personale del fondatore devono essere pronti prima dei primi clienti paganti; **Paddle** è il provider scelto, approvazione account e integrazione da completare.

> Il marketplace (professionisti che cercano turni e si candidano ad annunci) è stato rimosso dal codice il 2026-09-12 e dal DB il 2026-09-20 (`applications`, `shift_kind`, i `notification_type` `application_*` e i campi da annuncio dei turni non esistono più): non va riesumato senza una decisione di prodotto.
>
> Seconda potatura il 2026-09-20 (`20260920001700`): con lui se n'è andato il **CV** del professionista, che serviva a farsi scegliere da chi non ti conosce — `waiter_experiences`, la `bio`, le specializzazioni e le colonne del modulo di candidatura. Il profilo lo legge solo chi ha già la persona in azienda, e quel che gli serve — le **lingue** — sta nella scheda di organico. Sono cadute anche le due schede «Professionista» (`(manager)/cameriere/[id]` e `/professionista/:id` sulla dashboard): il posto dove si guarda una persona è `staff/[id]`.
>
> Terza potatura il 2026-10-04 (`20261004000200`): le **recensioni** dei clienti (sospese dal 2026-09-12) — tabella `reviews`, `rating_*` su `waiter_profiles`, la carta pubblica `waiter_public_cards`, il sito `web-review/` e il QR. `anon` non legge e non esegue più nulla (`050_surface.sql`): non riaprirlo senza una decisione di prodotto.

⚠️ **Vocabolario**: nelle stringhe utente si usa **professionista** (non "cameriere") e **sede** (non "locale"/"ristorante"/"ristoratore"), perché il prodotto non è più solo per la ristorazione. I nomi interni restano `waiter`/`manager` (rotte, tipi): non rinominarli. **Unica deroga** (2026-09-20, `20260920001900`): le colonne della chat sono `conversations.user_a` / `user_b`, perché lì non è cambiato il vocabolario ma il significato — vedi «La chat» qui sotto.

## Modello: chi è chi (2026-09-20)

Un solo asse per **titolare**, **collaboratore** e **dipendente**. Dettagli e regole in `supabase/README.md`.

```
profiles           l'account — una persona, valida fra più aziende. Niente ruolo, niente piano.
workspaces         l'azienda (è lei ad avere il piano)
venues             le sedi (workspace_id)
workspace_members  UNA persona nell'azienda: authority owner | collaborator | none,
                   status invited | active | left, 5 permessi + ambito (tutte le sedi | elenco)
venue_members      dove lavora (l'organico) — il bersaglio di shift_assignments.venue_member_id
```

- **authority** (cosa puoi fare) e **organico** (dove lavori) sono ortogonali: un titolare in turno è un membro `owner` con una riga in `venue_members`, non un caso speciale. Un account può stare in più aziende con authority diverse.
- I permessi del collaboratore stanno **sul membro**, non per sede, più un ambito: tutte le sedi (anche le future) o un elenco (`member_scope`).
- Il «cappello» con cui si usa l'app (gestione / lavoro) **non è un ruolo**: si ricava dalle appartenenze (`get_my_context()` → `useOwnerVenues()` e `useViewMode()`).
- `staff_people`, `staff_members` e `venue_access` **non esistono più**. I tipi di dominio storici (`OwnerPerson`, `StaffMember`, …) restano in `src/features/staff/types.ts` e li **produce** il data layer: `StaffPerson.id` è un member id, `StaffMember.id` è un venue member id — non confonderli.
- Le **scritture passano dalle RPC** (atomiche, con errori `raise exception '<codice>'` tradotti in `src/lib/errors.ts`). INSERT/UPDATE/DELETE diretti sono revocati tranne l'elenco in `supabase/tests/rls/050_surface.sql`. ⚠️ Un update diretto che la RLS scarta torna 204 **senza errore**: `.select()` e zero righe = errore.

## La chat (2026-09-20)

Una conversazione è fra **due membri qualsiasi della stessa azienda** —
titolari, collaboratori e dipendenti nello stesso insieme — e la coppia è **non
ordinata**: `conversations.user_a < user_b`, un indice unico solo per entrambi i
versi. Chi «parla a nome dell'azienda» non si legge da una colonna, si ricava
dall'authority (`private.speaks_for_workspace`).

- **Nome e insegna**: la controparte è sempre una **persona** per nome; il luogo
  (la sede se l'azienda ne ha una sola, altrimenti l'azienda) è il sottotitolo, e
  lo vede solo chi **non** guida quell'azienda. Fonte unica `chat_counterpart`,
  usata anche dal trigger delle notifiche: la notifica non deve mai nominare un
  mittente diverso da quello del thread.
- **Quale nome** (2026-09-21, `20260921000200`): dentro un'azienda una persona
  si chiama come sulla **scheda** (`workspace_members.display_name`), non come
  sul profilo — ovunque, chat e notifiche comprese (`private.member_name`). Il
  profilo è solo il ripiego senza scheda; la foto resta quella del profilo.
- **L'interruttore**: `workspaces.staff_can_chat` (acceso di default) spegne la
  chat **fra dipendenti**; verso chi gestisce si scrive sempre, e spegnerlo non
  cancella i thread aperti. Lo applicano `open_conversation` (`chat_disabled`) e
  `get_workspace_contacts` (la rubrica), non l'UI.
- Le **card** (cambio turno, assenze) nascono sempre sul thread col titolare
  (`conversation_for_pair(workspace, richiedente, titolare)`): in una chat fra
  colleghi non compaiono.

## Spostare un turno (2026-09-20)

> **Un turno si sposta nel tempo; una persona si sposta da un turno a un altro.**

Sono due operazioni diverse e due RPC diverse — `update_shift` con una data
nuova (si muove tutta la squadra) e `move_assignment` (si muove una persona
sola, e se nel giorno d'arrivo non c'è niente nasce il gemello del turno di
partenza). Vale ovunque: settimana e mese trascinano la card del turno, la vista
per persona trascina il chip di una persona su un turno e quindi in verticale
cambia la persona (`reassign`) e in orizzontale il turno.

Le conseguenze — notifiche, conferme riaperte, assenze, sovrapposizioni — le
calcola **solo** `src/features/shifts/moveImpact.ts`, e le dicono con le stesse
frasi il trascinamento, il pannello della dashboard e il form dell'app. Non
scrivere avvisi a mano in un punto solo: la divergenza fra le tre strade è
esattamente il bug che questo modulo ha chiuso. ⚠️ `moveImpact.ts` e `notify.ts`
sono gemelli **manuali** dei trigger SQL: se cambia `notify_on_shift_change`,
cambiali con lui.

## Ore, assenze e maggiorazioni (2026-09-24)

La decisione completa è in `plans/HOURS-ABSENCES-ADJUSTMENTS.md` e completa il
piano `CLOCK_IN_OUT.md`. Tre quantità restano sempre distinte:

- `worked_hours` contiene soltanto ore realmente lavorate e approvate;
- ferie, permessi e altre assenze possono produrre **ore riconosciute** separate,
  mai ore lavorate;
- notturno, straordinario, festivo ed extra sono classificazioni di ore già
  lavorate, con percentuale configurabile e snapshot storico: non moltiplicano
  il totale delle ore.

KlokShift prepara quantità ed export per il consulente, ma non calcola importi in
euro, saldo ferie o busta paga. Non introdurre percentuali universali: fasce,
cumulabilità e maggiorazioni dipendono dal contratto applicato. Un conflitto fra
assenza riconosciuta e lavoro effettivo deve risultare **da verificare**, non
essere contato due volte in silenzio.

## Timbratura senza turno (2026-10-10)

Chi gestisce le ore può abilitare una persona (`venue_members.clock_unplanned`,
solo con la timbratura dall'app) a timbrare anche senza un turno. L'entrata è una
`shift_clock_records` con `shift_id` nullo; all'uscita nasce il turno
`shifts.unplanned` («Fuori turno») con un'assegnazione **da approvare**. Le ore
restano solo su `shift_assignments`: non introdurre una seconda fonte di ore. I
turni nati così non notificano (`app.unplanned_clock`) e i colleghi li vedono solo
dopo l'approvazione. Dettagli in [plans/UNPLANNED-CLOCK.md](plans/UNPLANNED-CLOCK.md).

## Promemoria di timbratura (2026-10-27)

Chi timbra dall'app riceve un promemoria solo quando manca qualcosa: l'entrata
5 minuti dopo l'inizio, l'uscita 20 minuti dopo la fine, il fuori turno aperto
da 10 ore. Lo decide il database (`private.queue_clock_reminders`, ogni 10
minuti con pg_cron), non l'app: niente a chi è in ferie approvate, già in
servizio altrove, in una sede senza timbratura o ha spento la categoria
`reminders` (allora non nasce nemmeno la riga). `private.clock_reminders`
impedisce i doppioni; una timbratura qualsiasi segna letti i promemoria aperti
della persona; la push scade dopo un'ora (Edge Function `push`, deploy a mano).
Test SQL 041.

## Turno già fatto (2026-10-26)

Un turno svolto ma mai pianificato («mi sono dimenticato di metterlo») si
registra a posteriori con `record_past_shift`, non col form del turno. Serve il
permesso **Ore**, non «Turni», ed è accettato solo un turno già finito. Le persone
risultano presenti (`confirmed`) e le ore contano subito con la regola del turno
concluso senza timbratura (`manual_auto`), anche per chi timbra dall'app, e si
correggono dalle presenze.
Non parte nessuna notifica di turno assegnato: c'è solo un «Turno registrato»
facoltativo (`p_notify`). Il turno porta `recorded_at`/`recorded_by` («Inserito a
mano»). Ci si arriva dal «+» dei giorni passati (agenda e planning) e dalla pagina
Ore. Le frasi sono in `src/features/shifts/recorded.ts`.

**Il passato non si pianifica** (`20261026000100`). `create_shifts` rifiuta i
turni già finiti (`shift_finished`) e `move_assignment` non fa nascere il
gemello nel passato. Mettere qualcuno su un turno finito (`assign_one`) chiede
«Ore», come cambiarne data e orari. «Duplica» lascia fuori i giorni passati e lo
dice; i form del nuovo turno dicono l'orario passato e portano a «Turno già
fatto». Nei test SQL lo storico si prepara con `tests.create_shifts` (seed).
«Duplica settimana» c'è anche nell'app (solo la settimana; il mese resta sulla
dashboard): cosa si copia e cosa resta fuori lo decide
`src/features/shifts/duplicate.ts` per entrambe.

## Correggere le ore (2026-10-26)

Con la timbratura le ore contano solo da una timbratura approvata: un numero
scritto a mano resta fuori dal consuntivo (B02). Per questo, sulle righe che
timbrano (`hoursAreClocked`, gemello di `record_attendance`), app e dashboard
non mostrano il campo ore. Si correggono entrata e uscita, e la correzione
approva nello stesso passo («Salva e approva»). Chi non ha timbrato riceve gli
orari da chi ha «Ore» con `enter_clock_record`: timbratura `method = 'manual'`,
con correzione e autore, già approvata. Il motivo di una correzione è
facoltativo (`20261026000300`); per annullare una timbratura resta obbligatorio.
La pagina Ore apre con **«Ore da sistemare»** (`get_hours_to_fix`): i turni
conclusi le cui ore non contano ancora, ciascuno con il motivo (non ha timbrato,
uscita mancante, da approvare), e ogni riga porta al turno. ⚠️ È il complemento
esatto di `shifts_count` in `get_workspace_hours_summary`: se cambia la regola
di cosa conta, cambiano insieme (test SQL 037).
Su un turno finito chi ha «Ore» può aggiungere **chi ha lavorato** senza esserci
segnato, cioè il sostituto (`add_shift_worker`): risulta presente con le ore del
turno (`manual_auto`) e non parte nessuna notifica. Chi aveva rifiutato torna
presente sulla sua riga.

## Pausa (2026-10-16)

La sede (chi ha «Ore») decide se la pausa è retribuita: retribuita resta nelle
ore lavorate, non retribuita si toglie; l'export la dice in colonne a parte. Il
turno porta `break_minutes` e la **copia** `shifts.break_paid`, così cambiare la
scelta non riscrive i turni conclusi. Il professionista timbra inizio/fine pausa
(`shift_clock_breaks`); vale la correzione di chi gestisce, poi la pausa
timbrata, poi la pianificata. ⚠️ `shiftCountedHours` e `effectiveClockBreak`
sono gemelli **manuali** di `shift_counted_hours` e `clock_record_break`.
Dal 2026-10-22 la sede sceglie anche se la pausa si **timbra** o è **fissa**
(dal turno, senza pulsante), con eccezione per persona e sede; la scelta si
copia sulla timbratura all'entrata. La durata resta sul turno, mai sul
contratto. Dettagli in [plans/BREAKS.md](plans/BREAKS.md).

## Modelli di turno (2026-10-16)

Un turno tipo si salva come **modello** (`shift_templates`, per sede) e si
riusa dal form del nuovo turno, in app e dashboard. Ricorda orari, pausa,
fabbisogno per ruolo, note e «chiedi conferma»; **non** la data e **non** le
persone. Lo legge e lo scrive chi ha «Turni» sulla sede, solo via
`save_shift_template` / `delete_shift_template`. Eliminarlo non tocca i turni
creati da lui. Dettagli in [plans/SHIFT-TEMPLATES.md](plans/SHIFT-TEMPLATES.md).

## Primo accesso (2026-10-22)

Chi entra deve capire in pochi minuti cosa fare, in app e sul web.

- **Titolare**: prima sede → schermata della prova (`(manager)/prova`, web
  `#/prova`, testi in `workspace/trialCopy.ts`) → checklist **Primi passi**
  in Home (prova, ruoli, persone, primo turno, team invitato). I passi si
  spuntano dai dati (`onboarding/firstSteps.ts`, condiviso app+web), mai a mano;
  «chiudi» è locale. La prova resta un tocco esplicito (MONETIZATION §3).
- **Azienda in `setup`**: i pulsanti operativi non spariscono in silenzio, dicono
  perché (`operationsGate` in `workspace/access.ts`) e portano alla prova.
- **Dipendente**: il wizard chiede solo nome e foto; senza organico la Home
  mostra «fatti aggiungere con questa email» (`JoinWorkspaceCard`).
- **Collaboratore**: benvenuto con permessi e sedi in Home sulla dashboard.
- Il carosello ha tre serie (titolare, collaboratore, dipendente) in
  `introContent.ts`: se cambia il percorso, cambia anche lui.

## Monetizzazione e dashboard personale (2026-10-05)

Le regole approvate sono in [docs/MONETIZATION.md](docs/MONETIZATION.md);
la dashboard del fondatore in
[docs/FOUNDER-DASHBOARD.md](docs/FOUNDER-DASHBOARD.md). Il piano di esecuzione è
[plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md](plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md).
M03a/M03b implementano modello, accesso/capacità server e collegamento iniziale
app/dashboard, verificati in locale. `migration_pending` conserva esplicitamente
le operazioni precedenti, senza concessioni inventate; il dato mancante non
sblocca. M04 beta aggiunge la pagina cliente `#/piano` per il titolare:
stato/capacità/date, avvio prova confermato e listino informativo separato.
Sito/FAQ/CTA/meta dichiarano la beta, con registrazione → prima sede → prova;
nessun acquisto attivo o offerta acquistabile nel JSON-LD. Listino web condiviso
in `shared/pricing.ts`, mai importato nell'app nativa. Contratti e checkout
restano M09/M11. Procedura [docs/TEST-MONETIZATION-M04.md](docs/TEST-MONETIZATION-M04.md).
M05 aggiunge consultazione del fondatore in `web/` a
`#/amministrazione`, allowlist privata vuota fino a provisioning esplicito,
MFA `aal2` e controllo live di account/sessione/fattore a ogni RPC globale.
Nessuna RLS cliente ampliata, nessun accesso admin ordinario a HR/chat/file.
M05 è stato rilasciato dal workflow del commit `f6ff685`; l'utente ha abilitato
esplicitamente il fondatore e confermato il primo accesso MFA/panoramica.
Le due aziende proprie di test esistevano prima della monetizzazione e sono
entrate in `migration_pending`, senza avvio automatico della prova o concessioni.
L'utente ha poi assegnato esplicitamente Team/una sede/2048 MiB gratuiti a vita
a Da Buffa: screenshot del 6 ottobre, 21:12 Europe/Rome, con periodo e audit.
M06a implementa in locale concessioni gratuite a vita immediate/variazioni,
classificazioni, note e audit idempotente con revisione/lock aziendale.
Riordino UI locale: schede Riepilogo, Persone e sedi, Gestione e Cronologia;
modulo inizializzato dalla concessione corrente, modifiche conservate cambiando
scheda. Rilascio del riordino e prova visuale ancora da fare.
Quota documenti dichiarata, non ancora applicata agli upload; nessuna
conversione automatica delle aziende ospitate. Economia/spese e altri
interventi M06, pagamenti, quote/downgrade e archivio/cancellazione restano
da completare. [docs/TEST-FOUNDER-M06A.md](docs/TEST-FOUNDER-M06A.md).
Il fondatore usa solo test propri per i prossimi due mesi: dev remoto separato
rimandato fino a prima dei tester esterni, senza bloccare il lavoro locale.
Procedure:
[docs/TEST-MONETIZATION-M03B.md](docs/TEST-MONETIZATION-M03B.md).
[docs/TEST-FOUNDER-M05.md](docs/TEST-FOUNDER-M05.md) distingue il banco SQL
locale dalla prima prova MFA reale/visuale sul progetto di soli test propri;
dettagli, filtri, diniego multiutente, nuovo login e revoca live restano aperti.

- Il piano è aziendale; i due piani hanno le stesse funzioni e capacità diversa.
  Il limite di 30 riguarda persone uniche nell'intera azienda, non per sede.
- Prova di 30 giorni senza carta per tutte le nuove aziende. Gratuità a vita
  assegnata dal fondatore per azienda, con piano e sedi concessi individualmente.
- Pausa mensile a fine periodo pagato; annuale senza congelamento automatico.
  Archivio gratuito di 12 mesi da fine operatività, con consultazione/export,
  revoca accessi e percorso di cancellazione dedicato. Pausa, disdetta,
  cancellazione account e cancellazione dati sono operazioni distinte.
- Insoluto di rinnovo: 7 giorni di tolleranza; rettifiche pregresse: finestra
  separata di 7 giorni senza nuova operatività. Entrambe richiedono controlli
  server, senza reset dell'archivio per login, retry o rettifiche.
- Capacità, concessioni, eventi finanziari e date si verificano nel backend;
  non trasformare il vecchio `free/pro` in un freemium pubblico e non sbloccare
  un diritto commerciale perché il suo dato manca.
- Prezzi e acquisti sul sito e nei flussi commerciali web; l'app nativa non
  mostra prezzi o checkout. Il provider scelto è **Paddle (MoR)**; account,
  configurazione, procedura fiscale e integrazione non sono già completati.
- Il fondatore dichiara partita IVA già attiva in forfettario e attività di
  frontend developer; codice ATECO da recuperare e compatibilità da verificare
  prima degli incassi. Non presumere che «licenza» o il regime fiscale bastino
  a convalidare inquadramento, payout o dicitura IVA del checkout Paddle.
- L'area del fondatore richiede autorizzazione server distinta dai permessi
  di titolare cliente. L'accesso globale non deriva da `authority = owner`.

## Stack
| Categoria | Tecnologia |
|-----------|-----------|
| Framework | React 19 + React Native 0.85 + **Expo SDK 56** |
| Routing | **Expo Router** (file-based, gruppi `(auth)`/`(waiter)`/`(manager)`) |
| Backend | **Supabase** (auth, DB, realtime, storage) — no GraphQL/Relay |
| Styling | **NativeWind v5** (Tailwind v4 CSS-first) via wrapper `@/tw` |
| UI | Componenti React Native + primitive in `src/components/ui/` |
| Lint | `expo lint` (eslint) — nessun Biome/Prettier |
| Lingua | Stringhe utente in **italiano inline** (no lib i18n) |
| Package manager | **yarn** (`yarn.lock`) — niente npm |

## Comandi
```bash
yarn start                # Expo dev server
yarn ios                  # iOS simulator
yarn android              # Android emulator
yarn web                  # web
yarn lint                 # expo lint src web/src web-site/src shared (eslint) — bloccante in CI
                          #   i path vanno nominati: senza, expo lint salta web/ e web-site/
yarn site:dev             # sito vetrina (web-site/) — vedi web-site/README.md
yarn add <pkg>            # dipendenze (oppure `npx expo install <pkg>`)
npx tsc --noEmit          # type-check
npx expo export --platform ios   # verifica bundle
```

## Struttura
```
src/
├── app/                  # Expo Router: solo routing, schermate che usano hook di feature
│   ├── _layout.tsx       # AppProviders + RootNavigator (Stack.Protected) + SplashScreen
│   ├── (auth)/           # welcome, login, signup, signup-account
│   ├── (onboarding)/     # primo accesso del professionista
│   ├── (waiter)/         # vista «lavoro»: (tabs), shift, assenze, documenti, chat…
│   ├── (manager)/        # vista «gestione»: (tabs), shift, staff, venue, ore, team, chat…
│   └── (dev)/            # components.tsx — demo design system, solo con __DEV__
├── features/<dominio>/   # api.ts (Supabase), hooks.ts (React Query), componenti,
│                         #   regole pure testate (es. shifts/moveImpact.ts)
├── components/           # ui/ primitive (GoldButton, Card, Avatar, Pill, Icon…),
│                         #   form/ campi react-hook-form, nav/ FloatingTabBar
├── providers/            # AppProviders (Query, Auth, OwnerVenues, ViewMode, Toast,
│                         #   ErrorBoundary), ErrorFallback
├── lib/                  # supabase.ts, auth.tsx, queryKeys.ts, errors.ts, format.ts, cn.ts…
├── tw/                   # wrapper CSS-class (index/image/animated) per NativeWind
├── types/database.ts     # tipi DB generati (supabase/tests/gen-types.sh), mai a mano
├── constants/            # colors.ts, fonts.ts
└── global.css            # import Tailwind v4 + @theme token (la palette AURA è qui)

web/src/    # dashboard desktop delle sedi (Vite+React, /app/ su Pages); admin/ = area fondatore
web-site/   # sito vetrina pubblico + pagine legali (radice su Pages)
shared/     # solo web: listino (pricing.ts) condiviso da dashboard e sito, mai nell'app nativa
supabase/   # migrations/ (baseline + successive), functions/ (Edge), tests/ (banco SQL)
tests/      # vitest: unit/, integration/ (client Supabase finti), helpers/
docs/ plans/ # decisioni di prodotto, piani e audit
```

⚠️ Il copy del sito vetrina sta tutto in `web-site/src/content/it.ts` e non può
nominare recensioni, candidature o paghe. Il listino pubblico è sul sito e i
riepiloghi/acquisti contrattuali sono sul web: 29 €/mese o 290 €/anno fino a 30 dipendenti unici nell'azienda,
49 €/mese o 490 €/anno senza limite, sede aggiuntiva 15 €/mese o 150 €/anno,
IVA esclusa; l'annuale equivale a 10 mensilità, quindi offre 2 mesi gratuiti.
L'app nativa non mostra prezzi. La procedura fiscale effettiva del provider
resta da validare. Vedi `web-site/README.md` e `docs/MONETIZATION.md`.

## Path alias
`@/` → `src/`. Es. `import { cn } from "@/lib/cn"`, `import { View, Text } from "@/tw"`.

## Auth & navigazione
- Pattern ufficiale Expo Router v56: `Stack.Protected` con 4 guard — `!session` → `(auth)`, vista `manager` → `(manager)`, vista `waiter` senza onboarding → `(onboarding)`, con onboarding → `(waiter)`. Nessun `index.tsx` root.
- La vista la dà `useViewMode()`: si ricava dalle appartenenze, **non** da un ruolo sul profilo. Chi ha entrambi i cappelli sceglie con l'interruttore; l'ultima vista è ricordata (`viewModeStorage`) per non aspettare la rete allo splash. `user_metadata.intent` è solo il suggerimento della registrazione.
- `AuthProvider`/`useAuth()` in `src/lib/auth.tsx`: `getSession()` + `onAuthStateChange` → `ensureProfile()`. Il profilo di norma lo crea il **trigger su `auth.users`** (`private.handle_auth_user`), che non deve mai sollevare; l'insert nel client è la rete di sicurezza.
- ⚠️ **"Confirm email" su Supabase Auth non si disattiva.** L'aggancio automatico (`private.link_member_invites`) collega un account alla scheda che un'azienda ha preparato per quell'indirizzo. Il controllo `email_confirmed_at is not null` è l'unica cosa che separa «ti colleghiamo alla tua scheda» da «chiunque scriva l'email di un altro entra nel suo organico». Senza conferma email la funzione smette di agganciare — rottura visibile, non un buco silenzioso — ma la protezione va lasciata dov'è.
- **Due inviti, due meccaniche diverse, apposta.** Il dipendente si registra da sé e l'account resta suo (è il suo profilo di carriera fra più aziende): l'email dice «registrati con questo indirizzo» e l'aggancio lo fa il trigger. Il collaboratore no: l'email porta un token monouso a `#/invito` sulla dashboard, e lì l'account **nasce** — `accept-invite` fa `createUser` con la password scelta in quel momento e `email_confirm: true`, poi `consume_invite` rende definitivo l'ingresso. Il canale lo sceglie il DB (`claim_invite_send`), non il client.
- ⚠️ **L'account del collaboratore non esiste prima che apra il link.** È il motivo per cui non lo crea `generateLink({ type: 'invite' })` all'invio (provato il 15/09, ritirato il 16): così l'indirizzo restava occupato anche per chi l'invito non lo apriva mai, e aprire il link attivava l'accesso **prima** della password. Non tornare a pre-creare l'account.
- ⚠️ **Il token non passa mai da chi invita**: lo genera la Edge Function, nel DB entra solo il suo SHA-256, e `claim_invite_send`/`peek_invite`/`consume_invite` sono **solo service role**. Se chi invita potesse sceglierlo, accetterebbe l'invito al posto del destinatario creando un account con l'email di un altro, già confermata.

## Dati (Supabase)
- Query/mutation nel data layer `src/features/*/api.ts` (`getX`/`saveX`/`createX`/`updateX`), **mai** fetch diretti nei componenti.
- Tipi da `src/types/database.ts`. Controllare sempre `error`. Le RLS filtrano per `auth.uid()`.
- Lo schema è una **baseline unica** in `supabase/migrations/` (le 99 storiche sono in `supabase/migrations_legacy/`, solo per consultazione). Banco di prova: `supabase/tests/run.sh up|reset|test` (Postgres in Docker) e `supabase/tests/gen-types.sh`.

## Convenzioni UI (vedi anche `.claude/skills/new-component`)
- Importare i componenti con `className` da **`@/tw`**, non da `react-native`. Comporre le classi con `cn()`.
- **Niente Tamagui.** `style`/`StyleSheet` solo per valori dinamici (eccezione: `Pill` usa `rgba` inline per il workaround color-mix).
- ⚠️ **Gotcha**: NON usare `<Link className=...>` da `@/tw` per testo tappabile (testo invisibile/non tappabile). Usare `Pressable` + `useRouter().push()` con `Text` stilizzato.
- Named export per le primitive; `export default` per le schermate Expo Router.
- Nessun `console.log` committato. Nessun `babel.config.js` (Tailwind v4 CSS-first; config in `metro.config.js`).

## Tooling Claude (`.claude/`)
- **Subagent**: `code-reviewer`, `principles-enforcer`, `techdebt-analyzer`.
- **Comandi**: `/full-review` (review parallela con i 3 subagent), `/pr` (pre-review + PR Conventional Commits).
- **Skill**: `new-component` (creare componenti/screen secondo le convenzioni), `improve` (audit read-only + piani per altri agent).
