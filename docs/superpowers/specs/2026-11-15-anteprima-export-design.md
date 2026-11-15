# Anteprima dell'export per il consulente — design

Data: 2026-11-15 · Stato: da approvare · Ambito: pagina Ore, app (`src/app/(manager)/ore.tsx`) e dashboard (`web/src/pages/Ore.tsx`)

## Perché

Oggi la pagina Ore ha quattro pulsanti di export (CSV mensile, CSV giornaliero,
CSV assenze, PDF) che scaricano alla cieca, e gli avvisi utili (codici e
matricole mancanti, malattie senza certificato, persone senza ore da contratto)
stanno sparsi sopra la tabella, lontani dal momento in cui servono. Il fondatore
ha visto sul sito vetrina la bozza del file pronto (righe con matricola, giorno,
causale, ore) e la vuole nel prodotto.

Il modello è quello dei concorrenti (ricerca del 15/11, fonti in fondo):
**un solo ingresso «Esporta» → scegli il file → riepilogo leggibile con i
totali e cosa resta fuori → scarica** (Planday «Prepare report» con anteprima a
riepilogo + dettaglio per persona; Deputy con elenco righe, riepilogo e
controllo codici prima dell'invio; 7shifts con gli avvisi prima del report;
Fluida con una pagina unica di export). Nessuno mostra il CSV grezzo come
anteprima principale.

## Obiettivi

- Un pulsante **«Esporta per il consulente»** al posto dei quattro pulsanti di
  export, in app e dashboard. «Maggiorazioni» e «Codici per il consulente»
  restano dove sono (sono impostazioni, non export).
- Un pannello che parte da **periodo e persone già scelti in pagina** e offre il
  **file**: CSV giornaliero, CSV mensile, CSV assenze, PDF da stampare.
- Nel pannello: **totali** del file scelto, **«Resta fuori o va controllato»**
  con i motivi e dove si sistemano, e (dashboard) **le prime righe del file**.
- L'anteprima dice il vero: le righe mostrate sono **le stesse** che finiscono
  nel file, e il file scaricato dal pannello è identico byte per byte a quello
  di oggi.

## Non obiettivi

- Chiusura/blocco del mese (7shifts, Planday «locked period»): funzione a sé.
- Formati specifici dei programmi paghe (Zucchetti, TeamSystem, Paghe Web…).
- Cambiare il contenuto dei file: colonne, arrotondamenti, codici restano quelli
  di `src/lib/exportBuilders.ts`.
- Nuove RPC o migration.

## Anti-obiettivi

- Un'anteprima che diverge dal file (righe calcolate per un'altra strada).
- Un avviso che **blocca** lo scarico: oggi nessun avviso blocca, e così resta
  (regola delle maggiorazioni e dei codici in AGENTS.md: «mai un blocco»).
- Caricare il giornaliero con la pagina: si legge solo quando si apre il
  pannello (regola dell'export giornaliero, 03/11).
- Il popup del PDF bloccato da Safari perché aperto dopo un'attesa di rete.

## Vincoli

- I file restano prodotti dalle funzioni pure di `src/lib/exportBuilders.ts`,
  condivise da app e web («stesse funzioni pure dell'app: i file devono
  coincidere»). I test esistenti (`tests/unit/assignments/hoursExport.test.ts`,
  `hoursDailyExport.test.ts`, `exportCodes.test.ts`, `absences/summary.test.ts`,
  `monthlyReport.test.ts`) devono restare verdi **senza modifiche alle attese**.
- Codici e maggiorazioni si leggono **freschi** (oggi al clic; ora all'apertura
  del pannello) e il file si scarica **con gli stessi dati letti per
  l'anteprima**: nessuna seconda lettura fra anteprima e file.
- Gli avvisi riusano i testi esistenti (`exportCodesWarning`,
  `missingCertificatesWarning`, `missingContractWarning`, `hoursToFixSummary`);
  nessun avviso nuovo inventato.
- Disponibilità invariata: `exportAvailability` (mensile/assenze) decide quali
  file si possono scegliere; un file non disponibile resta visibile ma spento,
  con il motivo.
- Permessi invariati rispetto ai pulsanti di oggi (stessi `canAny`/`canRecord`).
- Glossario (`tests/unit/glossary.test.ts`), testi italiani inline.
- Web: niente popup aperti dopo `await`. Il PDF apre la finestra nel clic di
  «Stampa», con i dati già letti all'apertura del pannello.

## Approcci considerati

| | Approccio | Pro | Contro |
|---|---|---|---|
| **A** | Le funzioni dei file restituiscono prima una **tabella** (intestazione + righe), poi la si serializza in CSV; l'anteprima mostra le prime righe della stessa tabella. Totali e avvisi in un modulo puro condiviso. | Anteprima e file non possono divergere; niente server; app e web condividono la logica | Si toccano le funzioni dei file (protette dai loro test) |
| B | Nuova RPC che prepara l'anteprima | Una fonte server | Migration, e una seconda strada rispetto al file: proprio la divergenza da evitare |
| C | Generare il CSV e rileggerlo | È letteralmente il file | Parsing fragile (`;`, virgolette, BOM, intestazioni diverse), inutile per il PDF |

**Scelta del fondatore: A.**

## Come funziona

### Funzioni dei file (src/lib/exportBuilders.ts)

Per i tre CSV, la costruzione si divide in due:

- `build…Table(...)`: `{ header: string[]; rows: string[][] }`, con gli stessi
  valori già formattati che oggi finiscono nelle celle (date `gg/mm/aaaa`, ore
  con la virgola, `csvText` applicato);
- `tableToCsv(table)`: BOM + righe unite da `;` e `\r\n`, come oggi.

`buildHoursCsv`, `buildDailyCsv`, `buildAbsencesCsv` restano con la stessa firma
e diventano `tableToCsv(build…Table(...))`: chi le chiama non cambia, i test
esistenti provano che l'output è identico. Il giornaliero oggi ha una via con
maggiorazioni che riordina/aggiunge righe (`out.map(o => o.line)`): la tabella
deve contenere le righe **finali**, nello stesso ordine.

Il PDF resta `buildHoursHtml` e non ha anteprima a righe.

### Il modulo dell'anteprima (nuovo, puro)

`src/features/assignments/exportPreview.ts`, condiviso da app e web:

- `type ExportFormat = "daily" | "monthly" | "absences" | "pdf"`;
- una funzione che, dati formato, righe del riepilogo, assenze, ore da
  sistemare, codici, maggiorazioni e (per giornaliero/PDF) righe del giorno,
  restituisce:
  - **totali** del formato: ore lavorate, ferie e permessi, malattia (in ore,
    dalle righe che il file contiene), e per i CSV il **numero di righe** del
    file;
  - **cosa resta fuori o va controllato**: una lista di voci `{ testo, dove }`,
    nell'ordine: ore da sistemare (turni conclusi le cui ore non contano: nel
    file restano righe **«Da verificare»** senza ore, non ore lavorate),
    codici/matricole mancanti, malattie senza
    certificato, persone senza ore da contratto (solo se il file porta le
    maggiorazioni). `dove` dice dove si sistema: la sezione «Ore da sistemare»
    della pagina, la scheda della persona, i «Codici per il consulente», la
    pagina Assenze;
  - **tabella** (solo CSV): intestazione + prime righe (5) + quante ne restano.

Le voci riusano i testi delle funzioni d'avviso esistenti. Gli avvisi che oggi
stanno sopra la tabella delle ore (certificati, contratto, codici) **si spostano
nel pannello**; il riquadro «Ore da sistemare» in cima alla pagina resta dov'è.

### Dashboard (web/src/pages/Ore.tsx)

- Nell'intestazione: «Maggiorazioni», «Codici per il consulente» e un solo
  pulsante oro **«Esporta per il consulente»** al posto di CSV mensile, CSV
  giornaliero, CSV assenze, Stampa/PDF.
- Il pannello è una finestra di dialogo come `ExportCodesDialog` /
  `SurchargeRulesDialog`: titolo, sottotitolo con periodo e persone, scelta del
  file (segmentato), totali, «Resta fuori o va controllato» (non bloccante, ogni
  voce con il suo collegamento), tabella delle prime righe con «e altre N righe
  nel file», piedi «Annulla» / «Scarica CSV» (o «Stampa» per il PDF).
- All'apertura legge codici, maggiorazioni e — se il file lo richiede — il
  giornaliero; mentre legge mostra il caricamento; se fallisce, l'errore di oggi
  («Export non riuscito. Riprova.») con «Riprova».
- Il formato di partenza è il **CSV giornaliero** (quello del consulente, come
  la bozza del sito); cambiare formato non rilegge niente se i dati ci sono già.

### App (src/app/(manager)/ore.tsx)

- Al posto di «Esporta PDF», «Esporta CSV mensile», «Esporta CSV giornaliero»,
  «Esporta CSV assenze»: un solo **«Esporta per il consulente»**.
- Il pannello è il `BottomSheet` dell'app: stessa scelta del file, **totali e
  «Resta fuori o va controllato»**, senza tabella (sul telefono le righe non ci
  stanno; Planday fa lo stesso con la prima pagina di riepilogo). Pulsante
  «Scarica e condividi» che chiama gli export di oggi (`exportDailyCsv`,
  `exportHoursCsv`, `exportAbsencesCsv`, `exportHoursPdf`) con i dati letti
  all'apertura.

## Verifica

- Test esistenti dei file verdi senza toccarne le attese (prova che i file non
  cambiano).
- Test nuovi: le tabelle serializzate danno esattamente i CSV di oggi; le righe
  dell'anteprima sono le prime della tabella; totali e conteggio righe; le voci
  «resta fuori» (presenti/assenti, ordine, testo riusato); un formato non
  disponibile.
- `yarn test:unit`, `yarn lint`, `npx tsc --noEmit`, prova a vista sulla
  dashboard (screenshot) e prova a mano nell'app.

## Lasciato al builder

Nomi esatti dei tipi, aspetto del segmentato, come si apre il collegamento di
ogni voce (scroll alla sezione o navigazione), testi dei totali, stato vuoto
(nessuna riga nel periodo).

## Scelte mie da controllare

- Il pannello parte sul **CSV giornaliero**.
- Gli avvisi certificati/contratto/codici **lasciano** la pagina e vivono solo
  nel pannello.
- Nell'app niente tabella delle righe.
- Le righe di anteprima sono 5.

## Fonti (concorrenti)

- Planday: https://help.planday.com/en/articles/30504-how-to-export-a-payroll-report, https://help.planday.com/en/articles/30507-customise-your-payroll-exports
- Deputy: https://help.deputy.com/hc/en-au/articles/13116516297487-Introduction-to-the-new-Timesheet-Export-experience-Beta, https://help.deputy.com/hc/en-au/articles/15228811397903-Timesheet-Export-Guide-for-Xero-Reseller
- 7shifts: https://kb.7shifts.com/hc/en-us/articles/4417520109075, https://kb.7shifts.com/hc/en-us/articles/31656345253011
- Shiftbase: https://help.shiftbase.com/report-payroll
- Fluida: https://help.fluida.io/en/articles/10215025-exporting-attendance-data
