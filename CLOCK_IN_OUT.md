# Clock in / clock out del turno (metodo configurabile per professionista)

> **Stato 2026-09-24:** implementato il primo flusso end-to-end: fondamenta DB,
> metodo `app`, entrata/uscita del professionista, correzione/annullamento
> append-only e approvazione dalla dashboard. La sede parte da `manual` e può
> abilitare `app`; dalla scheda staff, su app manager e dashboard, si può anche
> ereditare il metodo della sede oppure impostare `manual`/`app` per la singola
> persona. QR, geolocalizzazione e promemoria restano milestone future.
> Il piano era stato scritto prima del refactor del 2026-09-20; i riferimenti
> storici qui sotto vanno letti sul modello nuovo (vedi `supabase/README.md`):
> `staff_members` → `venue_members` (`shift_assignments.venue_member_id`),
> `can_manage_venue(v, perm)` → `private.can(v, perm)`,
> `freeze_assignment_payroll` → il guard sulle assegnazioni + `record_attendance`,
> e le scritture passano da una RPC come tutto il resto.
>
> Il consuntivo successivo alla timbratura — ferie e altre assenze riconosciute,
> maggiorazioni notturne/straordinarie e relativo export — è deciso in
> `plans/HOURS-ABSENCES-ADJUSTMENTS.md`. Le ferie non entrano in
> `worked_hours` e le maggiorazioni non aumentano il totale delle ore lavorate.

## Context
Oggi le ore di un turno interno le decide a posteriori chi ha il permesso **Ore**: `shift_assignments.worked_hours` (null = durata pianificata), scritta da `(manager)/shift/[id].tsx` → `PresenceRow` e `web/src/shifts/PresenceSection.tsx` via `setAssignmentPresence`. `record_attendance` impedisce al professionista di scrivere le proprie ore. Manca il dato reale: a che ora è arrivato e uscito.

Decisioni prese con l'utente:
- **Metodo configurabile.** La sede sceglie un metodo predefinito e può
  cambiarlo per il singolo professionista: manuale, pulsante nell'app, QR della
  sede o posizione del dispositivo.
- **QR dinamico, non statico.** La sede apre una pagina display su tablet o
  computer; il QR cambia ogni 30 secondi e quello fotografato scade rapidamente.
  La rotazione non crea righe nel database: si salva soltanto un segreto per
  sede e il server verifica crittograficamente la fascia temporale.
- **Ore = proposta da approvare.** Le timbrature stanno a parte; chi ha il
  permesso **Ore** vede "timbrato 18:04–23:40 · 5,6h" e con un tocco le copia in
  `worked_hours`. Il professionista non scrive le proprie ore; il titolare può
  farlo anche sulla propria riga, il collaboratore no.
- **Finestra libera.** Nessun vincolo orario; solo guard contro errori grossolani (turno di un altro giorno).
- **Dopo il clock-in l'assegnazione è congelata.** Non si può rimuovere,
  riassegnare o spostare una persona che ha una timbratura attiva: prima il
  titolare o un collaboratore con permesso **Ore** deve annullarla indicando una
  motivazione. L'annullamento resta nello storico e rende di nuovo modificabile
  l'assegnazione.

## Flusso di utilizzo

### 1. Configurazione
- La sede ha un metodo di timbratura predefinito. Il titolare o un collaboratore
  con permesso **Ore** può scegliere un metodo diverso sulla singola scheda di
  organico (`venue_member`):
  - `manual`: il professionista non timbra; chi gestisce inserisce le ore;
  - `app`: pulsante entrata/uscita nell'app, senza verifica del luogo;
  - `qr`: scansione del QR dinamico mostrato dal display della sede;
  - `geolocation`: pulsante nell'app accettato entro il raggio configurato.
- Il metodo appartiene alla relazione persona-sede: la stessa persona può usare
  QR in una sede e geolocalizzazione in un'altra.

### 2. Pianificazione e timbratura
- Il titolare o collaboratore con permesso **Turni** crea il turno con gli orari
  pianificati. Non sono ancora le ore effettive.
- Il professionista vede l'azione coerente col proprio metodo: semplice pulsante,
  scansione QR, verifica posizione oppure nessuna azione nel metodo manuale.
- Entrata e uscita salvano sempre l'istante ricevuto dal server. Un'entrata
  anticipata o in ritardo non viene corretta automaticamente.

### 3. Anomalie e correzioni
- Il sistema segnala senza modificare il dato: entrata/uscita anticipata o in
  ritardo, clock-out mancante, durata anomala, QR o posizione non validi.
- Il titolare o collaboratore con permesso **Ore** può completare, correggere o
  annullare una timbratura, sempre con motivazione. La scansione originale resta
  nello storico.

### 4. Revisione e mese
- Una timbratura completa produce una proposta di ore; non aggiorna da sola
  `worked_hours`.
- Chi ha il permesso **Ore** può approvare una riga, correggerla oppure usare
  **“Approva tutte le timbrature regolari”**. L'approvazione copia la durata in
  `worked_hours` e registra chi e quando l'ha approvata.
- Il riepilogo mensile separa ore pianificate, ore effettive approvate, turni da
  verificare e anomalie aperte. Il totale definitivo usa soltanto le ore
  approvate; non deve presentare come effettive quelle ancora da verificare.

### 5. Promemoria push
- Solo per i metodi `app`, `qr` e `geolocation`; nessun promemoria nel metodo
  `manual`.
- **15 minuti prima dell'inizio:** ricorda al professionista che il turno sta per
  iniziare e che dovrà timbrare l'entrata.
- **30 minuti dopo l'inizio:** se non esiste ancora il clock-in, notifica
  l'anomalia al professionista.
- **30 minuti dopo la fine prevista:** se esiste il clock-in ma manca il
  clock-out, ricorda al professionista che la timbratura è ancora aperta.
- Una sola notifica per ciascun evento, senza ripetizioni. Se la condizione non
  esiste più al momento dell'invio — turno modificato/annullato o timbratura già
  effettuata — il server non invia nulla.
- Generazione lato server usando gli orari correnti del turno e chiavi di
  deduplicazione; non programmare notifiche locali che diventerebbero obsolete
  quando il turno cambia.

## 1. Database — migration `20260918100000_shift_clock.sql`

**Configurazione**
- Enum `clock_method`: `manual | app | qr | geolocation`.
- Impostazioni per sede: metodo predefinito e, per la geolocalizzazione,
  coordinate e raggio ammesso.
- Override opzionale per `venue_member`; in assenza di override vale il metodo
  della sede. Le modifiche richiedono `private.can(venue_id, 'hours')` e non
  possono essere effettuate da un collaboratore sulla propria scheda.

**a) QR dinamico per sede** — tabella `venue_clock_secrets`
- `venue_id uuid pk references venues on delete cascade`, `secret text not null`
  generato casualmente, `rotated_at timestamptz default now()`. Il segreto non
  è il contenuto del QR e non deve mai arrivare al browser o all'app.
- Il payload contiene `venue_id`, fascia temporale di 30 secondi e firma HMAC.
  Non si salva un token per fascia: il server ricalcola la firma e accetta la
  fascia corrente e, per tollerare scansione/rete, quella immediatamente
  precedente. Validità pratica massima circa 60 secondi.
- La pagina **Display timbrature** richiede al backend il token breve da
  mostrare e lo aggiorna alla scadenza. È una richiesta leggera, non una
  scrittura; non usa Realtime e la tabella non cresce nel tempo.
- Il backend genera/firma il token: il tablet non può calcolarlo partendo dal
  segreto permanente. La pagina display deve avere una sessione dedicata alla
  sola sede, senza accesso al resto della dashboard.
- RLS: nessun client legge `secret`. RPC/endpoint di emissione e rotazione
  verificano l'accesso alla sede; ruotare il segreto invalida immediatamente
  ogni token emesso con quello precedente.
- Tabella separata e non colonna su `venues`: `venues` è letta dallo
  staff/colleghi e il segreto non deve finirci.

**b) Timbrature** — tabella `shift_clock_records`
- `id uuid pk`, `assignment_id uuid null references shift_assignments on delete set null`, più gli snapshot immutabili `shift_id`, `venue_id` e `venue_member_id`; `clock_in_at timestamptz not null`, `clock_out_at timestamptz null`, `check (clock_out_at is null or clock_out_at > clock_in_at)`.
- Salvare anche il metodo usato e, per `geolocation`, coordinate e accuratezza
  ricevute per entrata e uscita. Non raccogliere la posizione in background.
- Campi di annullamento: `voided_at timestamptz`, `voided_by uuid`,
  `void_reason text`; o sono tutti nulli oppure tutti valorizzati.
- Una sola riga **attiva** per assegnazione, tramite indice unique parziale su
  `assignment_id where voided_at is null` (MVP: niente pause / timbrature
  multiple). Le righe annullate restano come audit e non contano come
  timbratura.
- RLS select: professionista collegato (stesso predicato di `"shift_assignments: linked waiter read"`) oppure `can_manage_venue(venue, 'hours')` o `'shifts'` via join `shift_assignments → shifts`. **Nessuna** policy di scrittura: solo RPC. Così non serve toccare `freeze_assignment_payroll`.

**Correzioni senza perdere la scansione originale** — tabella
`shift_clock_corrections`
- `id uuid pk`, `clock_record_id uuid references shift_clock_records`,
  `corrected_in_at timestamptz`, `corrected_out_at timestamptz`,
  `reason text not null`, `corrected_by uuid not null`, `created_at timestamptz`.
- Le correzioni sono append-only: `clock_in_at` e `clock_out_at` originali non
  vengono mai sovrascritti. L'ultima correzione del record determina gli orari
  effettivi mostrati e proposti, usando l'originale per i campi non corretti.
- RPC `correct_clock_record(p_record_id, p_in, p_out, p_reason)` riservata a chi
  ha il permesso **Ore**, con
  motivazione obbligatoria. Serve sia per completare un'uscita dimenticata sia
  per correggere una scansione fatta in ritardo.
- Esempio: Marco esce alle 00:00 ma scansiona alle 02:00. Il record conserva
  `clock_out_at = 02:00`; il titolare registra `corrected_out_at = 00:00` con
  motivo «Clock-out dimenticato, comunicato dal professionista». Entrambi i
  dati restano consultabili.

**Approvazione delle ore**
- Aggiungere all'assegnazione `attendance_reviewed_at` e
  `attendance_reviewed_by`. L'approvazione scrive sempre `worked_hours`, anche
  quando coincide con la durata pianificata, così “approvato” non si confonde
  con il fallback attuale `worked_hours is null`.
- RPC singola e massiva riservata al permesso **Ore**. Quella massiva accetta
  solo timbrature complete, non annullate e senza anomalie; le altre restano
  esplicitamente “Da verificare”. Vale la stessa restrizione sulle proprie ore
  già applicata da `record_attendance`.
- I riepiloghi mensili devono esporre separatamente totale approvato e ore non
  ancora revisionate; il totale definitivo non usa il fallback pianificato.

**Guard sulle assegnazioni**
- `unassign`, `reassign`, `move_assignment` e la sostituzione dello staff in
  `update_shift` devono rifiutare una riga con timbratura attiva usando
  `attendance_started`.
- RPC `void_clock_record(p_assignment_id, p_reason)` riservata a chi ha il
  permesso **Ore**: richiede una
  motivazione non vuota e valorizza `voided_at`, `voided_by` e `void_reason`.
  Non cancella il record. Dopo l'annullamento la guard non trova più una
  timbratura attiva e l'assegnazione torna modificabile.
- Se l'assegnazione viene poi cancellata, `assignment_id` diventa null ma gli
  snapshot conservano chi, dove e per quale turno aveva timbrato.

**c) RPC `clock_punch(p_assignment_id, p_action, p_code, p_lat, p_lng, p_accuracy)`** — SECURITY DEFINER, `search_path=''`
1. Assegnazione dell'utente: join `shift_assignments → venue_members → workspace_members`, con `workspace_members.user_id = auth.uid()`, altrimenti errore.
2. `shifts.status <> 'cancelled'`, `assignment.status not in ('declined','no_show')`.
3. Risolve il metodo effettivo della persona nella sede:
   - `manual`: rifiuta la timbratura del professionista;
   - `app`: non richiede altre prove;
   - `qr`: verifica firma, sede e fascia temporale del token dinamico;
   - `geolocation`: verifica coordinate, accuratezza e distanza dal punto sede.
4. Guard anti-errore (non finestra): `local_now()::date` fra `shift.date - 1` e `shift_ends_at(...)::date + 1`.
5. `p_action` è esplicita (`in | out`) per evitare che un doppio callback della
   fotocamera trasformi subito l'entrata in uscita. La RPC serializza le
   richieste e rende idempotente la stessa azione. Le righe annullate vengono
   ignorate.
- Errori con `raise exception ... using errcode` leggibili, mappati in `src/lib/errors.ts` (`userErrorMessage`).
- `revoke execute from anon, public`; grant authenticated.

**d)** Aggiungere le tabelle alla publication realtime (così la pagina turno del titolare vede "in servizio" live — opzionale).

Applicare via MCP Supabase + allineare history (vedi memoria supabase-cli-no-token), poi rigenerare `src/types/database.ts`.

## 2. Data layer — nuova feature `src/features/clock/`
- `api.ts`: `punchClock(assignmentId, action, proof)` (rpc), lettura/scrittura
  delle impostazioni, emissione e rotazione del QR dinamico,
  `correctClockRecord`, `voidClockRecord` e approvazione singola/multipla.
- `hooks.ts`: `usePunchClock` (invalida `qk` delle assegnazioni del professionista e del turno), `useVenueClockCode`, `useRotateVenueClockCode`. Chiavi nuove in `src/lib/queryKeys.ts`.
- `hours.ts`: `clockedHours(inAt, outAt)` arrotondato al quarto d'ora e calcolato
  sugli orari corretti quando esistono; `parseClockQr(data)` valida il formato
  `klokshift-clock:<token>` e lascia al server la verifica della firma e della
  scadenza.
- Estendere la select di `getShiftAssignments` (`src/features/assignments/api.ts:426`) e dell'assegnazione del professionista con `clock:shift_clock_records(clock_in_at, clock_out_at)`; aggiornare il tipo `AssignmentWithStaff`.

## 3. App professionista
- `npx expo install expo-camera` → config plugin con `cameraPermission` in italiano in `app.json`. **Rebuild dev client necessario.**
- `npx expo install expo-location` per il solo controllo puntuale della posizione
  con permesso foreground; niente tracciamento o geofencing in background.
- Nuova rotta modale `src/app/(waiter)/timbra.tsx` (`?assignmentId=`): sceglie
  l'esperienza dal metodo effettivo. Con `app` chiede conferma, con `qr` apre
  `CameraView`, con `geolocation` acquisisce la posizione corrente; `manual` non
  espone il pulsante. Gestione di permessi negati e posizione non disponibile.
- `src/app/(waiter)/shift/[id].tsx`: sezione "Timbratura" sotto lo stato di conferma — "Timbra entrata" / "In servizio dalle 18:04 · Timbra uscita" / "18:04–23:40 · 5,6h". Visibile solo se il turno non è annullato e l'assegnazione non è declined/no_show.
- Home professionista (turno di oggi, `MyShiftCard`): scorciatoia "Timbra" che apre la stessa modale. Rigenerare i typed routes col dev server (memoria expo-typed-routes-regen).

## 4. Titolare / collaboratori
- Nella configurazione della sede: metodo predefinito; per la posizione, punto
  della sede e raggio. Nella scheda della persona: “Usa impostazione sede” o
  override del metodo.
- **Display timbrature (web)**: pagina dedicata e utilizzabile a schermo intero
  su tablet o computer, con QR grande, conto alla rovescia e aggiornamento ogni
  30 secondi. Se la rete manca mostra “QR non disponibile” e non riutilizza un
  token scaduto. Serve una libreria QR web; il display non deve esporre il resto
  della dashboard.
- **Rotazione segreto**: azione separata con conferma nelle impostazioni della
  sede, utile se si sospetta una compromissione. Non è la normale rotazione dei
  30 secondi e comporta l'invalidazione immediata dei token precedenti.
- **Presenze** — `web/src/shifts/PresenceSection.tsx` e `PresenceRow` in `(manager)/shift/[id].tsx`: per riga mostra timbratura ("18:04–23:40", "entrata senza uscita", "non timbrato") e, se completa e diversa dalle ore attuali, bottone "Usa ore timbrate (5,5h)" → `presence.mutate({ id, status, worked_hours: clockedHours })`. Nessuna scrittura automatica.
- Se manca il clock-out, chi ha il permesso Ore vede **“Inserisci uscita”**. Se
  la scansione è avvenuta in ritardo, vede **“Correggi orari”**. Entrambe le
  azioni richiedono una motivazione e aggiungono una riga a
  `shift_clock_corrections`, senza cambiare la scansione originale.
- Quando esiste una correzione, la UI mostra l'orario corretto come principale e
  rende consultabile anche quello originale con autore, data e motivazione.
- Sulla timbratura attiva chi ha il permesso Ore vede anche **“Annulla
  timbratura”**: apre
  una conferma con motivazione obbligatoria, spiega che l'operazione sbloccherà
  spostamento/rimozione della persona e chiama `void_clock_record`.
- Pagina turno di oggi: badge "In servizio" accanto a chi ha timbrato l'entrata (dato già nella select estesa).
- Vista mensile Ore: sezioni “Da verificare” e “Anomalie”, approvazione singola
  e azione massiva per le sole timbrature complete senza anomalie. Mostrare
  separatamente il totale definitivo approvato.
- Copy: "professionista", "sede" (AGENTS.md).

## 5. Fuori scope MVP (annotare)
Pause/timbrature multiple, solleciti push ripetuti, escalation automatica al
titolare/collaboratore, colonne orari nell'export CSV/PDF (`src/lib/export.ts`),
posizione in background, kiosk.

## Verifica
1. Migration applicata; `get_advisors` security senza nuovi errori oltre ai WARN DEFINER attesi.
2. SQL impersonando utenti seed (`set_config('request.jwt.claims', ...)`): professionista con token QR valido → in, poi out, poi errore; token di altra sede → errore; utente non assegnato → errore; `insert` diretto su `shift_clock_records` da authenticated → negato; il segreto di `venue_clock_secrets` non è leggibile da alcun client.
   Per il QR dinamico: token corrente e immediatamente precedente validi; token
   più vecchio, firma alterata e token di un'altra sede rifiutati; rotazione del
   segreto invalida i token precedenti; l'emissione periodica non inserisce né
   aggiorna righe nel database.
   Verificare inoltre: assegnazione con timbratura attiva non rimovibile né
   spostabile; chi non ha il permesso Ore non può annullarla; titolare o
   collaboratore autorizzato la annullano solo con motivazione (mai il
   collaboratore sulla propria riga); il record annullato resta leggibile; dopo l'annullamento
   l'assegnazione torna modificabile e può ricevere una nuova timbratura.
   Verificare i due casi di correzione: clock-out mancante completato dal
   titolare e clock-out scansionato due ore dopo ma corretto all'orario
   dichiarato. In entrambi i casi la scansione originale deve restare immutata,
   la motivazione deve essere obbligatoria e `worked_hours` non deve aggiornarsi
   automaticamente.
   Coprire inoltre tutti e quattro i metodi, override per persona, posizione
   dentro/fuori raggio e accuratezza insufficiente, doppia richiesta della
   stessa azione, approvazione singola, approvazione massiva che salta le
   anomalie e totale mensile che esclude le righe non revisionate.
   Per le push: promemoria a -15 minuti; anomalia di entrata a +30; uscita
   mancante a +30 dalla fine; nessun invio per metodo manuale, turno annullato o
   condizione già risolta; nessun duplicato se il job viene eseguito più volte.
3. `npx tsc --noEmit`, `yarn lint`, `npx expo export --platform ios`.
4. Dev build iOS (`expo run:ios --no-bundler`): QR da web dashboard sullo schermo del Mac → scansione con dispositivo fisico (il simulatore non ha fotocamera; al massimo testare la RPC). Controllare poi in web Presenze il bottone "Usa ore timbrate" e il riepilogo `/ore`.
