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
`update_shift`, `assign`, `record_attendance`, `request_absence`, …), atomiche, con
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
giorni per rettifiche. Questi flag non autorizzano ancora scritture pregresse:
servono i controlli per record nelle RPC operative.

Il backfill registra solo le aziende da classificare, senza assegnare prove,
pagamenti o gratuità a vita. Questo blocco è **additivo**: mantiene il campo
storico per compatibilità e non modifica ancora le RPC operative o Storage.
Applicazione completa dei limiti, interfacce, rollout, periodi Paddle e
cancellazione dell'archivio richiedono i passaggi successivi del piano. La
presenza della migration nella repo non attesta un'applicazione sul remoto.

Le scritture operative e Storage devono verificare accesso/capacità nel server,
anche per inviti, ripristini e riaperture concorrenti. La sola lettura conserva
lettura/export nei permessi effettivi, azioni di sicurezza e revoca accessi;
rettifiche pregresse e chiusura timbrature richiedono eccezioni limitate.
Date server e fine operatività governano i 12 mesi di archivio: login, rettifiche
e retry non riavviano la finestra.

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

## Banco di prova locale

Non c'è la CLI Supabase in questa repo: `supabase/tests/run.sh` fa da `db reset`
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
