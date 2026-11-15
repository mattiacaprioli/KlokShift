# Sito vetrina: la settimana viva — design

Data: 2026-11-15 · Stato: da approvare · Ambito: `web-site/` (solo la home; `#/invito`, pagine legali e dashboard fuori)

## Perché

klokshift.com oggi dice le cose giuste ma «sembra un sito standard fatto con
l'AI»: niente che resti in testa a un titolare che lo apre. Il fondatore vuole
un effetto «wow», con Circle (circle.so/ai) come riferimento — il software vero
come protagonista, grande, vivo — **mantenendo palette e font AURA** (nero,
oro, Fraunces, Inter). L'obiettivo commerciale non cambia: chi arriva avvia la
prova di 30 giorni (registrazione → prima sede → prova).

## Obiettivi

- Un'apertura memorabile: la **settimana dei turni** che prende vita (direzione
  «A · La settimana viva», scelta dal fondatore fra tre bozze).
- **Una sola storia** che continua scorrendo: la stessa settimana si trasforma
  nei quattro momenti del prodotto (pubblica → il team conferma → le ore si
  contano → al consulente). È il secondo e ultimo punto di «wow».
- Tutto il resto calmo, pulito, leggibile: funzioni in breve, prezzi, domande.
- Togliere i segni da «pagina generata» (vedi Linguaggio visivo).

## Non obiettivi

- Nuova palette, nuovi font, tema chiaro.
- Pagina d'invito (`InvitePage`), pagine legali, dashboard `web/`, app nativa.
- Inglese/spagnolo (la struttura resta pronta, il file `en.ts` no).
- Screenshot veri: si continua con i mockup in HTML di `src/mock/`.

## Anti-obiettivi (fallimento anche se «funziona»)

- Animazioni ovunque: fade-in su ogni sezione, hover su ogni card. Il wow sta in
  **due** punti, il resto non si muove se non lo tocchi.
- Un loop infinito che dopo dieci secondi stanca.
- Una pagina che sul telefono scatta, scorre in orizzontale o nasconde il testo.
- Promettere cose che il prodotto non fa (vedi Vincoli sul copy).
- Il sito che sembra di un altro prodotto: la griglia deve essere riconoscibile
  come la vista per persona della dashboard.

## Vincoli

- **Copy solo in `web-site/src/content/it.ts`**, tipizzato da `types.ts`; nessuna
  stringa nei componenti (README del sito).
- **Cosa non si può scrivere**: recensioni/QR, annunci/candidature, paghe o buste
  paga, referral, numeri di tempo risparmiato o testimonianze non verificabili.
  Beta dichiarata, nessun acquisto attivo, JSON-LD senza offerte.
- **Glossario** (`tests/unit/glossary.test.ts`): team, dipendente, sede; niente
  «personale», «organico», «professionista», parole da ufficio.
- **Esempi misti**, mai solo ristorazione: reception, cassa, magazzino, sala,
  pulizie, palestra.
- **Niente font o script esterni** (`noExternalFonts`, DPA §6.4): Motion entra nel
  bundle Vite, non da CDN.
- Prezzi solo da `shared/pricing.ts`; pagine legali raggiungibili dal footer
  (`legalPages.test.ts`, revisione Paddle).
- Mobile come punto di partenza: corpo ≥ 16px, nessuno scroll orizzontale della
  pagina, 375px di larghezza minima provata.
- `prefers-reduced-motion`: niente movimento, si vedono gli stati finali.

## Approcci considerati

| | Approccio | Pro | Contro |
|---|---|---|---|
| A | Tutto a mano: CSS `position: sticky`, transizioni, un hook che misura lo scroll | Zero dipendenze | Morph griglia→telefono scritto a mano, più fragile su Safari/telefono, meno fluido |
| **B** | **Motion** (`motion`, ex Framer Motion) nel bundle del solo sito | `useScroll`/`useTransform` e layout animation rendono fluido il passaggio griglia→telefono con meno codice; rispetta reduced-motion | ~30–40 KB gzip in più sul sito vetrina |
| — | GSAP ScrollTrigger | Potentissimo | Imperativo, poco naturale in React, eccessivo qui — scartato |

**Scelta del fondatore: B.** Il wow sta quasi tutto nella fluidità del
passaggio, ed è ciò che Motion fa meglio.

## La pagina, dall'alto

L'ordine è l'argomentazione. Ancore della nav invariate nel significato.

1. **Nav** — come oggi (logo, quattro voci, «Prova gratis»); *mia scelta*: si
   nasconde scorrendo in giù e torna risalendo. `MobileCta` resta.
2. **Apertura — la settimana viva** (`#top`). Titolo + lead + due pulsanti a
   sinistra; a destra la griglia della settimana (vista per persona, 5 persone ×
   7 giorni, ruoli misti) in leggera prospettiva, su un alone oro.
   - All'apertura i turni **cadono al loro posto una volta sola**, a cascata
     (~1,5 s), poi le conferme si accendono di verde una dopo l'altra.
   - Dopo, la griglia resta viva con **pochi eventi rari** (un avviso «Sara ha
     confermato venerdì», il buco del sabato sera che pulsa piano in rosso),
     non un loop che ricomincia.
   - Sotto, una riga sobria di settori (oggi `Sectors`).
   - Telefono: testo sopra, sotto la griglia ridotta a 3 giorni (o la stessa
     griglia che scorre dentro il suo riquadro, come fa oggi `PlanningMock`).
3. **La storia** (`#come-funziona`). Desktop (`lg`+): colonna di testo che
   scorre a sinistra, oggetto **fermo** a destra (sticky) che cambia forma.
   Quattro passi, ognuno apre con il suo «prima» in una riga (assorbe l'attuale
   `Problem`):
   1. *Prima:* il turno scritto nel gruppo. **Prepari in bozza e pubblichi**:
      una sola notifica a testa. → la griglia, con i turni che passano da
      tratteggiati (bozza) a pieni (pubblicati).
   2. *Prima:* «hai visto il messaggio?». **Il team conferma con un tocco**,
      dall'app gratuita. → la griglia si stringe e diventa il telefono di Sara
      con il turno di venerdì e «Conferma» (base: `ConfirmMock`/`AgendaMock`).
   3. *Prima:* le ore contate a memoria a fine mese. **Si timbra dal telefono e
      le ore si sommano da sole.** → entrata/uscita, poi il riepilogo mensile che
      sale (base: `HoursMock`).
   4. *Prima:* il foglio da ricopiare per il consulente. **Ore, pause e assenze
      in PDF o CSV.** → nuovo mock: il file pronto (anteprima di un CSV/PDF).
   - L'oggetto cambia legato alla posizione di scroll (Motion `useScroll`
     sulla sezione), con transizioni morbide tra i passi; il passo attivo
     a sinistra è evidenziato, gli altri attenuati.
   - Sotto `lg`: niente sticky. I quattro passi sono uno sotto l'altro, ognuno
     col suo oggetto statico che si anima una volta entrando in vista.
4. **Il resto, in breve** (`#funzioni`). Più sedi con una persona sola, ferie e
   assenze, documenti con scadenze, giorni di chiusura, cambio turno, aggiungere
   il team con l'email. Righe brevi in una griglia tipografica, **niente card
   tutte uguali**. Assorbe `ForVenues`, `ForPros` e `HowItWorks`.
5. **Prezzi** (`#prezzi`) — contenuto e logica di oggi (`Plans`), restyling
   calmo coerente col resto.
6. **Domande** (`#faq`) — come oggi.
7. **Chiusura** — torna la settimana dell'apertura, ora **tutta confermata**,
   ferma; titolo di `finalCta`, stesso pulsante.
8. **Footer** — invariato.

## Linguaggio visivo

Palette, font e scala fluida restano quelli di `web-site/src/index.css`.
Cambiano i dettagli che fanno «pagina generata» (fonte: skill
`frontend-design`):

- **Via l'eyebrow** sopra ogni titolo (`Eyebrow`, i campi `eyebrow` del
  contenuto della home). La pagina d'invito resta com'è.
- **Via le stringhe a puntini** («In beta · senza carta · …») dal copy della
  home: frasi vere.
- Il «wow» si spende in apertura e nella storia; altrove niente ombre e
  gradienti decorativi ripetuti, raggi diversi per gerarchia (non un raggio
  unico su tutto).
- Numeri progressivi solo nella storia, perché lì il contenuto **è** una
  sequenza.

## Copy

Il registro resta quello di `it.ts` (semplice, concreto, una riga per idea). Il
builder scrive le nuove chiavi (passi della storia con il loro «prima», righe
del «resto») dentro i vincoli; il fondatore le rilegge nella revisione finale.
Il titolo d'apertura di oggi («I turni della settimana in dieci minuti, non in
una serata.») resta salvo decisione contraria in revisione — «La settimana si fa
da sola» della bozza era una prova e promette troppo.

`types.ts` cambia di conseguenza (via `eyebrow` della home, `problem`/`how`/`pro`
fusi in `story` e `rest`); `Content` resta la sola forma del copy.

## Tecnica

- Dipendenza `motion` nella root (`yarn add motion`, versione esatta e stabile),
  importata **solo** da `web-site/src` (`motion/react`). App e dashboard non la
  toccano.
- I mock restano HTML in `src/mock/`, aria-hidden; il testo vero sta nelle
  sezioni. I dati finti dei mock sono costanti nei file mock (come oggi), non nel
  copy.
- Reduced motion: `useReducedMotion` → stati finali, nessuna trasformazione
  legata allo scroll.
- Nessun contenuto deve dipendere dal JS per essere letto: senza JS si vede la
  settimana già completa e i passi in colonna (stesso principio di `Reveal`).
- Il primo schermo non aspetta download: niente immagini pesanti nell'apertura.

## Verifica

- `yarn site:typecheck`, `yarn lint`, `yarn test` (glossario, font esterni,
  pagine legali, listino) verdi; `yarn site:build` riuscito, con il peso del
  bundle prima/dopo annotato.
- Prova visuale a 1440, 1024 e 375 px (Chrome e Safari), con reduced motion
  acceso e spento; nessuno scroll orizzontale.
- Revisione del copy da parte del fondatore prima del rilascio.

## Lasciato al builder

Durate e curve delle animazioni, dati finti dei mock (nel rispetto degli esempi
misti), come si stringe la griglia nel telefono, la griglia tipografica del
«resto», i dettagli del restyling dei prezzi, la forma del mock del file per il
consulente.

## Scelte mie da controllare

- Nav che si nasconde scorrendo.
- `HowItWorks` («Si parte in un pomeriggio») non è più una sezione: «aggiungi il
  team con l'email» passa nel «resto», il resto lo dice la storia.
- La chiusura riusa la settimana dell'apertura, confermata.
- Sotto `lg` niente effetto sticky.
