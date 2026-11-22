# Pagina Ore leggibile sul telefono — design breve

Data: 2026-11-22 · Solo app (`src/app/(manager)/ore.tsx`); la dashboard web non cambia.

## Perché

Il fondatore: «da mobile la pagina ore ha troppe scritte e troppo piccole, una
persona media farebbe fatica». Oggi ogni persona occupa fino a sei righe in
12–14 pt (ruolo e turni, pausa esclusa, maggiorazioni, «Assenza giustificata
0 h · Totale ore coperte», avvisi, barra) e il riepilogo ripete in quattro righe
come si contano le ore.

## Cosa fanno i concorrenti (ricerca del 22/11)

Deputy, Connecteam, Homebase, Planday: sul telefono un **elenco di persone con un
numero solo** (le ore del periodo), al massimo un conteggio di anomalie; il
dettaglio si apre **toccando la persona**; le cose da sistemare prima, approvabili
in blocco; report e costi soprattutto sul web.

## Obiettivi

- Leggibile a colpo d'occhio: nome e ore grandi, poche parole.
- Nessuna informazione persa: ciò che esce dall'elenco si ritrova nella pagina
  della persona.
- Gli avvisi che spiegano un totale più basso del previsto («da verificare»,
  «senza timbratura, escluse») restano visibili **come segnale** nell'elenco.

## Non obiettivi

- Nessun calcolo nuovo: stesse RPC, stessi hook, stesse regole
  (`groupHoursByPerson`, `monthlyReportRows`, `surchargeSummary`…).
- Niente modifiche a export, «Ore da sistemare» (contenuto), maggiorazioni,
  codici, dashboard web.

## Approcci considerati

- **A. Elenco corto + pagina della persona** — scelto dal fondatore. Toglie davvero
  testo dalla pagina; è lo schema dei concorrenti. Costa una schermata nuova.
- B. Righe che si espandono sul posto: meno lavoro, ma con più righe aperte si
  torna al muro di testo.
- C. Solo pulizia e caratteri più grandi: la più veloce, resta fitta.

## La pagina Ore, dall'alto

1. Testata, «Mese / Date», selettore del periodo, filtro «Persone»: come oggi.
2. **Ore da sistemare**: come oggi (è la cosa da fare).
3. **Riepilogo**: un numero grande, le ore lavorate del periodo; sotto, in una
   riga, «N turni · N persone». Le ore di assenza riconosciuta e il totale coperto
   compaiono solo se diverse da zero. Il paragrafo su come si contano le ore va
   dietro un «Come si contano?» che lo apre. Gli avvisi del periodo (da
   verificare, senza timbratura) restano, in una riga ciascuno, solo se ci sono.
   Le maggiorazioni del periodo escono dal riepilogo (stanno nella pagina della
   persona e nel file).
4. **Persone**: una riga toccabile per persona — nome (16 pt), sotto ruolo e
   turni; a destra le ore (18 pt, oro) e la freccia. Sotto, solo se serve, **un**
   segnale in arancione: «Da controllare» quando ci sono ore da verificare o senza
   timbratura. La barra di confronto resta, sottile. Niente pause, maggiorazioni,
   assenze a zero né totali ripetuti.
5. **Assenze del periodo**: come oggi, ma la nota esplicativa si accorcia.
6. **Esporta per il consulente**: come oggi, dopo le persone.
7. Maggiorazioni · Codici per il consulente: come oggi, in fondo.

## La pagina della persona (nuova)

Rotta nuova sotto la gestione, con persona e periodo nei parametri (mese, o
dal/al). Legge con gli **stessi hook** della pagina Ore (cache già calda) e
filtra la persona. Mostra, in caratteri normali (14–16 pt):

- nome, periodo, ore lavorate in grande;
- turni, pausa esclusa o compresa (`breakSummaryText`), maggiorazioni «di cui»;
- assenza riconosciuta e totale coperto (anche a zero, qui il contesto c'è);
- gli avvisi con la frase intera (da verificare, senza timbratura);
- le sue righe di «Ore da sistemare», che aprono il turno;
- le sue assenze del periodo (ferie, permessi, malattia, certificati);
- un collegamento alla scheda della persona nel Team.

## Lasciato a chi costruisce

- Nome e percorso della rotta; come passare il periodo (parametri).
- Testo esatto di «Come si contano?» (aperto/chiuso sul posto, non una pagina).
- Se il riepilogo mostra «di cui» per le assenze con un solo numero o due.
- Test: le regole nuove pure (es. quando una riga è «Da controllare») vanno in
  un modulo testato; nessun test visuale.
