# Export giorno per giorno per il consulente — design

> 2026-11-03. Punto 1 di 4 di «Export ore per il consulente» in `TASKS.md`
> (poi: matricola e causali, maggiorazioni, tracciato Zucchetti/TeamSystem).

## Perché

Oggi la pagina Ore esporta i **totali del mese per persona** (CSV mensile, CSV
assenze, PDF). Il consulente del lavoro ragiona invece **per giorno e per
causale**, ed è così che fanno i concorrenti più vicini a noi:

- **Fluida** (italiana, pensata per il consulente) ha un CSV piatto con una riga
  per persona, giorno e causale, e un Excel «da leggere» con il dettaglio per
  giorno e i totali del mese per causale;
- **Deputy** ha un CSV con una riga per turno: data, inizio, fine, pausa, ore;
- il **foglio presenze** classico italiano mette le persone in riga e i giorni
  1–31 in colonna, con le ore o un codice nella casella.

Il fondatore non sa come lavora il consulente dei suoi clienti e vuole «un
risultato come lo fanno i competitor»: si coprono tutte e due le letture, chi
importa e chi legge.

## Obiettivi

1. **CSV giornaliero** nella pagina Ore, app e dashboard: un elenco piatto da
   filtrare in Excel o da importare.
2. **Cartellino** come pagina in più del PDF «Stampa» che esiste già: la griglia
   persone × giorni, da leggere.
3. Stesso periodo e stesse persone scelte che valgono per la pagina e per gli
   altri export («quello che vedi è quello che esporti», `reportPeriod.ts`).

## Non obiettivi

- Matricola del dipendente e codici causale del gestionale: punto 2. Il file
  deve però poterli accogliere come colonne in più, senza essere rifatto.
- Maggiorazioni (notturno, straordinario, festivo): punto 3.
- Un tracciato per uno specifico software paghe: punto 4.
- Importi in euro, saldo ferie, calcolo delle ore contrattuali.

## Anti-obiettivi (sarebbe un fallimento anche se funziona)

- **I totali non tornano**: per ogni persona, la somma delle ore «Lavoro» del
  giornaliero deve essere **identica** a «Ore lavorate effettive» del CSV
  mensile, e la somma delle ore di ferie, permesso e malattia identica alle
  rispettive colonne del mensile. Due file dello stesso mese che danno numeri
  diversi fanno perdere la fiducia del consulente.
- Un giorno lavorato che **sparisce in silenzio** perché le ore non contano
  ancora.
- Un'assenza contata **due volte** con il lavoro dello stesso giorno.
- Una persona o una sede che chi esporta non ha il permesso di vedere.

## Strade considerate

| | Cosa | Pro | Contro |
|---|---|---|---|
| A | Solo l'elenco CSV | Si importa e si filtra; pronto per matricola e causali | A colpo d'occhio si legge male |
| B | Solo il cartellino | Il consulente lo legge subito | Non si importa; niente entrata e uscita |
| **C** | **Tutti e due** (scelta) | Copre chi importa e chi legge, come Fluida | Più lavoro, quasi solo nella griglia |

Scelta **C** dal fondatore, il 03/11, dopo aver visto le due forme con dati di
esempio.

## Cosa si costruisce

### Una sola fonte: le righe del giorno

Una nuova RPC del database (nome lasciato a chi costruisce, per esempio
`get_workspace_hours_daily(p_workspace, p_from, p_to)`) restituisce **righe
giornaliere** nello stesso perimetro di `get_workspace_hours_summary` e
`get_workspace_absence_summary`:

- stesso controllo dei permessi («Ore», `private.venues_where('hours')`),
  stesse aziende leggibili (`commercial_readable_workspace_ids`), stesso
  intervallo `[p_from, p_to)`;
- **niente bozze** (`published_at is not null`), niente turni annullati, solo
  turni **finiti**, niente `declined`/`no_show`: le stesse esclusioni del
  riepilogo (vedi la regola sulle bozze in `AGENTS.md`);
- ⚠️ la regola di **cosa conta** è quella di `get_workspace_hours_summary` (le
  colonne `approved_hours`, `paid_break_hours`, `unpaid_break_hours`). La
  migration deve dire nell'intestazione che le due funzioni sono **gemelle**, e
  un test SQL deve verificare che, per ogni persona, la somma delle righe
  giornaliere sia uguale al riepilogo (come fa il test 037 fra «Ore da
  sistemare» e `shifts_count`).

Tipi di riga:

1. **Lavoro**: una riga per **turno** (assegnazione), non per giorno. Con due
   turni nello stesso giorno, entrata e uscita non si possono unire.
   Colonne: data, persona, sede, turno, entrata, uscita, pausa, ore.
   - Entrata e uscita: quelle della timbratura approvata (corretta se c'è una
     correzione); senza timbratura, l'orario del turno.
   - Pausa: la stessa che usa il riepilogo per quella riga (timbrata se
     approvata, altrimenti quella pianificata), in minuti, e se è retribuita o no.
   - Ore: quelle che il riepilogo conta per quella riga.
2. **Da verificare** (decisione del fondatore, 03/11): un turno finito le cui
   ore **non contano ancora** (non ha timbrato, uscita mancante, timbratura da
   approvare, sovrapposizione) **compare** con la causale «Da verificare» e le
   **ore vuote**, con entrata e uscita se ci sono. È lo stesso insieme di
   `get_hours_to_fix` sullo stesso periodo; il motivo si può dire in una
   colonna di nota con le frasi già usate in «Ore da sistemare». Non entra in
   nessun totale.
3. **Assenza**: una riga per persona, **giorno** e causale (Ferie, Permesso,
   Malattia) per ogni assenza **approvata** del periodo, tagliata sul periodo.
   - Ore: il credito del giorno (`absence_hour_credits`) o le ore del permesso
     orario. Senza ore indicate, ore **vuote**: il giorno compare comunque.
   - Un credito in **conflitto** con lavoro approvato lo stesso giorno
     (`private.absence_credit_conflict`) esce con le ore vuote e una nota «Da
     verificare: lavoro lo stesso giorno», ed è escluso dai totali come nel
     riepilogo.
   - La malattia non porta mai la nota: solo la causale (regola GDPR del
     progetto). Il riferimento del certificato resta nel CSV assenze.

Il dato non contiene importi, né maggiorazioni, né la classificazione
ordinario/straordinario.

### Correzione: il permesso a ore va in conflitto solo se si sovrappone

Decisione del fondatore, 03/11 («falla già adesso»). Oggi
`private.absence_credit_conflict(member, data)` segna in conflitto **qualsiasi**
credito di un giorno in cui la persona ha lavoro approvato. Per il permesso a
ore è sbagliato: «lavora 9–15, permesso 15–17» finisce «Da verificare» e fuori
dai totali, mentre è il caso normale.

- **Permesso a ore** (`staff_absences.start_time`/`end_time` non nulli): in
  conflitto solo se il suo intervallo **si sovrappone** a un intervallo di
  lavoro approvato della persona. Il lavoro è l'intervallo della timbratura
  approvata (entrata–uscita), altrimenti quello del turno (con il notturno che
  finisce il giorno dopo). Si toccano i bordi senza sovrapporsi (15:00–15:00):
  nessun conflitto.
- **Crediti a giornata** (ferie, malattia, permesso a giornata con le ore del
  giorno in `absence_hour_credits`): regola invariata, il lavoro nello stesso
  giorno resta un conflitto.
- La regola corretta è la stessa che l'app usa già per dire se un turno cade
  in un'assenza (`shiftOverlapsAbsence` in `src/features/absences/conflicts.ts`,
  istanti e non date): il commento della migration lo dice, sono gemelli.
- Cambia **ovunque** la regola sia usata, non solo nel giornaliero: CSV mensile,
  pagina Ore, conteggio dei conflitti. Chi costruisce elenca i chiamanti nella
  migration.
- Test SQL: permesso prima/dopo il turno (non conta come conflitto e entra nei
  totali), permesso che si sovrappone (conflitto), bordi che si toccano, turno
  notturno, ferie con lavoro lo stesso giorno (resta conflitto).

### CSV giornaliero

- Pulsante **«CSV giornaliero»** nella pagina Ore, accanto a «CSV mensile» e
  «CSV assenze», nell'app (`src/app/(manager)/ore.tsx` → `src/lib/export.ts`)
  e sulla dashboard (`web/src/pages/Ore.tsx`).
- Costruito da una funzione **pura** in `src/lib/exportBuilders.ts`, condivisa
  da app e dashboard come gli altri export.
- Stesse convenzioni degli altri CSV: `;`, decimali con la virgola, BOM UTF-8,
  `\r\n`, testo protetto dalle formule, date `gg/mm/aaaa`, orari `hh:mm`.
- Colonne, in quest'ordine: Data · Persona · Sede · Turno · Causale · Entrata ·
  Uscita · Pausa (min) · Pausa retribuita · Ore · Note. Ordinate per persona,
  poi per data, poi per entrata.
- Causali, a parole: «Lavoro», «Ferie», «Permesso», «Malattia», «Da verificare».
  Nel punto 2 arriveranno le colonne del codice; i nomi a parole restano.
- Nome del file sulla stessa forma degli altri (`hoursFileName` /
  `absencesFileName`), con «giornaliero» nel nome.
- Si filtra per le persone scelte nella pagina, come gli altri export.

### Cartellino nel PDF «Stampa»

Una pagina in più in `buildHoursHtml`, dopo le tabelle che ci sono già:

- persone in riga (nome; sotto, la sede, oppure «N sedi»), giorni in colonna
  con l'iniziale del giorno della settimana e il numero;
- nella casella: la **somma delle ore Lavoro del giorno**; **F**, **P**, **M**
  per le assenze (con le ore sotto, se ci sono); **P** accanto alle ore se nello
  stesso giorno c'è lavoro e un permesso a ore che non si sovrappone; un segno per «Da verificare» (per
  esempio «?») che **non** entra nella somma;
- a destra, i totali del periodo per causale: Lavoro, Ferie, Permessi,
  Malattia (in ore; la malattia senza ore in giorni). Gli stessi numeri del
  mensile;
- legenda sotto la griglia;
- **una griglia per mese di calendario**: con un periodo a cavallo di due mesi
  (o fino a 366 giorni) si fanno più griglie una dopo l'altra, mai una con 60
  colonne;
- con molte persone la griglia continua sulla pagina dopo, ripetendo
  l'intestazione; A4 orizzontale come il resto del PDF.

Il riferimento visivo è il mockup del brainstorming (elenco e cartellino con
tre persone in tre sedi, novembre 2026).

## Vincoli

- Le scritture non c'entrano: è solo lettura, da una RPC `SECURITY DEFINER`
  con `search_path ''`, come le altre letture delle ore. `anon` non esegue niente
  (`supabase/tests/rls/050_surface.sql`).
- Tipi DB rigenerati con `supabase/tests/gen-types.sh`, mai a mano.
- Glossario (`docs/GLOSSARIO.md`, `tests/unit/glossary.test.ts`): «sede»,
  «team», «dipendente»; niente «organico», «staff», «locale» nei testi.
- Migration nuova, mai toccare una migration già applicata.
- Lo stesso builder per app e dashboard: i file devono coincidere.

## Decisioni prese da me (da verificare leggendo)

- **Una riga per turno**, non per giorno, per il Lavoro; il cartellino invece
  somma per giorno.
- **Nel cartellino non si segnano i festivi**: nel progetto non esiste un
  calendario dei festivi, e l'app si usa anche fuori dall'Italia. In grigio solo
  sabati e domeniche. I festivi arriveranno con le maggiorazioni (punto 3).
- I **giorni di chiusura della sede** non si segnano nel cartellino: una persona
  può lavorare in più sedi e la riga è della persona.
- La riga «Da verificare» porta il **motivo** in «Note».
- **Ore al centesimo** (due decimali) nel giornaliero **e nel mensile**, che
  oggi arrotonda a un decimale. Ogni riga si arrotonda al centesimo **in SQL**,
  nel giornaliero e nel riepilogo, così la somma delle righe che il consulente
  fa in Excel è esattamente il totale del mensile (una timbratura corretta cade
  su minuti qualsiasi: 7,78 h × 3 darebbe 23,3 nel mensile e 23,4 in Excel).
  Centesimi e non `hh:mm` perché è la forma dei tracciati paghe italiani.
- **«Note» contiene solo frasi di KlokShift**, mai la nota scritta dal
  dipendente o da chi gestisce sull'assenza (può dire «visita medica»). Vale
  anche per la malattia: la nota di sistema del conflitto sì, nessun testo
  libero.
- La nota di un credito in conflitto dice solo **«Da verificare»**, senza «lavoro
  lo stesso giorno»: il lavoro può essere in una sede che chi esporta non vede,
  e la frase lo rivelerebbe.
- **Totali del cartellino**: quelli di ogni griglia sono **del suo mese**; il
  totale dell'intero periodo è la tabella che il PDF ha già in cima, uguale al
  mensile. Ferie e permessi in **ore riconosciute** come nel mensile; i giorni
  senza ore si vedono nella griglia (F o P senza numero) e si contano a parte
  («2 gg senza ore»).
- Le righe giornaliere si scaricano **quando si preme** il pulsante (o si
  stampa), non all'apertura della pagina: la pagina continua a usare i
  riepiloghi che ha già.

## Lasciato a chi costruisce

- Nome e firma esatta della RPC, e se le assenze escono dalla stessa RPC o da
  una seconda.
- Come si riusa la logica di conteggio del riepilogo nella nuova funzione
  (estrarre un pezzo comune in `private` oppure tenerla gemella con il test di
  uguaglianza).
- Il disegno della griglia (dimensioni, colori, segno per «Da verificare»)
  dentro lo stile del PDF attuale.
- Gestione del caricamento e degli errori del pulsante, sullo stile dei
  pulsanti già presenti.

## Prove

- **SQL**: per ogni persona, somma giornaliera = riepilogo (lavoro, ferie,
  permessi, malattia, pause); bozze, annullati, futuri e `declined` esclusi;
  le righe «Da verificare» coincidono con `get_hours_to_fix`; un collaboratore
  senza «Ore» su una sede non vede le sue righe; credito in conflitto escluso.
- **Unit** (vitest) sui builder: colonne e ordine, decimali, protezione dalle
  formule, filtro per persone, griglia divisa per mese, somma del giorno con
  due turni, «Da verificare» fuori dai totali.
- **Prova a mano**: scaricare i tre CSV e il PDF dello stesso mese su app e
  dashboard e confrontare i totali.
