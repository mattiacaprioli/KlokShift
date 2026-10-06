# Monetizzazione e dashboard personale di KlokShift

Analisi iniziale: **5 ottobre 2026**, repository al commit `da956cb`.
Stato di esecuzione aggiornato: **6 ottobre 2026**.

**Stato: regole commerciali approvate; M03a/M03b implementati, M05 rilasciato con primo accesso MFA/panoramica confermato, M06a verificato localmente.** Alisher ha confermato listino, 30 persone uniche per azienda, pagamenti automatici dal web al lancio, dashboard essenziale prima dei paganti, gratuità a vita con piano/sedi individuali, prova Team/una sede di 30 giorni e archivio di 12 mesi. Ha approvato anche le raccomandazioni sugli otto punti dopo il confronto con i concorrenti e ha scelto **Paddle**. Il fondatore dichiara una partita IVA già attiva in regime forfettario e attività di frontend developer; il codice ATECO esatto è da recuperare. Restano approvazione/configurazione Paddle, compatibilità ATECO e procedura fiscale, validazione privacy e dettagli tecnici esplicitamente aperti; la quota iniziale di spazio va calibrata sui tester. M06a aggiunge concessioni e audit senza modifiche remote in questo blocco. Classificazione e attivazione delle aziende ospitate rimangono esplicite; prove manuali residue e altre attività sono indicate nelle singole fasi.

**Fonti correnti:** [MONETIZATION.md](../docs/MONETIZATION.md) per le regole e
[FOUNDER-DASHBOARD.md](../docs/FOUNDER-DASHBOARD.md) per la dashboard personale.
Questo file conserva inventario, motivazioni, dipendenze, step e verifiche. I
riferimenti a «proposte» nell'analisi descrivono la progettazione iniziale;
regole approvate e questioni residue sono distinte nei documenti dedicati e nel
§10. Un requisito approvato non rende una fase di sviluppo completata.

## 1. Obiettivo e direzione concordata

Rivedere la monetizzazione esistente e costruire un percorso che permetta di vendere KlokShift e gestire l'attività senza introdurre subito un sistema amministrativo complesso.

La direzione concordata è: **pagamenti automatici dal web pronti prima dei primi clienti paganti, importi attuali mantenuti, 30 persone uniche per azienda nel piano Base, dashboard personale essenziale e aziende scelte dal fondatore gratuite a vita con piano/sedi decisi per ciascuna.** Tutte le nuove aziende hanno trenta giorni senza carta; a fine operatività sono previsti dodici mesi gratuiti di consultazione/export, con cancellazione operativa al termine secondo la policy. Il modello proposto resta abbonamento per azienda, stesse funzioni nei due piani e capacità distinta per organico e sedi. Il percorso inizialmente suggerito «manuale prima, automazione dopo» è sostituito dalla preferenza espressa da Alisher.

L'obiettivo finale della dashboard comprende utenti, aziende, sedi, persone in organico, date, scadenze, pagamenti, incassi, costi e andamento commerciale. La prima versione deve permettere di prendere decisioni e attivare clienti; le analisi avanzate possono arrivare dopo.

Vincoli del prodotto da conservare:

- Il piano appartiene a `workspaces`, non a `profiles` e non a una persona.
- Un account può lavorare in più aziende: ogni azienda ha accesso e abbonamento indipendenti.
- Authority, permessi, appartenenza all'organico e accesso commerciale sono concetti distinti.
- I professionisti non acquistano il piano e non pagano per il proprio account.
- Restano RPC atomiche, RLS, data layer condiviso e conferma email obbligatoria.
- Nessun recupero di marketplace, candidature, CV, recensioni o calcolo delle paghe.
- L'app nativa non mostra prezzi. La gestione commerciale per il titolare sarà sul web.
- Focus commerciale iniziale da scegliere: l'allegato parla anche di retail e cantieri, ma non costituisce una decisione di ampliare il prodotto. Partire da una nicchia di attività a turni già servite riduce il lavoro di vendita e supporto.

L'allegato riporta dicembre 2026 come obiettivo V1 e 3–5 beta tester gratuiti: sono riferimenti di pianificazione da confermare, non date di rilascio garantite.

## 2. Inventario iniziale: mantenere, sostituire, eliminare

Fotografia precedente a M03a/M03b. Le righe con gate Pro, fallback, sedi
illimitate e selettore di dodici mesi sono superate dall'implementazione
descritta in §8; restano qui per documentare la superficie verificata.

| Area verificata | Comportamento all'audit iniziale | Intervento previsto |
|---|---|---|
| `package.json`, `supabase/functions/` | Nessuna integrazione di pagamento trovata: niente SDK RevenueCat/Stripe, checkout o webhook commerciali | Nessuna integrazione da smontare; integrare Paddle dopo le verifiche |
| `supabase/migrations/20260920000100_identity_tables.sql` | `workspaces.plan` è `free/pro`, default `pro`, non modificabile dal client | Conservare la titolarità del piano nell'azienda; sostituire gradualmente il modello binario |
| `supabase/migrations/20260920000600_workspace_rpcs.sql` | `get_my_context()` restituisce `plan`; `create_workspace()` crea aziende con il default; tetto tecnico di 10 aziende per creatore | Aggiungere accesso commerciale esplicito; separare tetto antiabuso e capacità acquistata |
| `src/features/workspace/types.ts`, `src/features/venues/OwnerVenues.tsx` | Propagano `free/pro`; il provider ripiega su `pro` in assenza di azienda corrente | Introdurre stato di caricamento/errore e accesso dell'azienda, senza sbloccare per default quando il dato manca |
| `src/features/plan/hooks.ts` | `useIsPro`, `useProGate` e rotta paywall nativa | Sostituire i gate Free/Pro con accesso e capacità; separare permessi del membro e stato commerciale |
| `src/features/plan/ProLock.tsx` | Badge, lucchetti, card «Passa a Pro» | Eliminare upsell e distinzione delle funzioni se i due piani includono tutto; eventuale card neutra di stato azienda |
| `src/app/(manager)/pro.tsx` | Preview di upsell; promette copertura sempre gratuita; «Sono interessato» mostra soltanto un toast | Eliminare la promessa di freemium; rimuovere o sostituire la schermata. Il pulsante attuale non raccoglie interesse |
| `src/features/plan/devOverride.ts`, `DevPlanToggle.tsx` | Simulazione locale Free/Pro in sviluppo | Sostituire con fixture degli stati commerciali oppure eliminare; non usarli per attivazioni reali |
| `src/app/(manager)/(tabs)/staff.tsx`, `src/app/(manager)/staff/[id].tsx` | Gate Pro per ore e sezioni della scheda, ulteriori ai permessi | Rimuovere i gate di funzionalità; mantenere i controlli di authority/permesso e aggiungere il comportamento a scadenza |
| Home, profilo e impostazioni manager | Home con upsell, profilo con `PlanCard`, impostazioni con toggle dev | Riallineare al nuovo modello e verificare ogni chiamante prima di eliminare gli import |
| `src/features/venues/gate.ts` | Numero di sedi illimitato sia Free sia Pro | Sostituire con capacità effettiva acquistata; il conteggio deve includere tutte le sedi aziendali pertinenti |
| `create_venue`, `set_venue_closed` | Nessun limite commerciale; chiusura conserva storico | Controllare creazione e riapertura nel DB, con concorrenza e accesso commerciale |
| `web/src/pages/SedeNuova.tsx`, app `venue/new.tsx` | Condividono il gate sedi; web non usa il paywall nativo | Conservare la condivisione della regola e adattare messaggi/azioni per piattaforma |
| `web-site/src/content/it.ts`, `web-site/index.html` | Due listini, sede extra, annuale, 30 giorni senza carta | Allineare prezzi, capacità, CTA, FAQ, metadata e JSON-LD alla decisione finale |
| FAQ del sito su stagione/non rinnovo | Promette dashboard in sola lettura ed export dopo scadenza | Implementare davvero la modalità oppure correggere la promessa prima di venderla |
| Dashboard personale del fondatore | Non trovata nel progetto | Creare un'area riservata di gestione della piattaforma |
| `delete_account`, oracolo permessi, `get_my_context()` | Eliminare l'ultimo titolare chiude l'azienda e la esclude dal contesto; il login e i file caricati dall'account sono eliminati | Non riusare questo flusso per pausa/uscita commerciale: servono stati che conservino accesso all'archivio |
| `web/src/pages/Ore.tsx` | Il selettore offre gli ultimi 12 mesi | Permettere l'export dei periodi storici conservati, anche oltre dodici mesi fa |
| `getMyVenues`, `OwnerVenues`, policy documenti/Storage | Molte query usano solo sedi aperte; leggere e scrivere documenti riusano helper comuni | Scope storico per consultazione/export e controlli separati per lettura e scrittura |
| `web-site/public/privacy.html` | Conservazione generica, nessun calendario per aziende cessate; dichiara assenza di dati di pagamento e backup entro 30 giorni | Allineare ai nuovi flussi e ai tempi verificati, senza usare come prova una promessa non controllata |

**Conclusione dell'audit:** oggi non c'è un sistema di abbonamenti attivo. Ci sono un vecchio modello di accesso Free/Pro e un sito con un'offerta commerciale più recente. Mancano periodi, pagamenti, scadenze, applicazione dei limiti e accesso in sola lettura. I gate attuali sono principalmente UI: non costituiscono un controllo commerciale lato server.

Non eliminare i file storici in `supabase/migrations_legacy/` e non riscrivere le migration già applicate. Le modifiche allo schema saranno additive; la rimozione finale di `workspaces.plan` avverrà dopo la migrazione dei lettori.

## 3. Cosa correggere nell'altra chat

### Pagamenti web: RevenueCat non è una dipendenza necessaria

La scelta utile per KlokShift è evitare di introdurre un ulteriore sistema di abbonamenti se non serve al flusso scelto. Per il pagamento web, backend e database possono leggere gli eventi del provider e fornire lo stesso accesso a dashboard e app. Non serve un SDK di pagamento nativo per questo percorso. RevenueCat documenta anche Web Billing: l'affermazione che sia in generale soltanto per IAP è una semplificazione da non usare come requisito di progetto. [RevenueCat: Web Billing](https://www.revenuecat.com/docs/web/web-billing/overview).

### Merchant of Record: semplifica la vendita, non azzera gli adempimenti personali

La promessa «fai sicuramente una fattura al mese al MoR» non è una base corretta per decidere. Paddle documenta un documento di **reverse invoice** generato per ciascun payout; Lemon Squeezy descrive lo stesso meccanismo e payout normalmente due volte al mese. Sono procedure del provider, da far valutare nel tuo regime italiano: non equivalgono automaticamente a una fattura elettronica SdI valida per ogni tua esigenza. [Paddle: documentazione payout](https://www.paddle.com/help/manage/get-paid/do-i-need-to-invoice-paddle-for-my-payout), [Lemon Squeezy: getting paid](https://docs.lemonsqueezy.com/help/getting-started/getting-paid).

Il MoR può occuparsi delle imposte sulla vendita al cliente; la tua imposta personale, i contributi, il trattamento dei compensi e gli eventuali adempimenti con controparti estere restano da definire. Prima del primo incasso serve una procedura concordata con il commercialista, con un esempio di vendita, commissioni, payout e relativi documenti. La guida dell'Agenzia tratta separatamente natura IVA e operazioni transfrontaliere: non assumere che il bonifico netto coincida con il fatturato fiscale. [Agenzia delle Entrate: guida FE/operazioni estere](https://www.agenziaentrate.gov.it/portale/documents/20143/451259/Guida_compilazione-FE-Esterometro-V_1.9_2024-03-05.pdf).

**Aggiornamento confermato:** il canale iniziale è Paddle; il fondatore intende usare la propria partita IVA già attiva in forfettario per la licenza/accesso a KlokShift. Svolge attività di frontend developer, ma non ha ancora comunicato il codice ATECO completo. La compatibilità non è confermata: le note ISTAT separano programmazione ed edizione di software, compreso quello autopubblicato. Verificare l'inquadramento prima dei primi incassi, senza attendere un numero maggiore di clienti e senza presumere necessario un nuovo codice. Il flusso fiscale da esaminare è quello fra fornitore/licenziante e Paddle rivenditore/MoR, con contratto e documenti effettivi. [ISTAT: note ATECO, pp. 439–440 e 450–451](https://www.istat.it/wp-content/uploads/2025/10/Ateco-2025.-2.-Struttura-e-note-Ebook.pdf), [Paddle: accordo §§2.1 e 5.2](https://www.paddle.com/legal/terms). Situazione e verifiche sono consolidate in [MONETIZATION.md, §9](../docs/MONETIZATION.md#9-condizioni-prima-del-lancio-pagante-e-questioni-aperte).

Anche «IVA esclusa» va riesaminato: una vendita diretta nel tuo regime e una rivendita del MoR hanno soggetti venditori e trattamenti diversi. Non cambiare ora gli importi pubblici e non codificare un'IVA universale. Concordare la dicitura per ciascun canale, inclusi eventuali dati B2B richiesti e imposta di bollo. [Agenzia delle Entrate: bollo](https://www1.agenziaentrate.gov.it/web_app_entrate/bollo_fatture_2024.html).

### Provider: Paddle scelto; confronto conservato come riferimento

**Decisione corrente: Paddle.** La scelta sostituisce la precedente candidatura; le alternative sotto restano il contesto della valutazione, non attività di selezione ancora aperte. Approvazione dell'account, contratto applicabile, configurazione e test non sono completati dalla scelta.

| Opzione | Uso possibile | Valutazione proposta |
|---|---|---|
| Bonifico e fattura gestita esternamente | Eventuale eccezione assistita | Non è il percorso di lancio scelto; eventuale supporto futuro deve avere incasso e periodo verificati |
| Stripe Payments/Billing standard | Pagamenti e rinnovi; tu resti venditore | Alternativa da valutare insieme alla procedura di fatturazione italiana; non inserire Stripe nel MVP per inerzia |
| Paddle | MoR e abbonamento composto da piano + quantità di sedi extra | Scelto dal fondatore; approvazione account e prova tecnica da completare |
| Lemon Squeezy | MoR, varianti e quantità | Alternativa; provare il nostro caso completo prima di assumerne l'equivalenza con Paddle |
| Stripe Managed Payments | Prodotto MoR distinto da Stripe standard | Opzione attuale da valutare; l'Italia è elencata fra le sedi supportate, ma l'accesso dipende da una verifica di idoneità |

Stripe documenta oggi un proprio servizio MoR: quindi «Stripe oppure MoR» è una falsa alternativa se non si precisa il prodotto. Non viene scelta né integrata questa opzione nel presente piano. [Stripe Managed Payments](https://docs.stripe.com/payments/managed-payments), [idoneità](https://docs.stripe.com/payments/managed-payments/eligibility).

Paddle documenta più voci ricorrenti in un abbonamento, purché condividano il periodo: piano annuale e sedi annuali, piano mensile e sedi mensili. Questo corrisponde al nostro listino. **La scelta è confermata; la compatibilità dell'intero ciclo commerciale va ancora verificata in sandbox.** [Paddle: aggiunta/rimozione prodotti](https://developer.paddle.com/build/subscriptions/add-remove-products-prices-addons/).

Lemon Squeezy documenta varianti e subscription items, ma ciò non dimostra da solo un checkout con piano base + sedi a prezzo diverso e un unico rinnovo. La prova deve verificare questa combinazione, cambi quantità, annuale e downgrade senza generare molte varianti per ogni numero di sedi. [Lemon Squeezy: piani SaaS](https://docs.lemonsqueezy.com/guides/tutorials/saas-subscription-plans), [subscription item](https://docs.lemonsqueezy.com/api/subscription-items/the-subscription-item-object).

Per i costi, evitare la stima unica «5% + 0,50 €». Paddle pubblica **5% + 50¢** per transazione; valuta e condizioni vanno verificate nel contratto. Lemon Squeezy elenca supplementi per abbonamenti, transazioni internazionali, PayPal e payout esteri: il confronto va fatto sul costo effettivo per il tuo caso. [Paddle: prezzi](https://www.paddle.com/pricing), [Lemon Squeezy: commissioni](https://docs.lemonsqueezy.com/help/getting-started/fees).

### Store: KlokShift non è una reader app per definizione

Apple distingue reader app, servizi aziendali e app gratuite complementari a un servizio web. Per KlokShift la valutazione va fatta sul flusso B2B concreto e sulle sezioni **3.1.3(c)** e **3.1.3(f)**, senza garantire in anticipo l'approvazione. Google documenta app che accedono a servizi già acquistati fuori dall'app. Le possibilità di link e messaggi dipendono anche da storefront e programmi applicabili. [Apple: linee guida](https://developer.apple.com/app-store/review/guidelines/), [Google: chiarimenti sui pagamenti](https://support.google.com/googleplay/android-developer/answer/10281818?hl=en).

Proposta iniziale: acquisto e gestione del pagamento sul web, app nativa senza prezzi, checkout o inviti all'acquisto. Stato neutro dell'azienda, per esempio «L'accesso operativo di questa azienda è terminato. Puoi consultare lo storico.» Preparare note di review e account demo che permettano di verificare gestione e lavoro. Riesaminare registrazione azienda e link esistenti; non eliminare la registrazione dei professionisti o l'accettazione degli inviti per effetto di un consiglio generico.

## 4. Offerta commerciale approvata e dettagli applicativi

### Listino: mantenere gli importi, chiarire la capacità

Gli importi sotto sono **quelli già presenti nel sito e confermati da Alisher in questa sessione**. È confermato anche il limite di 30 persone uniche nell'intera azienda; i dettagli per inviti, organico chiuso e variazioni sono da concordare.

| Piano | Mensile | Annuale anticipato | Capacità proposta |
|---|---|---|---|
| Base, nome provvisorio | 29 € | 290 € | Una sede, fino a 30 persone in organico nell'azienda |
| Team, nome provvisorio | 49 € | 490 € | Una sede, organico senza limite commerciale |
| Sede aggiuntiva | 15 € per sede | 150 € per sede | Una sede operativa aggiuntiva, senza creare una nuova azienda |

Entrambi includono le stesse funzioni disponibili del prodotto. «Senza limite» riguarda l'organico, non il numero delle sedi né limiti tecnici infiniti. L'annuale copre dodici mesi, pagando l'equivalente di dieci mensilità; non è un abbonamento di dieci mesi.

Formula commerciale proposta, con `S` sedi acquistate e `S >= 1`:

- Mensile: prezzo piano + `15 × (S − 1)`.
- Annuale: prezzo piano + `150 × (S − 1)`.
- 25 persone e due sedi: 44 €/mese oppure 440 €/anno.
- 45 persone e tre sedi: 79 €/mese oppure 790 €/anno.

Gli esempi sono valori di listino prima degli eventuali tributi applicabili e delle commissioni. La dicitura fiscale resta da confermare. Non assumere che l'allegato abbia approvato un piano da 59 € con sedi illimitate: quella era una proposta diversa, non coerente con il sito attuale.

### Come contare le persone

**Decisione confermata:** il limite di 30 vale sull'intera azienda e una persona in più sedi conta una volta. Definizione tecnica proposta: contare ogni `workspace_members.id` che abbia almeno una riga corrente di organico in una sede aperta. Il controllo usa dati aziendali completi anche se il collaboratore vede una sola sede. I dettagli della tabella seguente restano proposte applicative da validare.

| Caso | Conteggio proposto |
|---|---|
| Professionista in due sedi della stessa azienda | Una persona |
| Persona in aziende diverse | Una persona in ciascuna azienda; un solo account nelle statistiche globali |
| Scheda manuale senza account, già in organico | Conta: usa il prodotto anche senza login |
| Titolare/collaboratore con accesso gestionale, senza organico | Non conta nel limite dell'organico |
| Titolare/collaboratore che lavora in organico | Conta una volta |
| Invito con posto in organico corrente | Riserva e conta il posto; accettarlo non deve rendere l'azienda oltre limite |
| Membro uscito o senza organico corrente in sedi aperte | Non conta; rimane nello storico |
| Stagionale / a chiamata | Conta finché è nell'organico corrente, indipendentemente dal numero di turni |

Distinguere «persone attive nell'organico» da «utenti che hanno usato l'app nell'ultimo mese». Non fare pricing sulla seconda misura.

Proposta per il 31° posto: rifiutare soltanto la creazione/ripristino che eccede la capacità, con un errore tradotto; il lavoro già esistente continua. Il titolare richiede e conferma il cambio piano dal web. Per un'azienda gratuita il fondatore decide se estendere la concessione. Nessun addebito silenzioso e nessuna espulsione automatica di persone.

Operazioni da coprire: `add_member`, `set_member_venue`, ripristino di un membro, auto-inserimento del titolare in organico, riapertura sedi, merge/link di schede e accettazione inviti. Verificare dove il conteggio cambia davvero. Il merge può ridurre il conteggio: non bloccare un'operazione che migliora una situazione oltre limite.

### Sedi, chiusura e cambi piano

- Capacità sedi = una inclusa + quantità di extra acquistata.
- Contano le sedi aperte; chiudere una sede non cancella turni e storico.
- Chiudere una sede non rimborsa o annulla automaticamente una voce già acquistata.
- Ridurre gli extra ha effetto al rinnovo, se le sedi aperte rientrano nella capacità futura.
- Riaprire verifica **sia** la capacità sedi **sia** le persone che tornano a contare.
- Nessuna duplicazione di abbonamento perché uno stesso titolare ha più sedi della medesima azienda.
- Due aziende distinte richiedono due contratti, anche quando hanno lo stesso titolare. Non aggregarle implicitamente per email.
- Upgrade e nuove sedi richiedono una variazione concordata/accettata; il prezzo aggiuntivo deve essere visibile sul web prima della conferma.
- Regola approvata: upgrade esplicito con costo proporzionato al residuo e nuova capacità dopo esito finanziario verificato; downgrade al rinnovo già compatibile. La capacità futura deve restare rispettata oppure il cliente annulla esplicitamente il downgrade. Il mapping provider e il cambio mensile/annuale restano da definire.

## 5. Percorso di lancio e ciclo dell'accesso

### Aziende test gratuite a vita

**Richiesta confermata:** poter lasciare gratuite a vita le aziende iniziali selezionate dal fondatore. La fase beta del prodotto può finire mentre la concessione gratuita resta valida; non convertire automaticamente questi clienti in paganti.

Raccomandazione: assegnazione dalla dashboard personale alla specifica azienda (`workspace_id`), con piano/capacità, data di inizio, motivo e fondatore che la concede. Il beneficio non scade e non richiede carta, checkout o rinnovi fittizi. «A vita» va definito nelle condizioni come gratuità per la durata del servizio, nel perimetro concesso; una normale fine beta o variazione prezzi non lo rimuove.

Non regalare automaticamente tutte le aziende future della persona né associare il beneficio soltanto all'email. Decidere che cosa accade al trasferimento di titolarità: proposta, resta sull'azienda identificata. Dipendenti e collaboratori usano quella stessa azienda secondo i permessi esistenti.

**Capacità confermata:** il fondatore sceglie piano e numero di sedi gratuite per ogni azienda. Gratuità e capacità sono campi distinti: la concessione non assegna automaticamente infinite sedi. Il piano scelto determina la capacità dell'organico, il numero di sedi concesse determina la capacità sedi. Un extra oltre la concessione non si addebita da solo; richiede estensione del beneficio o un nuovo accordo esplicito sul web.

### Codice gratuito: opzionale, monouso e con beneficio permanente

L'assegnazione diretta è sufficiente per i primi tester. Se serve consegnare un codice/link:

1. Il fondatore lo genera dalla propria dashboard; il server stabilisce benefici e destinatario.
2. Il codice è casuale, memorizzato come hash, con scadenza per il riscatto e un solo utilizzo; preferibilmente vincolato all'azienda già identificata.
3. Il titolare autenticato lo riscatta sul web; il backend verifica ownership, destinatario e validità.
4. Riscatto e concessione sono atomici e resistono a richieste simultanee. Il beneficio risultante non scade, anche se il codice di riscatto scade.

Niente codice pubblico riutilizzabile «sempre free» e niente coupon provider applicato a tutte le future aziende. Non serve sviluppare un sistema generale di promozioni: il codice è solo un altro ingresso alla stessa concessione amministrativa. Non usare `user_metadata` o un flag locale per concedere accesso.

In dashboard queste aziende risultano «Gratuito a vita», con capacità e cronologia visibili; MRR e incassi sono zero, consumo infrastrutturale e attività si misurano normalmente. Il vantaggio commerciale è distinto dal costo che sostieni per servirle.

### Primi clienti paganti: automatizzati dal lancio

Checkout web, eventi firmati, rinnovi, disdetta, variazioni compatibili e riconciliazione devono essere pronti prima di accettare clienti paganti. La dashboard mostra pagamenti riusciti, importi/valuta, documenti provider, periodi coperti, capacità e payout. **Un checkout aperto, un redirect di successo o un pagamento atteso non equivalgono a un incasso verificato.**

La fatturazione fiscale rimane nel processo del venditore/provider scelto e del commercialista. La dashboard conserva riferimenti e stato amministrativo, senza un generatore interno XML SdI.

### Preparazione e rilascio

Avviare subito nella roadmap la verifica di idoneità, la procedura fiscale e la prova sandbox. Una volta chiuse le regole, integrare un solo provider. L'accesso gratuito delle aziende scelte dal fondatore deve funzionare anche prima del provider: permette di provare il prodotto senza rimandare la preparazione dei pagamenti.

Ordine pratico: decisioni e verifica provider → accesso/capacità → dashboard personale e concessioni → pulizia client/sito → checkout/webhook → prove complete → primi clienti paganti. Lo sviluppo delle parti indipendenti può procedere nello stesso periodo; il lancio pagante richiede tutti i gate pertinenti. Il costo in tempo è maggiore del percorso manuale, quindi ridurre analytics e automazioni secondarie prima di ridurre l'affidabilità dei pagamenti.

### Stati: separare contratto, periodo e permessi

Non usare un unico enum per tutto. Il contratto descrive la relazione commerciale; i periodi e le concessioni descrivono il diritto di accesso; i permessi dicono cosa può fare il membro.

| Situazione | Accesso proposto |
|---|---|
| Azienda appena creata, senza attivazione | Setup limitato per creare la prima sede e richiedere l'attivazione; niente attività operativa indefinita |
| Beta / concessione gratuita valida | Operativo entro date e capacità concordate |
| Concessione gratuita a vita | Operativo senza scadenza commerciale entro la capacità concessa; niente richiesta di pagamento |
| Prova commerciale valida | Operativo per il periodo della prova |
| Periodo pagato valido | Operativo entro la capacità acquistata |
| Rinnovo disdetto, periodo già pagato non terminato | Operativo fino alla fine del periodo |
| Pagamento di rinnovo fallito | Raccomandazione: 7 giorni di tolleranza per aziende già paganti, poi sola lettura; nessun reset per retry |
| Prova o periodo terminato senza rinnovo | Sola lettura ed export nei permessi del membro |
| Pausa stagionale effettiva | Rinnovi fermati, dati consultabili/esportabili entro il termine dichiarato; ripartenza esplicita |
| Uscita commerciale, archivio ancora valido | Nessun nuovo rinnovo; consultazione/export temporanei per i membri autorizzati |
| Termine dell'archivio raggiunto | Accesso all'archivio cessato; cancellazione operativa prevista dalla policy |
| Sospensione amministrativa | Stato distinto, motivazione e azioni consentite definite; non confonderla con mancato pagamento |
| Azienda chiusa/eliminata | Regole di cancellazione esistenti e gestione della chiusura del contratto |

Per la prova pubblica di 30 giorni, proposta: inizio alla prima attivazione dell'azienda utilizzabile, con prima sede pronta; data impostata una volta dal server. Durante la beta assistita decide il fondatore. Aprire una sede o trasferire la titolarità non riavvia la prova. Definire come gestire la creazione ripetuta di aziende per ottenere nuove prove senza basarsi soltanto su `created_by`.

Inizio/fine dei periodi sono istanti UTC, intervalli con fine esclusiva, visualizzati in Europe/Rome. Un mese non è sempre 30 giorni e un anno non è sempre 365: per gli abbonamenti usare i periodi del provider. Una concessione a vita ha fine assente per scelta esplicita del fondatore; non interpretare qualunque data mancante come accesso illimitato.

### Scadenza: conservare il valore senza perdere registrazioni

La scadenza riguarda quell'azienda, non la sessione della persona. Si continuano a consultare turni, ore e documenti già autorizzati e a fare export. Rimangono disponibili gestione del proprio account, sicurezza, uscita/cancellazione e richiesta di assistenza. Le altre aziende della persona restano indipendenti.

La sola lettura deve bloccare le nuove attività operative e i relativi upload **nel backend**, non soltanto disabilitare pulsanti. Inventariare RPC, scritture dirette e policy Storage. I controlli di appartenenza/permesso restano necessari anche se il piano è attivo.

Eccezione approvata: finestra separata di 7 giorni per completare/rettificare presenze relative a lavoro svolto o iniziato prima della fine operativa, senza nuovi turni, lavoro o proroga dell'archivio. M03b applica localmente anche fine turno + 24 ore come limite tecnico del clock-out già aperto, da verificare nei flussi dev. Ogni eccezione è limitata per record, permesso e tempo. Dopo la finestra restano il percorso assistito e le richieste sui diritti. Il blocco locale nega conferme di turni futuri e richieste operative, conservando il testo della chat durante l'archivio; la procedura di assistenza completa resta M11.

La conservazione non è automaticamente illimitata. Definire tempi, avvisi, export e cancellazione nei termini, distinguendo dati fiscali da dati operativi.

### Primo mese gratuito: una regola esplicita

**Decisione confermata da Alisher:** il primissimo mese gratuito è la prova di **30 giorni senza carta per tutte le nuove aziende**, già annunciata sul sito. Il fondatore può concedere proroghe selettive, limitate e registrate. Non è una seconda promozione che si somma automaticamente alla prova.

- Parte quando l'azienda è utilizzabile con la prima sede pronta, una volta sola; un cambio piano, una pausa, una ripartenza o una nuova sede non lo riavviano.
- Comprende le funzioni operative e una capacità dichiarata. Il fondatore può concedere una proroga limitata e registrata.
- Alla fine, se manca una sottoscrizione pagante autorizzata, si passa all'archivio in sola lettura; nessun addebito senza metodo di pagamento e consenso al flusso ricorrente.
- Se il cliente sceglie un abbonamento durante la prova, mostrare data del primo addebito e periodo coperto; non troncare la prova per errore di mapping nel provider.
- Con l'annuale la prova precede i dodici mesi pagati. I due mesi di risparmio nel prezzo annuale restano il rapporto 10 mensilità/12 mesi; non duplicare la prova con un secondo coupon «primo mese gratis».
- Gratuità a vita, prova iniziale, proroga e sconto commerciale restano motivi separati; nessuna concessione gratuita entra nel MRR pagante.

Paddle documenta anche prove senza metodo di pagamento; verificare in sandbox conversione, scadenza e abbonamento risultante prima di scegliere quale stato sia autorevole. Una prova non convertita non deve impedire un acquisto successivo né assegnare altri trenta giorni automaticamente. [Paddle: cardless trials](https://developer.paddle.com/build/trials/cardless-trials/).

### Pausa stagionale: fermare il rinnovo e mantenere lo storico

Regola approvata: un'azienda che si ferma, per esempio d'inverno, può sospendere l'operatività e continuare a leggere i propri dati. Il flusso da implementare è:

1. Il titolare chiede la pausa dal web e vede decorrenza, ultimo periodo pagato e termine di consultazione. Il fondatore vede richiesta e risultato nella propria dashboard.
2. La pausa degli addebiti parte **alla fine del periodo già pagato**. Fino ad allora il diritto operativo acquistato resta valido; se si desidera bloccare prima il planning, indicarlo come scelta operativa distinta.
3. Dalla decorrenza non partono nuovi rinnovi del piano né delle sedi extra; si conservano lettura, download ed export già autorizzati. Non si creano nuovi turni, timbrature o upload, salvo le eccezioni finite di completamento del lavoro già iniziato.
4. La ripartenza richiede un'azione esplicita del titolare sul web. Mostrare prezzo, capacità e data del prossimo pagamento; riattivare l'accesso pagante sulla base della conferma prevista dal provider.
5. Una riattivazione durante l'archivio riprende dati e identità esistenti; nessuna nuova prova gratuita. Una gratuità permanente valida rimane gratuita e non richiede checkout.

**Regola annuale approvata:** la pausa stagionale non congela né prolunga automaticamente i dodici mesi già acquistati e non genera rimborsi automatici. Si può interrompere il rinnovo annuale futuro; un eventuale prodotto con mesi di credito o tariffa stagionale sarebbe una decisione distinta, oggi non prevista.

**Azienda e sede sono livelli diversi.** Chiudere una sede non sospende l'intera azienda né ferma da solo la sua voce di pagamento. Una sede stagionale può restare nello storico e ridurre gli extra acquistati alla decorrenza concordata; se altre sedi lavorano il contratto aziendale continua. La pausa aziendale non marca tutti i membri come usciti e non equivale a eliminarli dall'organico.

Il provider deve confermare il blocco: un flag locale non basta. Paddle documenta pausa degli addebiti, decorrenza a fine periodo e ripresa; la pausa non è disponibile nel suo portale cliente standard e richiede un flusso API dedicato. Non impostare riprese automatiche a una data presunta senza scelta del titolare. [Paddle: pause subscriptions](https://developer.paddle.com/build/subscriptions/pause-subscriptions/).

### Uscita definitiva: archivio temporaneo ed export

Richiesta confermata come requisito: chi termina il rapporto deve poter recuperare i propri dati per il consulente del lavoro o il commercialista. **Uscire dal servizio commerciale, cancellare un account e cancellare i dati aziendali sono azioni distinte.**

**Decisione confermata da Alisher:** archivio gratuito per **12 mesi dall'ultimo giorno di accesso operativo**, sia dopo pausa sia dopo mancato rinnovo/uscita senza richiesta di cancellazione anticipata. È una durata commerciale scelta per coprire un ciclo annuale, non un termine di conservazione imposto dalla legge. La finestra copre tutto lo storico ancora conservato, non soltanto gli ultimi dodici mesi di dati.

La conferma di uscita mostra fine degli addebiti, data di termine operativo, scadenza dell'archivio e cosa sarà cancellato. Se la disdetta avviene prima della fine del periodo pagato, i dodici mesi di archivio iniziano alla fine di quel periodo, non dal giorno della richiesta. Cambiare etichetta da pausa a uscita, effettuare un login o scaricare un export non prolunga la finestra.

Durante l'archivio:

- Consultazione ed export di turni, presenze, ore lavorate approvate, ore riconosciute, classificazioni/maggiorazioni e anomalie; PDF/CSV con periodo selezionabile.
- Accesso allo storico di sedi chiuse e persone uscite, entro i permessi effettivi del chiamante. I professionisti consultano i propri dati consentiti, non il fascicolo dell'intera azienda.
- Download dei documenti ancora autorizzati e disponibili. Un report ore non è da solo l'export completo di tutti i dati aziendali: prevedere un percorso di restituzione più ampio dove necessario.
- Nessun account condiviso con il commercialista e nessun link pubblico senza autorizzazione; il referente scarica gli export o delega secondo un permesso definito.
- Informazioni chiare su sola lettura, scadenza e riattivazione. Richiesta di cancellazione anticipata e gestione dei diritti restano disponibili.

Proposta di avvisi al referente autorizzato: conferma iniziale e promemoria a 30 e 7 giorni dal termine, con link alla pagina autenticata di export. Sono notifiche di servizio da implementare nel prodotto: questo piano non autorizza invii manuali a clienti.

Al termine l'accesso all'archivio cessa e il processo elimina i dati operativi secondo la policy concordata. Riattivare prima del termine ferma la cancellazione pendente. Se i dati sono già eliminati, non promettere ripristino dal backup: il cliente riparte con ciò che ha eventualmente conservato nel proprio export.

Una pausa senza fine e senza pagamenti non deve diventare conservazione gratuita perpetua implicita. Un'estensione eccezionale richiede motivo, durata e registrazione; una reale ripresa operativa è distinta da un cambio di stato usato per rinviare la cancellazione.

### Cosa resta a KlokShift dopo l'uscita

| Categoria | Finalità e gestione proposta |
|---|---|
| Cliente e contratto di KlokShift, transazioni, payout, documenti fiscali pertinenti | Storico amministrativo separato, con accesso ristretto e termini determinati dagli obblighi applicabili; validare col commercialista quali documenti sono tuoi e quali del MoR |
| Informazioni commerciali essenziali, date, motivo cessazione e KPI | Conservare solo ciò che ha uno scopo documentato, con un termine dedicato; per statistiche a lungo termine preferire aggregati effettivamente anonimi |
| Turni, ore, assenze, schede HR, chat e documenti del personale | Dati operativi dell'azienda: archivio per il periodo concordato e poi restituzione/cancellazione secondo istruzioni e obblighi applicabili; non diventano un archivio personale illimitato del fondatore |
| Account e appartenenze della stessa persona in altre aziende | Indipendenti dalla cessazione della singola azienda; non cancellarli con il suo archivio |
| Backup, file esportati e log | Tempi e accessi propri da verificare; la sola rimozione di una riga DB non elimina ogni copia |

Il perimetro dei ruoli privacy va validato: per i dati del personale trattati per conto dell'azienda, il contratto deve disciplinare restituzione/cancellazione al termine del servizio, secondo la scelta del titolare e gli obblighi applicabili. [EDPB, linee guida 07/2020, §1.3.7](https://www.edpb.europa.eu/system/files/2023-10/edpb_guidelines_202007_controllerprocessor_final_it.pdf).

**L'EDPB non stabilisce un termine universale di 12 mesi o di un'altra durata.** I paragrafi 139–142 delle linee guida citate prevedono scelta del titolare fra restituzione e cancellazione, istruzioni documentate, conferma della cancellazione entro il termine concordato ed eliminazione delle copie, salvo obblighi di legge. Il principio generale richiede di conservare i dati soltanto per il tempo necessario alla finalità: occorre quindi giustificare e documentare i tempi per ciascuna categoria. [EDPB, principio di limitazione della conservazione](https://www.edpb.europa.eu/sme/learn-the-basics/data-protection-basics_en).

La finestra gratuita di archivio va valutata come servizio limitato di consultazione/restituzione, con finalità, necessità, termini e istruzioni documentati. Inserire «12 mesi» nel contratto non dimostra da solo che ogni dato possa restare per dodici mesi. Una richiesta valida di cancellazione anticipata segue il percorso dedicato: non viene rinviata automaticamente al dodicesimo mese. Eventuali obblighi di conservazione riguardano dati individuati e accesso ristretto, non tutti i documenti del personale indiscriminatamente. I termini fiscali dei documenti propri di KlokShift vanno determinati separatamente con il commercialista; non derivano da questo riferimento EDPB.

Prevedere eliminazione verificabile e ripetibile di DB, Storage e copie applicative; registrare data e risultato senza conservare il contenuto eliminato nel log. Per i backup dichiarare la rotazione reale e impedire che un restore rimetta online dati già cancellati. L'attuale testo «entro 30 giorni» deve essere verificato sulla configurazione effettiva prima di mantenerlo come promessa.

## 6. Dashboard personale: cosa deve mostrare e permettere

È la **dashboard del fondatore della piattaforma**, distinta dalla dashboard che le aziende usano per i propri turni. Il titolare di una sede non è un amministratore di KlokShift.

Proposta tecnica iniziale: area `/amministrazione` nel progetto `web/`, con layout e data layer dedicati; evitare un secondo stack o una seconda installazione di React. Il percorso effettivo dovrà rispettare l'HashRouter attuale. Un dominio dedicato è facoltativo e non sostituisce l'autorizzazione server.

### Pagine e priorità

| Pagina | Prima versione | Evoluzione |
|---|---|---|
| Panoramica | Aziende totali, gratuite a vita/beta/prova/paganti/in pausa/cessate, account reali, sedi aperte, organico, incassi e costi del periodo, rinnovi vicini | Conversione, abbandoni, crescita, previsione ricavi |
| Aziende | Ricerca, stato, referente, piano, ciclo, sedi, persone conteggiate, attivazione, termine, prossimo rinnovo, provenienza commerciale | Filtri e segmentazione, andamento nel tempo |
| Scheda azienda | Dati e riferimenti, titolari/collaboratori, sedi aperte/chiuse, capacità/uso, contratto, periodi, concessioni, pagamenti, note commerciali e cronologia | Ultima attività affidabile, percorso di attivazione e storico KPI |
| Utenti | Account globale, date registrazione/conferma quando disponibili via backend, aziende collegate, authority per azienda, stato invitato/attivo/uscito; per ciascuna azienda sedi e organico, distinguendo quelle gestite da quelle dove la persona lavora | Ultimo accesso/uso con fonte dichiarata, ricerca e assistenza più avanzate |
| Incassi e contratti | Pagamenti provider, periodo coperto, importo/valuta, verificato/atteso, rimborsi, documenti e payout; sincronizzazione pronta prima delle vendite | Analisi e riconciliazione avanzate |
| Spese | Inserimento manuale, fornitore, categoria, data, importo/valuta, riferimento e ricorrenza | Import di report e previsione costi |
| Scadenze e attività | Prove/concessioni temporanee in scadenza, rinnovi/insoluti provider, pause, ripartenze richieste, termine export e cancellazioni; anomalie dello stop addebiti | Import e automazioni secondarie |
| Registro amministrativo | Chi ha attivato, prorogato, modificato capacità o rettificato un pagamento, quando e perché | Verifiche operative e riconciliazione assistita |

La prima scheda azienda deve rispondere subito a: **chi è il cliente, quante sedi ha, quante persone usa, cosa ha acquistato, fino a quando può lavorare, quanto ha pagato, cosa bisogna fare dopo.**

Azioni iniziali: concedere gratuità a vita o temporanea, estendere capacità gratuite, prorogare una prova con motivo, consultare/sincronizzare pagamenti, inserire spese e note. Eventuali variazioni paganti e rimborsi passano dal provider con l'appropriata conferma; un comando amministrativo non deve creare un addebito implicito. Mostrare effetto e decorrenza, registrare l'azione in modo atomico. Le concessioni permanenti non hanno un normale pulsante di scadenza a fine beta. Rettificare movimenti con una voce collegata, senza riscrivere silenziosamente lo storico economico.

Non aggiungere alla prima versione un impersonatore dei clienti o una lettura generale di chat, documenti sanitari e note HR. «Tutto sotto occhio» significa controllo commerciale e operativo della piattaforma. Eventuali dati individuali per assistenza richiedono uno scopo preciso e un percorso registrato, non accesso indiscriminato.

### Numeri con un significato preciso

| Indicatore | Definizione da implementare |
|---|---|
| Account registrati | Account Auth effettivi; separare confermati, non confermati, eliminati e account test. `profiles` conserva righe anonimizzate: il suo conteggio grezzo non basta |
| Aziende clienti | `workspaces` commerciali non eliminati; distinguere gratuite a vita, beta temporanee, prova, paganti, pause stagionali, cessate in archivio, interne/test; storico commerciale separato dopo cancellazione operativa |
| Organico per azienda | Conteggio del §4; distinto da utenti registrati, gestori e appartenenze per sede |
| Sedi | Aperte e chiuse separate; capacità acquistata separata dall'uso effettivo |
| MRR contrattuale | Valore ricorrente mensile dei contratti paganti validi, inclusi extra e sconti: mensile pieno oppure annuale / 12. Escludere gratuite a vita, beta, prove e una tantum; mostrare insoluti a parte |
| Vendite del periodo | Corrispettivi commerciali del periodo con imposte, sconti e rimborsi separati; per MoR indicare che sono vendite al cliente finale del provider |
| Incassi clienti verificati | Pagamenti riusciti/bonifici verificati, separati da preventivi, fatture attese e promesse di pagamento |
| Payout MoR | Trasferimenti del provider, attesi o arrivati, separati dai pagamenti dei clienti |
| Costi | Movimenti di costo verificati, con categorie e criteri di attribuzione; ratei annuali separati dalle uscite di cassa |
| Saldo di cassa del progetto | Entrate effettivamente ricevute meno uscite effettive attribuite al progetto, nel periodo |
| Margine operativo stimato | Ricavi di competenza secondo il criterio gestionale scelto meno costi attribuiti; indicare esplicitamente che precede imposte personali, contributi e remunerazione del tuo lavoro |
| Conversione e abbandono | Definire coorte, denominatore e date; distinguere pausa stagionale, fine prova senza acquisto e uscita definitiva, con numeri assoluti. Il MRR di un contratto effettivamente in pausa è zero, anche se non è abbandono definitivo |
| Ultima attività | Data di un evento realmente raccolto; login, creazione turno e timbratura sono misure differenti. Se non raccolta, mostrare «Non disponibile» |

Un contratto annuale da 290 € ha MRR gestionale di circa 24,17 €, pur generando un incasso anticipato di 290 €. Non contare prima la vendita MoR e poi il suo payout come due incassi del progetto. Non sottrarre due volte commissioni già trattenute dal payout. Conservare precisione nel calcolo e arrotondare soltanto in visualizzazione.

Esempi di scenario, non previsione: 50 aziende tutte mensili Base = 1.450 € di MRR; 100 = 2.900 €. Sono valori prima di sconti, commissioni, costi e tributi, senza sedi extra. Clienti annuali riducono il valore mensile equivalente. La sostenibilità dipende anche dal tempo di supporto: registrarlo almeno per i primi clienti prima di concludere che 29 € bastino.

Costi iniziali da registrare: Supabase, Expo/EAS, email, monitoraggio, dominio, account store, eventuale fatturazione/gestionale, commissioni e consulenza attribuita al progetto. I servizi condivisi con la tua attività professionale richiedono una quota dichiarata; non attribuire automaticamente tutte le tue spese a KlokShift.

### Date e dati storici

Raccogliere registrazione, prima sede, prima attivazione, inizio/fine beta o prova, primo pagamento, periodi coperti, rinnovo, richiesta/decorrenza pausa o disdetta, conferma stop provider, riattivazione, scadenza consultazione, cancellazione prevista/eseguita e origine del cliente. Non inventare la «prima attivazione» storica a partire da `created_at` senza indicarne la natura di stima.

I dati correnti non consentono di ricostruire perfettamente l'organico di ogni mese passato. Per grafici futuri, introdurre snapshot giornalieri semplici di aziende/sedi/organico/stati o eventi mirati. Dichiarare da quale data il monitoraggio è affidabile; non partire con un sistema completo di analytics o tracciamento di ogni interazione.

## 7. Modello tecnico progressivo

Nomi e collocazione delle tabelle seguenti sono **proposti**, non schema già definito. Il primo passo deve validare le regole e mantenere un numero ridotto di entità. Le informazioni economiche complete restano in `private` o in tabelle senza grant ai client; RPC ristrette restituiscono soltanto i dati autorizzati.

### Fondazione per gratuità e abbonamenti automatici

| Entità proposta | Dati essenziali |
|---|---|
| Contratto aziendale corrente | `workspace_id`, codice/versione piano, ciclo, quantità sedi extra, capacità, importi in centesimi, valuta, decorrenza, stato contratto, disdetta programmata, cliente/abbonamento/voci provider; nessun rinnovo pagante fittizio per le aziende gratuite |
| Periodi/concessioni di accesso | Azienda, eventuale contratto, inizio/fine, motivo `beta/trial/paid/complimentary_lifetime`, capacità, riferimento pagamento se pagato, concessore e motivo se gratuito; fine nulla ammessa soltanto per la concessione permanente esplicita |
| Movimenti di pagamento | ID, azienda/contratto, data, importo/valuta, canale, stato, riferimento univoco, documento esterno, eventuale movimento rettificato/rimborsato |
| Spese del progetto | Data, fornitore, categoria, importo/valuta, quota KlokShift, pagamento e riferimento documento; eventuale periodo di competenza |
| Amministratori della piattaforma | Allowlist server di account autorizzati, stato e revoca; inizialmente soltanto il tuo account |
| Registro amministrativo | Attore, azienda/movimento, azione, prima/dopo selettivi, timestamp e motivo; senza segreti o copie di dati HR |
| Ciclo commerciale e archivio | Azienda, stato operativo/pausa/uscita, richiesta/decorrenza, ultimo accesso operativo valido, `archive_until`, cancellazione prevista/eseguita e policy applicata; separati da credenziali e `workspaces.deleted_at` |

Il piano può inizialmente essere un piccolo catalogo versionato lato server, con due pacchetti e due cicli: non serve un editor generale dei prezzi. Snapshot di prezzi e capacità nel contratto/periodo impediscono che una futura modifica del catalogo riscriva il passato. Il listino pubblico nel sito e il catalogo dovranno essere allineati nella stessa modifica.

Profilo fiscale e contatti di fatturazione dell'azienda, eventuali note commerciali e provenienza vanno separati dai dati del professionista. Valutare se bastano campi privati della scheda cliente prima di aggiungere altre tabelle.

Vincoli necessari: un solo contratto corrente per azienda, periodi coerenti e non ambigui, pagamento idempotente, capacità non negativa, valuta obbligatoria, importi senza floating point, nessun periodo pagato generato da una promessa di incasso. Eventuali importi sconosciuti non diventano zero.

L'accesso gratuito può esistere senza un contratto pagante. Una concessione a vita impedisce di creare un checkout/nuovo rinnovo per la capacità già gratuita. Se un'azienda pagante riceve successivamente gratuità, pianificare la cessazione dei rinnovi nel provider, l'eventuale rimborso e la decorrenza: cambiare un flag nel DB non interrompe gli addebiti. Stabilire una precedenza unica fra concessioni e periodi pagati; non sommare capacità accidentalmente. L'azienda chiusa o un blocco amministrativo legittimo non diventa operativa soltanto perché conserva una concessione.

Una RPC, nome proposto `get_workspace_access`, restituisce accesso operativo, validità, capacità/uso e azioni consentite. I membri ricevono soltanto lo stato necessario; prezzo, dati fiscali e gestione del contratto sono riservati al titolare. Una risposta commerciale deve comunque rispettare permessi e ambito del chiamante. Non mettere questi dettagli nel `get_my_context()` visibile indistintamente a tutti.

Un helper `private.*` calcola il diritto corrente dagli intervalli, usando l'orologio del server. Il diritto deve scadere anche senza un cron puntuale. Le operazioni che aggiungono capacità bloccano la stessa riga azienda/contratto prima di verificare e scrivere, così due richieste concorrenti non superano il limite. Anche downgrade e cambi contratto devono usare lo stesso ordine di lock.

Separare diritto di scrivere, diritto di leggere l'archivio e istruzioni di cancellazione. Non impostare `deleted_at` né scollegare il titolare per una pausa/uscita che mantiene consultazione: oggi il contesto e l'oracolo escludono le aziende eliminate. Lo scope dello storico deve comprendere le sedi pertinenti già chiuse, indipendentemente da `venuesKey` operativo. Adattare il selettore ore oggi limitato agli ultimi dodici mesi e le policy documenti/Storage che condividono lettura/scrittura.

La cancellazione differita richiede un job idempotente con ultimo controllo di riattivazione e motivo, lock per evitare la gara con una ripresa del servizio e risultati visibili in dashboard. Considerare anche webhook in ritardo, istruzioni di cancellazione anticipata, riferimenti condivisi, dati ancora validi in altre aziende e file di proprietà dell'account: non applicare un cascade indiscriminato. Un evento vecchio non ricrea dati o periodi già cessati/eliminati.

Client: nuovo dominio, ad esempio `src/features/billing/`, con `api.ts`, tipi, hook e chiavi `qk`; funzioni pure condivise per presentazione e messaggi. I controlli SQL restano autorevoli. Aggiornamento di accesso/capacità deve invalidare lo stato su app e dashboard dopo mutation, refresh/reconnect e scadenza; evitare un nuovo realtime globale.

### Provider nella V1 pagante

Prima del lancio pagante completare: ID cliente/abbonamento/voci provider, registro eventi webhook con chiave unica, movimenti/saldi provider e payout riconciliabili. Un provider iniziale, un insieme di mapping documentato; nessun framework multi-provider. Se si aggiunge il riscatto codici, una piccola entità dedicata conserva hash, destinatario, scadenza del riscatto e utilizzo; il diritto gratuito resta nella concessione comune.

Percorso necessario:

1. Il titolare autenticato richiede il checkout **sul web** per la propria azienda.
2. Il backend verifica ownership, stato e catalogo; crea il checkout con identificativo dell'azienda stabilito dal server.
3. Il provider raccoglie pagamento e dati B2B necessari.
4. Una Edge Function riceve il webhook, verifica firma sul body originale e registra l'evento.
5. Una transazione idempotente sincronizza contratto, pagamento, periodo e capacità.
6. App e dashboard rileggono il diritto dell'azienda; il redirect di successo non concede accesso.

Prevedere eventi duplicati, tardivi e fuori ordine, fallimento del processo, cancellazione a fine periodo, pagamento fallito, rimborso e contestazione. Un ID già ricevuto deve poter essere riprocessato se l'elaborazione non è riuscita. Versione/timestamp e riconciliazione con il provider impediscono a un evento vecchio di ripristinare un piano superato. Non loggare carte, token o payload fiscali integrali.

Il portale del provider deve consentire soltanto cambi commerciali compatibili con le capacità in uso, oppure essere configurato per pagamento/disdetta e rimandare i cambi piano al nostro flusso controllato. Non presumere che un portale ospitato conosca il numero di sedi aperte e persone di KlokShift.

Se in futuro si supportano pagamenti eccezionali fuori dal provider, il passaggio al rinnovo automatico non deve addebitare nuovamente il periodo già pagato e richiede consenso/metodo di pagamento. Al trasferimento della titolarità, piano e concessione rimangono aziendali secondo le condizioni definite, mentre referenti e accessi commerciali vanno aggiornati.

Se viene eliminato l'ultimo titolare e l'azienda si chiude, serve una richiesta di cancellazione del rinnovo provider con retry e segnalazione in dashboard. La RPC di chiusura non può da sola fare una chiamata di rete atomica. Eliminare l'account di un dipendente non deve cancellare il contratto aziendale.

### Accesso alla dashboard del fondatore

- Allowlist amministrativa server, distinta da `workspace_members.authority`; bootstrap del tuo account fuori dal client.
- MFA richiesta per accesso amministrativo, verificata nel backend con sessione/JWT valido e livello `aal2`; revoca controllata su ogni richiesta. [Supabase: MFA](https://supabase.com/docs/guides/auth/auth-mfa).
- Il browser usa la chiave pubblica e la tua sessione; mai service-role key nel bundle. Le Edge Function verificano attore e autorizzazione prima di usare credenziali server.
- Endpoint e RPC espliciti per riepiloghi, ricerca paginata e azioni consentite; nessun endpoint SQL arbitrario, proxy generico o elevazione ottenuta da `user_metadata`.
- Preservare l'isolamento dei clienti: nessuna policy generale che dia ai titolari accesso alle altre aziende. Dati commerciali e spese personali non devono essere leggibili dai clienti.
- Ogni mutazione amministrativa produce una traccia; prezzi/date/limiti sono validati nel server. Nascondere il menu è solo presentazione.

## 8. Piano di lavoro, in ordine

Stati: `PROPOSTO`, `PRONTO` dopo chiusura delle decisioni necessarie, `IN CORSO`, `DONE` con evidenze. Una fase conclusa non significa che il provider sia integrato.

| ID | Blocco e risultato | Dipendenze | Stato |
|---|---|---|---|
| M01 | Definire regole, conteggi e dettagli di lancio | Discussione con Alisher | IN CORSO: otto regole approvate; dettagli residui aperti |
| M02 | Definire procedura fiscale e condizioni commerciali del canale iniziale | M01, commercialista | PROPOSTO |
| M03 | Implementare accesso/capacità nel DB e concessioni gratuite a vita | Regole pertinenti M01 | IN CORSO: M03a/M03b verificati localmente; quote, classificazione reale e rollout pendenti |
| M04 | Rendere coerenti app, dashboard cliente e sito; eliminare Free/Pro obsoleto | M03 | IN CORSO: collegamento minimo e rimozione gate; flussi commerciali/sito pendenti |
| M05 | Dashboard personale: accesso protetto, panorama, aziende e schede | M03; riuso stack web | RILASCIATO; primo accesso MFA/panoramica verificato; restanti prove manuali pendenti |
| M06 | Concessioni a vita, eventuali codici, gestione economica e spese personali | M05; M09 per dati provider | IN CORSO: M06a concessioni/classificazioni/audit locale; economia e altri interventi pendenti |
| M07 | Aziende test gratuite e validazione; primi paganti dopo pagamenti e ciclo archivio | M04–M06 per beta; M02/M09/M11 per vendite | PROPOSTO |
| M08 | Verifica account/contratto e prova sandbox Paddle, avviate presto | M01–M02 per chiusura; indagine indipendente avviabile prima | PROPOSTO: scelta Paddle confermata; verifiche da eseguire |
| M09 | Checkout web, webhook, rinnovi e riconciliazione prima dei primi paganti | M08, M03, M04, dashboard M05 | PROPOSTO |
| M10 | KPI storici, anomalie, previsione e automazioni mirate | Dati raccolti da M05–M09 | PROPOSTO |
| M11 | Primo mese, pausa stagionale, uscita, archivio/export e cancellazione verificata | Regole M01, modello M03, UI M04/M05, provider M09 | PROPOSTO; parte della V1 |

Ordine di avvio: **M01 + indagine M02/M08 → M03 → M05 → concessioni M06 → M04 → M09 + completamento M11 → completamento economico M06 → lancio pagante M07 → M10**. I tester gratuiti possono iniziare prima del completamento pagamenti; M09/M11 rimangono necessari per i primi clienti paganti. Nessuna dipendenza circolare: M06 consegna prima le concessioni, poi collega i dati prodotti da M09; le regole e la fondazione di M11 entrano già in M01/M03.

### M01 — Decisioni commerciali

- [x] Recepire la richiesta di pagamenti automatici già pronti per il lancio pagante.
- [x] Mantenere importi 29/49/15 e annuale 290/490/150.
- [x] Prevedere gratuità a vita per le aziende scelte dal fondatore.
- [x] Dashboard personale essenziale prima dei clienti paganti.
- [x] Limite 30 sull'intera azienda, persone uniche anche su più sedi.
- [ ] Chiudere dettagli della tabella di conteggio: inviti, gestori in organico, sedi chiuse e ripristini.
- [ ] Scegliere nomi dei piani senza recuperare involontariamente il freemium.
- [x] Piano e numero di sedi gratuite decisi dal fondatore per ogni azienda.
- [ ] Definire condizioni della concessione a vita; decidere se servono subito anche codici o basta l'assegnazione dalla dashboard.
- [ ] Distinguere fase beta, gratuità a vita e prova pubblica di 30 giorni; chiudere il collegamento dell'attivazione al flusso cliente.
- [x] Capacità della prova: Team con una sede inclusa, confermata dal fondatore.
- [x] Primo mese gratuito = 30 giorni senza carta per tutte le nuove aziende; proroghe selettive del fondatore, senza duplicare la prova.
- [x] Pausa a fine periodo pagato, annuale senza congelamento e ripartenza esplicita senza nuova prova.
- [x] Archivio gratuito per 12 mesi da fine operatività, dopo pausa o uscita senza cancellazione anticipata; avviso e cancellazione operativa al termine.
- [ ] Chiudere dettagli di uscita, avvisi, export, riattivazione, istruzioni del cliente e cancellazione anticipata.
- [x] Tolleranza di 7 giorni ai rinnovi insoluti e finestra separata di 7 giorni per rettifiche pregresse; preservare archivio e revoca accessi.
- [ ] Chiudere limite clock-out, conferme/chat dopo scadenza e matrice privacy per categorie/backup.
- [x] Upgrade espliciti con proporzione al residuo; downgrade al rinnovo compatibile, senza cancellare organico o storico.
- [ ] Chiudere mapping provider per sedi stagionali e cambio ciclo mensile/annuale.
- [x] Prezzo del periodo acquistato protetto, listino accettato alla ripartenza e preavviso di 60 giorni per aumenti ai rinnovi.
- [x] Regole di rimborso/cortesia annuale entro 14 giorni senza nuova attività, credito per disservizio grave e gestione tracciata delle contestazioni.
- [x] Supporto in italiano, prima risposta come obiettivo entro 2 giorni lavorativi e call iniziale di 30 minuti su richiesta.
- [x] Limite di 10 MiB/file e quota iniziale di 2 GiB per azienda, uguale nei piani; quota blocca solo nuovi upload.
- [ ] Calibrare la quota complessiva sui tester prima di pubblicarla; definire aumento concordato e misure di uso/traffico.
- [x] Recupero assistito del controllo aziendale con verifica identità/autorità e traccia dell'intervento.
- [ ] Definire i passaggi operativi e le prove minime del recupero prima del lancio.
- [ ] Scegliere nicchia e numero dei primi tester; confermare obiettivo temporale del rilascio.

**Uscita:** tabella delle decisioni aggiornata, con esempi cliente che non lasciano dubbi sul prezzo e sull'accesso.

### M02 — Procedura fiscale e commerciale

- [x] Registrare l'intenzione di partire con la partita IVA già attiva in forfettario e la licenza/accesso alla piattaforma tramite Paddle; codice ATECO non ancora disponibile.
- [ ] Recuperare il codice ATECO registrato e verificare col commercialista la compatibilità dell'attività e gli eventuali aggiornamenti necessari prima dei primi incassi, senza attendere la crescita clienti.
- [ ] Preparare per il commercialista contratto Paddle ed esempi mensile, annuale e più sedi, con vendita, commissioni, rimborso, payout e reverse invoice; controparti ricavate dai documenti effettivi.
- [ ] Definire soggetto venditore, dati B2B, documenti, IVA/natura, eventuale bollo, estero e commissioni; non assumere che l'importo netto ricevuto sia il fatturato.
- [ ] Stabilire documenti provider, trattamento payout, rinnovi e rimborsi del canale scelto; eventuali eccezioni dirette sono separate.
- [ ] Aggiornare condizioni del servizio, informativa privacy, ruoli rispetto ai dati del personale e termini di conservazione in base al flusso effettivo.
- [ ] Definire servizio limitato di archivio/restituzione, istruzioni del cliente e matrice di conservazione per dati operativi, commerciali, fiscali e backup; verificare le promesse già pubblicate.
- [ ] Confermare recapiti e dati legali oggi indicati come pendenti in `web-site/README.md`.
- [ ] Validare il servizio di archivio e la matrice di conservazione sul trattamento effettivo: i 12 mesi sono la scelta commerciale, non un termine stabilito dall'EDPB.

**Uscita:** una procedura applicabile al primo cliente pagante e testi coerenti con il canale scelto. Il software può avanzare sui blocchi indipendenti senza inventare una risposta fiscale.

### M03 — Fondazione DB e migrazione

**Primo blocco M03a — DONE in locale:** introdotto il modello server e il data layer in modo additivo. Le aziende già presenti vengono segnalate per revisione, senza attribuire pagamenti o gratuità permanente e senza far partire prove retroattive. Il vecchio `plan` rimane soltanto per compatibilità fino a M04; nessuna RPC operativa o policy Storage viene ancora bloccata dal nuovo modello. Il read model commerciale non è quindi un enforcement già attivo.

- [x] M03a: tabelle protette per stato commerciale e periodi/concessioni, senza scritture dirette del cliente.
- [x] M03a: RPC autorizzata di lettura dello stato, date, capacità e utilizzo dell'azienda; aggregati visibili ai gestori, non ai dipendenti.
- [x] M03a: attivazione esplicita della prova una sola volta, solo titolare e con sede pronta, Team/una sede/30 giorni.
- [x] M03a: concessioni permanenti/temporanee e transizione riservate al servizio; nessun periodo pagante fittizio.
- [x] M03a: derivazione di fine operatività, archivio di 12 mesi e finestra distinta di rettifica; nessun reset per lettura.
- [x] M03a: API/hook condivisi app/web, risposta mancante o invalida senza fallback operativo; invalidazione/reset dopo cambi di organico, sedi, authority e rientro realtime.
- [x] M03a: verifiche SQL/client, isolamento e privilegi; tipi DB rigenerati dal banco locale.

Evidenze del 2026-10-05: migration locale applicata con `run.sh reset`, suite
SQL completa e `concurrency/040_workspace_trial.sql` superate, tipi rigenerati
con `gen-types.sh`. `yarn test:unit`: **35 file / 242 test superati**;
`yarn typecheck` e `yarn web:typecheck` superati; `yarn lint` senza errori,
con il warning già presente in `web/src/shifts/ShiftPanel.tsx` sul metodo
`watch` di React Hook Form. `git diff --check` superato. L'avvio concorrente
restituisce lo stesso periodo prova; trasferimento del titolare e retry dopo
scadenza non ripartono da zero. Nessun deploy, migrazione remota o addebito.

**Secondo blocco M03b — DONE in locale:** nuove migration forward-only
`20261005000200`–`20261005000500`. Guard RPC e scritture dirette, upload Storage,
capacità persone/sedi serializzata sul lock aziendale, rettifiche per record e
letture/report fino a fine archivio. Le aziende `migration_pending` conservano
esplicitamente le operazioni precedenti senza inventare piano/date/periodi;
il dato commerciale mancante è invece un errore. Nuove aziende: setup prima
sede e pulsante di avvio prova esplicito, nessuna prova retroattiva.

Il collegamento minimo necessario alla verifica dev monta il read model su
app/dashboard, mostra stati/date/capacità, rimuove gate Pro e override obsoleti,
usa tutti gli id autorizzati (sedi chiuse comprese) per lo storico e permette
mesi arbitrari nell'export web. Non completa M04 commerciale e non anticipa
M05/M06: M05 aggiunge la consultazione amministrativa; il blocco
concessioni/audit M06a è implementato localmente su istruzione del fondatore;
le verifiche manuali restanti di M05 rimangono aperte e sono incluse nel test M06a.

Il refresh usa l'istante server e il prossimo inizio di concessione; focus,
reconnect e primo piano nativo rileggono lo stato. Nessun polling permanente
né realtime commerciale globale. Cambi del servizio su un client sempre
visibile richiedono refresh: il controllo server sulle scritture è immediato.
Clock-out pregresso prima di fine turno + 24 ore e entro sette giorni;
conferme/richieste operative nuove negate in archivio, testo chat conservato,
revoche/riduzioni e uscite disponibili. Conteggio: regola M03a mantenuta, non
una dichiarazione di approvazione dei dettagli M01 ancora aperti.

Procedura manuale completa: [TEST-MONETIZATION-M03B.md](../docs/TEST-MONETIZATION-M03B.md).
SQL/RLS, concorrenza, test client/typecheck, lint, build web ed export iOS
verificati nel banco locale (evidenze finali nel registro). Smoke visuale su
backend dev isolato ancora da eseguire, con passaggi nella procedura.

- [x] Inventariare e collegare RPC, scritture dirette e Storage che modificano operatività o capacità: matrice seguente, con residui distinti.
- [x] Periodi/concessioni e helper di accesso protetti dal client; gratuità permanente e assenza di contratto pagante esplicite (M03a/M03b).
- [ ] Contratto pagante e stati finanziari verificati: da collegare al provider in M09.
- [x] Conteggio univoco e lock condiviso per aggiunte/riaperture e concessioni; il futuro flusso contratti deve usare lo stesso lock.
- [ ] Applicare nel backend la quota iniziale documenti aziendale (2 GiB, da calibrare sui tester), misurando i file reali e gestendo upload concorrenti/orfani.
- [ ] Proteggere la capacità futura dei downgrade programmati, quando il modello contratti/provider sarà disponibile.
- [ ] Prevedere stati distinti per pausa/uscita/archivio e data di termine consultazione, senza usare cancellazione account o `deleted_at` come blocco commerciale.
- [x] Nuove aziende in setup, una sola prima sede; avvio esplicito della prova dal client, server idempotente.
- [ ] Migrare le aziende esistenti con un elenco esplicito di gratuite a vita autorizzate, prove/beta temporanee, interne/test e reali: non trasformare automaticamente tutti i `pro` in paganti, permanenti o scaduti.
- [ ] Introdurre una finestra di transizione con date dichiarate, verificare backfill e controlli prima di attivare i blocchi commerciali.
- [x] Rigenerare `src/types/database.ts`, aggiungere errori a `src/lib/errors.ts` e stato di accesso nel data layer.

**Uscita:** anche chiamando direttamente le API un cliente non modifica il proprio piano né supera i limiti; il setup e le aziende migrate hanno un percorso verificato.

#### Superficie verificata nell'enforcement M03b

Inventario iniziale del 2026-10-05. M03b collega accesso/capacità e conserva lettura/export e revoche. Quote aziendali, downgrade futuri, provider e restituzione completa/cancellazione restano nelle fasi pertinenti.

| Superficie | Controllo implementato e residui |
|---|---|
| `create_workspace`, `create_venue`, `set_venue_closed` | Setup della prima sede distinto da operatività; capacità aziendale per nuove sedi/riaperture e persone che tornano a contare; chiusura senza cancellazione o stop implicito degli extra |
| `add_member`, `set_member_venue`, `respond_to_invite`, aggancio inviti e merge delle schede | Lock comune per azienda; aggiunte/ripristini eccedenti rifiutati, accettazione di un posto già conteggiato senza doppio conteggio; merge migliorativo consentito |
| `create_shifts`, `update_shift`, `move_assignment`, `assign`, `reassign` e altre mutazioni di assegnazione | Operatività richiesta per nuovo lavoro; non rendere genericamente scrivibile il passato durante la finestra di rettifica |
| `clock_punch`, `record_attendance`, `correct_clock_record`, `void_clock_record`, `approve_clock_record` | Distinguere nuove timbrature da chiusura/approvazione/rettifica pregressa, con record e termini verificati dal server |
| RPC assenze e cambi turno; `messages.INSERT` | Nuove richieste/conferme operative negate; testo chat disponibile durante l'archivio. Percorso assistito e richieste sui diritti restano M11 |
| Scritture dirette `venue_roles`, `venues`, `workspaces.staff_can_chat`, `staff_documents` | Le RPC non coprono tutte le scritture: aggiornare anche policy/trigger, conservando revoca accessi, sicurezza e cancellazioni autorizzate |
| Storage `staff documents: insert/delete`, avatar e loghi | Upload documenti operativi bloccati; download nei permessi fino a fine archivio, cancellazione autorizzata conservata. Quota aziendale ancora da implementare; avatar e loghi globali restano distinti |
| `transfer_ownership`, `remove_member`, `leave`, `delete_account` | Recupero/revoca e uscita restano praticabili; eliminazione dell'ultimo titolare o dell'azienda deve coordinarsi con contratti, export e cancellazione |
| Report ore, storico turni, sedi chiuse, documenti | Conservare le letture nei permessi del membro e recuperare tutto lo storico autorizzato; non usare un generico gate Pro/operatività per l'archivio |

### M04 — Ripulire l'esperienza del cliente

- [x] Rimuovere `useProGate` dalle ore e i lucchetti obsoleti, mantenendo tutti i permessi del membro.
- [x] Sostituire `PlanCard`, upsell, route `pro`, toggle dev e relativi chiamanti come da inventario.
- [x] Adattare gate sedi e conteggi senza usare soltanto le sedi visibili al collaboratore.
- [x] Mostrare stato/validità e comportamento a scadenza; le funzioni consultabili rimangono accessibili.
- [ ] Implementare la gestione commerciale del titolare sul web; nell'app messaggi neutri e nessun prezzo/checkout.
- [ ] Aggiornare `it.ts`, JSON-LD/meta di `index.html`, FAQ, CTA e documentazione. Il lancio pagante avrà un percorso web funzionante di prova/acquisto; eventuale beta anticipata ha una CTA reale di richiesta attivazione. Gratuità a vita per clienti selezionati non va presentata come freemium pubblico.
- [x] Aggiornare `AGENTS.md`, `web-site/README.md`, `supabase/README.md` e i commenti dei gate rimossi con lo stato M03b; ulteriori aggiornamenti seguiranno i flussi commerciali.

**Uscita:** cliente e sito descrivono lo stesso servizio; nessuna funzione essenziale dipende da un tier Free/Pro inventato. Approvare il flusso store sul prodotto concreto.

### M05 — Dashboard personale di consultazione

- [x] Implementare allowlist, MFA e controllo server prima delle query globali.
- [x] Aggiungere layout amministrativo separato e data layer con query key dedicate.
- [x] Creare panorama, ricerca aziende paginata, scheda azienda e elenco/dettaglio account.
- [x] Separare account, persone, gestori, appartenenze e sedi; distinguere aziende interne/test tramite classificazione esplicita, senza dedurla dalla gratuità.
- [x] Mostrare date disponibili e capacità/uso, con stati vuoto/caricamento/errore e fonti dei numeri.
- [x] Rendere visibili anomalie disponibili e uso misurato dei documenti; costo non disponibile esplicito, nessuna ripartizione inventata.
- [x] Test SQL: titolare cliente con MFA, collaboratore, professionista e anon non leggono riepiloghi globali; revoca/sessione/fattore/account verificati.
- [x] Rilascio del commit `f6ff685` e provisioning deliberato del fondatore, eseguiti dall'utente/CI.
- [x] Primo accesso Auth/MFA reale e panoramica caricata sul progetto attuale di sole aziende/account propri di test.
- [ ] Verifiche manuali restanti: dettagli/filtri, enrollment/codice errato, logout/nuovo challenge, diniego multiutente e revoca live.

**Evidenze locali del 2026-10-06:** nuova migration forward-only
`20261006000100_platform_admin_reads.sql`, allowlist inizialmente vuota,
nessun ampliamento RLS cliente. Cinque RPC globali e una lettura del solo
stato amministrativo del chiamante. Account Auth distinti da schede/profili,
ricerca/paginazione server, classificazioni private motivate, periodi/date
autorevoli, misure `storage.objects.metadata.size` con sconosciuti/non
attribuiti; nessun file/chat/HR aperto. `migration_pending` rimane visibile
senza concessioni inventate; consultazione senza reset archivio.

14 file SQL/RLS e 5 concorrenti passati; 38 file / **272 test client**;
tipi DB rigenerati dal banco, typecheck app/web/sito, lint senza errori
(warning React Hook Form preesistente), build web ed export iOS superati.
Il build web segnala la dimensione del bundle. La suite SQL simula le fonti
Auth necessarie: non attesta enrollment/challenge TOTP HTTP reale.
Procedura con ambiente/passaggi/esiti: [TEST-FOUNDER-M05.md](../docs/TEST-FOUNDER-M05.md).
M06a aggiunge localmente concessioni e audit (§M06); economia e altri
interventi M06 restano aperti, M09 serve per Paddle.
Durante l'implementazione locale Codex non ha eseguito provisioning reale,
migrazioni remote, commit/push o deploy. Successivamente l'utente ha rilasciato
M05 tramite CI e abilitato esplicitamente il proprio account.

**Prima evidenza manuale del 2026-10-06:** schermata dell'utente con secondo
fattore verificato e lettura server alle 09:16 Europe/Rome. Visibili 2 aziende,
4 account Auth confermati, 2 sedi aperte, Storage 0,03 MiB; economia/costi
non disponibili. Bar Teatro e Da Buffa sono proprie aziende di test create
prima della monetizzazione, entrambe `migration_pending` e non classificate.
Questa origine spiega lo stato senza assegnare diritti o avviare prove;
la classificazione amministrativa resta distinta dai diritti commerciali.
Evidenza limitata al primo accesso e alla panoramica, non alle prove manuali
restanti elencate nella [procedura M05](../docs/TEST-FOUNDER-M05.md).

**Uscita:** puoi vedere ogni cliente e capire piano, uso e scadenza senza aprire il pannello DB.

### M06 — Concessioni del fondatore ed economia

**M06a, 2026-10-06:** implementata la prima parte nel banco locale.
Nuova migration `20261006000200_founder_concessions.sql`: nessuna azienda
preesistente viene convertita implicitamente. La scheda permette concessione
gratuita a vita immediata e variazione compatibile di piano/sedi/quota dichiarata,
classificazione di aziende/account e note. Guard live/MFA prima di ogni RPC,
lock aziendale condiviso con le capacità, revisione senza l'orologio di lettura,
identificativo idempotente e audit atomico conservato dopo cancellazione del
destinatario. Nessuna revoca generica del beneficio permanente; periodi futuri
e dati commerciali mancanti richiedono verifica prima della concessione.

La quota documenti è registrata, con controllo dei byte noti e rifiuto di
dimensioni ignote; l'enforcement della quota upload rimane nel backlog M03.
M06 non è chiuso: economia/spese, proroghe e flussi assistiti restano da
realizzare, cifre provider dipendono da M09. Decorrenze future e codici di
riscatto non sono stati introdotti. Nessun provisioning, concessione reale,
migration remota, commit/push o deploy eseguiti da Codex in questo blocco.
Ambiente e procedura: [TEST-FOUNDER-M06A.md](../docs/TEST-FOUNDER-M06A.md).
Il fondatore conferma due mesi di uso solo personale: dev remoto separato
rimandato, da predisporre prima dell'ingresso di persone esterne.

- [x] M06a: gratuità a vita/variazione immediata, classificazioni e note dalla dashboard.
- [x] M06a: registro atomico per destinatario, motivo/attore/esito, retry e revisione concorrente.
- [x] M06a: 15 file SQL/RLS, 6 suite concorrenti e 39 file / 281 test client passano; tipi, typecheck, lint senza errori e build web verificati localmente.
- [ ] M06a: rilascio e prova visuale sul progetto attuale di soli test propri.

- [x] Aggiungere concessione gratuita a vita con capacità, assegnazione aziendale, motivo e cronologia; eventuali concessioni temporanee restano distinte.
- [ ] Aggiungere codici/link di riscatto soltanto se scelti: destinatario, hash, scadenza per riscatto, monouso atomico e nessuna scadenza del beneficio permanente.
- [ ] Collegare pagamenti/rimborsi provider con riferimento univoco, separati dalle somme attese; nessun addebito per la capacità gratuita concessa.
- [ ] Aggiungere spese, periodi di competenza, quota progetto e riferimenti esterni.
- [ ] Implementare incassi, MRR, cassa e costi con le definizioni del §6.
- [ ] Aggiungere scadenzario e registro amministrativo atomico; verificare rettifiche e doppio submit.
- [ ] Gestire trasferimento titolarità e chiusura azienda senza perdita del contratto o dei movimenti storici.
- [ ] Definire recupero assistito del controllo aziendale quando l'unico titolare perde accesso: verificare identità e autorità, registrare l'intervento e non usare il pagamento come prova sufficiente di titolarità.

**Uscita:** puoi assegnare e controllare una gratuità a vita dalla dashboard; al completamento M09 vedi anche pagamenti e scadenze reali, cifre riconciliate e spese del progetto.

### M07 — Tester gratuiti e lancio pagante

- [ ] Chiudere le verifiche operative pertinenti di `plans/AUDIT-2026-10-04.md`; non ripetere fix già conclusi.
- [ ] Reclutare 3–5 aziende adatte con una settimana reale da pianificare e un referente disponibile al feedback.
- [ ] Annotare onboarding, prima settimana pianificata, partecipazione del team, uso ore/export, problemi e tempo di supporto.
- [ ] Calibrare la quota documenti sui tester, predisporre il canale di assistenza e verificare un ripristino di DB e file prima di accettare clienti paganti.
- [ ] Selezionare quali aziende hanno diritto a gratuità a vita e registrare le condizioni; la fine della fase beta non rimuove il beneficio.
- [ ] Validare disponibilità a pagare anche con prospect senza concessione permanente; i tester gratuiti misurano usabilità e valore, non conversione pagante.
- [ ] Accettare i primi paganti soltanto dopo M02 e M09, usando il checkout web verificato; nessun pagamento/rinnovo implicito per i tester a vita.
- [ ] Rivedere prezzi e capacità con dati concreti prima di consolidare l'automazione.

**Uscita:** primi clienti paganti verificati e un processo sostenibile. Le azioni di contatto saranno svolte dal fondatore o soltanto su sua istruzione esplicita.

### M08–M09 — Automazione pagamenti

- [x] Scegliere Paddle come unico provider iniziale.
- [ ] Completare verifiche applicabili all'account/prodotto Paddle; verificare contratto, costo effettivo, dati fiscali e payout.
- [ ] Provare in sandbox due piani × due cicli + sedi extra, cambio quantità, proration, downgrade, insoluti e disdetta.
- [ ] Provare primo periodo gratuito senza duplicazioni, pausa a fine periodo e ripresa con prezzo/data mostrati; nessun rinnovo residuo degli extra durante la pausa.
- [ ] Provare insoluto con tolleranza senza reset e riallineamento con retry/fatture provider; testare prezzi con preavviso e promemoria annuali.
- [ ] Documentare catalogo e mapping Paddle per piani, cicli, sedi extra e stati commerciali.
- [ ] Implementare checkout server, webhook firmato, idempotenza e riconciliazione.
- [ ] Integrare pagamento, contratti, periodi e payout nella dashboard del fondatore, senza doppio conteggio.
- [ ] Configurare gestione cliente/portale e limiti ai cambi non compatibili.
- [ ] Impedire downgrade incompatibili con organico/sedi prima della modifica del contratto; ricontrollare alla decorrenza e applicare l'esito concordato senza cancellazioni o acquisti automatici.
- [ ] Provare doppio addebito, rimborso totale/parziale e contestazione; applicare la regola commerciale scelta senza eliminare automaticamente lo storico aziendale.
- [ ] Verificare aziende gratuite escluse dagli addebiti, passaggio pagante→gratuito senza rinnovi residui, pagamento fallito, rimborso, account cancellato e retry delle cancellazioni provider.
- [ ] Attivare il live dopo prove e configurazione controllata; non applicare migration o iniziare addebiti reali nell'esecuzione locale del piano.

**Uscita:** il diritto aziendale segue eventi verificati; un cliente può acquistare/rinnovare/disdire dal web e il fondatore riconcilia pagamenti e accrediti.

### M11 — Primo mese, pausa e archivio dopo uscita

- [ ] Implementare la regola approvata per il primo mese e le proroghe selettive; una sola prova iniziale per azienda idonea.
- [ ] Implementare richiesta/decorrenza di pausa stagionale e uscita commerciale sul web, sincronizzate col provider; gestire retry e stato di conferma.
- [ ] Implementare la regola annuale approvata: stop del rinnovo futuro, senza congelamenti o rimborsi impliciti.
- [ ] Conservare account e membri autorizzati per consultazione; separare cancellazione account, chiusura commerciale e cancellazione dei dati.
- [ ] Creare accesso all'archivio e selezione/export storico completi per i periodi conservati, sedi chiuse ed ex membri, rispettando permessi e categorie delle ore.
- [ ] Bloccare scritture operative/upload nel backend preservando lettura/download ed eccezioni finite di completamento; gestire cancellazioni richieste nel percorso dedicato.
- [ ] Conservare revoca accessi e azioni di sicurezza durante l'archivio; limitare le rettifiche ai turni già maturati, senza spostare fine operativa o scadenza archivio.
- [ ] Aggiungere scadenza consultazione, promemoria di servizio, riattivazione e annullamento della cancellazione pendente; nessun reset del termine per login/cambio etichetta.
- [ ] Implementare cancellazione idempotente di DB, Storage e copie applicative; preservare altre aziende/account e documentazione commerciale ancora dovuta.
- [ ] Verificare backup/restore e trattamento di copie già esportate; registrare soltanto esito e dati minimi del processo.
- [ ] Mostrare nella dashboard personale pause, cessazioni, termine export/cancellazione, ripartenze e anomalie dei rinnovi; adeguare privacy, FAQ e termini alle funzioni reali.

**Uscita:** un'azienda prova, paga, si ferma, consulta/esporta e riparte senza perdere dati o subire addebiti inattesi; un'uscita definitiva segue il termine dichiarato e la cancellazione lascia solo i dati giustificati dalla policy.

### M10 — Controllo completo dell'attività

- [ ] Aggiungere snapshot/eventi minimi per grafici e coorti; indicare l'inizio del monitoraggio.
- [ ] Definire clienti attivi, conversione, abbandoni, ricavo medio e costo di supporto.
- [ ] Aggiungere previsione rinnovi/costi e segnalazioni di errori webhook, scostamenti e dati amministrativi mancanti.
- [ ] Automatizzare import costi o promemoria solo quando sostituiscono un lavoro manuale frequente.

**Uscita:** la dashboard copre andamento, spese, vendite, cassa e clienti con dati verificabili, senza trasformarsi in un software fiscale o paghe.

## 9. Verifiche richieste durante l'implementazione

Verifiche inizialmente elencate nell'analisi documentale. Le voci spuntate
indicano prove locali M03a/M03b; le voci che dipendono da admin/provider,
rollout o smoke visuale restano aperte.

### Accesso e limiti

- [ ] Cliente, collaboratore, professionista e `anon` non possono elevare accesso commerciale o leggere dati amministrativi globali.
- [x] Un piano attivo non concede permessi di gestione a un membro che non li ha (suite RLS).
- [x] Persona con due aziende: scadenza in una, operatività conservata nell'altra (080).
- [x] Persona in due sedi conteggiata una volta; scheda senza account conteggiata; gestore senza organico escluso (070/080).
- [ ] 30→31 posti, inviti, ripristino, auto-inserimento, riapertura e merge verificati, anche con collaboratore ad ambito ristretto.
- [x] Aggiunte e gara riapertura/aggiunta all'ultimo posto disponibile non eccedono capacità persone/sedi (concurrency/050).
- [x] Scadenza server senza cron e nessun accesso concesso da dati mancanti; timer client calibrato sul server, incluso inizio futuro (080 e test client).
- [ ] Smoke visuale di refresh/reconnect/background su backend dev isolato (procedura M03b).
- [ ] Gratuità a vita valida oltre la fine della beta e dopo cambio listino; trasferimento titolarità conforme alle condizioni; nessuna estensione ad altre aziende dello stesso account.
- [ ] Eventuale codice: doppio riscatto, destinatario errato e riscatto scaduto rifiutati; beneficio permanente conservato dopo scadenza del codice.
- [x] Sola lettura su RPC, scritture dirette e Storage, con eccezioni clock per record limitate e conservazione della timbratura pregressa (080).
- [ ] Primo mese gratuito una volta sola: non raddoppia con coupon, cambio piano, extra, ripartenza o annuale.
- [ ] Pausa ferma tutti i rinnovi pertinenti alla data concordata; annuale mantiene durata originaria; nessuna ripresa a sorpresa.
- [x] Archivio accessibile senza cancellare account, anche con tutte le sedi chiuse; report di periodi più vecchi di 12 mesi disponibili se conservati (080). Export visuale da provare in dev.
- [ ] Scadenza archivio indipendente dall'ultimo login; riattivazione concorrente alla cancellazione non perde dati; nessun vecchio webhook riapre un'azienda eliminata.
- [ ] Cancellazione anticipata o programmata verificata su DB/Storage e copie applicative; altre aziende della persona e dati fiscali da conservare restano separati.

### Amministrazione ed economia

- [ ] Account non in allowlist, amministratore revocato e sessione senza MFA rifiutati dal server.
- [ ] Nessuna service-role key o segreto provider nei bundle web/native e nei log.
- [ ] Doppio submit/evento non duplica pagamento o periodo; una rettifica conserva la traccia originale.
- [ ] Annuale da 290 €: incasso 290, MRR 290/12; gratuite a vita, beta e prova non contano come paganti.
- [ ] Concessione a vita: nessun checkout/nuovo rinnovo per capacità già concessa; se assegnata a un pagante, cancellazione degli addebiti futuri confermata nel provider.
- [ ] Rimborso, commissioni, payout e spese non sono conteggiati due volte; importi ignoti dichiarati.
- [ ] Fine mese, 29 febbraio e cambio DST: date di scadenza e periodi mostrati correttamente.
- [ ] Cancellazione ultimo titolare, trasferimento di titolarità e migrazione al provider non lasciano addebiti futuri inattesi.

Usare suite SQL/RLS e test di comportamento per limiti/accesso/movimenti; test di concorrenza per lock; smoke con più attori su app e dashboard. Poi eseguire i controlli pertinenti già presenti: `yarn test:unit`, `yarn typecheck`, `yarn web:typecheck`, `yarn site:typecheck`, `CI=1 yarn lint`, build web/sito ed export native quando i cambi lo richiedono. Per DB: banco locale dedicato, replay delle migration, test e rigenerazione tipi secondo `supabase/README.md`; per Edge: controlli Deno della CI. Nessun test meramente basato sulla presenza di stringhe nel sorgente.

## 10. Decisioni approvate e dettagli ancora aperti

Alisher ha approvato le raccomandazioni sugli otto punti e chiesto di consolidarle nella documentazione dedicata. La tabella distingue decisioni di prodotto e verifiche ancora necessarie: [MONETIZATION.md](../docs/MONETIZATION.md) contiene le regole correnti complete.

| Decisione | Regola o dettaglio | Stato |
|---|---|---|
| Percorso di lancio | Pagamenti automatici pronti per i primi clienti paganti | Richiesto da Alisher |
| Listino | Mantenere 29/49/15 e annuali, chiarire le regole | Confermato |
| Dashboard personale | Versione essenziale prima dei clienti paganti | Confermato |
| Gratuità a vita | Aziende iniziali selezionate dal fondatore | Richiesta confermata |
| Capacità gratuita | Piano e sedi per azienda scelti dal fondatore | Confermato |
| Codice gratuito | Assegnazione diretta sufficiente; eventuale monouso con beneficio permanente | Proposta da scegliere |
| Limite 30 | Persone uniche nell'intera azienda | Confermato; dettagli degli stati da validare |
| Primo mese gratuito | 30 giorni senza carta per tutte le nuove aziende; Team con una sede inclusa; proroghe selettive del fondatore | Confermato; flusso di attivazione da completare |
| Beta e avvio prova | Fine beta distinta dalla gratuità a vita; prova commerciale iniziale separata | Dettagli da discutere |
| Pausa stagionale | Stop rinnovi a fine periodo pagato; sola lettura/export e ripartenza esplicita | Approvato; da implementare |
| Annuale in pausa | Nessun congelamento/proroga/rimborso automatico; stop rinnovo futuro | Approvato; da implementare |
| Uscita e archivio | 12 mesi gratuiti da fine operatività; tutto lo storico conservato esportabile, avvisi e cancellazione operativa al termine | Durata confermata; dettagli da validare |
| Scadenza e tolleranza | Insoluto: 7 giorni per aziende già paganti, avvisi e nessun reset; 7 giorni separati per rettifiche pregresse senza nuova operatività | Approvato; limite clock-out/chat e sincronizzazione provider da definire |
| Variazioni piano/sedi | Upgrade esplicito e capacità dopo pagamento verificato; downgrade al rinnovo già compatibile, con capacità futura protetta e annullamento esplicito | Approvato; mapping provider/cambio ciclo da definire |
| Prezzo alla ripartenza/listino futuro | Periodo pagato invariato; listino vigente accettato alla ripartenza; aumenti sui rinnovi con 60 giorni di preavviso | Approvato; da implementare |
| Rimborsi e contestazioni | Errori rimborsati; disdetta ordinaria senza rimborso residuo automatico; cortesia per rinnovo annuale entro 14 giorni senza nuova attività; disservizio grave con credito proporzionale | Approvato; esecuzione e condizioni del provider da verificare |
| Spazio e uso sostenibile | 10 MiB/file esistenti; base iniziale 2 GiB documenti per azienda, uguale nei piani; quota blocca solo nuovi upload | Regola approvata; quota da calibrare prima di pubblicarla |
| Supporto e continuità | Email/modulo italiano, lun–ven; obiettivo prima risposta entro 2 giorni lavorativi; guida/call iniziale 30 minuti; prova ripristino DB+file prima della vendita | Approvato; canale e ripristino da predisporre/verificare |
| Recupero controllo aziendale | Percorso assistito con verifica identità/autorità, distinto dal reset password e dalla carta che paga | Regola approvata; procedura operativa da predisporre |
| Provider | Paddle scelto per il canale web, come rivenditore/MoR | Confermato; approvazione account e integrazione da completare |
| Soggetto e regime iniziali | Partita IVA già attiva del fondatore, regime forfettario; attività dichiarata frontend developer, licenza/accesso alla propria piattaforma | Dichiarato dal fondatore; codice ATECO completo da recuperare |
| Procedura fiscale e copy IVA | Verificare compatibilità ATECO e flusso fornitore/Paddle: contratto, reverse invoice, commissioni, payout e adempimenti italiani applicabili | Commercialista, prima dei primi incassi; non rinviata alla crescita clienti |
| Conservazione/accesso ai dati | Matrice per categorie/finalità e accesso minimo; validare archivio, cancellazioni e backup; EDPB senza durata universale | Prima dell'esercizio commerciale |
| Rilascio dicembre 2026 | Core, dashboard essenziale e pagamenti prima del lancio pagante; analytics avanzati dopo | Obiettivo dell'allegato da confermare |

### Confronto con i concorrenti: motivazioni delle regole approvate

**Fonti verificate il 2026-10-05.** Il confronto ha motivato le otto raccomandazioni poi approvate da Alisher. Le politiche pubblicate dai concorrenti sono esempi commerciali, non norme italiane né garanzie sulla liceità della conservazione. Quando una pagina descrive fatture o una singola funzione, non estendere la regola a pagamenti con carta o a tutto lo spazio della piattaforma.

| Riferimento ufficiale | Regola osservata e limite del confronto |
|---|---|
| [When I Work: ibernazione](https://help.wheniwork.com/articles/hibernating-your-account/) | Pausa solo mensile, minimo 30 giorni; ferma pagamenti e accesso, conserva dati; dopo oltre 13 mesi disattiva l'account. Non documenta una pausa dell'annuale |
| [Planday: fatture e accesso](https://help.planday.com/en/articles/67176-invoices-and-billing-faqs-and-troubleshooting) | Solleciti tipicamente a circa 8 e 16 giorni dalla scadenza fattura, accesso fino alla data di chiusura comunicata. Non stabilisce una grazia universale di 7 giorni per carta |
| [Sling: fatturazione](https://support.getsling.com/en/articles/5949289-billing-annual-or-monthly-option) | Nel piano gratuito con tetto 30 utenti, il 31° chiede upgrade/riduzione. Annuale ordinario senza rimborso dei mesi inutilizzati, con eccezione iniziale. Variazioni delle tariffe con 30 giorni di avviso |
| [Connecteam: rimborsi](https://help.connecteam.com/en/articles/5828460-subscriptions-cancellations-refunds-and-plan-changes) | Mensile disdetto a fine periodo senza rimborso; annuali Basic/Advanced/Expert cancellati entro primi 30 giorni con rimborso proporzionale. Cambi di piano hanno condizioni proprie |
| [Connecteam: posti](https://help.connecteam.com/en/articles/8343725-seat-pricing) | 30 posti inclusi e posti aggiuntivi a pagamento con proporzione al periodo residuo. Non è il modello KlokShift 29/49: qui serve upgrade esplicito, non addebito automatico per persona |
| [Sling: documenti](https://support.getsling.com/en/articles/6057580-employee-documents), [Connecteam: Knowledge Base](https://help.connecteam.com/en/articles/5995369-starting-guide-to-connecteam-s-knowledge-base) | Sling limita a 20 MB ogni documento senza tetto al numero; Connecteam pubblica quote della sola Knowledge Base fra 500 MB e 10 GB. Nessuna delle due dimostra che 2 GiB siano il limite giusto per KlokShift |
| [When I Work: assistenza](https://help.wheniwork.com/submit-a-ticket/), [Connecteam: assistenza](https://help.connecteam.com/en/articles/11503466-how-to-reach-out-to-our-support-team) | When I Work ha orari pubblicati; Connecteam offre 24/7. La disponibilità continua non è una regola universale |
| [Connecteam: termini, §2.5](https://connecteam.com/terms-conditions/), [Deputy: trasferimento](https://help.deputy.com/hc/en-au/articles/15076521133839-How-do-I-transfer-my-Deputy-account-to-a-new-owner) | Recupero soggetto a verifiche; trasferimento amministrativo può preservare configurazione e storico. Non basta conoscere nome dell'azienda o dati pubblici |

Le regole complete degli otto punti sono consolidate in
[MONETIZATION.md](../docs/MONETIZATION.md), così le variazioni commerciali
hanno una fonte dedicata. I requisiti della dashboard, comprese le anomalie
essenziali e gli interventi amministrativi, sono in
[FOUNDER-DASHBOARD.md](../docs/FOUNDER-DASHBOARD.md).

La quota iniziale documenti rimane da calibrare in beta, i dettagli di
conteggio/prova sono ancora aperti e il provider deve dimostrare in sandbox
che pause, modifiche e rimborsi rispettano le regole approvate. La validazione
fiscale/privacy rimane separata dall'approvazione delle condizioni commerciali.

## 11. Registro e riferimenti

| Data | Attività | Risultato |
|---|---|---|
| 2026-10-05 | Lettura allegato, istruzioni, schema, gate piani, sito e routing dashboard | Inventario e divergenze documentati; nessuna modifica al prodotto |
| 2026-10-05 | Consultazione fonti ufficiali Expo, provider, store, Supabase e Agenzia delle Entrate | Corrette le assunzioni su MoR, store e prodotti Stripe; questioni fiscali specifiche lasciate aperte |
| 2026-10-05 | Prima proposta di piano | Solo documentazione; decisioni commerciali non ancora confermate |
| 2026-10-05 | Risposte di Alisher | Importi mantenuti, dashboard essenziale prioritaria, pagamenti già pronti e gratuità a vita per aziende selezionate; piano riallineato |
| 2026-10-05 | Ulteriori risposte di Alisher | 30 persone uniche nell'intera azienda; piano e sedi della gratuità permanente decisi per ogni azienda |
| 2026-10-05 | Richieste successive: primo mese, pausa stagionale e uscita con dati | Aggiunti ciclo archivio, proposta 12/24 mesi, dati trattenuti per finalità distinta e blocco M11; durate ancora da confermare |
| 2026-10-05 | Verifica tecnica parallela in lettura e fonti EDPB/Paddle | Confermata incompatibilità di `delete_account` con sola lettura; rilevati scope sedi chiuse e limite UI agli ultimi 12 mesi |
| 2026-10-05 | Conferma primo mese e archivio | 30 giorni senza carta per tutte le nuove aziende e 12 mesi di consultazione/export dopo fine operatività; proposta riallineata |
| 2026-10-05 | Chiarimento EDPB e revisione delle questioni residue | Nessun termine universale EDPB; aggiunte decisioni su prezzi futuri, rimborsi, spazio, supporto e recupero controllo; annuale e tolleranza restano proposte |
| 2026-10-05 | Confronto fonti ufficiali When I Work, Planday, Sling, Connecteam, Deputy e Supabase | Raccomandazioni concrete sugli otto punti, con evidenze/limiti del confronto e controlli tecnici; nessuna nuova scelta presentata come confermata |
| 2026-10-05 | Approvazione degli otto punti e richiesta di documentazione dedicata | Create fonti canoniche in `docs/`, allineati istruzioni/README/tracker e stato delle decisioni; nessuna implementazione dichiarata completata |
| 2026-10-05 | Scelta Paddle e dichiarazione partita IVA forfettaria già attiva; attività frontend developer, codice ATECO non disponibile a memoria | Provider confermato; registrata intenzione di usare la partita IVA esistente. Compatibilità ATECO/procedura fiscale da verificare prima degli incassi, privacy e integrazione ancora da completare |
| 2026-10-05 | Autorizzazione a iniziare lo sviluppo e conferma prova Team/una sede | Avviata fondazione additiva M03a: schema, RPC protette, read model e test locali; nessun rollout remoto o addebito |
| 2026-10-05 | Completamento M03a e verifica coordinata locale | SQL/RLS/concorrenza superati; tipi rigenerati; 242 test client e typecheck app/web superati; lint senza errori con warning preesistente. Restano enforcement, interfacce, pagamenti e rollout |

| 2026-10-05 | M03b e collegamento minimo client | Guard server/RLS/Storage, capacità con lock, compatibilità migration_pending, rettifiche limitate, storico sedi chiuse e mesi arbitrari. Verifica locale: 256 test client, typecheck app/web, lint (warning preesistente), build web/export iOS; suite SQL e concorrenza nel banco. Nessuna nuova migration remota o addebito. |

Riferimenti interni da leggere prima di implementare: `AGENTS.md`, `ARCHITECTURE.md`, `supabase/README.md`, `web/README.md`, `web-site/README.md`, `CLOCK_IN_OUT.md`, `plans/HOURS-ABSENCES-ADJUSTMENTS.md` e stato corrente di `plans/AUDIT-2026-10-04.md`.

Documentazione Expo richiesta e consultata: [SDK 56](https://docs.expo.dev/versions/v56.0.0/). Le fonti esterne sono state consultate il 5 ottobre 2026; condizioni dei provider e regole store devono essere ricontrollate quando si passa all'integrazione/rilascio.

### Istruzioni per l'esecuzione futura

Eseguire un blocco alla volta, dopo averne chiuso le decisioni necessarie. Rileggere file e stato Git: questo inventario fotografa il commit indicato, non lo stato futuro. Conservare le modifiche del titolare. Aggiornare qui stato, risultati e verifiche dopo ogni blocco. Non introdurre gateway, prezzi, perdita di accesso o nuove regole commerciali soltanto perché compaiono fra le raccomandazioni. Non fare deploy, addebiti, contatti a clienti o modifiche a produzione come conseguenza automatica di questo documento.
