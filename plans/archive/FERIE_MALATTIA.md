# Ferie, permessi e malattia

> ⚠️ **Documento di piano scritto prima del refactor del 2026-09-20.** La feature
> è implementata e funziona, ma i riferimenti al database sono cambiati:
> le assenze stanno sul **membro** (`staff_absences.member_id` →
> `workspace_members`, niente `owner_id`), `request_absence` prende l'azienda
> (`p_workspace`), `get_owner_absence_summary` è diventata `get_absence_summary`,
> e `can_manage_person` è `private.can_person`. Vedi `supabase/README.md`.

> **Stato (16/09/2026): F1, F2 e F3 fatte, migration applicate** (`20260918100000`–`100200`, `20260918110000`, `20260918120000`). Resta solo il blocco «Dopo».
>
> **17/09/2026 — pagina Assenze dell'azienda.** Non è una tab, perché le assenze arrivano poche volte al mese e la barra del titolare è piena: 7shifts e Homebase le mettono nel menu, Deputy e When I Work in una card della home.
> - **App**: `(manager)/assenze`, raggiunta dalla card «Assenze» nella tab Staff. Il badge sulla tab Staff conta le richieste da decidere.
> - **Web**: `/assenze`, con la voce e il badge nella barra laterale.
> - **Contenuto**: le richieste da decidere, le assenze in corso e prossime, quelle passate o chiuse degli ultimi 60 giorni (`getCompanyAbsences`, `groupCompanyAbsences`). Lo storico completo resta nella scheda della persona.
> - **Notifiche**: la copia per il collaboratore porta qui e non più alla home.
>
> Come è stata fatta F2:
> - `get_absence_availability` restituisce le assenze a chi gestisce l'organico o i turni (`my_venue_ids('roster')`), senza mai il tipo.
> - I conflitti con i turni li calcola `absenceConflicts` in `src/features/absences/conflicts.ts`, confrontando istanti e non date: un turno notturno e un permesso a ore si comportano quindi come ci si aspetta. I turni della persona si leggono con la RLS di `shift_assignments`, perciò un delegato con il solo permesso Organico vede l'assenza ma non i conflitti.
> - «Togli dai turni» cancella l'assegnazione, come la modifica di un turno: parte il trigger «Turno revocato» e il turno resta scoperto. Il comando compare nel dialog di approvazione («Approva e togli dai turni») e sulle assenze già approvate: card in chat, home e scheda persona. Questo copre anche la malattia, che non passa dall'approvazione.
> - Nel planning web (`PeopleWeek`) le celle delle assenze sono tratteggiate, più leggere se l'assenza è in sospeso. Un turno in conflitto ha il bordo arancione. Trascinare un turno su una persona assente chiede conferma.
> - Nel planning dell'app (`PeopleWeekList`) i pallini dei giorni di assenza sono tratteggiati e sotto il nome c'è una riga con l'assenza.
> - I picker di assegnazione (web `ShiftPanel`, app `StaffAssignPicker`) avvisano senza bloccare. Nella ripetizione su più giorni l'avviso vale solo per il giorno principale.
> - Nell'agenda del professionista, un turno che cade in una sua assenza approvata **presso lo stesso titolare** mostra «Sei in ferie» o simile.
>
> Nell'implementazione di F1 il piano è cambiato su tre punti:
> - le migration sono tre, con gli enum per primi, e la tabella sta nell'ultima;
> - lo stato delle assenze non passa da `RealtimeSync` ma dalle notifiche (`DOMAINS_BY_TYPE` in `useNotificationsRealtime.ts`), come per le richieste di cambio turno;
> - il blocco «Richieste» della home non esisteva e l'abbiamo creato da zero. Contiene solo le assenze, perché le richieste di cambio turno restano nel dettaglio del turno.
>
> Come è stata fatta F3:
> - `get_owner_absence_summary(p_from, p_to)` conta solo le assenze approvate, con la fine esclusa come nel riepilogo ore, e la vede chi ha il permesso Ore.
> - Per ogni persona restituisce: giorni di ferie, giorni di permesso a giornata intera, ore di permesso a ore, giorni di malattia e protocolli INPS. I giorni sono di calendario tagliati sul mese, e la nota `ABSENCE_SUMMARY_NOTE` lo scrive nella pagina e nel PDF.
> - La pagina Ore (app e web) ha una sezione «Assenze del mese».
> - Il PDF delle ore aggiunge una tabella «Assenze». Le assenze escono anche in un **CSV separato**, `assenze-<azienda>-<mese>.csv` (`buildAbsencesCsv`), perché lo schema del CSV delle ore non cambia.

## Contesto

Oggi l'app sa chi è assegnato a un turno, ma non sa chi **non può** lavorare. Le ferie si chiedono in chat come testo libero e la malattia arriva con un messaggio o una telefonata. Il titolare deve ricordarsele a memoria mentre prepara il planning, e a fine mese deve ricostruirle per il commercialista.

L'obiettivo:

1. il professionista chiede ferie o permessi e comunica la malattia dall'app;
2. il titolare approva (ferie e permessi) o prende atto (malattia);
3. il planning mostra chi è assente e avvisa se lo si assegna a un turno;
4. il riepilogo mensile per il commercialista include giorni di ferie, ore di permesso e giorni di malattia.

Viene **prima** del clock in/out (`CLOCK_IN_OUT.md`): tocca il planning, che è il cuore del prodotto, e non richiede né una build nativa né un QR fisico in sede.

## Decisioni di fondo

### L'assenza è della persona, non del turno né della sede

L'assenza sta su `staff_people` (persona × titolare), come i documenti e il contratto. Chi lavora in due sedi dello stesso titolare chiede le ferie una volta sola e valgono per entrambe.

Chi lavora per **due titolari diversi** ha due `staff_people` distinti: le richieste sono separate, perché ogni azienda decide per sé. Nel form, se il professionista appartiene a più aziende, sceglie a quali mandare la richiesta (una riga per azienda).

### Tabella nuova, non un tipo in più di `shift_change_requests`

Il commento di `20260915140000_change_request_kinds.sql` prevedeva un futuro kind `time_off`. Non lo usiamo:

- `shift_change_requests.shift_id` è `not null`: una richiesta di cambio riguarda un turno. Le ferie riguardano un intervallo di date, e spesso quando si chiedono i turni non esistono ancora.
- Approvare un cambio turno riscrive un'assegnazione. Approvare le ferie non tocca nessun turno da solo (vedi sotto).

Riusiamo invece lo **schema** di quella feature: sola lettura via RLS, scrittura solo da RPC `SECURITY DEFINER`, card in chat, notifiche dedicate. Il commento nella nuova migration deve spiegare perché `time_off` non è stato aggiunto a quell'enum.

### Approvare non toglie nessuno dai turni in automatico

Stessa filosofia delle richieste `hours`: un tap su «Approva» non deve cancellare assegnazioni come effetto collaterale. Il dialog di approvazione **mostra** i turni in conflitto e propone «Togli dai turni» come azione esplicita.

### ⚠️ Malattia = dati sanitari (GDPR art. 9)

- Si salvano **solo** le date e, facoltativo, il **numero di protocollo** del certificato telematico INPS. Mai diagnosi, mai allegati medici.
- Il campo nota della malattia non esiste: al suo posto un testo che ricorda di non scrivere informazioni sulla salute.
- La malattia **non si approva**: il professionista la comunica e il titolare la vede. Nasce già `approved`.
- Il protocollo spesso arriva dopo la visita: si può aggiungere in un secondo momento.
- I colleghi non vedono mai il **tipo** di assenza. Anche chi ha solo il permesso sui turni vede «non disponibile», non «malattia».

### Niente saldo ferie nel MVP

Il saldo di ferie maturate e residue lo tiene il consulente del lavoro. L'app registra le assenze e le esporta, ma non calcola i contatori. Se servirà, si aggiunge dopo un «saldo iniziale» manuale sulla persona.

## 1. Database

Una migration principale più le migration separate per i valori aggiunti agli enum esistenti (convenzione del repo: un `alter type ... add value` in un file a sé).

### `20260918100000_staff_absences.sql`

```sql
create type public.absence_kind as enum ('ferie', 'permesso', 'malattia');
create type public.absence_status as enum ('pending', 'approved', 'rejected', 'withdrawn');

create table public.staff_absences (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.staff_people(id) on delete cascade,
  owner_id  uuid not null references public.profiles(id) on delete cascade, -- denormalizzato per la RLS, come staff_people
  kind public.absence_kind not null,
  start_date date not null,
  end_date   date not null,
  start_time time,   -- solo per 'permesso' a ore, stesso giorno
  end_time   time,
  note text,                 -- motivo ferie/permesso; sempre null per 'malattia'
  inps_protocol text,        -- solo 'malattia'
  status public.absence_status not null default 'pending',
  requested_by uuid references public.profiles(id) on delete set null, -- null = inserita dal titolare
  resolved_by  uuid references public.profiles(id) on delete set null,
  resolved_at  timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),

  check (end_date >= start_date),
  check ((start_time is null) = (end_time is null)),
  check (start_time is null or (kind = 'permesso' and start_date = end_date and end_time > start_time)),
  check (kind = 'malattia' or inps_protocol is null),
  check (kind <> 'malattia' or note is null)
);

create index staff_absences_person_dates_idx on public.staff_absences (person_id, start_date, end_date);
create index staff_absences_owner_status_idx on public.staff_absences (owner_id, status, start_date);
```

**RLS (sola lettura):**

- `requester read`: la persona collegata (`staff_people.waiter_id = auth.uid()`) legge le proprie.
- `manager read`: il titolare, oppure un collaboratore con permesso `staff` su almeno una sede dove la persona è in organico attivo. Usare l'helper del perimetro delegati (`20260916130000_delegate_perimeter.sql`), non riscriverlo.
- Nessuna policy di insert, update o delete.

**RPC (`SECURITY DEFINER`, `search_path = ''`, `revoke from anon, public`):**

| Funzione | Chi | Cosa fa |
|---|---|---|
| `request_absence(p_owner, p_kind, p_start, p_end, p_start_time, p_end_time, p_note, p_inps_protocol)` | professionista | Trova la persona con `owner_id = p_owner and waiter_id = auth.uid()`, con organico non `left`. Controlla le sovrapposizioni. `malattia` nasce `approved`, gli altri tipi `pending`. Scrive la card in chat e la notifica. |
| `resolve_absence(p_id, p_approve, p_note)` | titolare o delegato `staff` | Solo da `pending`. Scrive `resolved_*`, card di risposta e notifica. |
| `withdraw_absence(p_id)` | chi l'ha chiesta | Da `pending`, oppure da `approved` se `start_date > local_now()::date`. |
| `record_absence(p_person, ...)` | titolare o delegato `staff` | Assenza inserita dal titolare (es. malattia comunicata al telefono). Nasce `approved`, `requested_by` null. |
| `set_absence_inps_protocol(p_id, p_protocol)` | professionista o titolare | Aggiunge il protocollo dopo. |
| `get_absence_availability(p_from, p_to)` | chi legge il planning | Restituisce solo `person_id`, date, orari, `pending`/`approved`. **Mai il tipo.** È la fonte per il planning e per i delegati senza permesso `staff`. |

**Sovrapposizioni:** controllo nella RPC, non con un exclusion constraint. Con `permesso` a ore due righe nello stesso giorno sono legittime, e l'errore deve arrivare in italiano leggibile (`userErrorMessage` in `src/lib/errors.ts`). Stati attivi: `pending` e `approved`.

**Date:** «oggi» e «futuro» si confrontano con `local_now()`, mai con `current_date` (UTC).

### Migration separate per gli enum

- `20260918100100_notification_types_absence.sql`: `absence_request`, `absence_response`, `absence_sick`.
- `20260918100200_message_kind_absence.sql`: `absence_request`, `absence_response` su `message_kind`. In più, sullo stesso modello di `messages.request_id`, una colonna `absence_id uuid references staff_absences on delete set null` su `messages`.

`notify_on_new_message` salta già le righe con `kind <> 'text'`: non manda notifiche doppie.

Dopo l'applicazione (MCP Supabase + allineamento della history, vedi memoria `supabase-cli-no-token`): rigenerare `src/types/database.ts`.

## 2. Data layer — `src/features/absences/`

Stessa struttura di `src/features/changeRequests/`.

- `api.ts`: `requestAbsence`, `resolveAbsence`, `withdrawAbsence`, `recordAbsence`, `setAbsenceInpsProtocol`, `getMyAbsences`, `getPersonAbsences(personId)`, `getPendingAbsences()`, `getAbsenceAvailability(from, to)`.
- `hooks.ts`: hook React Query corrispondenti. Invalidazioni: assenze della persona, pendenti, disponibilità, planning. Chiavi nuove in `src/lib/queryKeys.ts`. Le chiavi del lato titolare vanno tenute nel `clear()` al cambio account (memoria `query-cache-account-switch`).
- `labels.ts`: `ABSENCE_KIND_LABEL` (`Ferie`, `Permesso`, `Malattia`), `ABSENCE_STATUS_LABEL`, `formatAbsenceRange` (riusa `src/lib/format.ts`).
- `conflicts.ts`: `absenceConflicts(assignments, absences)`. Funzione pura: dato un elenco di turni della persona e le assenze, restituisce i turni in conflitto. Usa `shiftEndsAt` per i turni che scavalcano la mezzanotte; un permesso a ore è in conflitto solo se si sovrappone all'orario.
- `AbsenceRequestCard.tsx`: card in chat, sul modello di `ChangeRequestCard.tsx`.
- Realtime: niente `RealtimeSync`. Le tre notifiche `absence_*` invalidano `qk.absences.all` tramite `DOMAINS_BY_TYPE`.

## 3. App professionista

- **`(waiter)/assenze.tsx`**: lista delle mie assenze (in attesa, approvate, passate) con pulsante «Nuova richiesta». Entry point dal profilo e dalla tab Turni.
- **`(waiter)/assenze/nuova.tsx`**: form.
  - tipo (segmented: Ferie / Permesso / Malattia);
  - date da–a (riuso del `PickerField` esistente); per Permesso, switch «A ore» con orario;
  - nota (non per Malattia);
  - Malattia: campo «Numero di protocollo INPS (facoltativo)» e il testo «Non scrivere qui informazioni sulla tua salute: al titolare servono solo le date»;
  - se in più aziende: scelta dell'azienda.
- **Agenda**: un turno che cade in un'assenza approvata mostra la dicitura «Sei in ferie» o simile. Il turno non sparisce: lo toglie il titolare.
- Stringhe con il vocabolario del repo: «professionista», «sede».
- Dopo le nuove rotte: rigenerare i typed routes con il dev server (memoria `expo-typed-routes-regen`).

## 4. Titolare e collaboratori

**App (`(manager)`) e dashboard web:**

- **Da gestire**: nella home, un blocco «Richieste» con le assenze `pending` e le malattie appena comunicate, accanto alle richieste di cambio turno.
- **Dialog di approvazione**: tipo, date, nota, e l'elenco dei **turni in conflitto** (`absenceConflicts`). Pulsanti: «Approva», «Approva e togli dai turni», «Rifiuta» con nota. «Togli dai turni» usa il percorso esistente di rimozione o riassegnazione, così scattano le notifiche già previste.
- **Malattia comunicata**: notifica con i turni dei prossimi giorni e un link al turno per trovare un sostituto.
- **Scheda persona**: sezione «Assenze» in `(manager)/staff/[id].tsx` e `web/src/staff/StaffDetail.tsx`, con elenco e «Registra assenza» (`record_absence`).
- **Planning**:
  - web, `web/src/shifts/PeopleWeek.tsx`: cella tratteggiata per i giorni di assenza; `pending` con stile più leggero;
  - assegnando una persona assente (picker del turno in app e web, drag in `PeopleWeek`): **avviso, non blocco**, come per le ore da contratto (`src/features/staff/contract.ts`);
  - i dati arrivano da `get_absence_availability`, quindi chi ha solo il permesso turni non vede il tipo.
- **Planning dei colleghi** (`get_staff_planning`): nel MVP nessuna informazione sulle assenze.

## 5. Riepilogo per il commercialista

- RPC `get_owner_absence_summary(p_from, p_to)`, gate permesso `hours`: per persona, giorni di ferie, ore di permesso, giorni di malattia con i protocolli. Solo `approved`.
- Giorni di ferie: giorni di calendario dell'intervallo tagliati sul mese. Non conviene contare giorni lavorativi: dipendono dal contratto, e il conteggio lo fa il consulente. Scriverlo nell'intestazione dell'export.
- Pagina Ore (app `(manager)/ore.tsx` e web) ed export PDF/CSV (`src/lib/export.ts`): colonne in più. Le ore lavorate non cambiano.

## 6. Fasi

1. **F1 — Richiesta e risposta**: migration, RPC, feature module, form del professionista, approvazione del titolare (app e web), card in chat, notifiche.
2. **F2 — Planning**: bande in `PeopleWeek`, avvisi all'assegnazione, conflitti nel dialog di approvazione, dicitura nell'agenda del professionista.
3. **F3 — Export**: riepilogo e colonne nell'export.
4. **Dopo**: saldo ferie manuale, altri tipi (congedi, 104), reminder per il protocollo INPS mancante.

## Fuori scope

Saldo ferie automatico, allegati, calendario festività, permessi retribuiti e non retribuiti come tipi separati, integrazioni con software paghe.

## Verifica

1. **SQL**, impersonando gli utenti seed con `set_config('request.jwt.claims', ...)`:
   - il professionista crea ferie `pending` e malattia `approved`;
   - una sovrapposizione restituisce l'errore;
   - un `insert` o `update` diretto su `staff_absences` viene negato;
   - un collega non legge le assenze altrui;
   - un delegato con solo `shifts` riceve le righe da `get_absence_availability` ma non legge la tabella;
   - `withdraw_absence` su ferie già iniziate fallisce.
2. `get_advisors` security: nessun errore nuovo oltre ai WARN attesi sulle funzioni DEFINER.
3. `npx tsc --noEmit`, `yarn lint`, `npx expo export --platform ios`.
4. **End-to-end** con due account seed: il professionista chiede le ferie → il titolare riceve notifica e card → approva e toglie dai turni → il professionista riceve la notifica del turno rimosso → il planning web mostra la cella tratteggiata → l'export del mese riporta i giorni.
5. Nessuna build nativa necessaria: solo JavaScript.
