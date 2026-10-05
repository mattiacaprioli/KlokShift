# web-site — sito vetrina

La pagina pubblica di KlokShift: cosa fa il prodotto, per chi, e il pulsante che
porta alla registrazione della sede. È la **radice** del sito su GitHub Pages;
la dashboard sta sotto `/app/` (vedi `web/README.md`).

Qui dentro non c'è niente del prodotto: nessun Supabase, nessun `src/features`,
nessun router. È una pagina sola con le ancore, e l'unica cosa che condivide con
l'app sono i **token di design**, copiati in `src/index.css` dagli stessi valori
di `web/src/index.css`.

## Comandi (dalla root del repo)

```bash
yarn site:dev         # dev server Vite
yarn site:build       # build di produzione → web-site/dist
yarn site:preview     # serve la build
yarn site:typecheck   # tsc con il tsconfig di qui
yarn lint             # eslint su src/, web/src/ E web-site/src/
```

## Regola che tiene in piedi tutto il resto: niente stringhe nei componenti

Il copy vive **solo** in `src/content/it.ts`, tipizzato da `src/content/types.ts`.
I componenti leggono `t` da `src/content`. È la condizione perché inglese e
spagnolo siano un secondo file e non una riscrittura: aggiungere `en.ts`,
cambiare una riga in `src/content/index.ts`, buildare in una sottocartella
(`/en/`, `/es/`) e dichiarare gli `hreflang` nel `<head>` — Pages non ha
redirect lato server, quindi la lingua sta nel path, non in un negoziato.

`document.documentElement.lang` viene da `content.lang` (in `App.tsx`), così non
resta un `lang="it"` dimenticato nell'HTML.

## Cosa NON si può scrivere nel copy

Il sito deve raccontare il prodotto che esiste oggi:

- **niente recensioni, reputazione o QR** — rimossi il 2026-10-04;
- **niente annunci o candidature** — il marketplace è stato rimosso il 2026-09-12;
- **niente paghe o buste paga** — KlokShift conta ore, non soldi;
- **niente referral** («un mese gratis a chi porti») — non esiste ancora nel prodotto;
- **niente numeri di tempo risparmiato né testimonianze** finché non sono veri.

Il **listino pubblico** è qui; riepiloghi contrattuali e acquisti saranno sul
web. L'app nativa non mostra prezzi:

- fino a 30 dipendenti unici nell'intera azienda: 29 € al mese oppure 290 € all'anno;
- dipendenti illimitati: 49 € al mese oppure 490 € all'anno;
- sede aggiuntiva: 15 € al mese oppure 150 € all'anno;
- IVA esclusa e 30 giorni di prova senza carta.

Con la fatturazione annuale si pagano 10 mensilità invece di 12: sono quindi
inclusi **due mesi gratuiti**. Se cambia un importo, aggiornare insieme
`src/content/it.ts` e l'`offers` JSON-LD in `index.html`.

## Regole commerciali approvate, da implementare

Fonte delle decisioni: [MONETIZATION.md](../docs/MONETIZATION.md). Le attività
sono in [MONETIZATION-AND-FOUNDER-DASHBOARD.md](../plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md);
la dashboard personale in [FOUNDER-DASHBOARD.md](../docs/FOUNDER-DASHBOARD.md).

I due piani includono le stesse funzioni, con capacità distinta. La prova è di
30 giorni senza carta per tutte le nuove aziende. Sono previste gratuità a
vita assegnate dal fondatore, pausa mensile a fine periodo pagato, annuale senza
congelamento e 12 mesi gratuiti di consultazione/export da fine operatività.
Le altre regole approvate riguardano tolleranza di 7 giorni sugli insoluti,
rettifiche pregresse, upgrade/downgrade espliciti, preavviso prezzi di 60 giorni,
rimborsi, spazio documenti e assistenza. La quota complessiva iniziale di circa
2 GB documenti per azienda va calibrata sui tester prima di pubblicarla.

Questa documentazione non attiva i flussi nel prodotto. Copy, FAQ, CTA,
metadata/JSON-LD e condizioni devono essere allineati quando il servizio sarà
realmente disponibile. Non pubblicare come già attivi checkout, pausa, archivio,
tempi di ripristino o assistenza non ancora predisposti. I tester gratuiti a
vita non costituiscono un freemium aperto al pubblico. La dicitura IVA attuale
e i documenti fiscali vanno verificati sul canale di vendita scelto.

Il pubblico è **qualunque azienda con personale a turni**, non solo
l'ospitalità: sul sito le persone sono «team» / «dipendenti», il luogo «sede».

L'elenco è ripetuto in testa a `src/content/it.ts`: se una feature entra o esce
dal prodotto, quel file va aggiornato come `src/features/onboarding/introContent.ts`.

## Mockup, non screenshot

Nella repo non ci sono screenshot di prodotto: i "fermi immagine" sono
ricostruiti in HTML (`src/mock/`) con i token veri e le etichette vere
(`3/3 coperti`, `manca 1`, `Da confermare`, `Esporta CSV`).

`src/mock/Shot.tsx` è la cornice. Quando arriva uno screenshot vero:

```tsx
<Shot kind="phone" src="shots/agenda.png" alt="…" />   // niente children
```

Il file va in `public/shots/`, e il mock corrispondente si cancella.

## Responsive

Mobile-first: le classi senza prefisso sono il telefono, `sm:`/`lg:` aggiungono.
Due punti che si rompono facilmente e vanno ricontrollati a ogni modifica:

- **`PlanningMock` è largo per natura** (una colonna per giorno): ha una
  larghezza minima e scorre **dentro** il proprio `overflow-x-auto`. La pagina
  non deve mai scorrere in orizzontale — si verifica con
  `document.documentElement.scrollWidth === document.documentElement.clientWidth`.
- **La CTA compare due volte su mobile** se si sbaglia: quella della nav è
  nascosta sotto `sm` da un `<span className="hidden sm:block">` *attorno* al
  bottone, non da una classe sul bottone (che porta già `inline-flex` fra le sue
  classi di base, e in Tailwind vince l'ordine nel foglio di stile). Sotto `sm`
  la CTA è la barra fissa in basso (`sections/MobileCta.tsx`), che sparisce
  quando arriva la CTA finale.

## Pagine legali

`public/privacy.html` e `public/elimina-account.html` sono file statici, non
rotte React: i loro URL stanno nell'app (`src/features/account/legal.ts`) e
nelle schede degli store, quindi **i nomi dei file non cambiano** e non devono
dipendere dal bundle per aprirsi. Stavano in `web-review/` finché quella cartella
occupava la radice.

Il testo è allineato al comportamento di cancellazione implementato il 23/09:
la scheda dell'organico resta nominativa e scollegata dall'account, mentre i file
caricati dall'account vengono rimossi prima di eliminare le credenziali. Recapito
privacy e dati fiscali restano da confermare prima della messa in esercizio.

Il nuovo ciclo commerciale richiede inoltre condizioni del servizio e accordo
sul trattamento dei dati coerenti con prova, pagamenti, archivio e cancellazione.
La durata di 12 mesi è una scelta commerciale: l'EDPB non stabilisce un termine
universale. Validare finalità, necessità e tempi per categoria, incluse copie e
backup. Le pagine pubbliche attuali descrivono il comportamento esistente e
andranno aggiornate con il rilascio effettivo; la promessa di eliminazione dei
backup entro 30 giorni va verificata sulla configurazione reale.

## Variabili d'ambiente

Vite legge il `.env` della root (`envDir` + `envPrefix` in `vite.config.mts`).
L'unica che questo sito usa è `EXPO_PUBLIC_APP_URL`: dove sta la dashboard.
Se manca, le CTA puntano a `./app/`, che è dove la mette il workflow di deploy.
In locale la si punta al dev server di `web` per provare i link davvero.

`EXPO_PUBLIC_SITE_URL` non serve qui, ma serve all'**app**: è la base degli URL
delle pagine legali. Va impostata nel `.env`, su EAS e nelle `vars` di GitHub;
se manca, `legal.ts` usa esplicitamente `https://klokshift.com`, mai localhost o
il vecchio sito delle recensioni.

## Deploy

`.github/workflows/deploy-web.yml` monta un unico artifact Pages:

```
/              ← web-site/dist
/app/          ← web/dist
```

`web-review/` (le recensioni dei clienti, sotto `/recensioni/`) e lo shim che vi
rimandava i QR già stampati (`?w=<id>`) sono stati rimossi il 2026-10-04: quei QR
ora aprono la vetrina.

SEO: `robots.txt`, `sitemap.xml`, canonical, Open Graph e JSON-LD sono nel
`<head>` di `index.html` e in `public/`. Gli URL assoluti là dentro sono quelli
di Pages: al primo dominio proprio vanno cambiati in un colpo solo (canonical,
`og:url`, `og:image`, sitemap, robots).

`public/og.png` (1200×630) è generato, non disegnato a mano: se cambia la
headline va rifatto.
