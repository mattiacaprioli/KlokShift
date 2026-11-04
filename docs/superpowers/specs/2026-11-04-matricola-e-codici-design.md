# Matricola e codici per il consulente — design

> 2026-11-04. Punto 2 di 4 di «Export ore per il consulente» in `TASKS.md`
> (il punto 1, export giornaliero, è in `2026-11-03-export-giornaliero-design.md`).

## Perché

Il consulente importa le ore nel suo programma paghe, dove ogni dipendente ha
una **matricola** e ogni voce (lavoro ordinario, ferie, malattia…) un **codice**.
Oggi i nostri CSV hanno solo il nome della persona e le causali a parole: il
consulente deve ricodificare tutto a mano, e due omonimi si confondono.

I concorrenti fanno così, ed è il riferimento scelto dal fondatore («un risultato
più vicino possibile ai competitor»):

- **Fluida**: «ID esterno» sulla scheda di ogni utente (codice dipendente), un
  «ID esterno» per ogni giustificativo e il codice azienda nelle impostazioni; il
  CSV porta codice azienda, codice dipendente e causale in ogni riga;
- **Planday**: «Salary identifier» nella scheda del dipendente, codici per le ore
  normali, le assenze e le maggiorazioni nelle impostazioni;
- **Factorial**: «configura i codici Zucchetti per l'azienda e per i dipendenti».

In tutti i casi i codici li scrive **chi gestisce**, copiandoli da quel che gli dà
il consulente. Nessuno dà al consulente un accesso suo.

## Strade considerate

| | Cosa | Pro | Contro |
|---|---|---|---|
| **1** | **Matricola sulla scheda + codici dell'azienda scelti da lei** (scelta) | Come Fluida e Planday; pronto per i codici delle maggiorazioni | Un campo e una sezione in più da compilare |
| 2 | Matricola + codici causale fissi decisi da noi | Più semplice | Ogni programma paghe ha i suoi codici: il consulente ricodifica comunque |
| 3 | Strada 1 + accesso per il consulente | Il consulente li scrive da sé | Ruolo nuovo, permessi, inviti; nessun concorrente lo fa in modo chiaro |

Scelta **1** dal fondatore, il 04/11.

## Obiettivi

1. **Matricola** sulla scheda della persona (app e dashboard).
2. **Codici per il consulente** dell'azienda: codice azienda e un codice per
   ciascuna causale (Lavoro, Ferie, Permesso, Malattia).
3. I codici nei file: CSV giornaliero, CSV mensile, export completo.
4. Un avviso, mai un blocco, quando mancano.

## Non obiettivi

- Codici delle maggiorazioni: arrivano col punto 3, nella stessa sezione.
- Tracciati di uno specifico programma paghe: punto 4.
- Un accesso per il consulente.
- Un codice per sede: il consulente è uno per azienda.

## Anti-obiettivi

- Un export che **non parte** perché manca un codice (Fluida lo fa: per chi
  inizia è un muro).
- Una matricola visibile ai colleghi.
- Due persone della stessa azienda con la **stessa matricola**: nel programma
  paghe sarebbero la stessa persona.
- Cambiare la firma delle RPC esistenti che le app già installate chiamano
  (`get_workspace_hours_summary`, `get_workspace_hours_daily`,
  `get_workspace_absence_summary`): l'app non è sugli store ma la dashboard e
  le build interne sì, e la regola del progetto è aggiungere, non rompere.

## Cosa si costruisce

### 1. La matricola

- Colonna nuova in `public.member_hr` (la tabella riservata dei dati di
  contratto: la leggono la persona stessa e chi ha «Team» sulla persona,
  policy `member_hr: staff managers and self read`). Nome lasciato a chi
  costruisce (`matricola` va bene).
- Si scrive con `update_member`, chiave nuova nel `p_patch` accanto a `note`,
  `contract_hours`, `contract_period`, con le **stesse regole** (permesso
  «Team» sulla persona, il non titolare non modifica i propri dati di
  contratto: `is_restricted_self`).
- Testo libero corto (es. fino a 30 caratteri), spazi in testa e in coda tolti,
  vuoto = nessuna matricola.
- **Unica dentro l'azienda** (confronto senza maiuscole/minuscole e senza spazi
  ai lati). Una matricola già usata: errore `matricola_taken`, tradotto in
  `src/lib/errors.ts` con il nome di chi la usa se chi scrive può vederlo
  («Matricola già usata da Marco Rossi»), altrimenti senza nome. Chi è uscito
  dall'azienda la tiene: le sue ore passate restano sue.
- UI: un campo **«Matricola»** nella scheda della persona, accanto alle ore da
  contratto, in app e dashboard, dove si modificano già contratto e nota HR.
  Testo d'aiuto: «Il codice del dipendente nel programma paghe del consulente.»

### 2. I codici per il consulente

- Tabella nuova per azienda, scritta solo da RPC. Forma a **chiave e valore**
  (azienda, chiave, codice) e non una colonna per causale, perché col punto 3
  arriveranno i codici delle maggiorazioni senza cambiare lo schema. Chiavi di
  oggi: `company`, `work`, `ferie`, `permesso`, `malattia`.
- Leggere e scrivere: permesso **«Ore»** sull'azienda (lo stesso di chi
  esporta). Scrittura con `private.assert_workspace_operational`, lettura
  dentro `private.commercial_readable_workspace_ids()` (l'archivio si legge e
  si esporta).
- Codici: testo corto (es. fino a 20 caratteri), spazi tolti, vuoto = nessun
  codice.
- UI: nella **pagina Ore**, accanto ai pulsanti di export, una voce **«Codici
  per il consulente»** che apre un piccolo modulo (app: una schermata o un
  foglio; dashboard: un riquadro o una finestra) con cinque campi: Codice
  azienda, Lavoro, Ferie, Permesso, Malattia. Testo d'aiuto: «Te li dà il tuo
  consulente: sono i codici del suo programma paghe. Puoi lasciarli vuoti.»

### 3. I codici nei file

Le RPC esistenti **non cambiano firma**. Il client riceve matricole e codici da
una RPC nuova (forma lasciata a chi costruisce: per esempio
`get_export_codes(p_workspace)` che restituisce i codici dell'azienda e le
matricole delle persone nel perimetro «Ore»), e le unisce alle righe per
`person_id` nei costruttori puri di `src/lib/exportBuilders.ts`, condivisi da app
e dashboard.

- La RPC delle matricole restituisce solo le persone che chi esporta vede nel
  perimetro delle ore (stesse regole di `get_workspace_hours_summary` e del
  riepilogo assenze), mai le altre.
- **CSV giornaliero**: tre colonne nuove **in testa**, nell'ordine Codice
  azienda · Matricola · Codice causale; poi le colonne di oggi invariate. Il
  codice causale viene dalla chiave della causale (`work`, `ferie`,
  `permesso`, `malattia`); le righe «Da verificare» non ne hanno.
- **CSV mensile**: colonna **Matricola** subito dopo «Nome». Nell'intestazione
  delle colonne di ore, il codice fra parentesi quando c'è: «Ore lavorate
  effettive (01)», «Ferie (FE) - ore riconosciute», «MAL/Malattia (MAL) - ore
  riconosciute», «Permessi (PE) - ore riconosciute». Senza codice
  l'intestazione resta quella di oggi.
- **CSV assenze**: colonna Matricola dopo «Nome».
- **Export completo** (`export_workspace_data`, `persone.csv`): colonna
  «Matricola». Lo schema zod di `web/src/export/fullExportFiles.ts` la accetta
  come facoltativa, perché gli export salvati prima non la portano.
- **PDF**: niente codici (è il documento da leggere, non da importare).

### 4. L'avviso

Sopra i pulsanti di export, nella pagina Ore (app e dashboard), quando nel
periodo e fra le persone scelte:

- qualcuno con ore o assenze **non ha la matricola**: «3 persone senza
  matricola: nel file la colonna resta vuota.»;
- una causale **usata nel periodo** non ha codice, o manca il codice azienda,
  ma solo se l'azienda ha già scritto **almeno un** codice (chi non usa i codici
  non deve vedere avvisi): «Senza codice: Malattia.»

Non blocca niente, come l'avviso dei certificati medici. La frase sta in un
modulo puro condiviso da app e dashboard.

## Vincoli

- Migration nuove, mai toccare quelle applicate (`20261103000600`/`000700`
  sono già sul remoto).
- RPC `SECURITY DEFINER`, `search_path ''`, `revoke all … from public, anon`,
  `grant execute … to authenticated`; aggiornare
  `supabase/tests/rls/050_surface.sql`.
- Tipi DB con `supabase/tests/gen-types.sh`.
- Errori come `raise exception '<codice>'`, tradotti in `src/lib/errors.ts`.
- Glossario (`docs/GLOSSARIO.md`): «dipendente», «team», «sede»; niente
  «organico», «staff», «locale». «Matricola» e «consulente» vanno bene.
- CSV: stesse convenzioni di oggi (`;`, virgola, BOM, protezione dalle formule:
  una matricola che comincia con `=` resta testo).
- Pagine legali: la matricola è un dato nuovo della scheda; verificare se
  `web-site/public/dati-del-team.html` elenca i campi della scheda e, se sì,
  aggiungerla (test `tests/unit/web/legalPages.test.ts`).
- Si lavora su `main`, un commit a fine lavoro.

## Decisioni prese da me (da verificare leggendo)

- Matricola **unica** nell'azienda, chi è uscito la tiene: il controllo di
  unicità comprende anche i membri usciti (`status = left`). `member_hr` non
  porta l'azienda e una persona può non averne ancora la riga: l'unicità va
  garantita con un controllo nell'RPC sotto lock dell'azienda (o un trigger),
  non con un indice sulla sola `member_hr`.
- Chi ha **«Ore» senza «Team»** riceve la matricola **nei file** (e nel conteggio
  dell'avviso), anche se non la vede sulla scheda: è un codice per il programma
  paghe, non un dato riservato come la nota HR, e senza non potrebbe fare
  l'export per cui ha il permesso. La RPC nuova la dà nel perimetro «Ore».
  L'unione con le righe delle ore si fa su `member_id` (che il client chiama
  `person_id`).
- Matricola modificabile con **«Team»** (come il contratto); codici con **«Ore»**.
- «Codici per il consulente» nella **pagina Ore**, non in Impostazioni.
- Codici a **chiave e valore**, pronti per le maggiorazioni.
- Nel mensile il codice va **nell'intestazione**, non in una colonna.
- Avviso sui codici solo se l'azienda ne ha già scritto almeno uno.
- Nessun codice nel PDF.

## Lasciato a chi costruisce

- Nomi di tabella, colonna e RPC; come garantire l'unicità della matricola
  (indice, trigger o controllo nell'RPC con lock dell'azienda).
- Disegno del modulo dei codici nelle due piattaforme, nello stile delle
  schermate vicine.
- Come portare matricole e codici nella pagina Ore (una query in più al
  caricamento o al tocco del pulsante) — purché avviso e file usino gli stessi
  dati.

## Prove

- **SQL**: matricola scritta da chi ha «Team», rifiutata a chi non ce l'ha e a
  chi la modifica su di sé senza essere titolare; `matricola_taken` su
  doppione (anche con maiuscole e spazi diversi) nella stessa azienda, accettata
  in un'azienda diversa; codici scritti e letti con «Ore», rifiutati senza;
  matricole restituite solo nel perimetro «Ore»; `anon` non esegue niente.
- **Unit**: colonne e ordine dei tre CSV con e senza codici; intestazioni del
  mensile con e senza codice; matricola con `=` protetta; frasi dell'avviso
  (nessuna matricola mancante, alcune, codici assenti del tutto = nessun
  avviso, una causale usata senza codice); `fullExportFiles` con e senza
  matricola.
- **Prova a mano**: scrivere matricole e codici, esportare i tre CSV dello stesso
  mese e controllarli in Excel.
