# Turni in bozza e pubblicazione — design

Data: 2026-10-31 · Stato: in approvazione

## Perché

Quando il titolare prepara il mese, il dipendente riceve una notifica (e una
push) per **ogni** assegnazione: 20 e più in pochi minuti. In più vede il mese
mentre è ancora a metà e può confermare turni che il titolare sposterà subito
dopo. I competitor (Deputy, 7shifts, Sling, When I Work, Agendrix, Zoho Shifts)
risolvono con lo stesso schema: i turni nuovi sono una **bozza** invisibile al
team finché chi gestisce non preme **Pubblica**, e la pubblicazione manda
**una** notifica a persona.

Successo: il titolare costruisce un mese intero senza che parta niente; preme
Pubblica; ogni persona riceve un solo avviso e conferma tutto in un tocco.

## Obiettivi

1. Un turno nuovo nasce in bozza; la bozza è invisibile a chi non gestisce e
   non produce notifiche, promemoria, timbrature né ore.
2. «Pubblica» rende visibili le bozze del periodo che si sta guardando e manda
   **una** notifica per persona (o nessuna, a scelta).
3. Dopo la pubblicazione ogni modifica vale **subito**, come oggi.
4. Le bozze dimenticate non passano inosservate.
5. «Conferma tutti» per il dipendente.

## Non obiettivi

- **Modifiche in bozza sui turni già pubblicati** (la versione vecchia resta
  visibile finché non si ripubblica): scartata dall'utente, richiederebbe due
  versioni di ogni turno.
- Raggruppare le notifiche delle modifiche successive alla pubblicazione.
- Un interruttore per sede/azienda che spenga le bozze.
- Pubblicazione programmata, «ritira la pubblicazione».

## Anti-obiettivi (fallimento anche se «funziona»)

- Un dipendente che non si presenta perché il turno è rimasto in bozza senza
  che nessuno se ne accorgesse.
- Una bozza che filtra al dipendente da **una** strada qualsiasi: notifica,
  push, planning dei colleghi, storico ore, timbratura, promemoria, assenze,
  export, conteggi della Home.
- L'interfaccia che promette «verrà avvisato» su una bozza, o tace su un turno
  pubblicato che invece avvisa (la divergenza che `moveImpact.ts` ha chiuso).
- Ore contate su un turno che nessuno ha mai visto.

## Approcci considerati

| | Cosa | Pro | Contro |
|---|---|---|---|
| **A — scelto** | `shifts.published_at` (null = bozza) sul turno esistente | Un solo modello di turno: form, trascinamento, Duplica, modelli, ore restano com'erano | Ogni funzione DEFINER che legge i turni va rivista una per una |
| B | Tabella separata delle bozze, copiata in `shifts` alla pubblicazione | Il dipendente non le vede per costruzione | Raddoppia form, drag, modelli, sovrapposizioni; l'id del turno cambia alla pubblicazione |
| C | Bozza sulla singola assegnazione | Permetterebbe aggiunte in bozza su turni pubblicati | Serve solo al non-obiettivo scartato; complica senza dare niente |

Scelto **A** dall'utente: il rischio è circoscritto a un elenco finito di
funzioni, coperto da test SQL.

## Comportamento deciso con l'utente

### Bozza

- Nascono **in bozza**: i turni creati dal planning (app e dashboard), dal
  trascinamento che crea, da «Duplica settimana/mese», dai modelli e dal form
  con **«Salva in bozza»**.
- Il form del nuovo turno ha due pulsanti: **«Salva in bozza»** e **«Salva e
  pubblica»**. Il secondo pubblica subito i turni appena creati, con la stessa
  notifica unica per persona della pubblicazione, anche se il turno è ripetuto
  su più giorni.
- Una bozza **non** è visibile a chi non gestisce: niente agenda, planning dei
  colleghi, dettaglio, conteggi; niente notifiche (assegnato, modificato,
  annullato, tolto, conferma richiesta), niente promemoria di timbratura,
  niente timbratura.
- Sul calendario di chi gestisce la bozza ha un aspetto distinto (tratteggiata
  con etichetta «Bozza»: proposta, da rifinire in UI).

### Pubblicazione

- **Cosa pubblica**: le bozze del **periodo visualizzato** (app: la settimana;
  dashboard: la settimana o il mese aperto), su **tutte le sedi** dove chi
  pubblica ha «Turni».
- **Prima di confermare** si vede: quanti turni, quante persone vengono
  avvisate, e una riga «ci sono altre N bozze fuori da questo periodo» se ce ne
  sono.
- **Scelta**: «Pubblica e avvisa» oppure «Pubblica senza avvisi». («Solo chi ha
  modifiche» coincide con «chi ha turni nuovi», perché le modifiche ai turni già
  pubblicati partono subito.)
- **Una notifica per persona** per pubblicazione, anche se ha turni in più sedi
  della stessa azienda: es. «Sono usciti i tuoi turni: 22 turni dal 1 al 30
  novembre» (testo finale con il glossario), con «Conferma la presenza.» se
  almeno uno chiede conferma. Apre l'agenda.
- **Dopo**: ogni modifica a un turno pubblicato vale subito e avvisa come oggi.

### Bozze dimenticate

- Un avviso fisso in Home (gestione) e sul calendario: «12 turni in bozza
  (dicembre)» che porta al periodo.
- La riga nella conferma di pubblicazione (sopra).
- Un **promemoria a chi ha «Turni»** sulla sede quando una bozza inizia entro
  24 ore: «Hai 3 turni di domani non ancora pubblicati». Uno solo per turno.

### Conferma tutti

Nell'agenda del dipendente, **«Conferma tutti»** conferma in un tocco i turni
futuri che aspettano una risposta e che lui vede. Il rifiuto resta sul singolo
turno.

## Scelte mie (dichiarate all'utente, da confermare leggendo)

- Le bozze valgono sempre, senza interruttore: chi vuole subito ha «Salva e
  pubblica».
- Pubblica chi ha «Turni» su quella sede (anche un collaboratore). Le bozze le
  **vede** chiunque gestisca la sede (permesso derivato `roster`).
- Alla migration **tutti i turni esistenti diventano pubblicati**.
- «Turno già fatto» (`record_past_shift`), il fuori turno
  (`materialize_unplanned_clock`) e il sostituto (`add_shift_worker`) nascono o
  restano **pubblicati**: sono il passato.
- `move_assignment` che fa nascere il **gemello**: il gemello eredita lo stato
  del turno di partenza (pubblicato → pubblicato e avvisa; bozza → bozza).
- Spostare una persona da un turno pubblicato a una bozza: dal turno di
  partenza esce subito (e riceve la revoca come oggi), nella bozza entra in
  silenzio; `moveImpact.ts` lo dice.
- Un titolare/collaboratore **in turno**, nella vista lavoro, non vede le
  proprie bozze in agenda: si comporta come un dipendente (le vede in gestione).
- La notifica di pubblicazione salta chi pubblica (regola già di
  `private.notify`).
- Annullare una bozza non ha senso: per una bozza l'azione è **Elimina**.
- Il promemoria delle bozze va nella categoria notifiche `shifts`.
- L'export dei dati completo (GDPR, `export_workspace_data`) include le bozze
  con il loro stato; export ore e riepiloghi le escludono.
- La checklist «Primi passi» resta com'è (il primo turno si spunta anche in
  bozza).
- Una bozza **iniziata ma non finita** si può ancora pubblicare (avvisa come
  le altre); il limite è la fine del turno.
- Dopo la pubblicazione, mettere o togliere persone su un turno pubblicato
  avvisa subito, anche dal trascinamento: è la conseguenza diretta di «subito».
- Per chi gestisce, i conteggi (Home, ore da contratto nel planning, copertura)
  includono le bozze, distinguibili; per il dipendente no.

## Il modello (A)

- `shifts.published_at timestamptz` (null = bozza) e `shifts.published_by
  uuid`. Backfill: `published_at = created_at` per tutti gli esistenti.
- **Il default è «pubblicato»** (`published_at default now()`), e la bozza va
  chiesta esplicitamente (`create_shifts`: chiave `"draft": true` nel piano).
  Motivo: le versioni dell'app già installate chiamano `create_shifts` senza
  sapere delle bozze. Con il default a bozza creerebbero turni invisibili senza
  un pulsante per pubblicarli, cioè proprio l'anti-obiettivo del dipendente che
  non si presenta. Il caso peggiore del default a «pubblicato» è invece una
  notifica in più. Lo stesso vale per `tests.create_shifts` e per le altre
  strade che inseriscono turni.
- **Visibilità**: una policy **restrittiva** su `shifts`,
  `shift_assignments`, `shift_role_requirements` (e `shift_change_requests`
  per coerenza): passa se il turno è pubblicato **oppure** la sede è in
  `venues_where('roster')`. È lo stesso schema delle policy «commercial archive
  read» (20261005000500), già restrittive. Le tabelle figlie non fanno
  subquery su `shifts`: serve un helper DEFINER (es. `private.draft_shift_ids()`)
  o uno stato denormalizzato, a scelta del builder.
- **Funzioni DEFINER**: scavalcano la RLS, quindi ognuna va passata. Elenco
  ricavato dal banco locale (funzioni che citano `public.shifts`,
  `shift_assignments` o `my_work_history`), da ricontrollare nel piano:
  - **lato dipendente, devono escludere le bozze**: `get_staff_planning`,
    `my_work_history` e `get_my_work_history_page/_range/_totals`,
    `get_my_work_totals`, `clock_punch` (rifiuta: codice nuovo, es.
    `shift_draft`), `queue_clock_reminders`, `respond_assignment`,
    `request_shift_change`, `absence_credit_conflict`,
    `private.notification_person`;
  - **ore e riepiloghi**: `get_hours_summary`, `get_workspace_hours_summary`,
    `get_hours_to_fix`, `get_member_performance`, `get_member_worked_shifts`,
    `effective_assignment_hours`, `definitive_manual_hours`,
    `approve_regular_clock_records`, `auto_approve_clock` — una bozza non
    produce ore (vedi «Bozza scaduta» sotto); ⚠️ `get_hours_to_fix` è il
    complemento esatto di `shifts_count` (test 037): cambiano insieme;
  - **trigger di notifica**: `notify_on_assignment`, `_removed`, `_declined`,
    `_reconfirmed`, `notify_on_shift_change` — tacciono se il turno è una
    bozza; `default_assignment_confirmation` resta com'è;
  - **scritture** (`create_shifts`, `update_shift`, `move_assignment`,
    `reassign`, `assign_one`, `unassign`, `set_shift_status`, `delete_shift`,
    `record_past_shift`, `add_shift_worker`, `materialize_unplanned_clock`):
    impostano o ereditano lo stato come sopra;
  - **resto** (`commercial_readable_shift_ids`, `workspace_data_inventory`,
    `export_workspace_data`, `delete_account`, `admin_*`): verificare, di norma
    invariati.
- **Nuove RPC**:
  - anteprima della pubblicazione (periodo + sedi → turni, persone avvisate,
    bozze fuori periodo), calcolata dal server per non promettere avvisi
    sbagliati;
  - `publish_shifts` (periodo, sedi opzionali, avvisa sì/no): richiede
    «Turni» su ogni sede toccata e azienda operativa
    (`assert_workspace_operational`); atomica; idempotente su doppio tocco;
    una notifica per persona;
  - «Salva e pubblica» = creazione + pubblicazione degli id appena creati, in
    una transazione;
  - «Conferma tutti» per il dipendente: riceve gli id che ha visto, conferma
    solo quelli suoi, pubblicati, futuri e in attesa.
- **Notifiche**: tipo nuovo per la pubblicazione (es. `shifts_published`,
  `related_id` nullo → agenda) e per il promemoria delle bozze (→ planning di
  quel giorno, gestione). `routeForNotification` totale sui tipi nuovi.
  Promemoria con pg_cron e tabella anti-doppioni, come
  `private.clock_reminders`.
- **Gemelli manuali**: `moveImpact.ts` e `notify.ts` imparano la bozza (nessun
  avviso, frase dedicata); vanno aggiornati con i trigger, nella stessa
  modifica.
- **Client**: app (tab Turni gestione, form nuovo turno, Home, agenda
  dipendente) e dashboard (`Planning.tsx`, `ShiftPanel.tsx`, `PeopleWeek.tsx`,
  Home): aspetto bozza, pulsante Pubblica con dialogo, avviso bozze, «Salva in
  bozza / Salva e pubblica», «Conferma tutti». Le frasi in un modulo condiviso
  (es. `src/features/shifts/publish.ts`), come `recorded.ts`.
- **Copy e aiuto**: tutorial dei turni, carosello (`introContent.ts`),
  `Aiuto.tsx`, eventuale FAQ del sito; glossario rispettato
  (`glossary.test.ts`). `AGENTS.md`: nuova sezione «Bozza e pubblicazione».

## Test richiesti

- Test SQL nuovo (`supabase/tests/rls/0xx`): per **ogni** strada elencata
  sopra, una bozza non si vede/non notifica/non conta per il dipendente, e si
  vede per chi gestisce; pubblicazione = una notifica per persona; senza
  avvisi = zero; permessi (senza «Turni» rifiuta, sede fuori ambito esclusa);
  gemello eredita; doppia pubblicazione non duplica; promemoria uno solo.
- Un piano `create_shifts` senza la chiave `draft` nasce pubblicato e avvisa
  come oggi: è il percorso delle app già installate.
- Unit test per `moveImpact`/`notify` sulla bozza e per il modulo delle frasi.
- Suite esistenti verdi (in particolare 037 ore da sistemare, 041 promemoria).

## Lasciato al builder

Nomi esatti di colonne/RPC/tipi, forma delle policy (helper vs
denormalizzazione), layout di pulsante e dialogo, testi finali nel rispetto del
glossario, ordine delle migration.

### Bozza scaduta (deciso con l'utente)

Una bozza mai pubblicata il cui orario è finito resta lì, segnata **«Mai
pubblicato»**, non conta ore e non si può più pubblicare. Chi gestisce ha due
azioni:

- **Elimina**;
- **Registra come fatto** (serve «Ore», come `record_past_shift`): il turno
  diventa pubblicato con `recorded_at`/`recorded_by`, le persone risultano
  presenti (`confirmed`) con le ore del turno (`manual_auto`), nessuna
  notifica. Le frasi riusano `src/features/shifts/recorded.ts`.

Le bozze scadute compaiono nell'avviso delle bozze dimenticate (Home e
calendario), non in «Ore da sistemare»: non sono ore mancanti ma un turno mai
uscito.
