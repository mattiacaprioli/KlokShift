# Prova in sandbox — cambio di piano al rinnovo

Prova del 31 ottobre 2026, prima di costruire il cambio di piano al rinnovo
(spec `docs/superpowers/specs/2026-10-31-cambio-piano-al-rinnovo-design.md`, §9).
Solo sandbox (`https://sandbox-api.paddle.com`), abbonamento di prova di
**DA CARLOTTA**, con il consenso del fondatore. Nessun codice, migration o test
modificato.

## Ambiente

La chiave API sandbox sta in `.env.paddle-sandbox.local` (non versionato) come
`export PADDLE_SANDBOX_API_KEY=…`. Si carica solo nel comando che la usa e si
controlla che sia una chiave sandbox prima di ogni chiamata. Non va mai stampata.

```sh
source .env.paddle-sandbox.local
case "$PADDLE_SANDBOX_API_KEY" in pdl_sdbx_apikey_*) ;; *) echo "non è sandbox"; exit 1;; esac
P() { curl -sS -X "$1" "https://sandbox-api.paddle.com$2" \
  -H "Authorization: Bearer $PADDLE_SANDBOX_API_KEY" -H "Paddle-Version: 1" \
  -H "Content-Type: application/json" ${3:+--data "$3"}; }
SUB=sub_01m5fbkta79re52mncw1frpn0z
```

Prezzi sandbox (`private.billing_prices`): Base `pri_01m577s3dchg2ctcrenkderz05`
(mese) / `pri_01m577th8zt8x41cxk2p8m5n63` (anno); Team `pri_01m577vzt1b6qkyyf80pnq4aj9`
/ `pri_01m577wqj8atr0sjvy8xhybwf1`; sede in più `pri_01m577z2zz69jyw4r3hm53warm`
/ `pri_01m577zzw0kv3c91yqttd0kk6k`.

## Procedura

1. **Leggere l'abbonamento** (con prossimo addebito previsto):
   `P GET "/subscriptions/$SUB?include=next_transaction,recurring_transaction_details"`
   e le transazioni: `P GET "/transactions?subscription_id=$SUB&per_page=50"`.
2. **Applicare gli articoli d'arrivo** (sempre l'elenco completo):
   `P PATCH "/subscriptions/$SUB" '{"items":[{"price_id":"<prezzo>","quantity":1}],"proration_billing_mode":"do_not_bill"}'`
   Per vedere l'effetto senza cambiare nulla: stessa chiamata su `"/subscriptions/$SUB/preview"`.
3. **Avvicinare il rinnovo**, come nella prova del 18/10:
   `P PATCH "/subscriptions/$SUB" "{\"next_billed_at\":\"$(date -u -v+31M +%Y-%m-%dT%H:%M:%SZ)\",\"proration_billing_mode\":\"do_not_bill\"}"`
   ⚠️ Il minimo è **30 minuti** da adesso (sotto: 409 `subscription_next_billed_at_too_soon`).
4. **Aspettare il rinnovo** ripetendo la `GET` ogni minuto: il rinnovo arriva
   ~25 s dopo `next_billed_at`. Poi ripetere i passi 1.
5. **Esito degli avvisi**: la chiave API sandbox attuale **non** può leggere
   `GET /events` né `GET /notifications` (403 `forbidden`). Gli avvisi si
   leggono dove arrivano, in `private.billing_events` del progetto:

   ```sql
   select occurred_at, event_type, event_id, outcome, error,
          payload #>> '{data,billing_cycle,interval}' as cycle,
          payload #>  '{data,current_billing_period}'  as period,
          payload #>> '{data,next_billed_at}'          as next_billed_at
     from private.billing_events
    where environment = 'sandbox'
      and (payload #>> '{data,id}' = 'sub_01m5fbkta79re52mncw1frpn0z'
           or payload #>> '{data,subscription_id}' = 'sub_01m5fbkta79re52mncw1frpn0z')
      and occurred_at >= '2026-10-31T09:30:00Z'
    order by occurred_at;
   ```

## Stato di partenza

`sub_01m5fbkta79re52mncw1frpn0z`, unico abbonamento attivo con Team annuale + 1
sede in più annuale, creato il 21/10 13:50 UTC (checkout KlokShift collegato).
Periodo 21/10/2026 → 21/10/2027, `next_billed_at` 21/10/2027, nessun cambio
programmato. Unica transazione: 780,80 € (640 € + IVA).

## 1. Team→Base e da 2 sedi a 1, stesso ciclo (annuale) — superato

PATCH alle 09:31 UTC con solo Base annuale, `do_not_bill` → 200.

- `next_billed_at` **invariato** (21/10/2027), ciclo annuale, periodo invariato.
- Nessuna transazione. Prossimo addebito previsto: **353,80 €** (290 € + IVA).
- Rinnovo avvicinato alle 10:02:46: rinnovato alle 10:03:10 (24 s dopo),
  transazione `subscription_recurring` di **353,80 €** con solo Base annuale,
  periodo nuovo contiguo 31/10/2026 10:02:46 → 31/10/2027 10:02:46.

Atteso dalla spec §9.1 e confermato.

## 2. Annuale→mensile con `do_not_bill` — condizione d'arresto

PATCH alle 10:04:25 UTC con solo Base mensile, `do_not_bill` → **200, accettata**.

- Subito dopo: ciclo **mensile**; il periodo **ricomincia all'istante della
  PATCH** (31/10 10:04:25 → 30/11 10:04:25); `next_billed_at` passa da
  31/10/2027 a **30/11/2026**.
- Nessuna transazione: il primo mese non si paga e l'anno già pagato non viene
  accreditato.
- Rinnovo avvicinato alle 10:35:33: **35,38 €** (29 € + IVA), periodo di un mese.

Paddle **sposta la data**: il cambio di ciclo con `do_not_bill` non aspetta la
fine del periodo, ne apre uno nuovo subito.

## 3. Mensile→annuale con `do_not_bill` — condizione d'arresto

PATCH alle 10:37:11 UTC con solo Base annuale, `do_not_bill` → **200, accettata**.

- Subito dopo: ciclo **annuale**; periodo **31/10/2026 10:37:11 → 31/10/2027**;
  `next_billed_at` passa da 30/11/2026 a **31/10/2027**.
- Nessuna transazione: **un anno intero senza addebito**.
- Rinnovo avvicinato alle 11:08:26: **353,80 €**, periodo di un anno
  (31/10/2026 11:08:26 → 31/10/2027).

Come il caso 2: la data si sposta e il periodo riparte dalla PATCH.

## 3 bis. Cambio di ciclo con la data del rinnovo fissata

Serve a evitare il periodo regalato dei casi 2 e 3.

- **Una sola PATCH con articoli e `next_billed_at`**: articoli mensili,
  `do_not_bill` e `next_billed_at` uguale a quello attuale (31/10/2027 11:08:26),
  alle 11:10:04 → 200, ma la data viene **ignorata** in silenzio. Il periodo
  riparte comunque dalla PATCH (31/10 11:10:04 → 30/11) e non nasce nessuna transazione.
  Con un `next_billed_at` diverso da quello attuale (anteprima, ora+50 min) →
  **400 `bad_request`**: «not possible to change items and billing date in the same request».
- **Due PATCH di seguito** (11:10:26–27): prima gli articoli annuali con
  `do_not_bill` (periodo riparte, `next_billed_at` 31/10/2027), poi solo
  `{"next_billed_at":"2026-10-31T11:46:27Z","proration_billing_mode":"do_not_bill"}`
  → 200. Ciclo resta annuale, periodo 11:10:26 → 11:46:27, nessuna transazione,
  prossimo addebito previsto 353,80 € per un anno.
  Rinnovo alle 11:46:27 (fatturato 11:47:05): **353,80 €**, periodo
  31/10/2026 11:46:27 → 31/10/2027 11:46:27.

Il cambio di ciclo «alla data giusta» si ottiene solo con **due PATCH**: prima
gli articoli, poi la data. Fra le due l'abbonamento resta per un istante con il
periodo regalato, e ognuna genera il suo `subscription.updated`. La seconda
PATCH deve cadere più di 30 minuti prima della data scelta. Provato solo
mensile→annuale; l'annuale→mensile in due passi non è stato provato.

`next_billed_at` è stato provato solo con **secondi interi** (`…:46:27Z`): la
Edge Function tronca le frazioni della data d'effetto (`scheduledDateBody`,
31/10). La verifica resta ±120 s e il reconcile tiene 5 minuti di margine.

## Prove collaterali (anteprime, nessun cambio)

- Cambio di ciclo con `prorated_next_billing_period` o `full_next_billing_period`:
  **400 `subscription_new_items_not_valid`**. Un cambio di frequenza non si può
  rimandare al periodo successivo.
- Con `full_immediately` / `prorated_immediately`: periodo che riparte subito e
  addebito immediato (35,38 € nell'anteprima da annuale a mensile).
- **Blocco di 30 minuti**: entro 30 minuti dal rinnovo ogni modifica, anche a
  ciclo invariato, dà 409 `subscription_locked_renewal`. La finestra d'invio di
  24 ore della spec (§8.3) resta fuori dal blocco; l'allarme a 6 ore pure.

## 4. Avvisi nel webhook

Gli avvisi reali non sono leggibili con questa chiave (vedi Procedura, passo 5).
Sugli stati dell'abbonamento letti dopo ogni passo (`data` di
`subscription.updated` è la stessa entità), `public.billing_apply_event`:

- intervalli degli articoli sempre uguali a `billing_cycle.interval` (Paddle
  sostituisce tutti gli articoli insieme), quindi niente `mixed_billing_interval`
  né `unsupported_billing_cycle`;
- `current_billing_period` sempre presente e coerente, quindi niente
  `invalid_billing_period`;
- un solo articolo di piano con quantità 1, quindi niente `invalid_plan_items`.

Esito atteso: `applied` per tutti. **Verificato il 31/10/2026** dal fondatore
sul remoto, dopo le prove: per `sub_01m5fbkta79re52mncw1frpn0z` dalle 09:30Z,
`subscription.updated` 17 `applied` e 1 `stale`, `transaction.completed` 5
`ignored`, nessun `rejected`. `billing_apply_event` non va cambiato per i cambi
di ciclo.
Nei cambi di ciclo il `current_period_starts_at` locale si sposterà
all'istante della PATCH, e con le due PATCH del §3 bis arrivano due avvisi ravvicinati
(il primo con il periodo regalato, il secondo con il periodo accorciato).

## 5. Portale clienti

- Il cambio di piano nel portale è una funzione **in early access**, su
  richiesta, alimentata da «product collections» create via API: senza aderire
  al programma il portale non la offre.
  <https://developer.paddle.com/build/subscriptions/customer-portal-upgrades-downgrades>
- La pagina del portale elenca ricevute, abbonamenti, metodi di pagamento e
  disdetta, non il cambio di piano, e non descrive interruttori per le singole
  funzioni. <https://developer.paddle.com/concepts/sell/customer-portal/>
- Quindi per KlokShift oggi il portale non permette di cambiare piano; non c'è
  un interruttore documentato perché la funzione non è attiva. Resta il ripiego
  di §7.7 se un giorno venisse attivata.

## Stato di DA CARLOTTA a fine mattina (superato: vedi in fondo)

Alle 11:47 UTC del 31/10 l'abbonamento sandbox `sub_01m5fbkta79re52mncw1frpn0z`
è `active`, **Base annuale, nessuna sede in più**, periodo pagato
31/10/2026 11:46:27 → 31/10/2027 11:46:27, prossimo addebito 353,80 € il
31/10/2027, nessun cambio programmato. Per arrivarci Paddle ha emesso quattro rinnovi sandbox oltre
all'acquisto del 21/10 (353,80 €, 35,38 €, 353,80 €, 353,80 €).

⚠️ Prima era Team + una sede in più (2 sedi). Se gli avvisi sono stati
applicati, in KlokShift DA CARLOTTA ora risulta Base con **una** sede, e la sua
seconda sede supera il piano. Per tornare com'era serve una PATCH con Team
annuale + sede in più annuale e `do_not_bill` (stesso ciclo: la data resta).
Decide il fondatore.

## Annuale→mensile in due passaggi (31/10, pomeriggio)

Il verso mancante del §3 bis. Stessa procedura, stesso abbonamento.
Snapshot in `.superpowers/sdd/2026-10-31-cambio-piano-al-rinnovo/task-0b-events/`.

**Partenza (11:53:58 UTC)**: Base annuale, periodo 31/10/2026 11:46:27 →
31/10/2027 11:46:27, `next_billed_at` 31/10/2027, nessun cambio programmato.

1. **PATCH degli articoli** (11:54:09):
   `P PATCH "/subscriptions/$SUB" '{"items":[{"price_id":"pri_01m577s3dchg2ctcrenkderz05","quantity":1}],"proration_billing_mode":"do_not_bill"}'`
   → 200. Ciclo **mensile**, periodo che riparte dalla PATCH
   (31/10 11:54:09.853 → 30/11 11:54:09.853), `next_billed_at` 30/11/2026.
   Nessuna transazione: come nel caso 2, l'anno pagato sparisce senza credito.
2. **PATCH della data**, un secondo dopo (11:54:10):
   `P PATCH "/subscriptions/$SUB" '{"next_billed_at":"2026-10-31T12:29:10Z","proration_billing_mode":"do_not_bill"}'`
   → 200. Ciclo resta mensile; periodo **11:54:09.853 → 12:29:10** (dalla prima
   PATCH alla data scelta); `next_billed_at` 12:29:10. Nessuna transazione.
   Prossimo addebito previsto: **35,38 €** per 31/10 12:29:10 → 30/11 12:29:10.
3. **Rinnovo**: fatturato alle 12:30:02 (52 s dopo `next_billed_at`),
   `subscription_recurring` di **35,38 €** (29 € + 6,38 € di IVA) con solo Base
   mensile. Periodo nuovo contiguo **31/10/2026 12:29:10 → 30/11/2026 12:29:10**
   (un mese), ciclo mensile, `next_billed_at` 30/11/2026; il successivo
   previsto è 35,38 € per 30/11 → 31/12.

Esito: **superato**. Anche annuale→mensile si fa alla data giusta con due PATCH,
prima gli articoli e poi la data; la seconda PATCH porta il periodo dalla prima
PATCH alla data scelta e il rinnovo addebita un mese intero. Come nell'altro
verso, fra le due PATCH l'abbonamento ha per un istante il periodo regalato (qui
un mese invece dell'anno pagato), e ognuna genera il suo `subscription.updated`.

⚠️ Non provato: un `next_billed_at` **più lontano di un mese** su un ciclo già
mensile. Nell'uso reale la data d'effetto è la fine dell'anno pagato e la
PATCH cade nelle 24 ore prima, quindi il caso non si presenta; se un giorno la
PATCH venisse anticipata, va provato prima.

### Ripristino di Base annuale

Subito dopo il rinnovo (12:30:48; il prossimo rinnovo era al 30/11, quindi
fuori dal blocco di 30 minuti), le stesse due PATCH all'inverso:

- articoli Base annuale `pri_01m577th8zt8x41cxk2p8m5n63`, `do_not_bill` → 200:
  ciclo annuale, periodo 12:30:48.601 → 31/10/2027 12:30:48.601;
- `{"next_billed_at":"2027-10-31T11:46:27Z","proration_billing_mode":"do_not_bill"}` → 200:
  periodo 12:30:48.601 → **31/10/2027 11:46:27**. Nessuna transazione.

## Stato finale di DA CARLOTTA

Alle 12:31 UTC del 31/10 l'abbonamento sandbox `sub_01m5fbkta79re52mncw1frpn0z`
è `active`, **Base annuale ×1, nessuna sede in più**, periodo 31/10/2026
12:30:48 → **31/10/2027 11:46:27**, prossimo addebito **353,80 €** il
31/10/2027 11:46:27 (per 31/10/2027 → 31/10/2028), nessun cambio programmato.
Nella giornata Paddle ha emesso cinque rinnovi sandbox oltre all'acquisto del
21/10 (353,80 €, 35,38 €, 353,80 €, 353,80 €, 35,38 €). L'anno fino al
31/10/2027 è quello pagato alle 11:47; il mese pagato alle 12:30 è stato
sostituito senza credito. Valgono le avvertenze di sopra su Team e sedi in più.

## Prova manuale end-to-end (dopo il rilascio)

Scritta il 31/10, **non ancora eseguita**. Da fare dopo le operazioni del
fondatore in `TASKS.md` («Cambio di piano al rinnovo»): migration applicate,
`billing-scheduled` e `billing-manage` pubblicate, `FOUNDER_ALERT_EMAIL`
impostata. Solo sandbox, sul progetto di soli test. Le chiamate a Paddle usano
`P` del paragrafo «Ambiente»; le query vanno nell'SQL editor del progetto.

### 0. Prima di cominciare

- **Avvisi delle PATCH del 31/10**: ✅ verificato il 31/10/2026 (§4: 17
  `applied` e 1 `stale` fra i `subscription.updated`, 5 `transaction.completed`
  `ignored`, nessun `rejected`). La query resta per le prove qui sotto:

  ```sql
  select event_type, outcome, count(*)
    from private.billing_events
   where environment = 'sandbox'
     and (payload #>> '{data,id}' = 'sub_01m5fbkta79re52mncw1frpn0z'
          or payload #>> '{data,subscription_id}' = 'sub_01m5fbkta79re52mncw1frpn0z')
     and occurred_at >= '2026-10-31T09:30:00Z'
   group by 1, 2 order by 1, 2;
  ```

  Atteso: i `subscription.*` tutti `applied`; le `transaction.*` `ignored`, come
  da M09a; nessun `rejected`. Con un `rejected` ci si ferma e si legge `error`:
  vuol dire che un cambio di ciclo produce un avviso che il webhook scarta.
  La stessa query, con l'abbonamento e l'ora d'inizio della prova, si ripete
  alla fine di ogni prova qui sotto.
- **Lavoro pianificato**:

  ```sql
  select jobname, schedule, active from cron.job where jobname = 'billing-scheduled-changes';
  select status, return_message, start_time from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'billing-scheduled-changes')
   order by start_time desc limit 5;
  ```

- **Azienda di prova**: un'azienda nuova con acquisto sandbox di **Team
  mensile + 1 sede in più**, carta 4242 4242 4242 4242, e **una sola sede
  aperta**. Non usare DA CARLOTTA: è su Base annuale per scelta del fondatore e
  le sue 2 sedi aperte bloccano ogni cambio (`billing_scheduled_venues`).
  `SUB=` va impostato al suo `provider_subscription_id`:

  ```sql
  select s.id, s.provider_subscription_id, s.status, s.plan, s.billing_interval,
         s.extra_venues, s.current_period_ends_at
    from public.billing_subscriptions s
    join public.workspaces w on w.id = s.workspace_id
   where s.environment = 'sandbox' and w.name = '<azienda>'
   order by s.created_at desc limit 1;
  ```

- **La riga del cambio**, da rileggere a ogni passo:

  ```sql
  select id, status, close_reason, target_plan, target_interval, target_extra_venues,
         effective_at, attempts, last_error_code, applied_at, confirmed_at,
         reminder_notified_at, reminder_emailed_at, alert_kind, alert_emailed_at, reviewed_at
    from public.billing_scheduled_changes
   where workspace_id = '<azienda id>'
   order by created_at desc limit 3;
  ```

### R. Avvicinare il rinnovo con un cambio aperto

La riga tiene la data del rinnovo letta alla richiesta. La Edge Function invia
solo se Paddle rinnova a quella data (±2 minuti), e l'avviso conferma solo un
rinnovo da quella data in poi. Per non aspettare giorni si spostano entrambe,
**in quest'ordine**:

1. Paddle (minimo 30 minuti da adesso):

   ```sh
   X=$(date -u -v+6H -v+30M +%Y-%m-%dT%H:%M:%SZ); echo "$X"   # l'anticipo cambia a ogni passo
   P PATCH "/subscriptions/$SUB" "{\"next_billed_at\":\"$X\",\"proration_billing_mode\":\"do_not_bill\"}"
   ```

2. Si aspetta l'avviso, cioè `current_period_ends_at` uguale a `X`, poi:

   ```sql
   update public.billing_scheduled_changes set effective_at = '<X>'
    where id = '<riga>' and status in ('pending', 'applied');
   ```

⚠️ Mai la riga prima di Paddle. Una riga dentro le 24 ore con Paddle ancora
alla data vecchia viene presa dal lavoro e fallisce, giustamente, con
`paddle_period_moved`.

### A. Riduzione: programma, promemoria, invio, rinnovo

1. **Programma.** Pagina Piano → «Cambia dal prossimo rinnovo»: Base, mensile,
   1 sede. Prima della conferma la pagina mostra la data del rinnovo e
   l'importo di Paddle IVA compresa (Base mensile: 35,38 €). Dopo la conferma:
   riga `pending`; nella card Abbonamento «Dal …» con «Annulla il cambio».
   - Un aumento ora è rifiutato («C'è già un cambio programmato…»).
   - Aprire una seconda sede è rifiutato (`workspace_venue_capacity_scheduled`:
     «Hai programmato meno sedi dal prossimo rinnovo…»), anche dall'app.
2. **Promemoria.** R con `X` a 6 giorni (`date -u -v+6d …`). Nell'SQL di R
   aggiungere `created_at = created_at - interval '7 days'`: il promemoria va
   solo ai cambi chiesti almeno 7 giorni prima. Entro 10 minuti:
   - notifica nell'app a ogni titolare, «Cambia l'abbonamento di …», senza prezzi;
   - email a chi ha chiesto il cambio, con piano, sedi, ciclo, importo e link
     alla pagina Piano;
   - `reminder_notified_at` e `reminder_emailed_at` pieni.
3. **Invio.** R con `X` a 6 ore e 30 minuti: dentro la finestra delle 24 ore,
   fuori dall'allarme delle 6. Entro 10 minuti:
   - riga `applied`;
   - su Paddle (`P GET "/subscriptions/$SUB?include=next_transaction"`) solo
     Base mensile, `next_billed_at` uguale a `X`, nessuna transazione nuova,
     prossimo addebito 35,38 €;
   - avviso `subscription.updated` `applied`, l'azienda in KlokShift su Base
     con 1 sede;
   - la pagina dice «Il cambio è già stato inviato per il rinnovo…» e non
     offre più «Annulla il cambio».
4. **Rinnovo.** R con `X` a 35 minuti (riga `applied`: il lavoro non la tocca
   più). Dopo il rinnovo:
   - transazione `subscription_recurring` di 35,38 €;
   - riga `confirmed` con `confirmed_at`;
   - nella pagina, nessun cambio in attesa.

### B. Annulla e limite delle 24 ore

1. Programmare un cambio, per esempio Base annuale, poi «Annulla il cambio»:
   riga `canceled` con `close_reason = 'owner'`, la pagina torna al modulo e
   un aumento torna possibile.
2. Senza cambi aperti, spostare su Paddle `next_billed_at` a 2 ore (solo il
   passo 1 di R) e provare a programmare. Atteso «Mancano meno di 24 ore al
   rinnovo: per cambiare adesso scrivi a info@klokshift.com.»
3. Rimettere `next_billed_at` a un mese da adesso.

### C. Pausa con un cambio in attesa

1. Programmare Base annuale e poi «Metti in pausa»: la conferma dice «Il cambio
   programmato dal … verrà annullato.»
2. Confermare. Dopo l'avviso della pausa programmata la riga è `canceled` con
   `close_reason = 'paused'`.
3. «Annulla la pausa»: l'abbonamento torna `active` senza cambi in attesa, e
   la riga annullata non si riapre.

### D. Allarme: invio mancato, email al fondatore e «Riprova adesso»

Simulato con una chiave Paddle sbagliata, non con la Edge Function spenta:
l'email d'allarme la spedisce proprio `billing-scheduled`. A funzione spenta
l'allarme arriva lo stesso come push al fondatore (`billing_admin_alert`, dal
database con la Edge Function `push`) e nel pannello. Fa anche il cambio di
ciclo mensile→annuale in due PATCH. Per la push serve l'app sul telefono,
entrata con l'account del fondatore e con le notifiche attive.

⚠️ `PADDLE_API_KEY` è condivisa da `billing-checkout`, `billing-manage` e
`billing-scheduled`. Prima di cambiarla, tenere a portata la chiave giusta
(dashboard Paddle sandbox → Developer tools → Authentication); fino al
ripristino la pagina Piano non funziona.

1. Programmare Base annuale (importo 353,80 €).
2. `supabase secrets set PADDLE_API_KEY=pdl_sdbx_apikey_sbagliata --project-ref rmlobxjlqlpixkvrzmfg`.
3. R con `X` a 5 ore e 45 minuti. La PATCH di R usa la chiave locale di
   `.env.paddle-sandbox.local`, che resta giusta. Entro 10 minuti:
   - `alert_kind = 'not_sent'`, `last_error_code = 'paddle_unavailable'`,
     `attempts` > 0, riga ancora `pending`;
   - email a info@klokshift.com, arrivata nella casella inoltrata da ImprovMX,
     con `alert_emailed_at` pieno;
   - push sul telefono del fondatore, «Cambio di piano da controllare:
     {azienda}», e nelle notifiche della dashboard (apre la scheda azienda);
   - Panoramica del fondatore, «Cambi di piano da verificare», con la riga e
     «Riprova adesso».
4. Rimettere la chiave giusta con `supabase secrets set PADDLE_API_KEY=…`, poi
   «Riprova adesso». Entro un minuto:
   - riga `applied`;
   - su Paddle ciclo annuale, `next_billed_at` uguale a `X` (±2 minuti) e
     nessuna transazione nuova;
   - due `subscription.updated` `applied`, gli articoli e poi la data;
   - nessun `date_not_fixed`.
5. Un ritentativo a meno di 6 ore dal rinnovo riaccende subito `not_sent` (e
   la sua push), ma se il cambio diventa `applied` prima che l'email parta
   l'allarme si spegne da sé: niente seconda email. Se la riga resta da
   verificare, chiuderla con «Segna come verificato» e una nota: sparisce dalla
   Panoramica e resta nella scheda azienda con «Verificato il …».
6. **Rinnovo.** R con `X` a 35 minuti. Atteso 353,80 € per un anno, riga
   `confirmed`.

Per vedere `renewal_mismatch`, facoltativo: ripetere 1–3 senza rimettere la
chiave e lasciar arrivare il rinnovo. Paddle rinnova col piano attuale, la
riga diventa `failed` / `renewal_mismatch`, parte un'altra email con la sua
push e «Riprova adesso» non c'è più.

`renewal_overdue` non si prova a mano: servirebbe un rinnovo che non arriva.
Lo coprono i test SQL (`rls/145`): due ore dopo la data d'effetto un cambio
ancora aperto si chiude con l'allarme, senza avvisare il titolare.

### Esito

Da annotare qui sotto, con data, ambiente, azienda e abbonamento: per ogni
prova l'esito, gli importi visti, le email arrivate e la query degli avvisi.
