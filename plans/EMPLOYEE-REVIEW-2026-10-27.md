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
| E02 | Le mie ore con le stesse regole della sede | ☐ |
| E03 | «Timbra entrata» al momento giusto | ☐ |
| E04 | Frasi giuste a turno finito | ☐ |
| E05 | Rifiuto per sbaglio: si torna indietro, e la sede lo sa | ☐ |
| E06 | Cambio turno: nomi e refuso | ☐ |
| E07 | Ritirare la richiesta dal turno | ☐ |
| E08 | «Orario diverso» prima di confermare | ☐ |
| E09 | Correzioni della sede visibili | ☐ |
| E10 | Promemoria di timbratura | ☐ |
| E11 | Stesso numero di ore ovunque | ☐ |
| E12 | Testi minori e motivo del rifiuto | ☐ |

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

## E04 · Frasi giuste a turno finito

**Problema.** Turno passato senza timbratura: «La timbratura sarà disponibile
vicino al giorno del turno». «Turno concluso. Le presenze e le ore le registra la
sede» compare anche a chi ha timbrato o è ancora in servizio oltre l'orario.

**Correzione.** Una regola sola decide la frase della sezione Timbratura: troppo
presto, aperta, in servizio oltre l'orario, finita senza timbratura («Non hai
timbrato: la sede deve inserire gli orari»), metodo manuale.

## E05 · Rifiuto per sbaglio

**Problema.** «Non posso» toglie il turno da Home e agenda; il «Ci sono, conferma»
del dettaglio esiste ma non si raggiunge più. E se il dipendente ci ripensa, chi
gestisce non lo sa: un posto già riassegnato si raddoppia in silenzio.

**Correzione.** I turni futuri rifiutati restano in agenda come «Rifiutato», la
conferma del rifiuto lo dice (finestra unica, oggi copiata in tre schermate), e
chi gestisce riceve una notifica quando un rifiutato torna confermato.

## E06 · Cambio turno: nomi e refuso

**Problema.** Il pulsante dice «Chiedi sostituzione», la finestra «Chiedi un
cambio». Dopo l'invio: «Richiesta di sostituzione inviata: attendi la risposta
del sede», con un refuso, e falso se si era chiesto un orario diverso.

**Correzione.** «Chiedi un cambio» ovunque; la richiesta in attesa detta per tipo.

## E07 · Ritirare la richiesta dal turno

**Problema.** Una richiesta in attesa si ritira solo dalla card in chat.

**Correzione.** Nel dettaglio del turno «Ritira la richiesta» e «Apri la chat».

## E08 · «Orario diverso» prima di confermare

**Problema.** Su un turno da confermare le scelte sono solo «Confermo» o «Non
posso»: chi può venire un'ora dopo deve prima confermare l'orario intero. Il
server accetta già la richiesta su un turno da confermare.

**Correzione.** Terza scelta «Ci sono, ma a un altro orario»: manda la richiesta
di orario e conferma la presenza.

## E09 · Correzioni della sede visibili

**Problema.** Se chi gestisce corregge gli orari o li inserisce per chi non ha
timbrato, il dipendente legge «Timbrato 18:00–23:00» come se l'avesse fatto lui.

**Correzione.** Dettaglio: orari timbrati e orari corretti, con il motivo, oppure
«Orari inseriti dalla sede». Storico: la stessa distinzione, con le colonne di E02.

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

## E12 · Testi minori e motivo del rifiuto

- «Presenza confermata» sulla card del prossimo turno solo se il dipendente ha
  confermato (al fisso non serve).
- «Sei stato assegnato… da {sede}» e «Turno dello staff» → frasi neutre, «Il tuo
  turno».
- Errori della conferma in Home con il motivo vero, come in agenda e dettaglio.
- Profilo: «Vedi storico turni» → «Le mie ore».
- «Non posso» con un motivo facoltativo, che arriva a chi gestisce nella notifica
  e accanto a «Rifiutato».
