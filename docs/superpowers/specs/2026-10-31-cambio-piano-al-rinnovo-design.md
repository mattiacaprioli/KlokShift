# Cambio di piano al rinnovo — design

Data: 2026-10-31. Stato: **bozza da approvare**. Riguarda M09 (riga «Riduzioni
al rinnovo con un'operazione pianificata» in
[plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md](../../../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md))
e la regola già approvata in [docs/MONETIZATION.md §2](../../MONETIZATION.md)
«Superamento dei 30 e downgrade».

## 1. Intento

Il fondatore vuole che il primo cliente pagante trovi **tutto a posto**: nessun
cambio di abbonamento deve passare da un'email a info@klokshift.com. Oggi il
titolare fa da solo gli aumenti (Base→Team, sedi in più, pagamento subito della
differenza) dalla pagina Piano della dashboard (`web/src/pages/Piano.tsx`); per
**scendere di piano, togliere sedi o cambiare fra mensile e annuale** la pagina
dice di scrivere un'email, e `public.billing_prepare_change` rifiuta con
`billing_downgrade_unsupported`.

Il motivo per cui non c'è: Paddle applica le modifiche agli articoli
dell'abbonamento **subito**, mentre la regola approvata vuole le riduzioni
**dal rinnovo**. Serve un pezzo nostro che le programmi.

## 2. Obiettivi

- Il titolare, dalla pagina Piano sul web, programma da solo un **cambio al
  rinnovo**: piano più piccolo, meno sedi in più, mensile→annuale,
  annuale→mensile, o una combinazione di questi.
- Il cambio vale **dal prossimo rinnovo**; fino ad allora l'azienda tiene ciò
  che ha pagato.
- Il titolare vede sempre il cambio in attesa e lo può annullare fino al
  rinnovo.
- Il cambio arriva a Paddle in automatico prima del rinnovo, così Paddle
  rinnova già col piano nuovo; se qualcosa va storto il fondatore lo sa in
  tempo.

## 3. Non obiettivi

- **Gli aumenti restano come sono** (immediati, con importo proporzionale
  calcolato da Paddle, `prorated_immediately`). Questo lavoro non li tocca
  salvo il blocco «annulla prima il cambio in attesa» (§6.4).
- Niente cambio di ciclo **immediato** con sconto sul mese già pagato: deciso
  il 31/10 che anche mensile→annuale parte al rinnovo.
- Niente rimborsi automatici, niente acquisti o espulsioni automatiche.
- Nessuna modifica all'app nativa oltre a una notifica neutra (l'app non mostra
  mai prezzi né acquisti — vincolo App Store, `docs/MONETIZATION.md`).
- Le aziende gratuite a vita non hanno abbonamento Paddle: fuori ambito.

## 4. Anti-obiettivi (fallimento anche se «funziona»)

- Il cliente rinnova al prezzo vecchio **senza che nessuno se ne accorga**.
- Paddle e il nostro database dicono cose diverse su cosa l'azienda ha pagato
  in questo momento.
- Una riduzione che toglie capacità a lavoro già in corso (persone già nel
  team, sedi aperte) o cancella qualcosa.
- Team rinnovato «di nascosto» quando la riduzione non si può applicare.
- Un addebito che il titolare non ha visto prima di confermare.

## 5. Vincoli

- Scritture solo da RPC; le RPC di fatturazione sono **solo `service_role`** e
  le chiama la Edge Function `billing-manage` dopo aver verificato l'utente
  (schema esistente: `billing_manage_context`, `billing_prepare_change`).
- **Solo migration nuove**; quelle applicate sono immutabili.
- Il diritto aziendale segue gli avvisi verificati di Paddle (`paddle-webhook`):
  non concedere né togliere capacità per un dato mancante.
- Testi utente in italiano, glossario di `docs/GLOSSARIO.md` (team, sede,
  dipendente).
- L'app nativa non mostra prezzi.
- Paddle Billing: `PATCH /subscriptions/{id}` sostituisce l'elenco completo
  degli articoli; `proration_billing_mode: do_not_bill` cambia gli articoli
  senza addebitare ora. `scheduled_change` di Paddle supporta solo
  `cancel`/`pause`/`resume`, non un cambio di articoli.
- I commit li fa il fondatore: lasciare le modifiche pronte, niente
  commit/push.

## 6. Approcci considerati

In tutti e tre il **cambio in attesa sta nel nostro database**: serve per la
riga nella pagina, per il blocco della capacità futura e per il promemoria.
Cambia quando lo diciamo a Paddle.

- **A. Lo diciamo a Paddle poco prima del rinnovo — SCELTO (31/10).** Un lavoro
  pg_cron, come `clock-reminders` e `archive-reminders`, nelle ore prima del
  rinnovo chiama `billing-manage`, che cambia gli articoli su Paddle con
  `do_not_bill`; Paddle rinnova col piano nuovo. Paddle rispecchia sempre ciò
  che il cliente sta pagando adesso (anche nel portale) e la logica del webhook
  resta quasi invariata. Costo: un pezzo che lavora da solo, con tentativi e un
  allarme per il fondatore; la capacità scende qualche ora prima della fine del
  periodo (innocuo, vedi §7.3).
- **B. Lo diciamo a Paddle subito, alla conferma.** Nessun lavoro pianificato ed
  errori visibili subito al titolare, ma da quel momento Paddle e il portale
  mostrano già il piano nuovo e il nostro database dovrebbe ignorare Paddle fino
  a fine periodo: contraddice «il diritto segue ciò che Paddle conferma».
  Scartato.
- **C. Chiudere l'abbonamento e aprirne uno nuovo al rinnovo.** Richiede un
  nuovo pagamento con consenso del cliente. Scartato.

## 7. Comportamento

Le voci marcate **(fondatore)** sono decisioni sue; **(proposta)** sono scelte
di design accettate nella conversazione del 31/10 senza discussione puntuale;
**(scelta del designer)** sono state decise scrivendo questo documento e il
fondatore le può correggere.

### 7.1 Cosa si può programmare

- Un **solo cambio in attesa** per abbonamento, che descrive il **punto
  d'arrivo**: piano, ciclo, sedi in più. (proposta)
- Ammesso se, rispetto a oggi, piano e sedi **non aumentano** e almeno uno fra
  piano, sedi e ciclo cambia. Il ciclo è libero nei due sensi. (fondatore: tutte
  le riduzioni e i cambi di ciclo al rinnovo)
- Un cambio che aumenta piano o sedi passa dalla strada immediata esistente. Un
  cambio misto (es. Base→Team **e** mensile→annuale) non è ammesso in un colpo:
  prima l'aumento, poi si programma il ciclo. (scelta del designer: evita di
  fondere le due strade; da rivedere se i clienti lo chiedono)
- Team→Base solo se l'azienda conta **già** al massimo 30 persone (conteggio
  esistente di `workspace_access`: membri unici con organico corrente in una
  sede aperta). (fondatore)
- Meno sedi in più solo se le **sedi aperte** stanno già nella capacità futura
  (1 + sedi in più). Le sedi si chiudono prima, dalla loro pagina; chiudere
  una sede non cancella nulla. (fondatore)
- Solo con abbonamento `active`, senza rinnovo non riuscito, senza pausa o
  chiusura programmata su Paddle. (coerente con `billing_prepare_change`)
- Data d'effetto = `current_period_ends_at` dell'abbonamento al momento della
  richiesta (= il prossimo rinnovo). Se il periodo finisce entro il margine
  minimo che serve al lavoro pianificato (vedi §8.3), il cambio si rifiuta con
  un messaggio «troppo vicino al rinnovo: scrivi a info@…». (scelta del
  designer)

### 7.2 Pagina Piano (web, solo titolare)

- Un modulo **«Cambia dal prossimo rinnovo»** accanto all'aumento esistente:
  piano, ciclo, numero di sedi. Prima della conferma mostra **data del
  rinnovo** e **importo del rinnovo** col piano nuovo. (proposta) L'importo è
  quello di Paddle, non del listino locale: anteprima Paddle della modifica con
  `do_not_bill` (totale della prossima transazione, IVA compresa), come fa già
  l'aumento con `previewSummary`. (scelta del designer: unico modo di non
  mostrare una cifra diversa da quella che Paddle addebiterà)
- Se la scelta non è ammessa, la pagina lo dice prima della conferma con il
  motivo concreto: «hai 34 persone nel team: il piano Base ne comprende 30»,
  «hai 3 sedi aperte: chiudine una prima di ridurre». (proposta)
- Finché il cambio è in attesa, una riga sempre visibile nella card
  Abbonamento: «Dal 18/11/2026: Base · annuale, 1 sede — 290 € + IVA», con
  **«Annulla il cambio»** (sempre possibile fino all'invio a Paddle, §8.3).
  (proposta)
- Sparisce la frase «Per passare a un piano più piccolo… scrivi a
  info@klokshift.com».
- La conferma di **«Metti in pausa»** e **«Chiudi l'abbonamento»** dice che il
  cambio in attesa verrà annullato, e confermare lo annulla. (scelta del
  designer: pausa e chiusura rendono il cambio privo di senso; meglio dirlo
  che bloccarle)

### 7.3 Capacità mentre il cambio è in attesa

- **Aggiunte bloccate oltre la capacità futura** (fondatore): con Team→Base in
  attesa, il 31° posto (nuova persona in organico, ripristino, invito che
  riserva un posto — stesse regole del conteggio attuale) è rifiutato; con meno
  sedi in attesa, aprire o riaprire una sede oltre la capacità futura è
  rifiutato.
- Il rifiuto ha un codice **diverso** da `workspace_people_capacity` /
  `workspace_venue_capacity`, così il messaggio può dire «Hai programmato il
  passaggio a Base dal 18/11: annullalo dalla pagina Piano per aggiungere altre
  persone». (scelta del designer) Messaggi in `src/lib/errors.ts`.
- Il lavoro esistente continua sempre: nessuna persona tolta, nessuna sede
  chiusa d'ufficio.
- Poiché le aggiunte sono già bloccate, che Paddle riceva il cambio (e il
  webhook abbassi la capacità) qualche ora prima della fine del periodo non ha
  effetti pratici. Il nuovo periodo nel registro e l'MRR del fondatore
  partiranno da quell'istante, non dal rinnovo: accettato.

### 7.4 Aumenti mentre c'è un cambio in attesa

Bloccati con il messaggio «Annulla prima il cambio programmato». (proposta)

### 7.4 bis Dopo l'invio a Paddle e prima del rinnovo

Nelle ~24 ore fra l'invio (`applied`) e il rinnovo Paddle ha già gli articoli
nuovi. (scelta del designer)
- **Aumenti** e **«Annulla il cambio»** sono bloccati: «Il cambio è già stato
  inviato; dal {data} potrai modificare di nuovo il piano». La pagina lo dice
  prima, insieme alla scadenza per annullare.
- **Pausa e chiusura restano possibili** (un titolare che vuole fermarsi il
  giorno prima del rinnovo non deve essere addebitato): la riga diventa
  `canceled` con il motivo, e il rinnovo non avviene.
- Lo stesso vale per pausa, chiusura o rimborso decisi altrove in quella
  finestra.

### 7.5 Promemoria

- **7 giorni prima** della data d'effetto, al titolare: **notifica nell'app**,
  neutra e senza prezzi («Dal 18/11 cambia l'abbonamento di {azienda}: i
  dettagli sono nella pagina Piano sul web»), ed **email** con piano, sedi,
  ciclo, importo e link alla pagina Piano. (proposta)
- Se il cambio è programmato a meno di 7 giorni dal rinnovo, niente promemoria:
  basta la conferma a schermo. (scelta del designer)
- Riusa il canale di `archive-reminders` (tipo di notifica nuovo, coda con
  tentativi, Edge Function con Resend e segreto Vault). (proposta)

### 7.6 Area del fondatore

- Scheda azienda: il cambio in attesa (punto d'arrivo, data, chi l'ha chiesto,
  stato) e lo storico dei cambi. (proposta)
- Panoramica, **«Pagamenti da verificare»**: un cambio che non è arrivato a
  Paddle entro la soglia d'allarme (§8.3), o un rinnovo avvenuto con articoli
  diversi da quelli programmati. Si chiude con nota, come
  `admin_resolve_billing_adjustment`. (proposta)
- **Allarme via email a info@klokshift.com** (fondatore, 31/10): nessun canale
  oggi raggiunge il fondatore, e un avviso solo nel pannello lascerebbe
  passare il rinnovo al prezzo vecchio senza che nessuno se ne accorga. Parte
  un'email (Resend, come `archive-reminders`, con tentativi e senza doppioni
  per lo stesso cambio) quando un cambio non è ancora inviato a 6 ore dal
  rinnovo e quando un cambio diventa `failed`. L'indirizzo è un segreto/config
  della funzione, non scritto nel codice.
- Accanto all'avviso, **«Riprova adesso»** rilancia l'invio a Paddle con le
  stesse verifiche (solo fondatore, aal2, come le altre azioni admin). Se anche
  così non va, il rinnovo avviene col piano attuale e la differenza si
  rimborsa a mano su Paddle; il fondatore chiude l'avviso con una nota.
  (fondatore)

### 7.7 Portale clienti Paddle

Il titolare non deve poter cambiare piano dal portale Paddle. Da verificare in
sandbox se il portale lo permette; se sì, spegnerlo dalle impostazioni Paddle;
se non si può spegnere, il webhook tratta un cambio di articoli non partito da
noi come oggi (lo applica) e lo segnala in «Pagamenti da verificare».
(fondatore: va chiuso; il ripiego è scelta del designer)

## 8. Parti tecniche decise

### 8.1 Dati

Una tabella nuova (nome proposto `public.billing_scheduled_changes`, RLS
attiva, nessun grant ai client) con: abbonamento, azienda, ambiente; punto
d'arrivo (piano, ciclo, sedi in più); **articoli correnti al momento della
richiesta** (per riconoscere se nel frattempo sono cambiati); data d'effetto;
stato (`pending`, `applied`, `confirmed`, `canceled`, `failed`); chi l'ha chiesto
e quando; chi/che cosa l'ha annullato e perché (titolare, pausa, chiusura,
abbonamento chiuso, rimborso); tentativi, ultimo errore, istante di invio;
riferimento al promemoria. Al massimo un `pending` per abbonamento (indice
unico parziale). Le righe non si cancellano: sono storia commerciale e restano
anche dopo la cancellazione dei dati a fine archivio, come gli altri dati di
fatturazione.

`get_workspace_billing` restituisce anche il cambio in attesa (punto d'arrivo e
data) per la pagina Piano; `workspace_access` (o la funzione che fornisce i
limiti ai trigger `check_commercial_capacity`) espone la **capacità futura**
per il blocco di §7.3.

### 8.2 Richiesta e annullamento

Due azioni nuove in `billing-manage` (es. `schedule_change`,
`cancel_scheduled_change`) che chiamano due RPC `service_role` sulla falsariga
di `billing_prepare_change`: verifica titolare, stato dell'abbonamento,
regole di §7.1 (con errori `raise exception '<codice>'` tradotti in
`src/lib/errors.ts`). Nessuna chiamata a Paddle al momento della richiesta.
`pause` e `cancel` di `billing-manage` annullano il cambio in attesa dopo il
successo su Paddle; l'aumento (`preview_change`/`apply_change`) lo rifiuta.

### 8.3 Invio a Paddle

- Un lavoro pg_cron (stesso schema di `private.run_clock_reminders`) ogni 10
  minuti seleziona i `pending` la cui data d'effetto è entro la **finestra
  d'invio** e chiama via pg_net `billing-manage` (azione di servizio, stesso
  segreto delle altre chiamate pianificate).
- Valori di partenza (scelta del designer, regolabili): finestra d'invio
  **24 ore** prima del rinnovo; **allarme** al fondatore se a **6 ore** dal
  rinnovo non è ancora inviato; il titolare può annullare fino all'invio.
  Il margine minimo di §7.1 è quindi 24 ore.
- Prima dell'invio si ricontrollano le regole di §7.1 (persone, sedi, stato).
  Se non valgono più (caso che il blocco di §7.3 rende raro: azioni del
  fondatore, dati incoerenti) il cambio **non** si invia, diventa `failed`, e
  vengono avvisati titolare e fondatore: il rinnovo avverrà col piano attuale,
  in modo visibile, e la differenza si sistema a mano (rimborso). (scelta del
  designer, coerente con «nessuna conversione silenziosa»)
- La Edge Function legge l'abbonamento da Paddle, verifica che
  `next_billed_at` coincida con la data d'effetto e che gli articoli siano
  quelli registrati alla richiesta; fa `PATCH` con
  `proration_billing_mode: do_not_bill` usando gli **id prezzo d'arrivo
  registrati alla richiesta** (quelli dell'anteprima mostrata al titolare).
  Regola dei prezzi (scelta del designer, come `buildItems`): un articolo che
  non cambia né piano né ciclo tiene il suo prezzo attuale; un articolo che
  cambia prende il prezzo `selectable` di `private.billing_prices` per il ciclo
  d'arrivo al momento della richiesta. Se all'invio un prezzo registrato non è
  più valido o qualcosa non torna, si ferma (`failed` + allarme), non improvvisa.
- Tentativi con attesa crescente finché si è dentro la finestra; ogni tentativo
  e il suo esito registrati.
- Lo stato passa a `applied` all'esito positivo della PATCH; a `confirmed`
  quando arriva l'avviso del **rinnovo** con gli articoli d'arrivo. Rinnovo con
  articoli diversi → «Pagamenti da verificare».
- Il webhook non cambia regole: l'avviso `subscription.updated` generato dalla
  nostra PATCH aggiorna piano, ciclo e sedi come oggi.

### 8.4 Gli altri eventi

- Rinnovo non riuscito, rimborso, pausa o chiusura decisi altrove (portale,
  fondatore su Paddle) mentre il cambio è `pending`: il cambio si annulla col
  motivo. Dopo l'invio (`applied`) vale lo stato Paddle e gli avvisi esistenti.
- Rimborso nei 14 giorni del primo rinnovo col piano nuovo: regole esistenti
  (rimborso di un rinnovo → archivio).

## 9. Prima di scrivere codice: prova in sandbox

Il comportamento di Paddle va verificato **prima** di costruire, su un
abbonamento sandbox con `next_billed_at` avvicinato via API (come nella prova
del 18/10):

1. Team→Base e meno sedi con `do_not_bill`: `next_billed_at` invariato, nessuna
   transazione ora, rinnovo all'importo nuovo.
2. **Mensile→annuale** con `do_not_bill`: `next_billed_at` resta quello del
   mese? Il rinnovo addebita l'anno e apre un periodo di un anno?
3. Annuale→mensile, idem.
4. Quali avvisi arrivano (e in che ordine) e se il webhook attuale li accetta
   senza scartarli (`invalid_plan_items` è già successo con la pausa).
5. Se il portale clienti permette di cambiare piano e se si può spegnere.

**Condizione d'arresto**: se il punto 2 o 3 non si comporta come previsto
(Paddle sposta la data, addebita subito o rifiuta), fermarsi e tornare dal
fondatore prima di scegliere un'alternativa per il cambio di ciclo; le
riduzioni di piano e sedi possono procedere da sole.

## 10. Verifiche

- Suite SQL nuova in `supabase/tests/rls/` (accanto a `105_billing_manage.sql`):
  regole di §7.1, un solo `pending`, capacità futura e codici d'errore,
  annullamenti da pausa/chiusura/rimborso, selezione del lavoro pianificato
  dentro/fuori finestra, `failed` quando le regole non valgono più, nessun
  accesso dai client.
- Unit test della logica della Edge Function (costruzione articoli, controlli
  su `next_billed_at` e articoli correnti), come `billing-manage/logic.ts`.
- Unit test dei testi e degli importi della pagina Piano.
- Prova manuale sandbox completa (programma → promemoria → invio → rinnovo →
  `confirmed`; annulla; pausa con cambio in attesa; allarme simulando l'invio
  mancato, con l'email a info@ arrivata e «Riprova adesso»), scritta come procedura in `docs/` come le altre `TEST-*.md`.

## 11. Documenti da aggiornare

`docs/MONETIZATION.md` (§2 «Esecuzione attuale»),
`plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md` (M09), `TASKS.md`,
`docs/FOUNDER-DASHBOARD.md` (nuove voci), FAQ/termini del sito se citano
l'email per le riduzioni.

## 12. Lasciato al costruttore

Nomi di tabella, colonne, RPC, azioni e codici d'errore; dove esattamente
leggere la capacità futura nei trigger di capacità; layout del modulo nella
pagina Piano; forma della coda del promemoria (tabella propria o
generalizzazione di quella dell'archivio); attesa fra i tentativi; struttura
della procedura di prova manuale.
