# Monetizzazione di KlokShift

Aggiornato il **22 novembre 2026** (listino a tre fasce e clienti fondatori, §2 e §2-bis; prima: regola dei rimborsi, §6, 18 ottobre). Documento canonico delle decisioni commerciali e di prodotto approvate da Alisher; i dettagli ancora aperti sono indicati esplicitamente.

**Stato dell'implementazione, 6 ottobre:** M03a/M03b forniscono modello e
controlli server su operatività, capacità persone/sedi, rettifiche pregresse e
lettura/export dello storico. `migration_pending` conserva esplicitamente le
operazioni precedenti senza attribuire piano, capacità o prova; si risolve con
un periodo commerciale esplicito, non con la sola etichetta Test/Interna/Cliente.
Il campo storico `workspaces.plan = free/pro` non concede diritti.
Procedura: [TEST-MONETIZATION-M03B.md](TEST-MONETIZATION-M03B.md).

**Fondatore M05/M06a:** area distinta protetta con allowlist, MFA e verifiche
live; consultazione, concessioni immediate a vita/variazioni, classificazioni,
note e audit atomico/idempotente implementati. L'utente ha confermato accesso
MFA/panoramica e assegnazione Team/una sede/2048 MiB gratuiti a vita a Da Buffa
(6 ottobre, 21:12 Europe/Rome, con periodo e audit). Le aziende vecchie non sono
state attivate automaticamente. Restano prove manuali su dinieghi/revoche e
riordino UI, oltre a interventi ulteriori ed economia/spese. Quota documenti
per concessione dichiarata, enforcement upload ancora pendente. I dati
finanziari/costi restano Non disponibili. Procedure:
[TEST-FOUNDER-M05.md](TEST-FOUNDER-M05.md),
[TEST-FOUNDER-M06A.md](TEST-FOUNDER-M06A.md).

**M04 beta, implementato e verificato localmente:** pagina cliente Piano e
accesso per il titolare, conteggi e limiti distinti, date server, avvio prova
con conferma dopo la prima sede, link storico/export e listino informativo
separato. Il sito descrive la beta realmente provabile dal percorso di
registrazione; prezzi al lancio e acquisti non disponibili sono distinti.
L'app resta neutra senza prezzi/checkout. Nessuna nuova migration, modifica
remota o pubblicazione in questo blocco. Verifica visuale da eseguire:
[TEST-MONETIZATION-M04.md](TEST-MONETIZATION-M04.md).

**Ancora da completare:** approvazione/configurazione Paddle e procedura fiscale,
checkout/rinnovi/webhook/contratti (M09), quote e downgrade futuri, avvisi,
restituzione completa e cancellazione (M11). M04 beta non dichiara concluso il
percorso di vendita. Il fondatore usa attualmente solo aziende/account propri
di test; dev remoto separato rimandato a prima dell'accesso di terzi.

La sequenza di lavoro, l'audit del codice e le verifiche sono nel [piano di implementazione](../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md). La dashboard personale è descritta in [FOUNDER-DASHBOARD.md](FOUNDER-DASHBOARD.md).

## 1. Azienda, account e canale commerciale

- L'abbonamento appartiene all'azienda (`workspaces`), non all'account della persona.
- Ogni azienda ha contratto, capacità e accesso indipendenti, anche quando condivide il titolare con un'altra azienda.
- Il professionista non paga per il proprio account. La gratuità dell'account non rende gratuita l'operatività delle aziende a cui appartiene.
- Authority, permessi e ambito del membro restano distinti dal diritto commerciale dell'azienda.
- Acquisto, pagamento e gestione del contratto avvengono sul web, con prezzi e riepilogo prima della conferma. Il sito pubblico presenta il listino.
- **Paddle è il provider scelto**, con modello Merchant of Record (MoR): il fondatore fornisce/licenzia il software e Paddle rivende l'accesso al cliente secondo il proprio contratto. Scelta confermata; approvazione dell'account e integrazione ancora da completare.
- L'app nativa non mostra prezzi, checkout o inviti all'acquisto; mostra soltanto lo stato aziendale e le azioni consentite.
- Non si reintroducono marketplace, candidature, CV, recensioni o calcolo delle paghe.

## 2. Listino e capacità

**Listino a tre fasce, deciso il 22 novembre 2026**, dopo il confronto con i concorrenti dello stesso giorno (§10). Sostituisce Base 29 € fino a 30 persone e Team 49 € senza limite: a 25 persone eravamo a 29 € contro i 79 € di TurniFacili Presenze, e a 60 persone a 49 € contro circa 149 €. Inoltre Team non cresceva mai con l'azienda. **Nel codice dal 22 novembre 2026, da rilasciare** (migration `20261122000100_plan_bands.sql`, test SQL 147): `private.plan_people_limit` (Piccola 15, Media 40, Grande 100, su misura senza limite) e `private.plan_rank` sono la fonte unica dei limiti, gemella di `src/features/workspace/planBands.ts`; `shared/pricing.ts` ha Grande a 89/890 €; pagina Piano, area del fondatore (quattro fasce, «Su misura» compreso), sito (tre schede) e `termini.html` (data 22 novembre 2026, **senza** alzare la versione legale) sono allineati. Le concessioni gratuite e di transizione `team` sono diventate `custom` (senza limite, audit `plan_band_migration`, `actor_id` nullo); le prove `team` sono passate a `large`.

**Ancora da fare prima di vendere sulle fasce:**

- **Paddle (A0, a mano)**: rinominare i prodotti Base→Piccola e Team→Media; creare Grande a 89 €/mese e 890 €/anno (sandbox, poi live).
- **Prezzi sandbox di Grande**: non sono nel DB; vanno in una migration a parte (`20261122000300_large_prices_sandbox.sql`) quando ci sono i due `pri_…`. Finché mancano, un checkout su Grande risponde `billing_price_unavailable`. Poi i prezzi live.
- **Edge Functions** `billing-checkout`, `billing-manage`, `billing-scheduled`: pubblicarle a mano **subito dopo** la migration (le vecchie rifiutano `large`).
- **Prova in sandbox** (nuova azienda di test): prova → acquisto Piccola → aumento a Grande → riduzione a Media al rinnovo; l'esito va in [TEST-BILLING-SCHEDULED.md](TEST-BILLING-SCHEDULED.md).
- `public.grant_workspace_access` (solo service role/seed) accetta ancora solo `base`/`team`: da allineare.
- Decidere se la modifica a `termini.html` richiede un rialzo della versione legale (`private.current_legal_version()` e `LEGAL_VERSION` insieme, dopo i 30 giorni di preavviso).

| Voce | Mensile | Annuale anticipato | Capacità |
|---|---:|---:|---|
| Piccola | 29 € | 290 € | Una sede inclusa; fino a **15** persone uniche nell'intera azienda |
| Media | 49 € | 490 € | Una sede inclusa; da 16 a **40** persone |
| Grande | 89 € | 890 € | Una sede inclusa; da 41 a **100** persone |
| Su richiesta | accordo | accordo | Oltre 100 persone o più di 5 sedi, con un accordo scritto dal fondatore |
| Sede aggiuntiva | 15 € | 150 € | Una sede operativa oltre quella inclusa, uguale in tutte le fasce |

I nomi indicano la dimensione: i piani si distinguono **solo per capacità**, e «piano Team» si confondeva con il team, cioè le persone dell'azienda (glossario). Tutte le fasce includono le stesse funzioni disponibili del prodotto. Anche la fascia più alta non dà sedi o spazio documenti infiniti.

L'annuale copre **12 mesi consecutivi** al prezzo equivalente a **10 mensilità**: il risparmio corrisponde a due mesi, non a un secondo periodo di prova.

Con `S >= 1` sedi acquistate:

- Mensile: prezzo fascia + `15 × (S − 1)`.
- Annuale: prezzo fascia + `150 × (S − 1)`.
- Piccola con due sedi: 44 €/mese oppure 440 €/anno.
- Media con tre sedi: 79 €/mese oppure 790 €/anno.
- Grande con cinque sedi: 149 €/mese oppure 1.490 €/anno.

Da sé si comprano **al massimo 5 sedi in tutto** (1 inclusa + 4 aggiuntive), in ogni fascia: oltre serve l'accordo scritto della riga «Su richiesta». Il server lo applica all'acquisto, all'aumento e al cambio dal rinnovo (`billing_venues_need_agreement`, «Oltre 5 sedi serve un accordo su misura: scrivi a info@klokshift.com»), e la pagina Piano non offre di più. Le concessioni del fondatore non hanno questo tetto.

Con le fasce restiamo sotto TurniFacili Presenze in ognuna (29/49/89 € contro 45/79/~149 €), con timbratura ed export per il consulente compresi. Niente piano gratuito: le aziende sotto le 5–10 persone non sono il bersaglio, e il supporto ha un costo anche quando il cliente non paga.

### Passaggio al listino a fasce

- **Nomi interni**: nel codice `base` resta la fascia Piccola e `team` la fascia Media; è stata aggiunta la chiave `large` (Grande) e `custom` per le concessioni senza limite. Come per `waiter`/`manager`, rinominare le chiavi costerebbe molto e non darebbe niente.
- **Concessioni già fatte**: la gratuità a vita (Da Buffa), le concessioni temporanee e i periodi di transizione che erano `team` sono diventati `custom`, quindi **mantengono il perimetro concesso**, persone senza limite, con una riga di audit `plan_band_migration` (autore nullo), fatta da `private.migrate_plan_bands()`. Nessuna concessione era su `base` (controllato sul remoto il 22/11): non c'era niente da portare da 30 a 15. Le prove che erano `team` sono passate a `large`. Abbonamenti già pagati: nessuno al 22/11.
- **Server**: il limite sta in **una sola funzione**, `private.plan_people_limit` (migration `20261122000100_plan_bands.sql`: Piccola 15, Media 40, Grande 100, `custom` senza limite), con `private.plan_rank` per l'ordine delle fasce; funzioni, controlli, concessioni e cambi programmati la usano; gli avvisi del fondatore («vicino al limite», «oltre il limite») leggono `limits.people` da `private.workspace_access_at`, che a sua volta lo prende da lì. Il client non ricontrolla il limite contro le fasce: accetta quello che il server manda (le build native già installate devono leggere anche fasce venute dopo di loro; una fascia sconosciuta diventa «piano non assegnato» senza bloccare). Il gemello manuale lato client è `src/features/workspace/planBands.ts`: cambiano insieme.
- **Superamento e riduzione** (sotto): valgono le stesse regole, applicate a ogni soglia (15, 40, 100) invece che solo a 30.
- **Prova**: si fa sulla fascia **Grande** con una sede (prima era Team). Chi ha più di 100 persone la fa sulla Grande e poi passa all'accordo su richiesta.
- **Condizione di rilascio**: la migration `20261122000100_plan_bands.sql` si applica solo insieme a sito, FAQ, JSON-LD, pagina Piano e `shared/pricing.ts` già allineati, nello stesso rilascio: il listino pubblico non deve mai promettere una capacità diversa da quella che il server applica.

Il sito attuale indica **IVA esclusa**. Con Paddle come MoR, il regime forfettario del fondatore non determina automaticamente il trattamento delle vendite di Paddle ai clienti. La dicitura fiscale e il trattamento dei rapporti fondatore/Paddle devono essere validati col commercialista prima del primo incasso. Gli importi confermati non autorizzano un'aliquota universale o una fatturazione interna improvvisata.

### Conteggio delle persone: decisione e dettagli aperti

È approvato il conteggio delle **persone uniche nell'intera azienda** (soglie 15/40/100 dal 22/11, prima 30): chi lavora in più sedi della stessa azienda conta una volta. Contano solo le persone **attive** in organico, non chi è uscito: così un'attività stagionale che a luglio sale da 25 a 45 persone e poi scende non resta nella fascia alta tutto l'anno. Persone in aziende diverse rientrano nella capacità di ciascuna azienda.

Restano da validare le regole applicative: schede manuali senza account, inviti che riservano un posto, titolari/collaboratori in organico, organico di sedi chiuse, uscita/ripristino e collegamento/merge delle schede. Il piano propone un conteggio dell'organico corrente, distinto dagli account registrati o dagli utenti che hanno aperto l'app.

Il limite deve essere controllato dal server sull'intera azienda, anche quando il collaboratore può vedere soltanto alcune sedi. Non creare duplicati commerciali della stessa persona per ogni sede.

### Superamento della soglia e downgrade

Le regole valgono per ogni soglia di fascia (15, 40, 100). Gli esempi con 30 e Team/Base vengono dal listino precedente e si leggono come «soglia della fascia» e «fascia più alta/più bassa».

- Avvisi a 2 persone dalla soglia e alla soglia (a 28 e 30 col listino precedente).
- Al primo posto oltre la soglia si blocca soltanto l'aggiunta/ripristino eccedente; il lavoro esistente continua.
- Nessuna espulsione, cancellazione dello storico o conversione con addebito silenzioso.
- Upgrade esplicito dal web, con costo proporzionato al periodo residuo accettato dal titolare e capacità aggiornata dopo esito finanziario verificato.
- Riduzione di fascia (per esempio Grande → Media): programmata al rinnovo soltanto quando l'azienda è già entro la soglia della fascia d'arrivo.
- Un'aggiunta incompatibile con la capacità futura richiede di annullare esplicitamente il downgrade; non rinnova la fascia alta di nascosto.
- Le stesse verifiche valgono per le sedi. Chiusura, riapertura e riduzione degli extra devono preservare lo storico e rispettare la capacità futura.
- Per un'azienda gratuita, l'aumento della concessione passa dalla decisione del fondatore.

**Esecuzione attuale (18 ottobre 2026):** dalla pagina Piano il titolare fa da solo gli **aumenti** (Base→Team, sedi in più), con l'importo proporzionale calcolato da Paddle e mostrato prima della conferma; carta, ricevute e disdetta passano dal portale clienti di Paddle.

**Cambio al rinnovo (31 ottobre 2026, nel codice, da rilasciare):** anche **riduzioni** (di fascia, meno sedi) e **cambio mensile↔annuale** li fa da solo il titolare, dalla pagina Piano («Cambia dal prossimo rinnovo»), con data e importo del rinnovo (anteprima Paddle, IVA compresa) prima della conferma. Il cambio vale dal prossimo rinnovo e non si paga niente adesso; fino ad allora l'azienda tiene ciò che ha pagato.

- Riduzione di fascia solo con le persone già entro la soglia della fascia d'arrivo (15 per Piccola, 40 per Media, 100 per Grande); meno sedi solo con le sedi aperte già dentro il nuovo numero. Piano e sedi non possono aumentare nello stesso cambio: prima l'aumento, poi il resto.
- Un solo cambio aperto per abbonamento. Si annulla dalla pagina fino a 24 ore prima del rinnovo; finché è aperto sono bloccati gli aumenti e le aggiunte di persone o sedi oltre il limite futuro. Pausa e chiusura lo annullano finché non è stato inviato a Paddle; dopo l'invio una pausa o chiusura avvenuta ferma il rinnovo stesso.
- A meno di 24 ore dal rinnovo non si programma: resta l'email a info@klokshift.com.
- KlokShift lo invia a Paddle nelle 24 ore prima del rinnovo, senza addebito; Paddle rinnova col piano nuovo e il diritto cambia solo con l'avviso firmato. Se non si può più applicare prima del rinnovo (regole cambiate, rifiuto definitivo di Paddle), il rinnovo avviene col piano attuale: il titolare lo sa dall'app, il fondatore con email e push, e la differenza si rimborsa a mano. Gli altri imprevisti (cambio non arrivato a 6 ore dal rinnovo, rinnovo diverso dal programmato, data del rinnovo non rimessa, nessun rinnovo due ore dopo la data) arrivano solo al fondatore, che verifica su Paddle.
- Il portale clienti di Paddle non permette di cambiare piano: è una funzione su richiesta che KlokShift non ha attivato.

Prove sandbox e procedura in [TEST-BILLING-SCHEDULED.md](TEST-BILLING-SCHEDULED.md).

I dettagli di proration, concorrenza e modifica dei cicli vanno provati con il provider scelto. Chiudere una sede non cancella automaticamente un extra già acquistato né genera un rimborso.

## 2-bis. Clienti fondatori

Deciso il **22 novembre 2026**. È l'unico sconto previsto al lancio, oltre ai due mesi dell'annuale.

- **A chi**: le prime **30 aziende** che pagano, contate dal server sulla prima transazione completata e non per richiesta. Si possono assegnare anche a mano, dalla dashboard del fondatore, con motivo e audit.
- **Cosa**: **−30%** su fascia e sedi aggiuntive, mensile o annuale, per **24 mesi** dal primo addebito. Per tutto quel periodo il **prezzo di listino resta bloccato**: un aumento del listino non li tocca fino alla fine dei 24 mesi.
- **In cambio**, dichiarato nelle condizioni dell'offerta e non come obbligo per avere il servizio: feedback (una call di 30 minuti nei primi 2 mesi) e, se vogliono, una testimonianza con il loro nome.
- **Alla fine dei 24 mesi** si passa al listino in vigore, con lo stesso preavviso di 60 giorni degli aumenti (§6). Nessun «prezzo bloccato a vita».
- **Cambi di fascia o di sedi** mantengono lo sconto fino alla scadenza originaria: crescere non lo fa perdere, e passare all'annuale non fa ripartire i 24 mesi.
- **Pausa e disdetta**: i mesi in pausa contano nei 24 (la scadenza non si sposta). Chi esce e torna dopo la fine dell'operatività non lo riprende.
- **Non si somma** alla gratuità a vita, a eventuali convenzioni future o ad altri codici. Lo sconto vale per l'azienda e non si trasferisce a un'altra azienda della stessa persona.
- Sul sito se ne parla come di «posti limitati» solo se il conteggio è reale e visibile. Niente scarsità finta.

**Più avanti, non al lancio**: sconti del 10–15% per chi arriva da un **consulente del lavoro** o da un'**associazione di categoria**, e «porta un collega» (un mese gratis a entrambi, dopo aver verificato come Paddle gestisce i crediti). Sono esclusi gli sconti a tempo (Black Friday, primo mese a metà prezzo: la prova fa già quel lavoro) e i codici pubblici riutilizzabili.

## 3. Prova gratuita e aziende gratuite a vita

### Tutte le nuove aziende: 30 giorni senza carta

La prova di **30 giorni gratuiti senza carta** è approvata per tutte le nuove aziende, con **fascia Grande e una sede inclusa** (Team fino al listino del 22/11). Il primo mese gratuito è questa prova: non si aggiunge automaticamente un'altra promozione.

- Nessun addebito senza acquisto autorizzato e consenso al flusso ricorrente.
- Alla fine, in assenza di un periodo pagante o concessione valida, termina l'operatività e si passa alla consultazione/export.
- Pausa, ripartenza, nuove sedi o cambio di titolare non assegnano una seconda prova.
- Il fondatore può concedere proroghe finite con motivo, date e registro dell'intervento.
- La prova precede il periodo annuale acquistato: non duplica i due mesi di risparmio del listino.

**Acquisto durante la prova (decisione del 18 ottobre 2026):** l'abbonamento e il primo addebito partono il giorno dell'acquisto; i giorni di prova rimasti non si sommano, e la pagina Piano lo dice prima del pagamento. Il piano comprato vale subito, anche se diverso da Team.

**Dettagli da chiudere per il flusso cliente:** istante iniziale della prova ed eleggibilità in caso di aziende create ripetutamente. La fondazione tecnica prevede un'attivazione esplicita, una sola volta dal server, con almeno una sede aperta già pronta; il collegamento automatico al setup viene affrontato nel flusso cliente.

### Aziende selezionate: gratuità a vita

Il fondatore può assegnare gratuità a vita alla **singola azienda**, scegliendo piano e numero di sedi gratuite per ciascuna. La concessione non scade commercialmente e non richiede carta o rinnovi fittizi; non si estende automaticamente alle future aziende della stessa persona.

La fine della beta o una normale variazione di listino non rimuove il beneficio. Il perimetro concesso va dichiarato; capacità aggiuntive richiedono estensione del fondatore o accordo esplicito. Il trasferimento di titolarità e il significato contrattuale di «a vita» devono essere precisati nelle condizioni.

L'assegnazione dalla dashboard è il percorso iniziale. Un codice/link di riscatto è opzionale: casuale, monouso, verificato dal server e preferibilmente vincolato all'azienda. Il codice può avere una scadenza di riscatto, mentre il beneficio risultante resta permanente. Non serve un codice pubblico riutilizzabile.

Queste aziende hanno incassi e MRR pagante pari a zero; consumo infrastrutturale e assistenza si misurano comunque.

## 4. Pausa, disdetta e ripartenza

### Mensile e stagionalità

La pausa ferma i rinnovi **alla fine del periodo già pagato**, compresi gli extra dell'azienda. Fino a quella data resta valido il diritto operativo acquistato. Disattivare il rinnovo non elimina gli account o le appartenenze.

Dalla decorrenza: consultazione/export, senza nuovi turni, timbrature o upload operativi salvo le rettifiche limitate del §5. La ripresa richiede un'azione esplicita del titolare sul web, mostrando prezzo, capacità e periodo coperto; nessuna ripartenza o nuova prova automatica. Lo stop degli addebiti deve essere confermato dal provider.

Non è stato deciso un periodo minimo di pausa. Chiudere una sola sede non sospende l'intera azienda: le altre sedi possono continuare a lavorare e il contratto resta indipendente dalla chiusura.

### Annuale

L'annuale dura dodici mesi consecutivi. La chiusura stagionale **non congela né prolunga il periodo acquistato** e non genera un rimborso automatico del residuo. Il cliente può fermare il rinnovo futuro, mantenendo il diritto acquistato fino alla scadenza originaria.

Con questi prezzi, a parità di piano e sedi, il mensile costa meno per meno di dieci mesi e quanto l'annuale per dieci mesi. Per attività stagionali va spiegata questa differenza prima dell'acquisto.

### Disdetta

Il titolare può chiedere la disdetta prima del rinnovo, senza obbligo di un mese aggiuntivo di preavviso. Il servizio prosegue fino al termine pagato; seguono archivio e restituzione/cancellazione secondo la policy. Uscita commerciale, cancellazione dell'account e cancellazione dei dati aziendali sono processi distinti.

## 5. Pagamento fallito e chiusura delle presenze

### Tolleranza per il rinnovo: 7 giorni

Per un rinnovo fallito di un'azienda già pagante: **7 giorni di tolleranza**, avviso al primo errore e promemoria prima del blocco. Retry e cambio carta non riavviano il conteggio. Il fondatore può concedere una proroga limitata, motivata e registrata.

La tolleranza non si applica a fine prova, disdetta, pausa, primo acquisto o upgrade non incassato. Al termine: sola lettura/export, senza perdita dello storico. Un pagamento successivo deve avere importo e periodo identificati e non annullare una pausa volontaria.

Il calendario di retry e le fatture aperte devono essere coordinati con il provider: sola lettura, stop degli addebiti e cancellazione del contratto non sono lo stesso evento.

### Rettifiche pregresse: altri 7 giorni con finalità distinta

Sono consentiti **7 giorni dopo fine operatività** per completare, approvare o rettificare presenze relative a lavoro svolto o iniziato entro quella data. Nel blocco M03b la chiusura di una timbratura già aperta è limitata anche a prima di fine turno + 24 ore, oltre alla finestra complessiva di sette giorni. Inizio reale e assegnazione devono precedere fine operatività; le correzioni non possono spostare lavoro oltre questi confini. È il limite tecnico locale da verificare nei flussi dev, non una nuova tolleranza finanziaria.

L'eccezione è limitata ai record pertinenti, con permessi e audit: nessun nuovo turno, assegnazione, lavoro o upload operativo. Dopo la finestra resta il percorso assistito per rettifiche pregresse e richieste sui diritti. Questa finestra non prolunga l'operatività o l'archivio e non diventa una seconda tolleranza di pagamento.

## 6. Prezzi futuri e rimborsi

### Prezzo alla ripartenza e al rinnovo

- Il prezzo del periodo già pagato resta invariato.
- Alla vera ripartenza dopo fine operatività si presenta il listino vigente, con accettazione prima dell'acquisto.
- Annullare una pausa futura durante un periodo ancora valido non è un nuovo acquisto.
- Aumenti sui rinnovi: **60 giorni di preavviso**; prezzo precedente fino al primo rinnovo che rispetta il preavviso, con possibilità di disdire prima dell'addebito.
- Promemoria annuali a 30 e 7 giorni, con importo, sedi, data e percorso autenticato di disdetta.
- Nessuna promessa generale di prezzo bloccato a vita; eventuali accordi speciali devono essere espliciti. Le gratuità permanenti restano gratuite entro il perimetro concesso.

### Errori, ripensamenti e contestazioni

- **Ripensamento: rimborso completo di qualsiasi addebito chiesto entro 14 giorni dalla sua data**, senza motivazione: primo pagamento, rinnovi mensili e annuali, upgrade e sedi aggiuntive. Decisione del 18 ottobre 2026: Paddle approva il dominio solo con una finestra di ripensamento di 14–90 giorni e rifiuta formule come «nessun rimborso»; sostituisce la precedente cortesia limitata al rinnovo annuale senza nuova attività.
- Dopo il rimborso il periodo coperto da quell'addebito termina: primo pagamento o rinnovo → archivio (consultazione/export); upgrade o sede → capacità precedente, senza cancellare nulla.
- Addebiti duplicati o successivi a una disdetta/pausa già efficace: rimborso anche oltre i 14 giorni, compresi gli extra addebitati per errore.
- Disdetta ordinaria dopo i 14 giorni: periodo acquistato mantenuto, senza rimborso automatico del residuo.
- Disservizi gravi verificati: credito proporzionato al periodo inutilizzabile.
- Contestazioni: stato, motivo, documentazione ed esito separati; nessuna cancellazione automatica dei dati come conseguenza della contestazione.

I 14 giorni sono una policy commerciale richiesta dal provider e non limitano i diritti di legge. Testo pubblico: `web-site/public/rimborsi.html`. Rimborsi e crediti sono eseguiti da Paddle (MoR), con audit nella dashboard; un flag locale non restituisce il denaro. Sono ammessi i rifiuti per frode o abuso evidente previsti dalla politica di Paddle.

## 7. Documenti, assistenza e recupero del controllo

### Quota documenti

**10 MiB per file** è il limite già implementato. **2 GiB complessivi di documenti per azienda**, uguali per Base e Team, sono la base iniziale da calibrare sui tester **prima di pubblicarla**: non una quota già applicata o dimostrata corretta dai concorrenti.

Avvisi all'80% e al 90%. Raggiunta la quota, bloccare soltanto nuovi upload: turni, lettura, download ed export proseguono. Nessuna cancellazione o fatturazione extra automatica; aumento concordato o override motivato del fondatore. Anche le aziende gratuite a vita hanno una quota dichiarata, configurabile come capacità concessa.

Contare i documenti una volta nell'azienda, anche per persone in più sedi; avatar globali, export temporanei e copie applicative hanno cicli separati. Dimensioni effettive, file orfani, traffico e costi vanno misurati dal backend; non fidarsi soltanto della dimensione dichiarata dal client.

### Assistenza e continuità

Stesso supporto ordinario per entrambi i piani e tester selezionati: email/modulo in italiano, lunedì–venerdì festivi esclusi. **Obiettivo di prima risposta entro 2 giorni lavorativi**, con incidenti bloccanti prioritari; non è un tempo garantito di soluzione.

Guide, call iniziale di 30 minuti su richiesta e correzione dei bug del prodotto incluse. Lavori personalizzati e import complessi si concordano separatamente. Misurare il carico di supporto dei primi clienti prima di estendere la promessa.

Prima dei clienti paganti: backup adeguati, prova di ripristino DB **e file**, alert critici, comunicazione dei disservizi e rettifiche pregresse assistite. Il backup DB Supabase non contiene gli oggetti Storage: serve una strategia distinta per i file. Non promettere disponibilità 24/7 o tempi di ripristino non verificati.

### Recupero e trasferimento

Gestione commerciale ai titolari autorizzati. Se il reset ordinario non basta, recupero assistito con prova di identità **e rappresentanza aziendale**, notifica ai contatti precedenti e audit. Partita IVA pubblica o possesso della carta che paga non bastano.

Prevedere un contatto amministrativo secondario verificato senza concedergli automaticamente dati HR. Recuperare l'account della stessa persona e trasferire la gestione a un'altra sono processi diversi; il trasferimento conserva contratto/storico e aggiorna autorizzazioni. Un cambio della società giuridica richiede valutazione separata.

Revoca degli accessi, sicurezza, assistenza e richieste valide di cancellazione restano possibili anche in archivio. La sola lettura commerciale non deve impedire di togliere accesso a un collaboratore.

## 8. Archivio gratuito e privacy

Sono approvati **12 mesi gratuiti di consultazione ed export dalla fine dell'accesso operativo** per pausa, non rinnovo o uscita senza richiesta valida di cancellazione anticipata. Il termine è `operational_until + 12 mesi di calendario`, non dodici mesi dall'ultimo login, export o rettifica.

La data `operational_until` è determinata dal server secondo i periodi e le tolleranze validi. Richiedere la disdetta prima della scadenza pagata non anticipa l'archivio; cambiare etichetta da pausa a uscita o rettificare una presenza non lo prolunga.

L'archivio permette di recuperare **tutto lo storico ancora conservato**, non soltanto dati degli ultimi dodici mesi: sedi chiuse, persone uscite, turni, presenze, ore lavorate approvate, ore riconosciute, classificazioni/maggiorazioni, anomalie e documenti autorizzati. Restano i permessi del membro; i professionisti non ricevono il fascicolo completo dell'azienda. Il percorso di restituzione completa è distinto dal semplice report delle ore.

Mostrare decorrenza, scadenza e conseguenze; avvisi iniziali e a 30/7 giorni dal termine. Riattivare realmente prima del termine recupera l'azienda esistente e interrompe la cancellazione pendente, senza nuova prova. Le estensioni eccezionali richiedono durata, motivo e audit. Dopo eliminazione non promettere un ripristino dal backup.

**L'EDPB non prescrive 12 mesi né un altro termine universale.** Questa durata è una scelta commerciale di KlokShift, da validare per finalità, necessità, categorie di dati, ruoli privacy e istruzioni documentate nel DPA. Inserirla nel contratto non giustifica da solo la conservazione di ogni dato.

Richieste valide di cancellazione anticipata seguono un percorso dedicato. I dati del personale non diventano un archivio personale illimitato del fondatore; dati commerciali/fiscali propri, statistiche, log e backup hanno finalità e termini separati. Per statistiche di lungo periodo preferire aggregati effettivamente anonimi. Tempi fiscali col commercialista; eliminazione verificabile di DB/Storage/copie e rotazione dei backup da validare prima del lancio.

## 9. Condizioni prima del lancio pagante e questioni aperte

**Pagamenti automatici web pronti prima dei primi clienti paganti** e **dashboard personale essenziale già disponibile** sono requisiti approvati. Non sostituirli con un lancio pagante soltanto manuale.

### Paddle: scelta chiusa, attivazione da completare

Paddle è confermato. Prima dell'incasso servono verifica dell'account/prodotto, contratto applicabile, procedura fiscale, prova sandbox e verifiche complete di checkout, eventi firmati, idempotenza, rinnovi, disdetta, pause, capacità, conguagli, rimborsi e riconciliazione. Nessun redirect di successo o pagamento atteso equivale a un incasso verificato. Le aziende gratuite a vita non richiedono un abbonamento Paddle fittizio.

### Situazione fiscale dichiarata e verifica necessaria

Il fondatore dichiara di avere già una **partita IVA in regime forfettario** e di svolgere attività di **frontend developer**. Intende partire con questa partita IVA, offrendo la licenza/accesso alla propria piattaforma. Il **codice ATECO completo non è ancora disponibile**: non viene dedotto dalla professione dichiarata né registrato come già compatibile.

L'intenzione di rivalutare l'inquadramento con la crescita è registrata, ma la compatibilità iniziale va verificata **prima dei primi incassi**, senza legarla al raggiungimento di un numero di clienti. Le note ISTAT distinguono programmazione informatica ed edizione di software, anche autopubblicato: chiamare il prodotto «licenza» non risolve da solo la classificazione. Non si presume necessario un nuovo codice e non se ne sceglie uno senza valutare l'attività effettiva col commercialista.

Per chiudere la procedura fiscale:

- Recuperare il codice ATECO attualmente registrato e verificare l'attività effettiva e gli eventuali aggiornamenti necessari.
- Far valutare contratto Paddle e un esempio completo di vendita, commissioni, rimborso e payout, con la controparte risultante dai documenti effettivi.
- Stabilire documenti e adempimenti italiani applicabili, inclusi gli eventuali rapporti con l'estero, e come determinare ricavi/compensi e importi da monitorare nel forfettario. Non assumere che payout netto e ricavo fiscale coincidano.
- Validare dati legali e dicitura fiscale del listino/checkout. Paddle genera una **reverse invoice per ciascun payout**: è la sua procedura, non la prova automatica che ogni obbligo italiano sia assolto. Non sviluppare un generatore interno SdI come implicazione di questo piano.

Restano aperti: approvazione e configurazione Paddle; compatibilità ATECO, procedura fiscale e dicitura pubblica; dettagli di conteggio e trial; quota finale documenti; cancellazione (privacy e DPA scritti il 31/10 sulle clausole tipo UE 2021/915, senza revisione legale per scelta del fondatore: restano le azioni verso i fornitori in `docs/privacy/fornitori.md`, **bloccanti per la pubblicazione del DPA** finché Expo, Apple e GitHub non confermano un accordo con gli stessi obblighi (clausola 7.7 b), il rilascio e la prova a mano); trasferimenti e condizioni delle concessioni permanenti; limiti tecnici delle rettifiche e ripristino; flusso store concreto. Il piano di implementazione elenca dipendenze e verifiche bloccanti. La scelta del provider e il regime dichiarato non attestano validazione fiscale, privacy o funzionalità già operative.

## 10. Riferimenti e limiti del confronto

**Listino, 22 novembre 2026** (pagine prezzi ufficiali, prezzi mensili IVA esclusa; quelli in dollari non sono convertiti):

- [TurniFacili](https://turnifacili.com/prezzi): per azienda a fasce (fino a 15 / 16–50 / oltre 50). Base 29/59 €, Presenze 45/79 € e ~149 € (1.488 €/anno), AI 69/99 €. Trimestrale −5%, annuale 2 mesi gratis, 14 giorni di prova **con carta**.
- [Skello](https://www.skello.io/it/pricing): da 59–99 €/mese, non è chiaro se per sede; −10% con l'annuale; 14 giorni di prova.
- [Shiftbase](https://www.shiftbase.com/pricing): gratis fino a 15 persone; Basic 30 € con 6 persone incluse + 4 € a persona; −10% con l'annuale.
- [Connecteam](https://connecteam.com/pricing/): gratis fino a 10 persone; Basic 35 $ (29 $ con l'annuale) per le prime 30 persone + 1 $ a persona.
- [7shifts](https://www.7shifts.com/pricing): per sede, 44,99–149,99 $ a seconda delle persone (fino a 30/60/senza limite); gratis fino a 15.
- [Deputy](https://www.deputy.com/pricing) 5–9 $ a persona; [Planday](https://www.planday.com/pricing/) 2,99–4,49 $ a persona; [When I Work](https://wheniwork.com/pricing) 2,50–5 $; [Sling](https://getsling.com/pricing) gratis fino a 30 persone.
- Italiani a prezzo fisso: [Horix](https://horix.es/it) 19 €/mese; PagoPro 19/49 € ([confronto](https://pagopro.it/vs/skello)).
- [Paddle](https://www.paddle.com/pricing): 5% + 0,50 $ a transazione, cioè circa il 6,6% su 29 € al mese e il 5,2% su 290 € all'anno. Un motivo in più per spingere l'annuale.

Limiti: nessun prezzo è stato ancora provato con clienti veri. Il primo test è chiedere il prezzo a 5–10 titolari durante la beta.

**Regole di servizio**: fonti ufficiali verificate il **5 ottobre 2026**. Sono esempi commerciali, non norme italiane o regole da copiare integralmente.

- [When I Work: pausa](https://help.wheniwork.com/articles/hibernating-your-account/): pausa mensile con dati conservati e accesso sospeso; non prova un congelamento annuale. KlokShift non adotta automaticamente il minimo di pausa del concorrente.
- [Planday: fatture e accesso](https://help.planday.com/en/articles/67176-invoices-and-billing-faqs-and-troubleshooting): solleciti tipici a 8/16 giorni; non uno standard di sette giorni per rinnovi con carta.
- [Sling: fatturazione](https://support.getsling.com/en/articles/5949289-billing-annual-or-monthly-option): soglia di utenti e aumenti con 30 giorni di avviso. **I 60 giorni sono la policy scelta da KlokShift.**
- [Connecteam: rimborsi](https://help.connecteam.com/en/articles/5828460-subscriptions-cancellations-refunds-and-plan-changes): mensile a fine periodo senza rimborso; eccezione iniziale su alcuni annuali. Non dimostra un diritto generale di rimborso entro 14 giorni.
- [Sling: documenti](https://support.getsling.com/en/articles/6057580-employee-documents), [Connecteam: Knowledge Base](https://help.connecteam.com/en/articles/5995369-starting-guide-to-connecteam-s-knowledge-base): limiti con perimetri diversi; non giustificano la quota provvisoria di 2 GiB.
- [Connecteam: termini §2.5](https://connecteam.com/terms-conditions/): recupero subordinato a verifiche; non basta conoscere dati pubblici dell'azienda.
- [Supabase: backup](https://supabase.com/docs/guides/platform/backups): separazione fra backup DB e oggetti Storage.
- [Paddle: accordo con il fornitore, §§2.1 e 5.2](https://www.paddle.com/legal/terms), [verifica account](https://www.paddle.com/help/start/account-verification/what-is-account-verification), [reverse invoice per payout](https://www.paddle.com/help/manage/get-paid/do-i-need-to-invoice-paddle-for-my-payout): ruoli contrattuali e procedure Paddle, da valutare sul caso fiscale italiano.
- [ISTAT: struttura e note ATECO 2025, pp. 439–440 e 450–451](https://www.istat.it/wp-content/uploads/2025/10/Ateco-2025.-2.-Struttura-e-note-Ebook.pdf): distinzione fra edizione di software e programmazione; non un'attribuzione automatica del codice al fondatore.
- [EDPB: linee guida 07/2020, §§139–142](https://www.edpb.europa.eu/system/files/2023-10/edpb_guidelines_202007_controllerprocessor_final_it.pdf), [limitazione della conservazione](https://www.edpb.europa.eu/sme/learn-the-basics/data-protection-basics_en): restituzione/cancellazione secondo ruoli e istruzioni; conservazione necessaria per la finalità, senza durata universale.
