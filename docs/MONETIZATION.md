# Monetizzazione di KlokShift

Aggiornato il **5 ottobre 2026**. Documento canonico delle decisioni commerciali e di prodotto approvate da Alisher; i dettagli ancora aperti sono indicati esplicitamente.

**Stato dell'implementazione:** M03a e blocco server M03b implementati e verificati in locale: accesso, capacità persone/sedi, blocco operativo su RPC/scritture dirette/upload, rettifiche limitate e consultazione storico. Collegamento iniziale app/dashboard: stato/date, prova esplicita, rimozione dei gate Pro sulle ore e scope storico delle sedi chiuse. Le aziende `migration_pending` conservano esplicitamente il funzionamento precedente finché vengono classificate, senza pagamenti/concessioni inventati. Il campo storico `workspaces.plan = free/pro` resta per compatibilità dello schema e non autorizza l'operatività. Restano dashboard del fondatore, quota aziendale, downgrade futuri, checkout/rinnovi/webhook Paddle e completamento di M11 (avvisi, restituzione completa e cancellazione). La procedura di test è in [TEST-MONETIZATION-M03B.md](TEST-MONETIZATION-M03B.md). Nessuna nuova migration remota o operazione finanziaria eseguita in questo blocco.

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

Gli importi sono approvati. I nomi **Base** e **Team** sono provvisori.

| Voce | Mensile | Annuale anticipato | Capacità |
|---|---:|---:|---|
| Base | 29 € | 290 € | Una sede inclusa; fino a 30 persone uniche in organico nell'intera azienda |
| Team | 49 € | 490 € | Una sede inclusa; organico senza limite commerciale |
| Sede aggiuntiva | 15 € | 150 € | Una sede operativa oltre quella inclusa |

Entrambi i piani includono le stesse funzioni disponibili del prodotto; la differenza riguarda la capacità. Organico senza limite non significa sedi o spazio documenti infiniti.

L'annuale copre **12 mesi consecutivi** al prezzo equivalente a **10 mensilità**: il risparmio corrisponde a due mesi, non a un secondo periodo di prova.

Con `S >= 1` sedi acquistate:

- Mensile: prezzo piano + `15 × (S − 1)`.
- Annuale: prezzo piano + `150 × (S − 1)`.
- Base con due sedi: 44 €/mese oppure 440 €/anno.
- Team con tre sedi: 79 €/mese oppure 790 €/anno.

Il sito attuale indica **IVA esclusa**. Con Paddle come MoR, il regime forfettario del fondatore non determina automaticamente il trattamento delle vendite di Paddle ai clienti. La dicitura fiscale e il trattamento dei rapporti fondatore/Paddle devono essere validati col commercialista prima del primo incasso. Gli importi confermati non autorizzano un'aliquota universale o una fatturazione interna improvvisata.

### Conteggio delle persone: decisione e dettagli aperti

È approvato il conteggio di **30 persone uniche nell'intera azienda**: chi lavora in più sedi della stessa azienda conta una volta. Persone in aziende diverse rientrano nella capacità di ciascuna azienda.

Restano da validare le regole applicative: schede manuali senza account, inviti che riservano un posto, titolari/collaboratori in organico, organico di sedi chiuse, uscita/ripristino e collegamento/merge delle schede. Il piano propone un conteggio dell'organico corrente, distinto dagli account registrati o dagli utenti che hanno aperto l'app.

Il limite deve essere controllato dal server sull'intera azienda, anche quando il collaboratore può vedere soltanto alcune sedi. Non creare duplicati commerciali della stessa persona per ogni sede.

### Superamento dei 30 e downgrade

- Avvisi a 28 e 30 persone conteggiate.
- Al 31° posto si blocca soltanto l'aggiunta/ripristino eccedente; il lavoro esistente continua.
- Nessuna espulsione, cancellazione dello storico o conversione con addebito silenzioso.
- Upgrade esplicito dal web, con costo proporzionato al periodo residuo accettato dal titolare e capacità aggiornata dopo esito finanziario verificato.
- Team → Base: riduzione programmata al rinnovo soltanto quando l'azienda è già entro 30 persone.
- Un'aggiunta incompatibile con la capacità futura richiede di annullare esplicitamente il downgrade; non rinnova Team di nascosto.
- Le stesse verifiche valgono per le sedi. Chiusura, riapertura e riduzione degli extra devono preservare lo storico e rispettare la capacità futura.
- Per un'azienda gratuita, l'aumento della concessione passa dalla decisione del fondatore.

I dettagli di proration, concorrenza e modifica dei cicli vanno provati con il provider scelto. Chiudere una sede non cancella automaticamente un extra già acquistato né genera un rimborso.

## 3. Prova gratuita e aziende gratuite a vita

### Tutte le nuove aziende: 30 giorni senza carta

La prova di **30 giorni gratuiti senza carta** è approvata per tutte le nuove aziende, con **piano Team e una sede inclusa**. Il primo mese gratuito è questa prova: non si aggiunge automaticamente un'altra promozione.

- Nessun addebito senza acquisto autorizzato e consenso al flusso ricorrente.
- Alla fine, in assenza di un periodo pagante o concessione valida, termina l'operatività e si passa alla consultazione/export.
- Pausa, ripartenza, nuove sedi o cambio di titolare non assegnano una seconda prova.
- Il fondatore può concedere proroghe finite con motivo, date e registro dell'intervento.
- La prova precede il periodo annuale acquistato: non duplica i due mesi di risparmio del listino.

**Dettagli da chiudere per il flusso cliente:** istante iniziale della prova, comportamento dell'acquisto durante la prova ed eleggibilità in caso di aziende create ripetutamente. La fondazione tecnica prevede un'attivazione esplicita, una sola volta dal server, con almeno una sede aperta già pronta; il collegamento automatico al setup viene affrontato nel flusso cliente.

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

- Addebiti duplicati o successivi a una disdetta/pausa già efficace: rimborso, compresi gli extra addebitati per errore.
- Disdetta ordinaria: periodo acquistato mantenuto, senza rimborso automatico del residuo.
- Cortesia per **rinnovo annuale involontario segnalato entro 14 giorni**, senza nuova attività operativa nel periodo rinnovato: gestione assistita della restituzione dell'addebito e passaggio all'archivio. Semplici login o export non costituiscono nuova operatività.
- Disservizi gravi verificati: credito proporzionato al periodo inutilizzabile.
- Contestazioni: stato, motivo, documentazione ed esito separati; nessuna cancellazione automatica dei dati come conseguenza della contestazione.

La cortesia di 14 giorni è una policy commerciale, non un diritto legale universale, e non limita i diritti applicabili. Rimborsi e crediti devono essere compatibili con il provider/MoR scelto ed effettivamente eseguiti lì, con audit nella dashboard; un flag locale non restituisce il denaro.

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

Restano aperti: approvazione e configurazione Paddle; compatibilità ATECO, procedura fiscale e dicitura pubblica; dettagli di conteggio e trial; quota finale documenti; validazione privacy/DPA e cancellazione; trasferimenti e condizioni delle concessioni permanenti; limiti tecnici delle rettifiche e ripristino; flusso store concreto. Il piano di implementazione elenca dipendenze e verifiche bloccanti. La scelta del provider e il regime dichiarato non attestano validazione fiscale, privacy o funzionalità già operative.

## 10. Riferimenti e limiti del confronto

Fonti ufficiali verificate il **5 ottobre 2026**. Sono esempi commerciali, non norme italiane o regole da copiare integralmente.

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
