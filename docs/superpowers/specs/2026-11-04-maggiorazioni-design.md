# Maggiorazioni negli export per il consulente — design

> 2026-11-04. Punto 3 di 4 di «Export ore per il consulente» in `TASKS.md`
> (punto 1: `2026-11-03-export-giornaliero-design.md`; punto 2:
> `2026-11-04-matricola-e-codici-design.md`). Applica la decisione di prodotto
> del 24/09 in `plans/HOURS-ABSENCES-ADJUSTMENTS.md`.

## Perché

Il consulente, oltre alle ore lavorate, deve sapere **quante di quelle ore**
sono notturne, di domenica, festive o di straordinario, perché in busta paga
hanno una maggiorazione. Oggi KlokShift non lo dice: il titolare lo ricostruisce
a mano dai turni, o lo fa il consulente.

Il riferimento scelto dal fondatore è «un risultato il più simile possibile ai
concorrenti». Tutti calcolano in automatico, da regole che l'azienda imposta una
volta:

- **Planday**: «payroll supplements» per straordinario, notturno e weekend; lo
  straordinario sono le ore oltre quelle del contratto;
- **Shiftbase**: maggiorazioni su turni, contratti e festività nazionali; fra
  una maggiorazione e lo straordinario che cadono insieme **vale la più alta**;
- **Fluida**: calcola le maggiorazioni e le mette nel file da esportare;
- **Skello / Factorial**: straordinario automatico dal contratto; notturno,
  weekend e festivi senza interventi a mano.

Restano valide le regole del 24/09: una maggiorazione **qualifica** ore già
lavorate e non le aumenta (8 ore di cui 2 notturne restano 8 ore); le
percentuali le sceglie l'azienda, nessuna è preimpostata come «di legge»;
KlokShift dà quantità, categoria e percentuale, **mai importi**; cambiare una
percentuale non riscrive i mesi passati.

## Strade considerate

| | Cosa | Pro | Contro |
|---|---|---|---|
| **A** | **Calcolo ogni volta, regole con una data** (scelta) | Una sola fonte: se si corregge un'uscita le maggiorazioni seguono; stessa regola delle ore («non calcolare le ore altrove») | Cambiare le ore da contratto di una persona cambia il suo straordinario passato (il contratto non ha date) |
| B | Righe salvate turno per turno (lo schema `assignment_adjustments` del 24/09) | Passato congelato per costruzione; aprirebbe le maggiorazioni a mano | Seconda copia delle ore: ogni correzione e ogni cambio di contratto devono ricalcolare, e lo straordinario dipende da tutta la settimana. Se un ricalcolo salta, file e pagina Ore divergono |
| C | A + «Chiudi il mese» che congela i numeri | Protegge il passato anche dai cambi di contratto | Pulsante, stato del mese, riapertura: lavoro in più che si aggiunge dopo sopra A senza rifare niente |

Scelta **A** dal fondatore, il 04/11, su raccomandazione. Lo schema
`assignment_adjustments` del 24/09 resta un'idea per le maggiorazioni a mano,
fuori da questo lavoro: il piano del 24/09 va aggiornato per dirlo.

## Obiettivi

1. **Regole di maggiorazione** dell'azienda, scritte da chi ha «Ore», in app e
   sulla dashboard: quattro voci, ciascuna accesa o spenta, con la sua
   percentuale.
2. **Calcolo automatico** sul server, da una sola funzione, sulle stesse righe
   che contano nelle ore.
3. Le maggiorazioni **nei file e a video**: CSV mensile, CSV giornaliero, PDF,
   pagina Ore. Con il loro codice da «Codici per il consulente».
4. Un **avviso**, mai un blocco, quando lo straordinario non si può calcolare
   per qualcuno.

## Non obiettivi

- Importi in euro, tariffe orarie, busta paga.
- Preset di CCNL o percentuali suggerite.
- Maggiorazioni inserite a mano su un turno (la strada B, in futuro).
- «Chiudi il mese» (strada C, in futuro).
- Maggiorazioni che si sommano fra loro (vale sempre la più alta, vedi sotto).
- Sabato, festivi regionali, regole diverse per persona o per sede (a parte il
  patrono).
- Distinguere straordinario e supplementare (part-time): è una voce sola, il
  consulente sa il contratto di ciascuno.
- Soglie di straordinario doppie (giornaliera **e** settimanale insieme).
- Tracciati Zucchetti/TeamSystem: punto 4.

## Anti-obiettivi

- Un totale ore che cambia perché ci sono maggiorazioni.
- Una percentuale già scritta che sembri un obbligo di legge.
- Un export che non parte perché manca una regola, un codice o un contratto.
- Mesi già passati che cambiano quando si cambia una percentuale.
- Un secondo posto dove si calcolano ore o maggiorazioni: app, dashboard e file
  leggono **la stessa** funzione SQL.
- Cambiare la firma delle RPC delle ore che le app installate chiamano
  (`get_workspace_hours_summary`, `get_workspace_hours_daily`,
  `get_workspace_absence_summary`, `get_export_codes`).
- Nominare la malattia o altri dati sanitari dove non servono (le maggiorazioni
  riguardano solo il lavoro).

## Le regole

Quattro voci, per azienda:

| Voce | Cosa si imposta | Quali ore |
|---|---|---|
| **Notturno** | percentuale; fascia oraria (proposta di partenza 22:00–06:00, modificabile) | i minuti lavorati dentro la fascia, che può passare la mezzanotte |
| **Domenica** | percentuale | i minuti lavorati di domenica, dalle 00:00 alle 24:00 |
| **Festivi** | percentuale | i minuti lavorati in un giorno festivo, dalle 00:00 alle 24:00 |
| **Straordinario** | percentuale | le ore oltre le **ore da contratto** della scheda, nel periodo del contratto |

- Ogni voce si **accende** con la sua percentuale, obbligatoria quando è accesa:
  un numero maggiore di 0 e al massimo 300, con al più un decimale. Le voci
  partono **spente e vuote**. La fascia notturna parte già scritta 22:00–06:00
  perché è un orario, non una percentuale; si può cambiare (inizio e fine al
  quarto d'ora, diversi fra loro).
- **Da quando valgono.** Le regole si salvano **per mese**: «valgono dal mese
  di…», di default il mese corrente. Ogni salvataggio crea la versione di quel
  mese (o la sostituisce, se c'è già). Un mese usa l'ultima versione con mese
  di partenza uguale o precedente; prima della prima versione non c'è nessuna
  maggiorazione. Si può scegliere un mese passato (per mandare al consulente
  ottobre con le regole appena scritte): l'interfaccia dice che i file di quei
  mesi cambiano. Spegnere una voce è una versione con la voce spenta. La
  fascia notturna fa parte della versione, come le percentuali.
- I **festivi** sono quelli nazionali italiani, che l'app conosce: 1 gennaio,
  6 gennaio, Pasqua, lunedì dell'Angelo, 25 aprile, 1 maggio, 2 giugno,
  15 agosto, **4 ottobre** (San Francesco, festa nazionale dal 2026, legge
  151/2025), 1 novembre, 8 dicembre, 25 e 26 dicembre. Pasqua si calcola
  ogni anno. Più il **santo patrono** di ogni sede (giorno e mese, facoltativo),
  scritto nella stessa pagina delle regole da chi ha «Ore» su quella sede. Il
  patrono **non ha versioni** (scelta di semplicità del fondatore, «non
  aggiungiamo troppa roba»): è un dato della sede, e scriverlo o cambiarlo vale
  anche per i mesi passati. È un fatto che non cambia, quindi in pratica lo si
  scrive una volta; l'interfaccia lo dice accanto al campo.
- Lo **straordinario** usa `contract_hours` + `contract_period` della scheda
  (`member_hr`):
  - periodo **giorno**: il giorno del turno; **settimana**: da lunedì a
    domenica; **mese**: il mese di calendario;
  - contano solo le **ore lavorate** che contano nel riepilogo, di tutte le
    sedi dell'azienda (il contratto è della persona): ferie, permessi e
    malattia non contano;
  - le ore oltre la soglia sono le **ultime** in ordine di tempo: si mettono in
    fila le righe del periodo per inizio, si sommano, e quel che passa la
    soglia è straordinario (anche una parte di riga);
  - un periodo a cavallo di due mesi (una settimana fra ottobre e novembre) si
    calcola intero; ogni minuto di straordinario sta nel mese del giorno del
    suo turno;
  - chi non ha ore da contratto non ha straordinario: avviso (sotto).

## Il calcolo

Una sola funzione SQL privata, sulle righe di `private.workspace_hour_rows`
che contano (`counted`), è la **fonte unica** di tutte le maggiorazioni.

1. **L'intervallo di una riga** è quello che il giornaliero già mostra: gli
   orari della timbratura che conta, altrimenti quelli del turno (fine prima
   dell'inizio = giorno dopo). Ora di Roma, come il resto delle ore.
2. **Le ore della riga sono quelle che contano** (`approved_hours`), che
   possono essere diverse dall'intervallo: pausa non retribuita, ore corrette
   a mano. La pausa non dice dove cade. Per questo le porzioni si misurano
   sull'intervallo e si riportano **in proporzione** alle ore che contano:
   ogni minuto dell'intervallo vale `ore che contano / durata dell'intervallo`.
   Così la somma delle maggiorazioni di una riga non supera mai le sue ore.
3. **Una sola maggiorazione per minuto.** Se lo stesso minuto è, per esempio,
   notturno e festivo, conta solo la voce con la percentuale più alta (come
   Shiftbase e come succede di solito nei contratti italiani: la più alta
   assorbe la più bassa). A parità vale quest'ordine: festivi, domenica,
   straordinario, notturno. Lo straordinario entra nel confronto con i suoi
   minuti, cioè la coda dell'intervallo che supera la soglia.
4. **Arrotondamento al centesimo per riga e per voce, in SQL**, come le ore:
   la somma che il consulente fa in Excel sulle righe del giornaliero è
   esattamente il totale del mensile. Se dopo l'arrotondamento le voci di una
   riga superano le sue ore, il centesimo in più si toglie alla voce con più
   ore (a parità, l'ordine del punto 3).
5. **Perimetro**: chi legge vede le maggiorazioni delle righe che vede già
   (sedi dove ha «Ore»). La soglia dello straordinario però si calcola su
   tutte le ore della persona nell'azienda, anche quelle di sedi che chi legge
   non vede: altrimenti un collaboratore con «Ore» su una sede sola vedrebbe
   uno straordinario sbagliato.

La percentuale e il nome di ogni voce escono **con la riga**, presi dalla
versione delle regole del mese della riga: è lo «snapshot» del 24/09, senza
salvarlo.

### Esempio

Regole di novembre: notturno 22–6 al +20%, domenica +30%. Anna, contratto 40 h
a settimana (in quella settimana non le supera), domenica 8 novembre dalle
18:00 alle 02:00 con 30 minuti di pausa non retribuita: 7,5 ore lavorate su 8
ore di intervallo.
Minuti di domenica: 18:00–24:00 = 6 h; notturni: 22:00–02:00 = 4 h; dalle
22:00 alle 24:00 sono entrambi, vince domenica (+30%).
Domenica 6 h, notturno 2 h (00:00–02:00 di lunedì), in proporzione 7,5/8:
5,625 e 1,875, arrotondate 5,63 e 1,88 = 7,51, un centesimo oltre le ore della
riga, che si toglie alla voce più grande: **domenica 5,62 h, notturno 1,88 h**.
Ore lavorate: 7,5, invariate.

## Dove si vede

- **Periodi di più mesi.** La pagina Ore permette anche un intervallo di
  date fino a un anno: se nel periodo una voce ha percentuali diverse
  (notturno +20% a ottobre, +25% a novembre), compare **una riga, una colonna
  e un totale per voce e percentuale**. Le intestazioni si costruiscono dalle
  righe, non da una versione delle regole. Il codice resta uno per voce.
- **Pagina Ore** (app e dashboard): nel riepilogo del periodo e per persona,
  righe «di cui»: «Di cui notturne +20%: 24 h». Solo le voci con ore.
- **CSV mensile**: una colonna per voce accesa nel mese, dopo «Pausa non
  retribuita esclusa», intestazione «Di cui notturno +20%» con il codice fra
  parentesi se c'è («Di cui notturno +20% (NOT)»). Senza regole accese il file
  è **identico a oggi**.
- **CSV giornaliero**: per ogni riga di lavoro con maggiorazioni, una riga in
  più per voce, subito dopo, con stessa data, persona, sede e turno, la causale
  «Di cui notturno +20%», le ore e il codice causale della voce; entrata,
  uscita e pausa vuote. La somma delle righe «Lavoro» resta uguale alle ore
  lavorate del mensile.
- **PDF**: le stesse righe «di cui» nel riepilogo e nel cartellino giorno per
  giorno.
- **Codici per il consulente**: quattro codici in più (notturno, domenica,
  festivi, straordinario), nella stessa sezione; l'avviso «Senza codice» li
  nomina solo se nel periodo hanno ore.
- **Avviso** nella pagina Ore, con lo straordinario acceso: «N persone senza
  ore da contratto: lo straordinario non è calcolato.» Non blocca niente.
  Conta solo i **dipendenti** (`authority = none`) con ore nel periodo:
  titolari e collaboratori in turno di rado hanno ore da contratto, e con loro
  l'avviso resterebbe sempre acceso. Lo straordinario si calcola comunque per
  chiunque abbia le ore da contratto.

## Permessi e dati

- Regole: le legge e le scrive **chiunque abbia «Ore»**, anche su una sede
  sola (decisione del fondatore del 04/11: stessa regola dei codici,
  `private.can_workspace_hours`, niente permessi nuovi), anche per i mesi
  passati. Patrono: chi ha «Ore» su quella sede. Solo con l'azienda operativa
  (`assert_workspace_operational`). In archivio si
  leggono, il modulo dice perché non si salvano (come i codici).
- Le maggiorazioni le legge chi ha «Ore», nello stesso perimetro delle ore.
- Scritture solo da RPC SECURITY DEFINER; tabella nuova senza policy né grant;
  la lettura nuova va nell'elenco del confine commerciale (`050_surface.sql`).
- Una RPC **nuova** per le maggiorazioni; le RPC delle ore non cambiano. I
  costruttori dei file ricevono le maggiorazioni come parametro facoltativo in
  più: senza, escono come oggi (stessa regola del punto 2).

## Prove

- **SQL**: fascia notturna che passa la mezzanotte; domenica e festivo con
  turno a cavallo della mezzanotte; Pasqua e lunedì dell'Angelo di due anni
  diversi; 4 ottobre; patrono di una sede e non dell'altra; più alta vince e
  ordine a parità; proporzione con pausa non retribuita e con ore corrette a
  mano; straordinario giornaliero, settimanale (anche a cavallo di due mesi) e
  mensile, con ore in una sede che chi legge non vede; chi non ha contratto;
  versioni delle regole (mese passato invariato dopo un cambio, voce spenta,
  prima della prima versione niente); permessi (senza «Ore» niente, in archivio
  si legge ma non si scrive); arrotondamento per riga uguale alla somma del
  mensile; bozze e turni non contati esclusi.
- **Unit**: costruttori dei CSV con e senza maggiorazioni (output identico
  senza), intestazioni e codici, avvisi.
- **A mano**: impostare le regole, esportare un mese con un turno notturno di
  domenica, confrontare con l'esempio sopra.

## Lasciato a chi costruisce

- Nomi di tabelle, colonne e funzioni; come rappresentare le versioni.
- Come calcolare in SQL i minuti dentro le fasce (intervalli `tstzrange` o
  `generate_series` sui minuti: conta il risultato, provato dai test).
- Come ordinare le righe «di cui» nel giornaliero quando una riga ne ha più
  d'una (ordine stabile, uguale nel PDF).
- La disposizione del modulo delle regole, purché sia lo stesso su app e
  dashboard e stia nella pagina Ore accanto a «Codici per il consulente».

## Documenti da aggiornare

- `plans/HOURS-ABSENCES-ADJUSTMENTS.md`: maggiorazioni automatiche calcolate
  ogni volta, «più alta vince», le righe salvate restano un'idea futura.
- `AGENTS.md`: paragrafo «Maggiorazioni» sotto «Ore, assenze e maggiorazioni».
- `TASKS.md`: punto 3.
