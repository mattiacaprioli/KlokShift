import type { Content } from "./types";

/*
 * TUTTO il copy della vetrina sta qui. Nessuna stringa nei componenti: è la
 * condizione perché inglese e spagnolo siano solo un secondo file accanto a
 * questo (vedi README.md).
 *
 * Registro: **asciutto**. Una riga per idea, verbi diretti, nessuna frase che
 * spieghi due volte la stessa cosa. Se un `body` supera le due righe sul
 * telefono, è troppo lungo: il titolo della card fa già metà del lavoro.
 *
 * ⚠️ Cosa NON si può scrivere qui, e perché:
 *   - recensioni / reputazione / QR → sospesi (`src/features/reviews/config.ts`)
 *   - annunci / candidature / marketplace → rimossi dal codice il 2026-09-12
 *   - paghe, compensi, pagamenti, commissioni → fuori scope MVP
 *   - prezzi o piani con cifre → il modello non è ancora definito
 * Se una feature entra o esce dal prodotto, questo file va aggiornato, come
 * `src/features/onboarding/introContent.ts`.
 */
export const it: Content = {
  lang: "it",

  brand: {
    name: "topWaitr",
    tagline: "Gestione turni per l'ospitalità",
  },

  nav: {
    menuLabel: "Apri il menu",
    closeLabel: "Chiudi il menu",
    links: [
      { href: "#locali", label: "Per i locali" },
      { href: "#professionisti", label: "Per i professionisti" },
      { href: "#come-funziona", label: "Come funziona" },
      { href: "#faq", label: "Domande" },
    ],
    cta: "Crea il tuo locale",
  },

  hero: {
    eyebrow: "Gestione turni per l'ospitalità",
    title: "I turni del tuo locale, in un posto solo.",
    // I settori non stanno qui: hanno una sezione tutta loro più sotto.
    lead: "Organico, turni, ore e messaggi in un'unica app.",
    ctaPrimary: "Crea il tuo locale",
    ctaSecondary: "Guarda come funziona",
    note: "Gratis per iniziare. Nessuna carta richiesta.",
    shotAlt: "L'agenda dei turni della settimana",
  },

  problem: {
    eyebrow: "Il punto",
    title: "Il turno è deciso. Chi lo copre, no.",
    lead: "Il piano vive in tre posti. Nessuno dice se sabato è coperto.",
    items: [
      {
        title: "Il gruppo su WhatsApp",
        body: "Hai scritto il turno. Chi ha risposto, no.",
      },
      {
        title: "Il foglio in cucina",
        body: "Cambia un turno e va rifatto. E riletto da tutti.",
      },
      {
        title: "Le ore a fine mese",
        body: "Contate a memoria, la sera prima del commercialista.",
      },
    ],
  },

  venue: {
    eyebrow: "Per i locali",
    title: "Pianifica con il tuo organico, non con i post-it.",
    lead: "Inserisci lo staff una volta. Turni, copertura e ore si tengono da sé.",
    features: [
      {
        title: "Il tuo organico, su più sedi",
        body: "Ruoli, tipo di rapporto e ore da contratto. Una scheda per persona, anche con due locali.",
      },
      {
        title: "Copertura sotto controllo",
        body: "Dici quanti servono per ruolo. L'agenda segna cosa è scoperto.",
      },
      {
        title: "Planning da scrivania",
        body: "Trascini i turni, duplichi la settimana, stampi il piano.",
      },
      {
        title: "Presenze e ore, già contate",
        body: "Segni chi c'era. A fine mese esporti PDF o CSV.",
      },
      {
        title: "Documenti con le scadenze",
        body: "HACCP, contratti, visite mediche. Sai cosa scade prima che scada.",
      },
      {
        title: "I ruoli che usi davvero",
        body: "Sala, cucina, bar, reception, runner: li crei tu.",
      },
    ],
    shotPlanningAlt: "Il planning settimanale con i turni per persona",
    shotHoursAlt: "Il riepilogo mensile delle ore per persona",
  },

  pro: {
    eyebrow: "Per i professionisti",
    title: "Sai quando lavori. E quanto hai lavorato.",
    lead: "Il turno arriva, lo confermi, le ore si contano da sole.",
    features: [
      {
        title: "Conferma con un tocco",
        body: "Il locale assegna, tu rispondi dall'app.",
      },
      {
        title: "Le tue ore, sempre aggiornate",
        body: "Ogni turno svolto entra nel monte ore del mese.",
      },
      {
        title: "Chiedi un cambio",
        body: "Se non ce la fai, chiedi una sostituzione. Il locale la vede subito.",
      },
      {
        title: "Vedi i turni dei colleghi",
        body: "Se il locale lo consente, sai con chi sei in servizio.",
      },
    ],
    shotAlt: "Una conversazione tra locale e professionista",
  },

  how: {
    eyebrow: "Come funziona",
    title: "Quattro passi, poi va da sé.",
    steps: [
      {
        title: "Crea il tuo locale",
        body: "Nome, città, logo. Più sedi sullo stesso account.",
      },
      {
        title: "Aggiungi l'organico",
        body: "Inviti via email, o crei tu la scheda.",
      },
      {
        title: "Pianifica la settimana",
        body: "Crei i turni e assegni le persone. Telefono o browser.",
      },
      {
        title: "Il team conferma",
        body: "Arriva la notifica. Tu vedi la copertura, le ore si contano.",
      },
    ],
  },

  sectors: {
    eyebrow: "Per chi",
    title: "Se si lavora su turni, topWaitr serve.",
    lead: "Nato in sala, non solo per la sala.",
    items: [
      "Ristoranti",
      "Hotel",
      "Catering",
      "Discoteche",
      "Pub e cocktail bar",
      "Agenzie di eventi",
    ],
  },

  platforms: {
    eyebrow: "App e scrivania",
    title: "Il telefono per tutti, il browser per chi pianifica.",
    items: [
      {
        title: "L'app",
        body: "Agenda, conferme, ore, documenti e messaggi. Notifiche quando qualcosa cambia.",
      },
      {
        title: "La dashboard",
        body: "Planning trascinabile, duplicazione, stampa ed export. Niente da installare.",
      },
    ],
  },

  plans: {
    eyebrow: "Piani",
    title: "Coprire i turni resta gratis.",
    lead: "La gestione del personale andrà nel Pro. I piani li stiamo definendo: oggi lo usi tutto.",
    freeTitle: "Sempre gratis",
    freeItems: [
      "Organico e ruoli",
      "Turni, assegnazioni e conferme",
      "Agenda e copertura",
      "Messaggi e notifiche",
    ],
    proTitle: "Andrà nel piano Pro",
    proItems: [
      "Ore e presenze del mese",
      "Export PDF e CSV",
      "Statistiche del personale",
    ],
    note: "Nessun prezzo da annunciare, nessuna carta da inserire.",
  },

  faq: {
    eyebrow: "Domande",
    title: "Prima di iniziare.",
    items: [
      {
        q: "Serve una carta di credito?",
        a: "No. Crei il locale, aggiungi lo staff e inizi.",
      },
      {
        q: "Chi lavora con me deve pagare?",
        a: "No. L'app del professionista è gratuita.",
      },
      {
        q: "Funziona con più locali?",
        a: "Sì. Le sedi stanno sullo stesso account e chi lavora in due sedi resta una persona sola, con un unico conteggio delle ore.",
      },
      {
        q: "Devo installare qualcosa?",
        a: "Chi lavora usa l'app. Tu puoi fare tutto dal browser.",
      },
      {
        q: "Dove finiscono i dati del personale?",
        a: "Su server nell'Unione Europea. Ogni locale vede solo i propri, e ognuno può chiedere la cancellazione del proprio account.",
      },
      {
        q: "Gestisce anche le paghe?",
        a: "No. topWaitr conta le ore e le esporta. Le buste paga restano al tuo consulente.",
      },
    ],
  },

  finalCta: {
    title: "Il prossimo servizio, organizzato bene.",
    lead: "Crea il tuo locale e pianifica la prossima settimana.",
    cta: "Crea il tuo locale",
    secondary: "Ho già un account",
    note: "Sei un professionista? Scarica l'app e fatti invitare dal tuo locale.",
  },

  footer: {
    tagline: "Gestione dei turni per il settore dell'ospitalità.",
    // ⚠️ Da confermare: stesso indirizzo va messo in `public/privacy.html`,
    // dove oggi c'è il placeholder `[EMAIL DI CONTATTO]`.
    email: "info@topwaitr.com",
    emailLabel: "Scrivici",
    links: [
      { href: "./privacy.html", label: "Informativa sulla privacy" },
      { href: "./elimina-account.html", label: "Elimina il tuo account" },
    ],
    rights: "Tutti i diritti riservati.",
  },

  invite: {
    eyebrow: "Invito",
    title: "Ti hanno aggiunto a un organico.",
    lead: "Il locale che ti ha invitato usa topWaitr per organizzare i turni. Scarica l'app e trovi i tuoi.",
    steps: [
      {
        title: "Scarica l'app",
        body: "Su iPhone o su Android. Sta arrivando su entrambi gli store.",
      },
      {
        title: "Registrati con l'email dell'invito",
        body: "È quella a cui è arrivato il messaggio che ti ha portato qui.",
      },
      {
        title: "Trovi il locale e i tuoi turni",
        body: "Nessuna richiesta da accettare: la tua scheda è già pronta.",
      },
    ],
    calloutTitle: "Usa lo stesso indirizzo",
    calloutBody:
      "Con un indirizzo diverso ti registri lo stesso, ma non ti colleghiamo alla scheda che il locale ha già preparato.",
    storesSoon: "In arrivo su App Store e Google Play.",
    iosLabel: "Scarica su App Store",
    androidLabel: "Disponibile su Google Play",
    whatTitle: "Cosa ci trovi",
    whatItems: [
      "I tuoi turni, giorno per giorno, con orari e ruolo.",
      "Le ore che hai fatto, contate senza doverle scrivere a mano.",
      "I messaggi con il locale, per cambi e imprevisti.",
    ],
    homeLabel: "Scopri topWaitr",
  },
};
