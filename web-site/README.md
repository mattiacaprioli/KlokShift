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

- **niente recensioni, reputazione o QR** — sospesi (`src/features/reviews/config.ts`);
- **niente annunci o candidature** — il marketplace è stato rimosso il 2026-09-12;
- **niente paghe o buste paga** — KlokShift conta ore, non soldi;
- **niente referral** («un mese gratis a chi porti») — non esiste ancora nel prodotto;
- **niente numeri di tempo risparmiato né testimonianze** finché non sono veri.

I **prezzi** invece ci sono (sezione `#prezzi`: 29 €/mese fino a 30 dipendenti,
49 €/mese con dipendenti illimitati, +15 € per sede in più; l'annuale costa
rispettivamente 290 €, 490 € e +150 € per sede, cioè 2 mesi gratis; 30 giorni
di prova senza carta) e stanno **solo qui e
nella dashboard web**: l'app non mostra prezzi né link al sito (App Store
3.1.3, vedi la memoria sui vincoli di monetizzazione). Se cambiano, vanno
aggiornati insieme `src/content/it.ts` e l'`offers` del JSON-LD in `index.html`.

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

⚠️ Contengono ancora i placeholder `[P.IVA]` e `[EMAIL DI CONTATTO]`, e il testo
parla di candidature e recensioni: va riallineato al prodotto attuale.

## Variabili d'ambiente

Vite legge il `.env` della root (`envDir` + `envPrefix` in `vite.config.mts`).
L'unica che questo sito usa è `EXPO_PUBLIC_APP_URL`: dove sta la dashboard.
Se manca, le CTA puntano a `./app/`, che è dove la mette il workflow di deploy.
In locale la si punta al dev server di `web` per provare i link davvero.

`EXPO_PUBLIC_SITE_URL` non serve qui, ma serve all'**app**: è la base degli URL
delle pagine legali. Va impostata nel `.env`, su EAS e nelle `vars` di GitHub;
finché manca, `legal.ts` ripiega su `EXPO_PUBLIC_REVIEW_SITE_URL`, che punta allo
stesso host.

## Deploy

`.github/workflows/deploy-web.yml` monta un unico artifact Pages:

```
/              ← web-site/dist
/app/          ← web/dist
/recensioni/   ← web-review/   (sospeso, in uscita)
```

Finché `web-review/` esiste, `index.html` contiene uno shim: un ingresso con
`?w=<id>` (i QR già stampati) viene rimandato a `/recensioni/?w=<id>`. Quando le
recensioni verranno rimosse, si cancellano insieme cartella, riga di `cp` e shim.

SEO: `robots.txt`, `sitemap.xml`, canonical, Open Graph e JSON-LD sono nel
`<head>` di `index.html` e in `public/`. Gli URL assoluti là dentro sono quelli
di Pages: al primo dominio proprio vanno cambiati in un colpo solo (canonical,
`og:url`, `og:image`, sitemap, robots).

`public/og.png` (1200×630) è generato, non disegnato a mano: se cambia la
headline va rifatto.
