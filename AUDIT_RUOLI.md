# Ruoli e turni del gestore — audit e piano

> Audit dei tre ruoli (titolare, collaboratore, professionista) e piano per far
> entrare **chi gestisce** dentro l'organico e dentro i turni.
> Scritto il 2026-09-17. Decisioni di prodotto in fondo alla sezione *Contesto*.

## Contesto

Il prodotto ha **due assi di identità**, costruiti in momenti diversi e mai
incrociati del tutto:

- **chi gestisce** — `venues.owner_id` (titolare) + `venue_access`
  (collaboratore con permessi granulari), unificati da `my_venue_ids(perm)` e
  `can_manage_venue(venue, perm)`;
- **chi lavora** — `staff_people` (la persona, dell'azienda) + `staff_members`
  (l'appartenenza, della sede), agganciate a un account tramite `waiter_id`.

L'unico ponte fra i due assi è **a senso unico**: un professionista
dell'organico può essere promosso a gestire la sede (F3, `20260916140000`), e
dal 17/09 può anche mettersi in turno da sé (`20260918160000`). Il verso opposto
non esiste — chi gestisce non può comparire nell'organico.

Ma il titolare lavora: fa il servizio, copre un buco, sta al bar. Le sue ore
oggi non esistono da nessuna parte: non nel planning, non in `/ore`, non
nell'export per il commercialista.

**Decisioni prese (2026-09-17)**

1. Il **titolare** in turno può tutto anche su di sé — presenze, ore, rimozione
   della propria scheda. La regola «non decidi di te stesso» resta **solo per i
   collaboratori**.
2. Possono autoinserirsi in organico **titolare e collaboratori** con il
   permesso Staff.
3. **Nessuna vista «professionista»** per il titolare: si vede dal lato
   gestione, con un badge «Tu» e un filtro «I miei turni». Il profilo di
   carriera resta del professionista.
4. Questo documento sta in repo e si aggiorna quando i ruoli cambiano.

---

## Parte A — La matrice dei tre ruoli

Perimetro unico: `my_venue_ids(perm)` nelle policy, `can_manage_venue(venue,
perm)` nelle RPC `security definer`. Il titolare passa per `venues.owner_id`, il
collaboratore per una riga `venue_access` attiva **per sede** con cinque
booleani (`can_manage_shifts`, `can_manage_staff`, `can_view_hours`,
`can_manage_documents`, `can_manage_venue`) più due permessi derivati:
`'roster'` = turni **o** staff, `'any'` = vede la sede. Un permesso sconosciuto
**nega**.

| Oggetto | Titolare | Collaboratore | Professionista |
|---|---|---|---|
| Aprire / chiudere una sede | sì | **mai** (`venues_owner_not_delegate`) | no |
| Dati della sede, listino ruoli | sì | `can_manage_venue` | sola lettura sulle sue sedi |
| Turni (crea, modifica, duplica) | sì | `can_manage_shifts` | no |
| Assegnazioni | sì, **anche le proprie** (§B1) | `can_manage_shifts`, **tranne le proprie** | conferma/rifiuta le proprie |
| Organico: leggere | sì | `'roster'` (turni o staff) | solo sé stesso |
| Organico: aggiungere / modificare / togliere | sì | `can_manage_staff` | `leave_venue` su sé stesso |
| Anagrafica persona (`staff_people`) | tutto, incl. delete | read/create/update, **nessun delete** | legge la propria riga |
| Presenze e ore lavorate | sì, **anche le proprie** (§B1) | `can_view_hours`, **mai le proprie** | no (le legge) |
| Export ore | sì | `can_view_hours` | no |
| Documenti | sì | `can_manage_documents` | i propri |
| Assenze (ferie, permessi, malattia) | sì, **anche le proprie** | `can_manage_staff` | chiede le proprie |
| Chat | sì | **no** (scelta: `conversations` è una coppia, non è per sede) | sì |
| Invitare collaboratori | sì | **no** (nessuna catena di deleghe) | no |
| Piano Pro | suo | vede i lucchetti del **proprio** account (A7.4) | n/d |

**Due inviti, due meccaniche, apposta.** Il professionista si registra da sé e
l'account resta suo (è il suo profilo di carriera fra più aziende). Il
collaboratore no: l'email porta un token monouso a `#/invito` e l'account
**nasce** lì, con la password scelta in quel momento. In entrambi i casi
`email_confirmed_at` è il cardine: è l'unica cosa che separa «ti colleghiamo
alla tua scheda» da «chiunque scriva l'email di un altro entra nel suo
organico».

---

## Parte B — Risultanze

Stato: ✅ chiusa (codice scritto, migration **da applicare**) · ⚠️ aperta ·
🔍 da verificare sul DB vivo.

### A1 — `my_staff_member_ids()` confonde «sono io» con «sono un delegato» ✅ Fase 1

`public.my_staff_member_ids()` (`20260916140000_promote_staff_member.sql`) torna
**tutte** le schede di chi chiama, e cinque punti la leggono come «conflitto
d'interessi». Effetto su un titolare che si mette in organico:

| Punto | Effetto oggi |
|---|---|
| policy `shift_assignments: owner all` | non può inserirsi né cancellarsi su un turno **finito**, né segnare la propria presenza |
| `freeze_assignment_payroll` (`v_own`) | le proprie `worked_hours` e il proprio `status` **congelati in silenzio** |
| `remove_staff_member` | `not allowed`: la propria scheda è inamovibile (e non ha un `leave_venue` da usare — l'azienda è la sua) |
| `guard_finished_shift_times` (`20260918170000`) | non può correggere data/orari di un turno finito su cui era in servizio |
| `default_assignment_confirmation` | **qui il comportamento è giusto e va tenuto**: mettersi in turno vale come conferma |

Il commento della funzione lo dice a voce alta — «per un titolare è sempre
vuota: un titolare non è mai in organico» — ed è quell'assunto a cadere.

### A2 — Le due porte dell'organico filtrano il ruolo ✅ Fase 2

- `find_waiter_by_email` → `p.role = 'waiter'` (`20260712085513`)
- `link_staff_invites_for_user` → `return 0` se il ruolo non è `waiter` (`20260916100200`)

Conseguenza concreta e **oggi silenziosa**: un titolare che scrive la propria
email in «Aggiungi allo staff» ottiene una scheda non collegata, un'email
d'invito a sé stesso e un aggancio che non avverrà mai (il trigger scatta alla
registrazione e rifiuta i manager). Nessun errore, nessun avviso.

A livello di tabella invece **niente lo vieta**: `staff_people.waiter_id` è una
FK semplice verso `profiles` senza controllo di ruolo, e `staff_people: owner
all` verifica solo `owner_id = auth.uid()`. La strada è libera: mancano
l'ingresso e le regole.

### A3 — Presenze e ore sulla propria riga: salvataggio muto ✅ Fase 2

`PresenceRow` in `src/app/(manager)/shift/[id].tsx` e
`web/src/shifts/PresenceSection.tsx`: il collaboratore promosso vede
Presente/Assente e il campo Ore sulla propria riga, tocca, e non si salva
niente — `freeze_assignment_payroll` congela in silenzio e
`setAssignmentPresence` fa un update senza `.select()`, quindi torna 200 e
l'interfaccia festeggia.

Noto e rimandato il 17/09. **Ora va chiuso**, perché dopo A1 quella riga deve
essere scrivibile per il titolare e non scrivibile per il collaboratore: è
l'unico posto in cui la differenza fra i due si vede a schermo.

### A4 — L'identità di un account gestore dentro l'organico ⚠️

`profiles: manager reads own staff` pretende `role = 'waiter'`
(`20260916130000`), quindi l'embed
`waiter:profiles!staff_members_waiter_id_fkey` di `getVenueStaff` /
`getOwnerPeople` non passa da lì per la scheda di un gestore. Passano altre
policy, ma non in tutti i casi:

- titolare che legge sé stesso → `profiles: own read/write` ✅
- collaboratore che legge il titolare → `profiles: delegate reads owner` ✅
- titolare che legge un collaboratore → `profiles: owner reads delegates` ✅
- **collaboratore che legge un altro collaboratore → nessuna policy** ❌ → riga
  senza foto, trattata come «scheda senza account»

Inoltre `waiter_public_cards` filtra `role = 'waiter'`: un gestore non ha card
pubblica, quindi ogni schermata che risolve nome e foto via
`get_waiter_public_card` (chat, `(manager)/cameriere/[id]`) su di lui resta
vuota. Nei casi della feature non si incontra — la chat esclude sé stessi e la
card pubblica non si apre sulla propria scheda — ma resta il limite da tenere
d'occhio quando due collaboratori lavorano nella stessa sede.

### A5 — Lato app non esiste «questa persona sono io» ✅ Fase 2

Tre nozioni di sé, tutte parziali: `useAuth().session.user.id` (chi sono),
`useOwnerVenues().ownerId` (l'azienda — **non** è il mio id se sono un
collaboratore), `useOwnerVenues().isOwner`. Manca «la mia scheda
nell'organico», che è ciò che serve a picker, planning, dettaglio turno, ore e
assenze per dire «Tu».

### A6 — Il consenso del professionista sta solo nel client ✅ Fase 3

`staff_members.link_status` ha default **`'active'`** (`20260712085513`) e le
policy non guardano `waiter_id`: chi gestisce una sede può inserire via REST una
scheda con `waiter_id` = un profilo qualunque — gli uuid dei professionisti sono
leggibili, `waiter_public_cards` è a lettura pubblica — e trovarselo in organico
**attivo**, senza invito da accettare. Da lì: turni assegnati, notifiche, e
lettura di `profiles` / `waiter_profiles` di quella persona via `manager reads
own staff`. Il passaggio `pending` esiste solo in `addStaff`
(`src/features/staff/api.ts`), cioè nel client.

Il guard che serve all'autoinserimento della Fase 2 è lo stesso che chiude
questo buco.

⚠️ Il guard ha una quarta deroga che non era nel piano e che serve: se la
persona ha **già** un'altra appartenenza attiva con lo stesso account presso
quell'azienda, il consenso esiste — altrimenti «aggiungi una sede»
(`addPersonToVenue`) e «rimetti in organico» (`reviveMembership`) sarebbero
morti. Solo `'active'`: chi ha lasciato tutte le sedi l'accordo l'ha chiuso, e
la UI diceva già la stessa cosa con `canReassign`.

### A8 — Chi modifica un turno si avvisa da sé ✅ Fase 1b

Emersa implementando, non nell'audit iniziale. `notify_on_shift_change`
(`20260915100000`) fa due cose a chi è assegnato quando cambiano data od orari:
gli manda «Turno modificato» e gli riporta lo stato a `'assigned'`, perché la
conferma valeva per un turno che non esiste più. Entrambe giuste verso gli
altri; verso chi ha appena premuto Salva erano una notifica (e una push) che gli
dice l'orario che ha scritto lui, e il proprio turno che torna «da confermare»
— senza nessuna schermata dal lato gestione da cui confermarlo, e per un
titolare nessun altro che possa farlo al posto suo.

La metà «non avvisare chi ha agito» esisteva già in `notify_on_assignment` e
`notify_on_assignment_removed`. Ora vale anche qui, per la notifica **e** per il
reset dello stato. Il gemello client `shiftNotifyRecipients`
(`src/features/shifts/notify.ts`) va tenuto allineato: prende il proprio
`waiter_id` e lo esclude, o la finestra di conferma del Planning promette un
avviso in più di quelli che partono.

### A7 — Da verificare sul DB vivo 🔍

MCP Supabase non era connesso quando questo audit è stato scritto. Query pronte
per l'SQL editor:

1. **Quali migration sono davvero applicate.** La memoria di progetto elenca 9+
   file «da applicare» fra `20260916110000` e `20260918…`, e le migration di
   questo piano presuppongono `20260916140000`, `20260918160000`,
   `20260918170000`.
   ```sql
   select version, name from supabase_migrations.schema_migrations
    order by version desc limit 20;
   ```
2. **`venues: public read`** — residuo del marketplace con `using (true)`: il
   16/09 sera risultava **ancora nel DB** nonostante `20260916150000` fosse
   registrata come applicata. Sono tutti i locali leggibili senza login.
   ```sql
   select polname, cmd, qual from pg_policies where tablename = 'venues';
   ```
3. **Ricorsione RLS `staff_members` ↔ `staff_people`** (42P17, rimediata da
   `20260918150000`): la feature scrive su entrambe, va riprovata dopo le
   migration. L'errore in UI è generico — si legge in `postgres_logs`.
4. `useIsPro()` legge `profiles.plan` di **chi guarda**, non del titolare: un
   collaboratore su un account Pro vede i lucchetti. Noto, non risolto.
5. La RLS filtra righe e non colonne: un delegato con `'staff'` legge via API
   anche `contract_hours` / `note` / `email` delle persone delle sue sedi.
   L'app glieli nasconde. Limite accettato (F4).

---

## Parte C — Implementazione

### Fase 1 — DB: il titolare non è un delegato ✅ fatta

`supabase/migrations/20260919100000_owner_is_not_a_delegate.sql`.

Si aggiunge **una funzione accanto**, non si cambia il significato di quella
esistente:

```sql
create or replace function private.my_delegate_staff_member_ids()
returns setof uuid language sql stable security definer set search_path = ''
as $$
  select sm.id
    from public.staff_members sm
    join public.venues v on v.id = sm.venue_id
   where sm.waiter_id = (select auth.uid())
     and v.owner_id is distinct from (select auth.uid());
$$;
```

Le schede di chi chiama **presso aziende altrui**: cioè quelle su cui è un
collaboratore e non il titolare. Un elenco e non un predicato (dentro una policy
la forma booleana dipende dalla riga e verrebbe valutata una volta per riga);
`is distinct from` e non `<>` perché un null deve ricadere sul lato prudente; in
`private` perché PostgREST espone come RPC tutto ciò che sta in `public`.

Riscritti sostituendo **solo** la sorgente dell'elenco:

- policy `shift_assignments: owner all`;
- `freeze_assignment_payroll` — `v_own` (ricopiata dalla versione
  `20260918170000`, quella con `v_can_role` e `assignment_identity_locked`);
- `remove_staff_member` — e con essa una seconda correzione che vale solo grazie
  alla prima: la notifica «Collaborazione terminata» non parte più verso sé
  stessi (stessa guardia del trigger gemello `notify_on_staff_removed`);
- `guard_finished_shift_times`.

**Non** si toccano, di proposito: `default_assignment_confirmation` (resta su
`my_staff_member_ids()` non filtrata — là la domanda è «chi sta entrando in
turno», e mettersi in turno *è* la conferma), `private.can_self_plan`, e le
policy del lato professionista, che valgono per chiunque abbia una scheda.

### Fase 1b — Il trigger delle modifiche salta chi agisce ✅ fatta

`supabase/migrations/20260919100200_shift_change_skips_self.sql`: chiude **A8**.
`notify_on_shift_change` riscritta per intero (era `20260915100000`) con due
sole differenze — `sm.waiter_id is distinct from auth.uid()` fra i destinatari,
e `staff_member_id not in (select my_staff_member_ids())` sul reset dello stato.
⚠️ `is distinct from` e non `<>`: con `auth.uid()` nullo il secondo darebbe
null e **nessuno** riceverebbe la notifica.

### Fase 2 — «Metti te stesso in organico» ✅ fatta

**Data layer** — `src/features/staff/api.ts`. Nessuna RPC nuova:
`addStaffToVenues` accetta già `waiterId` e `linkStatus`. Si aggiunge il wrapper
che rende la decisione esplicita invece di ripeterla in due UI:

```ts
export async function addSelfToStaff(args: {
  ownerId: string; myId: string; venueIds: string[]; fullName: string;
  employmentType: Enums<"employment_type">; phone?: string | null;
}): Promise<StaffMember[]>   // linkStatus 'active', email null, nessun invito
```

Niente email e niente invito: il consenso è il gesto stesso. Passa da
`addStaffToVenues`, così riusa `findLeftMembership` / `reviveMembership` e chi si
era tolto e si rimette non crea una seconda scheda.

**«Sono io»** — nuovo `src/features/staff/self.ts` (nessun import di React
Native: lo riusa la dashboard web), che compone quello che c'è già:

```ts
useSelfStaff() → {
  myId: string;
  person: OwnerPerson | undefined;                   // da useOwnerPeople(ownerId)
  hasCard: boolean;
  isSelf: (waiterId: string | null | undefined) => boolean;
  canEditOwnPayroll: (venueId: string) => boolean;   // possiedo quella sede
  isPending: boolean;
}
```

`canEditOwnPayroll` è la traduzione in UI della regola di Fase 1 — il titolare
si scrive presenze e ore, il collaboratore no — e sta in un posto solo invece di
in cinque schermate.

**Hook** in `src/features/staff/hooks.ts`: `useAddSelfToStaff()`, con le stesse
invalidazioni di `useAddStaff`.

**App**

| File | Cosa |
|---|---|
| `src/app/(manager)/(tabs)/staff.tsx` | card «Metti te stesso in organico — per assegnarti i turni e contare le tue ore» quando `canStaff && !self.person`; `Pill` «Tu» sulla propria riga di `PersonRow` |
| `src/app/(manager)/staff/new.tsx` | modalità `?self=1`: copy diverso, nome prefillato da `profile.full_name` e in sola lettura, **campo email assente**, restano sedi / tipo / ruoli. Nessuna rotta nuova (una rotta nuova richiederebbe di rigenerare `.expo/types/router.d.ts` col dev server) |
| `src/app/(manager)/staff/[id].tsx` | sulla propria scheda spariscono `PromoteSection`, «Messaggio», invito e reinvio email, scheda pubblica; compare «Questo sei tu». Regola: **ogni ramo che oggi dipende da `waiterId` va riletto come «e non sono io»**. «Togliti dall'organico» resta al titolare |
| `src/features/assignments/StaffAssignPicker.tsx` | badge «Tu» |
| `src/features/assignments/PeopleWeekList.tsx` | badge «Tu» nella griglia del planning |
| `src/app/(manager)/shift/[id].tsx` | `PresenceRow`, chiude **A3**: sulla riga propria i controlli restano se `canEditOwnPayroll(venueId)`, altrimenti stato e ore in sola lettura con la nota «Le tue presenze le segna chi ha il permesso Ore». E niente chat né scheda pubblica verso sé stessi |
| `src/app/(manager)/(tabs)/turni.tsx` | filtro «I miei turni» accanto a «Solo i turni scoperti»; i due si sommano, e ognuno compare solo se filtra qualcosa |
| `src/app/(manager)/(tabs)/index.tsx` | card «Il tuo prossimo turno» + `Pill` «Tu» in «Chi lavora oggi» |
| `src/features/shifts/api.ts` + `src/features/assignments/coverage.ts` | `staff_member_id` nell'embed di `getOwnerShifts`: è quello che rende gratis il filtro «I miei turni» e la card in home. Facoltativo nel tipo, perché la copertura non lo guarda |
| `src/lib/errors.ts` | `staff_link_needs_consent` (Fase 3) tradotto, **prima** del generico sui permessi |

⚠️ `src/features/planning/TeamRow.tsx` non serviva: il planning del
professionista scrive già «(nome) (tu)» da `is_me`, che arriva dalla RPC
`get_staff_planning`.

**Web — i gemelli** (il data layer è condiviso, la UI no):
`pages/Staff.tsx` + `staff/AddStaffPanel.tsx` (ingresso e badge),
`staff/StaffDetail.tsx` (guard sulla propria scheda),
`shifts/PresenceSection.tsx` + `shifts/ShiftPanel.tsx` (A3: la sezione prende
ora anche `venueId`), `shifts/PeopleWeek.tsx` (badge), `pages/Planning.tsx`
(esclude sé stessi dai destinatari promessi nella finestra dello spostamento —
vedi **A8**), `pages/Chat.tsx` (⚠️ `useOwnerPeople(managerId)` è l'elenco con
cui si apre una conversazione: la propria scheda va esclusa).

**Niente da fare, per costruzione** — solo da verificare: **ore ed export**
(`get_owner_hours_summary` passa da `staff_members` / `staff_people` e non
guarda il ruolo) e le **assenze** (`can_manage_person` è vera sulla propria
persona, quindi il titolare registra le proprie ferie).

### Fase 3 — Hardening del consenso (A6) ✅ fatta

`supabase/migrations/20260919100100_staff_link_consent.sql`: trigger su
`staff_members` (insert e update di `waiter_id` / `link_status`) che ammette
`link_status = 'active'` con un `waiter_id` **solo** se:

- `waiter_id = auth.uid()` → è l'autoinserimento della Fase 2;
- la riga arriva da `respond_to_staff_invite` o
  `link_staff_invites_for_user` → flag di sessione via `set_config`, lo stesso
  schema di `app.staff_exit` in `remove_staff_member`;
- `auth.uid()` è nullo → service role, editor SQL.

Altrimenti `staff_link_needs_consent`, tradotto in `src/lib/errors.ts`. Sono
~40 righe e toccano la tabella che la Fase 2 sta già aprendo.

### Fase 4 — Questo documento ✅ fatta

Aggiornarlo quando i ruoli cambiano: la matrice della Parte A e lo stato delle
risultanze della Parte B sono la parte che invecchia.

---

## Verifica

**Stato al 2026-09-17**: codice e migration scritti, `npx tsc --noEmit` e
`yarn lint src web/src web-site/src` puliti (restano 4 warning preesistenti in
`web/`, nessuno nei file toccati). ⚠️ **Le tre migration nuove non sono
applicate** e nessuna prova è stata fatta contro il database: MCP Supabase non
era connesso in sessione.

| Migration | Chiude |
|---|---|
| `20260919100000_owner_is_not_a_delegate.sql` | A1 |
| `20260919100100_staff_link_consent.sql` | A6 |
| `20260919100200_shift_change_skips_self.sql` | A8 |

**Prerequisito.** Nell'SQL editor, confermare che `20260916140000`,
`20260918150000`, `20260918160000` e `20260918170000` risultino applicate (query
A7.1). Se mancano, applicarle prima, in ordine, e allineare a mano la history.

**DB, impersonando** — `set local role authenticated; set local
request.jwt.claims = '{"sub":"<uuid>"}'` — su due account, il titolare e un
collaboratore promosso, entrambi con una scheda in organico:

| Prova | Titolare | Collaboratore |
|---|---|---|
| insert `shift_assignments` su turno **futuro** proprio | ok | ok (`can_self_plan`) |
| insert su turno **finito** proprio | ok | rifiutato |
| update `worked_hours` sulla propria riga | **salva** | congelato in silenzio |
| update `status` → `no_show` sulla propria riga | salva | congelato |
| `remove_staff_member` sulla propria scheda | ok | `not allowed` |
| update `shifts.start_time` su turno finito proprio | ok | `finished_shift_locked` |
| insert scheda altrui con `link_status = 'active'` (Fase 3) | `staff_link_needs_consent` | idem |
| `addPersonToVenue` su chi è già attivo altrove (Fase 3, deroga) | ok | ok |
| cambiare l'orario di un turno futuro su cui sono (Fase 1b) | nessuna notifica a sé, la propria conferma resta | idem |

⚠️ Con `auth.uid()` nullo (MCP, service role) i trigger a seconda del punto sono
fail-closed o passano: le prove vanno fatte **impersonando**, non da service
role.

**App e web.** `npx tsc --noEmit`, `yarn lint src web/src web-site/src` (i path
vanno nominati: senza, `expo lint` salta `web/` e `web-site/`) — **fatti**. Poi
`expo run:ios --no-bundler` e la dashboard: **da fare**, e prima vanno applicate
le migration.

Giro a mano: mi metto in organico → compaio nel picker con «Tu» → mi assegno un
turno (nessuna notifica a me stesso, turno già confermato) → compare in home
come «Il tuo prossimo turno» e sotto il filtro «I miei turni» → il turno finisce
→ segno le ore (titolare: salva; collaboratore: sola lettura con la nota) →
`/ore` mi elenca e l'export CSV/PDF mi contiene → registro le mie ferie → la
chat non mi propone me stesso → la mia scheda non offre «Promuovi», «Messaggio»
né il profilo pubblico.

**Regressioni da guardare in particolare**: che il collaboratore promosso
continui a pianificarsi e a **non** scriversi le ore — è la regola che questo
piano taglia a metà per il solo titolare — e che l'organico visto da un
collaboratore mostri ancora nomi e foto (A4).
