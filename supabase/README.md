# Supabase — schema as code

Progetto `rmlobxjlqlpixkvrzmfg`. Lo schema vive in `supabase/migrations/` come
**baseline unica** (20260920…) che ha sostituito le 99 migration storiche, ora in
`supabase/migrations_legacy/` (solo per consultazione: non si applicano).

## Modello: chi è chi

Un solo asse per titolare, collaboratore e dipendente.

```
profiles           l'account — una persona, valida fra più aziende. Niente ruolo, niente piano.
workspaces         l'azienda (è lei ad avere il piano)
venues             le sedi (workspace_id)
workspace_members  UNA persona nell'azienda: authority = owner | collaborator | none
                   + status invited | active | left, + 5 permessi + ambito (all|selected)
venue_members      dove lavora (l'organico) — il bersaglio di shift_assignments
```

- **authority** (cosa puoi fare) e **organico** (dove lavori) sono ortogonali. Un
  titolare «in turno» è un membro `owner` con una riga in `venue_members`, non un
  caso speciale. Un account può stare in più aziende con authority diverse.
- I permessi del collaboratore stanno sul **membro** (turni, staff, ore, documenti,
  sede) più un ambito: tutte le sedi (anche le future) o un elenco (`member_scope`).
- Dati sensibili separati: `member_hr` (note, ore da contratto).
- `email_confirmed_at` è l'unico cardine che separa «ti colleghiamo alla tua
  scheda» da «chiunque scriva l'email di un altro entra nel suo organico». Vale
  per il trigger su `auth.users` (`private.link_member_invites`). Non si toglie.

### L'oracolo dei permessi

`private.member_venue_grants` (view) è l'unica sorgente: per ogni (utente, sede)
dice authority e permessi. Da lì derivano `venues_where(perm)`, `can(venue, perm)`,
`managers_of(venue, perm)`, `can_person(member, perm)`, `is_restricted_self(member)`.

Regole che tengono i confini (la ricorsione RLS 42P17 è già capitata):

- ogni helper è `security definer`, `stable`, `set search_path = ''`, in `private`;
- le policy chiamano **solo** helper `private.*`, nella forma `col in (select private.x())`;
- mai una subquery diretta su un'altra tabella con RLS dentro una policy
  (`tests/rls/050_surface.sql` lo controlla);
- «non decidi di te stesso, a meno che tu sia il titolare» è `is_restricted_self`,
  un posto solo.

### Scritture

**Tutte via RPC** (`add_member`, `set_member_access`, `create_shifts`,
`update_shift`, `assign`, `record_attendance`, `request_absence`,
`save_shift_template`, …), atomiche, con
errori `raise exception '<codice>'` (nessun no-op silenzioso). INSERT/UPDATE/DELETE
sono revocati ad `anon` e `authenticated` per default; le uniche scritture dirette
sono elencate in `tests/rls/050_surface.sql` (profilo proprio, dati sede, listino
mansioni, documenti, letto/cancellato delle notifiche, testo dei messaggi, profilo
professionale).

Le RPC `claim_invite_send`, `peek_invite`, `consume_invite`, `delete_account` sono
**solo service role** (le chiamano le Edge Function): il token d'invito non deve
mai arrivare a chi invita.

## Monetizzazione e amministrazione: requisiti da implementare

Le regole approvate sono in [MONETIZATION.md](../docs/MONETIZATION.md),
l'amministrazione globale in
[FOUNDER-DASHBOARD.md](../docs/FOUNDER-DASHBOARD.md), il piano e le verifiche in
[MONETIZATION-AND-FOUNDER-DASHBOARD.md](../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md).

Il campo corrente `workspaces.plan` (`free/pro`, default `pro`) è il modello
storico; non contiene pagamenti, scadenze, capacità acquistata o concessioni
permanenti. Non è modificabile dal client. Il nuovo modello resta aziendale e
separa contratto, periodo/concessione, capacità e permessi del membro.

### Fondazione commerciale M03a nel codice

La migration [20261005000100_workspace_access.sql](migrations/20261005000100_workspace_access.sql)
aggiunge `workspace_commercial_state` e `workspace_access_periods`, con RLS e
senza privilegi diretti per i client. `get_workspace_access` restituisce stato,
date e capacità solo a un membro attivo; i conteggi aziendali sono riservati ai
gestori e non dipendono dall'ambito delle sedi visibili.

`start_workspace_trial` richiede il titolare e una sede aperta: attiva una volta
sola Team/una sede/30 giorni dal server e restituisce lo stesso periodo ai
retry. `grant_workspace_access` è eseguibile solo dal servizio fidato: concede
periodi gratuiti o di transizione espliciti, mai pagamenti presunti. Il read
model distingue setup, operatività, archivio, scadenza e revisione migrazione;
deriva dodici mesi di archivio in Europe/Rome e una finestra distinta di sette
giorni per rettifiche. I guard M03b verificano anche il record e la data del turno prima di
autorizzare una rettifica: il solo flag non rende il passato scrivibile.

### Enforcement M03b e collegamento iniziale

Le nuove migration `20261005000200`–`20261005000500` aggiungono controlli alle
RPC, trigger sulle scritture dirette e capacità, policy Storage per upload e
lettura, e lo stesso confine di consultazione ai report SECURITY DEFINER.
`workspaces` è il lock comune prima delle righe figlie; capacità e conteggi
restano quelli di M03a. Aggiungere una persona già conteggiata a una seconda
sede non occupa un posto; riaprire verifica anche le persone che tornano a
contare. Riduzioni e operatività esistente non sono fermate per il solo
superamento della capacità. Inviti già riservati possono essere collegati e
accettati senza un secondo conteggio, anche per consultare l'archivio.

**`migration_pending` è un'eccezione di migrazione esplicita:** conserva le
operazioni precedenti finché riceve un periodo commerciale esplicito; la sola
etichetta Test/Interna/Cliente non risolve la migrazione. `can_operate`
rimane falso nel read model e piano/capacità/date restano null. Non è una
concessione. Una riga commerciale assente invece produce un errore, senza
fallback. Il backfill aggiuntivo marca per revisione anche le aziende nate col
vecchio client dopo M03a. Quelle create dopo M03b ricevono una riga di setup;
il titolare prepara una sola sede e avvia esplicitamente la prova dal client.

In archivio nessun nuovo lavoro/upload. `record_attendance`, approvazione,
annullamento e correzione timbrature hanno guard su record/turno pregressi e
finestra distinta di sette giorni. Clock-out: entrata entro fine operatività,
chiusura prima di fine turno + 24 ore e comunque nella finestra di rettifica.
Le nuove richieste di assenza/cambio turno sono bloccate; il testo della chat
rimane possibile durante la consultazione. Revoca/riduzione permessi, chiusura
sedi, uscite, trasferimento titolarità e cancellazione account restano distinti.
L'eventuale storico preservato dalla vecchia cancellazione dell'ultimo titolare
mantiene i permessi originari: `deleted_at` non viene introdotto come nuovo
motivo per sottrarre dati di carriera conservati.

Lettura/download/report continuano fino al termine dell'archivio, con gli scope
originari, anche per sedi chiuse e dati precedenti all'ultimo anno. La scadenza
nega nuove letture dei dati operativi; non esegue ancora la cancellazione M11.
Gli URL Storage già firmati rimangono validi per il loro TTL. Cancellazioni
richieste e restituzione completa seguono il percorso dedicato da completare.

Il read model espone `server_now` e `next_change_at`: timer calibrato sul server,
refresh per concessioni future, focus/reconnect e ritorno al primo piano nativo.
Nessun realtime commerciale globale/polling continuo per gratuità permanente.
Una variazione del servizio viene riletta al refresh; le scritture DB sono
sempre controllate subito. App/dashboard mostrano stato/date/capacità; i vecchi
gate Pro e il toggle sono rimossi. M04 beta usa queste stesse RPC nella pagina
cliente `#/piano`: avvio prova con conferma, piano/conteggi/date e listino web
informativo. Nessuna nuova migration o scrittura diretta commerciale.
Checkout/gestione contratto M09/M11, ulteriori interventi M06, quote, capacità
futura dei downgrade, grazia di rinnovo e Paddle restano da completare.

Verifiche e procedura: [TEST-MONETIZATION-M03B.md](../docs/TEST-MONETIZATION-M03B.md).
Flusso cliente e sito: [TEST-MONETIZATION-M04.md](../docs/TEST-MONETIZATION-M04.md).
Questo blocco è verificato nel banco locale; non attestare un rollout remoto
per la sola presenza delle migration nel repository.

`delete_account` non è una pausa commerciale: elimina credenziali/file e può
chiudere l'azienda quando manca un altro titolare. Servono stati commerciali
distinti, scope storico per sedi chiuse ed export dei periodi conservati.
La cancellazione operativa deve essere verificabile su DB, Storage e copie;
un ripristino non deve ripubblicare dati già cancellati. I backup del database
non comprendono gli oggetti Storage: prevedere copie/ripristino dei file separati.

Eventi provider firmati, idempotenza e riconciliazione governano i diritti
paganti. Allowlist amministrativa, MFA e autorizzazione server proteggono le
query globali e ogni mutazione del fondatore, con traccia degli interventi.
`authority = owner` vale nell'azienda e non concede amministrazione di KlokShift.
Nomi/tabelle/helper proposti nel piano non attestano schema già esistente.

### Consultazione del fondatore M05

`20261006000100_platform_admin_reads.sql` aggiunge allowlist e classificazioni
private (`platform_admins`, `admin_workspace_labels`, `admin_account_labels`),
senza assegnare implicitamente un amministratore. Classificare un'azienda non
concede periodi, non risolve `migration_pending` e non cambia il funzionamento
cliente. Nessuna RLS ordinaria viene ampliata.

`get_platform_admin_access()` restituisce soltanto eleggibilità/accesso del
chiamante. Ogni RPC globale (`admin_get_overview`, `admin_list_workspaces`,
`admin_get_workspace`, `admin_list_accounts`, `admin_get_account`) verifica
allowlist non revocata, account confermato/non anonimo/non bloccato/non
eliminato, sessione ancora presente/non scaduta, JWT `aal2` e fattore MFA
verificato ancora presente. Helper, viste e tabelle private non sono esposti
ad authenticated/anon; il browser usa soltanto sessione e chiave pubblica.

Payload con dati amministrativi minimi: account Auth effettivi, appartenenze,
sedi, periodi, uso/date commerciali e aggregati. Nessun contenuto di chat,
file, schede HR o token. Liste server con limiti/filtri validati e ordinamento
stabile; dettagli aziendali paginati per sezione. Il consumo documenti viene
da `storage.objects.metadata.size`: dimensioni mancanti/non valide e oggetti
non attribuiti sono espliciti, non stimati da `staff_documents.size_bytes`.
Finanza/costi sono null finché mancano le fonti. Non si prolunga l'archivio
leggendo da admin. Concessioni mutabili/audit ed economia sono M06.

Verifiche automatiche nel banco locale: `090_platform_admin.sql`, API/parser,
isolamento cache e gate web; suite precedenti ancora verdi. Il bootstrap
locale crea le sole colonne di `auth.sessions` e `auth.mfa_factors` necessarie
alle fixture: non verifica GoTrue/TOTP HTTP e non va applicato su dev remoto.
Rilascio M05 riuscito tramite CI sul commit `f6ff685`; l'utente ha eseguito il
provisioning esplicito e confermato il primo accesso MFA/panoramica sul progetto
attuale, che contiene soltanto propri test. Le due aziende precedenti alla
monetizzazione restano `migration_pending`, senza prova/piano automatici.
Dettagli, filtri e prove negative Auth/revoca restano aperti; ambiente,
passaggi ed evidenze sono in
[TEST-FOUNDER-M05.md](../docs/TEST-FOUNDER-M05.md). Codex non ha applicato
migration remote durante l'implementazione locale.

M06a aggiunge `20261006000200_founder_concessions.sql`: quota documenti
nullable sui periodi esistenti (nessun backfill commerciale), registro
`private.admin_operations` senza FK cancellanti e RPC dedicate protette da
guard live/MFA. Classificare non modifica l'accesso; concedere gratuità a vita
risolve esplicitamente la migrazione di quella sola azienda, dopo lock e
controllo capacità. Periodi precedenti conservati, replay autorizzato e
identificativo unico globale; revisione esclude `server_now`. Il client non
scrive direttamente audit/periodi/etichette. I byte concessi sono dichiarati,
non ancora enforcement quota upload. Procedura:
[TEST-FOUNDER-M06A.md](../docs/TEST-FOUNDER-M06A.md).

## Deploy Edge Functions

Le quattro funzioni si rilasciano manualmente: il job `edge` della CI verifica
tipi e lock, ma non esegue il deploy. Gli import fissano le versioni già risolte
in `functions/deno.lock`: `@supabase/supabase-js@2.117.0` per tutte le funzioni,
`expo-server-sdk@7.2.0` per `push`; SMTP usa `denomailer@1.6.0`.

Prima del rilascio, verifica il checkout con Deno **2.9.6** (come in CI):

```bash
cd supabase/functions
deno task check
cd ../..
yarn test:unit
yarn typecheck
yarn web:typecheck
yarn site:typecheck
CI=1 yarn lint
```

`deno task check` usa il lock congelato. Per cambiare intenzionalmente una
dipendenza, modifica l'import, rigenera il lock con
`deno check --frozen=false accept-invite/index.ts archive-reminders/index.ts billing-checkout/index.ts billing-manage/index.ts delete-account/index.ts invite-staff/index.ts paddle-webhook/index.ts push/index.ts workspace-file-cleanup/index.ts`
da `supabase/functions`, rivedi il diff e ripeti `deno task check`.

Se una funzione usa una RPC nuova o un contratto SQL aggiornato, rilascia e
verifica **prima le migration**, poi la funzione compatibile. La presenza del
file nel repository non prova che la migration sia applicata sul remoto.

Esegui dalla radice del repository, con la CLI installata dal progetto e una
sessione Supabase autorizzata, un comando per funzione:

```bash
yarn supabase functions deploy invite-staff --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy accept-invite --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy delete-account --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy push --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy paddle-webhook --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy billing-checkout --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy billing-manage --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy workspace-file-cleanup --project-ref rmlobxjlqlpixkvrzmfg
yarn supabase functions deploy archive-reminders --no-verify-jwt --project-ref rmlobxjlqlpixkvrzmfg
```

`invite-staff` e `delete-account` mantengono la verifica JWT e rivalidano
il chiamante con `auth.getUser()`. `accept-invite` disabilita la verifica JWT:
chi accetta non ha ancora un account; il token dell'invito e le RPC di consumo
controllano l'accesso. `push` la disabilita perché è chiamata da `pg_net`,
autenticato dal segreto condiviso nell'header `x-push-secret`; senza il segreto
configurato la funzione rifiuta la richiesta. `paddle-webhook` la disabilita perché
la chiama Paddle: l'autenticazione è la firma `Paddle-Signature` (HMAC-SHA256 sul
corpo grezzo con la chiave della destinazione), e senza segreto o ambiente
configurati rifiuta tutto. Va rilasciata **dopo** la migration
`20261018000000_billing_subscriptions`. Riferimento:
[flag di deploy della CLI](https://supabase.com/docs/reference/cli/supabase-functions-deploy).

Variabili lette dalle funzioni (qui si riportano solo i nomi):

| Funzione | Variabili |
| --- | --- |
| Tutte | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| `invite-staff`, `delete-account` | `SUPABASE_ANON_KEY` |
| `invite-staff` | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`, `SITE_URL`, `DASHBOARD_URL` |
| `push` | `PUSH_HOOK_SECRET`, `EXPO_ACCESS_TOKEN` |
| `paddle-webhook` | `PADDLE_WEBHOOK_SECRET` (chiave della destinazione su Paddle), `PADDLE_ENVIRONMENT` (`sandbox` o `live`) |
| `billing-checkout` | `SUPABASE_ANON_KEY`, `PADDLE_API_KEY`, `PADDLE_CLIENT_TOKEN`, `PADDLE_ENVIRONMENT`: chiave e token devono essere dello stesso ambiente (`pdl_sdbx_apikey_`/`test_` oppure `pdl_live_apikey_`/`live_`), altrimenti la funzione rifiuta |
| `billing-manage` | `SUPABASE_ANON_KEY`, `PADDLE_API_KEY`, `PADDLE_ENVIRONMENT` (stessi valori di `billing-checkout`); la chiave API deve avere Subscriptions R/W, Customers R e Customer portal sessions W |
| `archive-reminders` | `PUSH_HOOK_SECRET` (lo stesso di `push`, chiamata da `private.run_archive_reminders` con pg_cron ogni mattina), `SMTP_*` e `DASHBOARD_URL` come `invite-staff` |
| `workspace-file-cleanup` | `SUPABASE_ANON_KEY` (le altre le fornisce Supabase); solo il fondatore con secondo fattore, svuota `workspace_file_cleanup` dopo `admin_delete_workspace_data` |

Le variabili `SUPABASE_*` sono fornite dall'ambiente Edge del progetto;
le altre vanno configurate come segreti del progetto. `SMTP_PORT` usa `465` se
omessa; `EXPO_ACCESS_TOKEN` è opzionale nel codice e serve quando il progetto
Expo richiede l'autenticazione delle push. `SITE_URL` e `DASHBOARD_URL` devono
puntare rispettivamente al sito pubblico e alla dashboard: generano due link
diversi per l'invito del professionista e quello del collaboratore. Riferimento:
[variabili e segreti Edge](https://supabase.com/docs/guides/functions/secrets).

Per `push`, il valore di `PUSH_HOOK_SECRET` deve coincidere con il segreto Vault
`push_hook_secret` letto dal trigger `notify_push_on_notification`. Senza la
voce Vault il trigger non invia richieste; con valori diversi la funzione
risponde `401`. Verifica inviti, cancellazione e una push su un account di test
dopo il rilascio; questi controlli reali non sono coperti dal solo typecheck.

La risposta di `push` conta in `sent` soltanto i ticket `ok`, cioè richieste
accettate da Expo, e in `removed` soltanto i token effettivamente cancellati.
I ticket in errore e gli errori di invio/pulizia sono registrati senza token o
contenuto della notifica. **Resta da implementare un job separato per le
ricevute Expo**: un ticket `ok` non conferma la consegna al dispositivo e la
pulizia immediata riguarda soltanto gli errori `DeviceNotRegistered` presenti
nei ticket. Riferimento:
[ticket e ricevute Expo](https://docs.expo.dev/push-notifications/sending-notifications/#check-push-receipts-for-errors).

## Banco di prova locale

Lo schema è la somma delle migration: non esiste un dump versionato (il vecchio
`supabase/schema.sql`, fermo a prima del refactor, è stato tolto il 2026-10-16).

Il banco `supabase/tests/run.sh` fa da `db reset`
su un Postgres 17 di Supabase in Docker (stessa major del progetto).

```bash
supabase/tests/run.sh up       # avvia il container (una volta)
supabase/tests/run.sh reset    # azzera public/private, riapplica bootstrap + migration + seed
supabase/tests/run.sh test     # lancia supabase/tests/rls/*.sql impersonando gli attori
supabase/tests/gen-types.sh    # rigenera src/types/database.ts dallo schema locale
```

`reset` è distruttivo per il solo container locale gestito dallo script. Non
puntare questi comandi a un progetto remoto o a un database condiviso. Il gate
completo eseguito dalla CI è `up` → `reset` → `test`; dopo una modifica SQL si
eseguono anche `gen-types.sh`, `yarn typecheck` e `yarn web:typecheck`.

L'avvio usa Postgres `17.6.1.127` dai mirror ufficiali Supabase: prima GHCR,
poi ECR Public. Riutilizza il container o un'immagine locale della stessa
versione; se deve scaricare, esegue fino a tre tentativi per registry, con
attese di 5 e 10 secondi. Se entrambi i registry falliscono, il gate resta
bloccato. Il database è dichiarato pronto soltanto quando `pg_isready`
risponde: dopo 60 secondi senza risposta, lo script fallisce e mostra i log.
La CI limita il passo di avvio a cinque minuti, inclusi i download.

- `tests/bootstrap.sql` allinea il Postgres locale al progetto reale (`auth.uid()`
  che legge `request.jwt.claims`, storage, publication). Non è una migration.
- `tests/seed.sql` costruisce sei attori passando dalle RPC: `Ow` (titolare, in
  turno), `Co` (collaboratore «turni», ambito V1), `Co2` (collaboratore «ore»),
  `Emp` (dipendente di W1 e titolare di W2), `Emp2`, `Str`.
- I test impersonano con `set role authenticated` + `request.jwt.claims`: **mai da
  service role**, dove i trigger a seconda del punto passano o falliscono.

## Anti-drift

Dopo aver toccato una migration: `run.sh reset && run.sh test`, poi
`gen-types.sh` e `git diff src/types/database.ts`. Quando lo schema nuovo è sul
progetto remoto, `yarn db:types` (CLI con token) sostituisce `gen-types.sh`.

> Il remoto **è sulla baseline**: tutte le versioni `20260920*` risultano
> applicate. Da qui in avanti non si riscrivono i file della baseline — una
> modifica a un file già registrato non tocca il database reale e farebbe
> divergere repo e produzione, sanabile solo con un altro reset distruttivo
> (azzera `public`, lascia `auth.users`, e la history di
> `supabase_migrations.schema_migrations` va riallineata a mano). Si aggiunge un
> file nuovo, come `20260920001600_move_assignment` e `20260920001700_drop_career_showcase`.
