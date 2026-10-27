# Esperienza del dipendente — revisione del 27 ottobre 2026

Revisione dei flussi del dipendente nell'app: confermare i turni, chiedere un
cambio, timbrare, vedere le proprie ore. È la gemella della revisione dei flussi
di chi gestisce (26/10). Sono emersi 12 punti: **si fanno tutti, uno alla volta**,
in quest'ordine: E01 → E09, E11, E12, e **E10 per ultimo** (il più grosso, va
provato su un telefono vero).

Ogni punto ha il suo commit, e lo stato qui sotto si aggiorna **nello stesso
commit** del punto. Migration sempre nuove, rilasciate dalla CI.

| Punto | Cosa | Stato |
| ----- | ---- | ----- |
| E01 | Turno annullato ancora in Home e nel dettaglio | ✅ 27/10 |
| E02 | Le mie ore con le stesse regole della sede | ✅ 27/10 (migration da applicare via CI) |
| E03 | «Timbra entrata» al momento giusto | ✅ 27/10 |
| E04 | Frasi giuste a turno finito | ✅ 27/10 |
| E05 | Rifiuto per sbaglio: si torna indietro, e la sede lo sa | ✅ 27/10 (migration da applicare via CI) |
| E06 | Cambio turno: nomi e refuso | ✅ 27/10 |
| E07 | Ritirare la richiesta dal turno | ✅ 27/10 |
| E08 | «Orario diverso» prima di confermare | ✅ 27/10 |
| E09 | Correzioni della sede visibili | ✅ 27/10 |
| E10 | Promemoria di timbratura | ☐ |
| E11 | Stesso numero di ore ovunque | ✅ 27/10 |
| E12 | Testi minori e motivo del rifiuto | ✅ 27/10 (migration da applicare via CI) |

---

## E01 · Turno annullato ancora in Home e nel dettaglio

**Problema.** Annullare un turno cambia solo `shifts.status`: le assegnazioni
restano e il dipendente continua a leggere il turno. La Home lo mostra come
«prossimo turno» (con «Confermo / Non posso» o «Presenza confermata») e lo conta
fra i «turni da confermare». Il dettaglio non dice che è annullato e offre
«Conferma presenza», che poi fallisce. L'agenda invece lo barra già.

**Correzione.** La Home ignora i turni annullati (l'agenda li mostra barrati). Il
dettaglio di un turno annullato dice «Annullato» e non offre azioni né la
squadra. La notifica «Turno annullato» apre il dettaglio (prima non apriva
niente, sulla base di un commento superato: la RLS non nasconde gli annullati).

File: `src/app/(waiter)/(tabs)/index.tsx`, `src/app/(waiter)/shift/[id].tsx`,
`src/features/notifications/routing.ts` (commento superato).

## E02 · Le mie ore con le stesse regole della sede

**Problema.** Per chi timbra dall'app, lo storico personale conta già le ore del
turno anche quando non ha timbrato o la timbratura aspetta l'approvazione, e dice
«finché non è approvata valgono le ore del turno». Per la sede quelle ore **non
contano** finché non sono sistemate (riepilogo Ore, «Ore da sistemare»). Il
dipendente vede più ore di quelle che arrivano al consulente, e non sa di dover
chiedere.

**Correzione.** `private.my_work_history` dice se una riga conta (stessa
condizione di `shifts_count` in `get_workspace_hours_summary`) e, se non conta,
perché (stessi motivi di `get_hours_to_fix`). Storico e Profilo mostrano «ore che
contano» e «in attesa della sede», e ogni riga in attesa dice cosa manca. Nella
stessa migration le colonne che servono a E09. Test SQL che confronta i due lati.

File: nuova migration, `src/features/assignments/api.ts` e `history.ts`,
`src/app/(waiter)/storico.tsx`, `src/app/(waiter)/(tabs)/profilo.tsx`, nuovo test
`supabase/tests/rls/039_my_work_history.sql`.

**Fatto.** Migration `20261027000000_my_work_history_counts.sql` (da applicare
via CI): `counts`, `pending_reason`, `clock_edit`, `clock_edit_reason` sulle righe,
`pending_count`/`pending_hours` sui totali, `total_hours` solo ore che contano.
Il test 039 confronta storico personale, riepilogo e «Ore da sistemare» sugli
stessi turni. In app: «Ore lavorate» con «+ X h in attesa della sede», e ogni
turno in attesa dice cosa manca (non timbrato, uscita mancante, da approvare).
Le build vecchie restano compatibili (colonne in più, stessi nomi).

## E03 · «Timbra entrata» al momento giusto

**Problema.** La Home propone «Timbra entrata» dalla mezzanotte del giorno del
turno, e la card prende il posto di quella del prossimo turno. Il dettaglio
permette l'entrata dal giorno prima fino al giorno dopo la fine. Le ore partono
dal tocco: un'entrata alle 8 per un turno delle 19 propone 15 h. La conferma dice
solo «orario corrente del server».

**Correzione.** L'entrata si propone da un'ora prima dell'inizio alla fine del
turno (regola pura in `clock/availability.ts`, stessa soglia del fuori turno);
prima resta la card del prossimo turno con «Timbri dalle …». La conferma dice
l'ora e avvisa se si è lontani dall'inizio o dalla fine. Server invariato: la sua
finestra larga resta la rete per i notturni.

**Fatto.** `clockInPhase` / `clockInOpensLabel` / `punchConfirmMessage` in
`src/features/clock/availability.ts`, usati da Home (anche la Home di chi
gestisce, che condivide la card), dettaglio, fuori turno e pausa. Prima
dell'apertura la card del prossimo turno dice «Timbri l'entrata dalle …» (solo
nelle 12 ore prima). Le frasi a turno finito restano a E04.

## E04 · Frasi giuste a turno finito

**Problema.** Turno passato senza timbratura: «La timbratura sarà disponibile
vicino al giorno del turno». «Turno concluso. Le presenze e le ore le registra la
sede» compare anche a chi ha timbrato o è ancora in servizio oltre l'orario.

**Correzione.** Una regola sola decide la frase della sezione Timbratura: troppo
presto, aperta, in servizio oltre l'orario, finita senza timbratura («Non hai
timbrato: la sede deve inserire gli orari»), metodo manuale.

**Fatto.** `clockInNote` e `shiftOverNote` in `src/features/clock/availability.ts`,
con test. Chi è ancora in servizio oltre l'orario legge «L'orario del turno è
finito: timbra l'uscita quando smetti» invece di «Turno concluso».

## E05 · Rifiuto per sbaglio

**Problema.** «Non posso» toglie il turno da Home e agenda; il «Ci sono, conferma»
del dettaglio esiste ma non si raggiunge più. E se il dipendente ci ripensa, chi
gestisce non lo sa: un posto già riassegnato si raddoppia in silenzio.

**Correzione.** I turni futuri rifiutati restano in agenda come «Rifiutato», la
conferma del rifiuto lo dice (finestra unica, oggi copiata in tre schermate), e
chi gestisce riceve una notifica quando un rifiutato torna confermato.

**Fatto.** `DeclineShiftModal` (Home, agenda, dettaglio); `getMyDeclinedUpcoming`
per l'elenco dell'agenda (non la vista a settimana, non la Home). Migration
`20261027000100` (tipo `shift_reconfirmed`) e `20261027000200` (trigger
`notify_on_assignment_reconfirmed`, persona della notifica), da applicare via
CI; casi nel test SQL 020. Avvisa solo se a riconfermare è la persona stessa.

## E06 · Cambio turno: nomi e refuso

**Problema.** Il pulsante dice «Chiedi sostituzione», la finestra «Chiedi un
cambio». Dopo l'invio: «Richiesta di sostituzione inviata: attendi la risposta
del sede», con un refuso, e falso se si era chiesto un orario diverso.

**Correzione.** «Chiedi un cambio» ovunque; la richiesta in attesa detta per tipo.

**Fatto.** `src/features/changeRequests/labels.ts` (`REQUEST_CHANGE_LABEL`,
`myPendingRequestText`, con test), usato da dettaglio e finestra. Aggiornata
anche la risposta dell'Aiuto («Non posso coprire un turno»), e quella sulla
timbratura con l'ora di E03.

## E07 · Ritirare la richiesta dal turno

**Problema.** Una richiesta in attesa si ritira solo dalla card in chat.

**Correzione.** Nel dettaglio del turno «Ritira la richiesta» e «Apri la chat».

**Fatto.** Sotto la richiesta in attesa: «Ritira la richiesta» (stesso hook della
card in chat, senza conferma come lì) e «Vedi in chat», che apre il thread col
titolare dove sta la card.

## E08 · «Orario diverso» prima di confermare

**Problema.** Su un turno da confermare le scelte sono solo «Confermo» o «Non
posso»: chi può venire un'ora dopo deve prima confermare l'orario intero. Il
server accetta già la richiesta su un turno da confermare.

**Correzione.** Terza scelta «Ci sono, ma a un altro orario»: manda la richiesta
di orario e conferma la presenza.

**Fatto.** Nel dettaglio del turno da confermare. `RequestChangeModal` con
`withConfirm` (solo orario, «Conferma e invia») e `onSent`: prima la richiesta,
poi la conferma; se la conferma fallisce il toast lo dice. La finestra ora si
monta solo aperta. Le card di Home e agenda restano a due pulsanti. Aggiornata
l'Aiuto.

## E09 · Correzioni della sede visibili

**Problema.** Se chi gestisce corregge gli orari o li inserisce per chi non ha
timbrato, il dipendente legge «Timbrato 18:00–23:00» come se l'avesse fatto lui.

**Correzione.** Dettaglio: orari timbrati e orari corretti, con il motivo, oppure
«Orari inseriti dalla sede». Storico: la stessa distinzione, con le colonne di E02.

**Fatto.** `clockEdit` / `clockEditText` in `src/features/clock/hours.ts`, con
test: nel dettaglio «Avevi timbrato 18:02–23:40 · orari corretti dalla sede ·
«motivo»» (o pausa corretta, uscita inserita, orari inseriti). Nello storico
«Orari inseriti dalla sede: …» / «Timbratura corretta dalla sede: …» con il
motivo; lì orari e pausa non si distinguono (la colonna dice solo che c'è una
correzione), il dettaglio sì.

## E10 · Promemoria di timbratura

**Problema.** Nessun avviso né per l'entrata né per l'uscita dimenticata: è la
causa naturale di «non ha timbrato» e «uscita mancante».

**Correzione.** Funzione programmata ogni 5 minuti (pg_cron, come i promemoria
dell'archivio): «Timbra l'entrata» poco prima dell'inizio, «Hai ancora l'entrata
aperta» dopo la fine, «Sei ancora in servizio fuori turno» dopo molte ore. Mai due
volte lo stesso avviso, solo per chi timbra dall'app, categoria disattivabile in
Impostazioni. Prova vera su telefono.

## E11 · Stesso numero di ore ovunque

**Problema.** Lo stesso turno: «7,75 h» nel dettaglio, «7,8 h» nello storico.

**Correzione.** Un solo formato (`formatHours`), con due decimali quando servono:
le ore sono al quarto d'ora.

**Fatto.** `formatHours` fino a due decimali («7,75 h»), usato anche dal dettaglio
del turno. Vale per app, dashboard e riepilogo PDF del mese. Unica eccezione:
la stima settimanale del contratto («173 h al mese ≈ 39,9 h a settimana») resta
a un decimale.

## E12 · Testi minori e motivo del rifiuto

- «Presenza confermata» sulla card del prossimo turno solo se il dipendente ha
  confermato (al fisso non serve).
- «Sei stato assegnato… da {sede}» e «Turno dello staff» → frasi neutre, «Il tuo
  turno».
- Errori della conferma in Home con il motivo vero, come in agenda e dettaglio.
- Profilo: «Vedi storico turni» → «Le mie ore».
- «Non posso» con un motivo facoltativo, che arriva a chi gestisce nella notifica
  e accanto a «Rifiutato».

**Fatto.** Migration `20261027000300_decline_reason.sql` (da applicare via CI):
colonna `shift_assignments.decline_reason` (≤ 300), `respond_assignment` con
`p_reason` facoltativo (le build vecchie restano compatibili), motivo in coda
alla notifica «Turno rifiutato», cancellato a ogni cambio di stato
(`clear_decline_reason`); casi nel test SQL 020. `ConfirmModal` accetta un
contenuto sotto il messaggio. Il motivo si vede nel dettaglio del dipendente,
nella riga della persona (app di chi gestisce) e nella lista «Chi lavora» della
dashboard. Testi: «In turno» per il fisso, «{sede} ti ha messo in questo
turno», «Il tuo turno», «Non sei in questo turno», errore vero in Home,
«Le mie ore» nel Profilo.
