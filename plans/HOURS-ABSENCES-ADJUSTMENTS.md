# Ore, assenze riconosciute e maggiorazioni

> **Decisione di prodotto — 2026-09-24. Non ancora implementata.**
>
> Questo documento completa `CLOCK_IN_OUT.md`. Le timbrature stabiliscono
> quando una persona ha lavorato; questo documento stabilisce come presentare
> lavoro, assenze e maggiorazioni nel consuntivo.

## Obiettivo

KlokShift prepara un consuntivo affidabile per azienda, professionista e mese.
Non calcola la busta paga e non trasforma le regole di un CCNL in presunte
regole nazionali.

Il prodotto deve tenere separati tre dati:

1. **Ore lavorate** — tempo in cui la persona ha realmente lavorato.
2. **Ore riconosciute di assenza** — ferie, permessi o altre assenze che coprono
   ore contrattuali senza essere lavoro svolto.
3. **Maggiorazioni** — porzioni delle ore lavorate alle quali si applicano una
   categoria e una percentuale, per esempio notturno `+20%`.

## Decisioni invarianti

- Le ferie sono assenze retribuite, ma **non sono ore lavorate**: non vanno mai
  scritte o sommate in `shift_assignments.worked_hours`.
- `worked_hours` continua a rappresentare soltanto il lavoro effettivo
  approvato. Il piano timbrature e la sua revisione sono in
  `CLOCK_IN_OUT.md`.
- Le ore riconosciute stanno in un dato distinto. Servono al confronto con il
  monte ore contrattuale e all'export, non alterano lo storico dei turni.
- Una maggiorazione qualifica ore già lavorate. Otto ore di cui due notturne al
  `+20%` restano **otto ore lavorate**, non `8,4 h`.
- Le percentuali sono configurabili per azienda e non sono preimpostate come
  obblighi di legge. Fasce, percentuali, cumulabilità e trattamento dipendono
  dal contratto applicato.
- KlokShift esporta quantità, categoria e percentuale. Nel perimetro deciso qui
  non conserva retribuzioni orarie e non calcola importi in euro.
- I valori storici devono restare leggibili anche se una categoria viene
  rinominata, archiviata o cambia percentuale: sulle righe applicate si salvano
  gli snapshot di nome e percentuale.
- Un periodo non può essere conteggiato contemporaneamente come lavoro e come
  assenza riconosciuta senza una segnalazione da risolvere.

## Totali mostrati

Il riepilogo mensile deve evitare un unico numero ambiguo e mostrare almeno:

```text
Ore lavorate                  152 h
Ferie riconosciute             16 h
Permessi riconosciuti           4 h
Totale coperto                172 h

Di cui notturne +20%           24 h
Di cui straordinarie +30%       6 h
```

Formule:

```text
totale coperto = ore lavorate + ore riconosciute di assenza
maggiorazioni  = classificazioni delle ore lavorate, non addendi del totale
```

Le ore maggiorate possono sovrapporsi se la regola aziendale lo consente: la
stessa ora può, per esempio, essere notturna e festiva. Per questo le categorie
non sono una partizione obbligatoria delle ore lavorate.

## Ferie e altre assenze

Oggi `staff_absences` conosce intervallo, tipo e stato, ma una giornata intera
non dice quante ore la persona avrebbe dovuto lavorare. Anche
`contract_hours + contract_period` non definisce la distribuzione sui giorni.

### Prima versione

- Il riepilogo in giorni già esistente resta invariato.
- Per un'assenza approvata, chi ha il permesso **Ore** può indicare
  facoltativamente le ore riconosciute per ciascun giorno.
- Se le ore non sono state indicate, KlokShift mostra i giorni ma non inventa
  una conversione in ore.
- Il dato giornaliero, anziché un solo totale sull'assenza, permette di tagliare
  correttamente i mesi e di rappresentare settimane irregolari.

Nome di lavoro del modello, da confermare durante la progettazione SQL:

```text
absence_hour_credits
- absence_id
- date
- minutes
- source             manual | schedule
- schedule_snapshot  nullable
- created_by
- created_at
```

Le scritture devono passare da RPC e rispettare il permesso **Ore** e il
perimetro aziendale/sedi. Un collaboratore non può decidere i propri valori,
coerentemente con le presenze.

### Evoluzione successiva

Aggiungere alla scheda aziendale della persona una distribuzione oraria
contrattuale, per esempio lunedì `8 h`, martedì `6 h`, mercoledì riposo. Da
questa KlokShift può **proporre** i crediti giornalieri, salvando lo snapshot
della regola usata. La proposta resta revisionabile.

Non usare come unica fonte i turni pianificati: un'assenza approvata può
coesistere temporaneamente con un turno che la sede deve ancora sistemare.

### Conflitti con turni lavorati

Un turno lavorato nello stesso periodo di un'assenza approvata apre un'anomalia.
Il riepilogo non deve sommare silenziosamente entrambi. Chi gestisce deve
correggere l'assenza, correggere la presenza oppure confermare esplicitamente i
crediti che restano validi. Finché il conflitto non è risolto, la riga va
segnalata come **da verificare** nell'export.

## Maggiorazioni e attività

Le mansioni ordinarie continuano a usare i ruoli della sede (`venue_roles`). Le
regole che qualificano economicamente o contrattualmente una parte del lavoro
usano categorie separate, configurate sull'azienda.

Nome di lavoro della configurazione:

```text
work_adjustment_categories
- id
- workspace_id
- name
- percentage
- automatic_rule     nullable
- stacking_policy
- valid_from
- valid_to           nullable
- archived_at        nullable
```

Nome di lavoro delle righe applicate:

```text
assignment_adjustments
- id
- assignment_id
- category_id        nullable, per conservare lo storico dopo l'archiviazione
- minutes
- name_snapshot
- percentage_snapshot
- source             manual | automatic
- note               nullable
- created_by
- created_at
```

Il modello conserva minuti interi; arrotondamento e visualizzazione in ore
avvengono in un solo modulo condiviso. Le modifiche passano da RPC, sono
limitate a chi ha il permesso **Ore** e non devono permettere a un collaboratore
di modificare la propria riga.

### Automatico e manuale

- **Manuale:** chi gestisce assegna, per esempio, `2 h · Extra evento +20%`.
- **Automatico:** il server propone le porzioni risultanti dagli intervalli
  effettivi approvati, per esempio il tratto dopo le 22:00.
- Una proposta automatica non diventa definitiva prima della revisione delle
  ore dalla quale deriva.
- Se è disponibile soltanto il totale `worked_hours`, senza intervallo
  effettivo, KlokShift non può dedurre in modo affidabile il notturno: la voce
  resta manuale.

Calcoli di fasce notturne, cambio data, festività e sovrapposizioni devono
vivere lato server o in un unico modulo di dominio condiviso, usando il fuso
della sede. Non vanno riscritti separatamente in app, dashboard ed export.

## Export

Il CSV/PDF mensile deve mantenere colonne distinte:

- ore lavorate approvate;
- ore di ferie riconosciute;
- ore di permesso riconosciute;
- altre ore riconosciute, quando introdotte;
- una colonna o tabella per ciascuna categoria di maggiorazione, con ore e
  percentuale snapshot;
- anomalie ancora da verificare.

Non esportare una generica colonna “ore totali” senza specificare se indica
ore lavorate oppure totale coperto. Non calcolare importi monetari.

## Ordine di implementazione

1. Completare timbratura, correzione e approvazione delle ore descritte in
   `CLOCK_IN_OUT.md`.
2. Rendere esplicito l'intervallo effettivo approvato dal quale derivare le
   classificazioni automatiche.
3. Introdurre categorie e righe di maggiorazione, inizialmente anche manuali.
4. Estendere riepilogo mensile ed export mantenendo separati i totali.
5. Introdurre i crediti giornalieri manuali per le assenze approvate.
6. Aggiungere il calendario contrattuale e le proposte automatiche dei crediti.
7. Solo dopo, valutare preset di CCNL come funzionalità separata e versionata.

## Fuori perimetro della decisione

- Calcolo della retribuzione o della busta paga.
- Imponibile, contributi, tasse, indennità in euro o tariffa oraria.
- Un motore completo dei CCNL.
- Saldo di ferie maturate, godute e residue.
- Percentuali nazionali predefinite presentate come universalmente valide.

## Riferimenti normativi di contesto

La normativa italiana riconosce almeno quattro settimane di ferie retribuite e
definisce il quadro generale di orario, straordinario e lavoro notturno; la
disciplina concreta può dipendere dal contratto collettivo applicato. Questi
riferimenti motivano la configurabilità, ma non sostituiscono la verifica del
consulente del lavoro:

- Ministero del Lavoro, “Ferie annuali”:
  https://www.lavoro.gov.it/sportello-unico-digitale/termini-e-condizioni-di-impiego/ferie-annuali
- Ministero del Lavoro, “Orario di lavoro”:
  https://www.lavoro.gov.it/sportello-unico-digitale/termini-e-condizioni-di-impiego/orario-di-lavoro
- Decreto legislativo 8 aprile 2003, n. 66:
  https://www.normattiva.it/eli/id/2003/04/14/003G0091/ORIGINAL

## Regola per modificare questa decisione

Qualunque implementazione che sommi ferie a `worked_hours`, trasformi una
maggiorazione in ore lavorate equivalenti o calcoli importi in euro richiede
prima una nuova decisione di prodotto e l'aggiornamento di questo documento.
