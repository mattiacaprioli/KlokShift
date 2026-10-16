# Ruoli: titolare, collaboratore, dipendente

> Come stanno insieme i tre ruoli, dopo il refactor del 2026-09-20.
> Il modello e le regole del database stanno in `supabase/README.md`; qui c'è la
> **matrice di cosa può fare ciascuno** e la storia di come ci si è arrivati.

## Perché è stato rifatto

Il prodotto aveva **due assi di identità**, costruiti in momenti diversi e mai
incrociati del tutto:

- **chi gestisce** — `venues.owner_id` (titolare) + `venue_access` (collaboratore
  con permessi per sede);
- **chi lavora** — `staff_people` (la persona dell'azienda) + `staff_members`
  (l'appartenenza a una sede), agganciate a un account tramite `waiter_id`.

L'azienda non aveva una tabella: era l'`id` del titolare, copiato a mano in
quattro tabelle senza una FK che lo controllasse. Ogni volta che la stessa
persona finiva su entrambi gli assi — il titolare che fa il servizio, il
professionista promosso a collaboratore — serviva una patch:

| Sintomo | Misura |
|---|---|
| «non decidi di te stesso» riscritta da capo | 3 volte in 3 giorni (`20260916140000` → `20260918160000` → `20260919100000`) |
| `freeze_assignment_payroll` | 7 versioni |
| policy che si leggevano a vicenda | una ricorsione (42P17) che ha rotto ogni insert sull'organico |
| stessa regola scritta in più punti | `owner_id = auth.uid()` a mano in 11 posti, la CASE dei permessi in 3 |
| mirror da tenere allineati | `staff_members.display_name/waiter_id/phone/note` + 3 trigger |
| scritture del client non atomiche | `addStaffToVenues` 4-7 round trip, `updateInternalShift` 6+ |
| update che non scrivevano nulla senza dirlo | ~40 chiamate senza `.select()` |

## Il modello di adesso

Un asse solo. **authority** (cosa puoi fare) e **organico** (dove lavori) sono
ortogonali, e un titolare in turno non è più un caso speciale.

```
workspaces         l'azienda
venues             le sedi
workspace_members  UNA persona nell'azienda: authority owner | collaborator | none
venue_members      dove lavora — il bersaglio delle assegnazioni
```

- «dipendente» = `authority none` + righe in `venue_members`;
- «collaboratore» = `authority collaborator` + i suoi 5 permessi + un ambito
  (tutte le sedi, anche quelle future, oppure un elenco);
- «titolare» = `authority owner`, che ha ogni permesso per costruzione;
- chiunque dei tre può anche **lavorare**, e allora ha righe in `venue_members`.

Un account può stare in più aziende con authority diverse: titolare della
propria, dipendente di un'altra.

---

## La matrice

Un'unica sorgente decide tutto: la view `private.member_venue_grants` (per ogni
utente e sede: authority e permessi). Da lì derivano `venues_where(perm)`,
`can(venue, perm)`, `can_person(member, perm)`, `is_restricted_self(member)`.

| Oggetto | Titolare | Collaboratore | Dipendente |
|---|---|---|---|
| Aprire / chiudere una sede | sì | **mai** | no |
| Cedere la titolarità | sì (`transfer_ownership`) | no | no |
| Dati della sede, listino mansioni | sì | permesso «Sede» | sola lettura sulle sue sedi |
| Turni (crea, modifica, duplica) | sì | «Turni» | no |
| Assegnazioni | sì, **anche le proprie** | «Turni», sulle proprie solo a turno non concluso | conferma/rifiuta le proprie |
| Organico: leggere | sì | «Turni» o «Organico» | solo sé stesso |
| Organico: aggiungere / modificare / togliere | sì | «Organico», solo dipendenti e solo nelle sue sedi | `leave` su sé stesso |
| Anagrafica della persona | tutto | «Organico» | legge la propria |
| Note e ore da contratto (`member_hr`) | sì | «Organico», **mai le proprie** | legge le proprie |
| Presenze e ore lavorate | sì, **anche le proprie** | «Ore», **mai le proprie** | no (le legge) |
| Export ore | sì | «Ore» | no |
| Documenti | sì | «Documenti» | i propri |
| Assenze | sì, **anche le proprie** | «Organico», **mai le proprie** | chiede le proprie |
| Chat | sì | **no** (è fra l'azienda e la persona) | sì |
| Invitare collaboratori | sì | **no** (nessuna catena di deleghe) | no |
| Piano | dell'**azienda** (`workspaces.plan`), non di chi guarda | — | — |

**La regola «su me stesso»** è una funzione sola, `private.is_restricted_self`:
vera per chi non è titolare, sulla propria appartenenza. La chiamano le RPC di
presenze e ore, rimozione, assenze, risoluzione dei cambi turno e i due trigger
di guardia. Vale **per appartenenza**: essere titolare di un'altra azienda non
dà nessun potere su questa.

**Due inviti, due meccaniche, apposta.** Il dipendente si registra da sé e
l'account resta suo (è il suo profilo di carriera fra più aziende): l'aggancio
alla scheda lo fa il trigger su `auth.users` quando l'email risulta confermata.
Il collaboratore no: l'email porta un token monouso, e l'account **nasce** quando
sceglie la password. In entrambi i casi `email_confirmed_at` è il cardine — è
l'unica cosa che separa «ti colleghiamo alla tua scheda» da «chiunque scriva
l'email di un altro entra nel suo organico».

---

## Cosa è sparito, e cosa resta da guardare

**Chiusi dal refactor**

- `venues: public read` con `using (true)`: tutte le sedi erano leggibili senza
  login. Ora `venues` la leggono solo chi la gestisce e chi ci lavora.
- `profiles.role` e `profiles.plan` scrivibili dal client: il ruolo non esiste
  più (si ricava dalle appartenenze), il piano è dell'azienda e non ha nessun
  GRANT di scrittura.
- Il permesso «Sede» che il client mostrava e il DB rifiutava: ora `venues` ha
  una policy di UPDATE per chi ha quel permesso.
- Le scritture non atomiche e gli update muti: RPC con errori espliciti, e
  INSERT/UPDATE/DELETE revocati per default.
- Il token d'invito che passava da chi invitava.

**Da tenere d'occhio**

- La RLS filtra righe e non colonne: i dati sensibili della persona stanno in
  `member_hr`, tabella separata, ma `workspace_members` resta leggibile per
  intero a chi vede la persona (nome, telefono, email).
- La chat è fra il professionista e il **titolare** dell'azienda: un
  collaboratore non vede quelle conversazioni ed è una scelta, non una
  dimenticanza.
- Più titolari per azienda sono ammessi dallo schema (c'è il vincolo «almeno uno
  attivo»), ma non c'è UI per aggiungerne un secondo: si passa da
  `transfer_ownership`.

## Verifica

`supabase/tests/run.sh reset && supabase/tests/run.sh test` — cinque suite che
impersonano sei attori (titolare in turno, due collaboratori con permessi e
ambiti diversi, due dipendenti di cui uno titolare di un'altra azienda, un
estraneo, più `anon`): identità e visibilità, turni e regole «su me stesso»,
persone (assenze, cambi turno, chat, documenti, report, eliminazione account),
inviti, e la superficie dei permessi — cosa è scrivibile e da chi, così una
migration futura non può riaprire una porta per sbaglio.
