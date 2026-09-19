# Clock in / clock out del turno (timbratura con QR in sede)

## Context
Oggi le ore di un turno interno le decide solo il titolare a posteriori: `shift_assignments.worked_hours` (null = durata pianificata), scritta da `(manager)/shift/[id].tsx` → `PresenceRow` e `web/src/shifts/PresenceSection.tsx` via `setAssignmentPresence`. Il trigger `freeze_assignment_payroll` (20260913110000 / 20260915100000) impedisce al professionista di scriverla. Manca il dato reale: a che ora è arrivato e uscito.

Decisioni prese con l'utente:
- **Verifica presenza: QR in sede.** La sede espone un QR (codice ruotabile); il professionista lo scansiona per timbrare.
- **Ore = proposta da approvare.** Le timbrature stanno a parte; il titolare vede "timbrato 18:04–23:40 · 5,6h" e con un tocco le copia in `worked_hours`. La regola "le ore le scrive solo il titolare" resta intatta.
- **Finestra libera.** Nessun vincolo orario; solo guard contro errori grossolani (turno di un altro giorno).

## 1. Database — migration `20260918100000_shift_clock.sql`

**a) Codice QR per sede** — tabella `venue_clock_codes`
- `venue_id uuid pk references venues on delete cascade`, `code text not null unique` (default `encode(extensions.gen_random_bytes(18),'hex')`), `rotated_at timestamptz default now()`.
- RLS: select solo `can_manage_venue(venue_id, 'venue')`. Nessuna policy insert/update/delete: il professionista non legge mai il codice.
- RPC `get_or_create_venue_clock_code(p_venue_id)` + `rotate_venue_clock_code(p_venue_id)`, SECURITY DEFINER, gate `can_manage_venue(p_venue_id,'venue')`. Rotazione = QR vecchio morto (foto del QR girata su WhatsApp).
- Tabella separata e non colonna su `venues`: `venues` è letta dallo staff/colleghi (planning), il codice non deve finirci.

**b) Timbrature** — tabella `shift_clock_records`
- `assignment_id uuid pk references shift_assignments on delete cascade`, `clock_in_at timestamptz not null`, `clock_out_at timestamptz null`, `check (clock_out_at is null or clock_out_at > clock_in_at)`.
- Una riga per assegnazione (MVP: niente pause / timbrature multiple).
- RLS select: professionista collegato (stesso predicato di `"shift_assignments: linked waiter read"`) oppure `can_manage_venue(venue, 'hours')` o `'shifts'` via join `shift_assignments → shifts`. **Nessuna** policy di scrittura: solo RPC. Così non serve toccare `freeze_assignment_payroll`.
- Correzione di un orario da parte del titolare: RPC `set_clock_record(p_assignment_id, p_in, p_out)` gate `can_manage_venue(...,'hours')`. (Opzionale MVP: il titolare può già correggere direttamente le ore.)

**c) RPC `clock_punch(p_assignment_id uuid, p_code text) returns shift_clock_records`** — SECURITY DEFINER, `search_path=''`
1. Assegnazione dell'utente: join `staff_members.waiter_id = auth.uid()`, altrimenti errore.
2. `shifts.status <> 'cancelled'`, `assignment.status not in ('declined','no_show')`.
3. `p_code` = codice della `shifts.venue_id` (confronto su `venue_clock_codes`), altrimenti `'codice non valido per questa sede'`.
4. Guard anti-errore (non finestra): `local_now()::date` fra `shift.date - 1` e `shift_ends_at(...)::date + 1`.
5. Nessuna riga → insert `clock_in_at = now()`. Riga con `clock_out_at` null → update `clock_out_at = now()`. Entrambi pieni → errore "turno già timbrato".
- Errori con `raise exception ... using errcode` leggibili, mappati in `src/lib/errors.ts` (`userErrorMessage`).
- `revoke execute from anon, public`; grant authenticated.

**d)** Aggiungere le tabelle alla publication realtime (così la pagina turno del titolare vede "in servizio" live — opzionale).

Applicare via MCP Supabase + allineare history (vedi memoria supabase-cli-no-token), poi rigenerare `src/types/database.ts`.

## 2. Data layer — nuova feature `src/features/clock/`
- `api.ts`: `punchClock(assignmentId, code)` (rpc), `getVenueClockCode(venueId)`, `rotateVenueClockCode(venueId)`, `setClockRecord(...)`.
- `hooks.ts`: `usePunchClock` (invalida `qk` delle assegnazioni del professionista e del turno), `useVenueClockCode`, `useRotateVenueClockCode`. Chiavi nuove in `src/lib/queryKeys.ts`.
- `hours.ts`: `clockedHours(inAt, outAt)` arrotondato al quarto d'ora; `parseClockQr(data)` → estrae il codice da payload `klokshift-clock:<code>` (prefisso per scartare QR estranei).
- Estendere la select di `getShiftAssignments` (`src/features/assignments/api.ts:426`) e dell'assegnazione del professionista con `clock:shift_clock_records(clock_in_at, clock_out_at)`; aggiornare il tipo `AssignmentWithStaff`.

## 3. App professionista
- `npx expo install expo-camera` → config plugin con `cameraPermission` in italiano in `app.json`. **Rebuild dev client necessario.**
- Nuova rotta modale `src/app/(waiter)/timbra.tsx` (`?assignmentId=`): `CameraView` con `barcodeScannerSettings={{ barcodeTypes: ['qr'] }}`, `onBarcodeScanned` → `parseClockQr` → `usePunchClock`; blocco doppia lettura con ref; esito (entrata/uscita + ora) e `router.back()`. Gestione permesso negato con `EmptyState`.
- `src/app/(waiter)/shift/[id].tsx`: sezione "Timbratura" sotto lo stato di conferma — "Timbra entrata" / "In servizio dalle 18:04 · Timbra uscita" / "18:04–23:40 · 5,6h". Visibile solo se il turno non è annullato e l'assegnazione non è declined/no_show.
- Home professionista (turno di oggi, `MyShiftCard`): scorciatoia "Timbra" che apre la stessa modale. Rigenerare i typed routes col dev server (memoria expo-typed-routes-regen).

## 4. Titolare / collaboratori
- **QR della sede (web)**: sezione "Timbratura" nella gestione sede (`web/src/venues/VenueFormCard.tsx` o card dedicata accanto): QR grande + "Stampa" (`window.print` con CSS print) + "Rigenera codice" con conferma. Serve una lib QR web: `qrcode` (usata solo in web/, verificare che web/ risolva le dipendenze della root — memoria web-dashboard-manager: nessun package.json in web/).
- **QR in app manager** (opzionale): riuso `react-native-qrcode-svg` già presente (come `(waiter)/qr.tsx`), schermata in impostazioni sede.
- **Presenze** — `web/src/shifts/PresenceSection.tsx` e `PresenceRow` in `(manager)/shift/[id].tsx`: per riga mostra timbratura ("18:04–23:40", "entrata senza uscita", "non timbrato") e, se completa e diversa dalle ore attuali, bottone "Usa ore timbrate (5,5h)" → `presence.mutate({ id, status, worked_hours: clockedHours })`. Nessuna scrittura automatica.
- Pagina turno di oggi: badge "In servizio" accanto a chi ha timbrato l'entrata (dato già nella select estesa).
- Copy: "professionista", "sede" (AGENTS.md).

## 5. Fuori scope MVP (annotare)
Pause/timbrature multiple, notifica "X non ha timbrato", colonne orari nell'export CSV/PDF (`src/lib/export.ts`), GPS, kiosk.

## Verifica
1. Migration applicata; `get_advisors` security senza nuovi errori oltre ai WARN DEFINER attesi.
2. SQL impersonando utenti seed (`set_config('request.jwt.claims', ...)`): professionista con codice giusto → in, poi out, poi errore; codice di altra sede → errore; utente non assegnato → errore; `insert` diretto su `shift_clock_records` da authenticated → negato; select di `venue_clock_codes` da professionista → vuoto.
3. `npx tsc --noEmit`, `yarn lint`, `npx expo export --platform ios`.
4. Dev build iOS (`expo run:ios --no-bundler`): QR da web dashboard sullo schermo del Mac → scansione con dispositivo fisico (il simulatore non ha fotocamera; al massimo testare la RPC). Controllare poi in web Presenze il bottone "Usa ore timbrate" e il riepilogo `/ore`.
