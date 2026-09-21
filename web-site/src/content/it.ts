import type { Content } from "./types";

/*
 * TUTTO il copy della vetrina sta qui. Nessuna stringa nei componenti: è la
 * condizione perché inglese e spagnolo siano solo un secondo file accanto a
 * questo (vedi README.md).
 *
 * Registro: **semplice e concreto**. Una riga per idea, verbi diretti, il
 * tempo risparmiato come argomento. Se un `body` supera le due righe sul
 * telefono, è troppo lungo: il titolo della card fa già metà del lavoro.
 *
 * Pubblico: **qualunque azienda con personale a turni**, non solo
 * l'ospitalità. Per le persone si dice «team» / «dipendenti» (non
 * «professionista»); il luogo resta «sede».
 *
 * ⚠️ Cosa NON si può scrivere qui, e perché:
 *   - recensioni / reputazione / QR → sospesi (`src/features/reviews/config.ts`)
 *   - annunci / candidature / marketplace → rimossi dal codice il 2026-09-12
 *   - paghe, buste paga, compensi → KlokShift conta ore, non soldi
 *   - referral / mese regalato → non esiste ancora nel prodotto
 *   - numeri di tempo risparmiato o testimonianze → solo se veri e verificabili
 * I prezzi stanno qui e nella dashboard web, **mai nell'app** (App Store 3.1.3).
 * Se una feature entra o esce dal prodotto, questo file va aggiornato, come
 * `src/features/onboarding/introContent.ts`.
 */
export const it: Content = {
  lang: "it",

  brand: {
    name: "KlokShift",
    tagline: "Turni, presenze e ore del tuo team",
  },

  nav: {
    menuLabel: "Apri il menu",
    closeLabel: "Chiudi il menu",
    links: [
      { href: "#come-funziona", label: "Come funziona" },
      { href: "#funzioni", label: "Funzioni" },
      { href: "#prezzi", label: "Prezzi" },
      { href: "#faq", label: "Domande" },
    ],
    cta: "Prova gratis 30 giorni",
  },

  hero: {
    eyebrow: "Turni e ore del personale",
    title: "I turni della settimana in dieci minuti, non in una serata.",
    lead: "Pianifichi, il team conferma dal telefono, le ore si contano da sole. Addio a fogli Excel e gruppi WhatsApp.",
    ctaPrimary: "Prova gratis 30 giorni",
    ctaSecondary: "Guarda come funziona",
    note: "30 giorni gratis, senza carta. Poi da 29 € al mese, per tutto il team.",
    shotAlt: "L'agenda dei turni della settimana",
  },

  problem: {
    eyebrow: "Prima e dopo",
    title: "Il turno è deciso. Chi lo copre, no.",
    lead: "Oggi il piano vive in tre posti. Con KlokShift, in uno.",
    items: [
      {
        title: "Il gruppo su WhatsApp",
        body: "Scrivi il turno e aspetti le risposte.",
        after: "Ognuno conferma con un tocco. Vedi subito chi manca.",
      },
      {
        title: "Il foglio Excel",
        body: "Cambi un turno e rifai tutto. Poi lo rimandi a tutti.",
        after: "Sposti il turno. Chi è coinvolto riceve la notifica.",
      },
      {
        title: "Le ore a fine mese",
        body: "Contate a memoria, la sera prima del consulente.",
        after: "Già contate. Esporti PDF o CSV in un clic.",
      },
    ],
  },

  venue: {
    eyebrow: "Funzioni",
    title: "Tutto quello che serve per organizzare il personale. Niente di più.",
    lead: "Inserisci il team una volta. Turni, copertura e ore si tengono da sé.",
    features: [
      {
        title: "Il tuo team, su più sedi",
        body: "Ruoli, tipo di contratto e ore previste. Una scheda per persona, anche su due sedi.",
      },
      {
        title: "Copertura sotto controllo",
        body: "Dici quanti servono per ruolo. L'agenda segna cosa è scoperto.",
      },
      {
        title: "Planning da scrivania",
        body: "Trascini i turni, duplichi la settimana, stampi il piano. Chi è coinvolto viene avvisato.",
      },
      {
        title: "Presenze e ore, già contate",
        body: "Segni chi c'era. A fine mese esporti PDF o CSV per il consulente.",
      },
      {
        title: "Documenti con le scadenze",
        body: "Contratti, certificati, visite mediche. Sai cosa scade prima che scada.",
      },
      {
        title: "I ruoli che usi davvero",
        body: "Sala, cassa, magazzino, reception, turno notte: li crei tu.",
      },
    ],
    shotPlanningAlt: "Il planning settimanale con i turni per persona",
    shotHoursAlt: "Il riepilogo mensile delle ore per persona",
  },

  pro: {
    eyebrow: "Per il tuo team",
    title: "Il team sa quando lavora. Senza chiederlo a te.",
    lead: "Il turno arriva sul telefono, si conferma, le ore si contano da sole. L'app per i dipendenti è gratuita.",
    features: [
      {
        title: "Conferma con un tocco",
        body: "Tu assegni, loro rispondono dall'app.",
      },
      {
        title: "Le proprie ore, sempre aggiornate",
        body: "Ogni turno svolto entra nel monte ore del mese.",
      },
      {
        title: "Cambi e assenze in chat",
        body: "Una sostituzione o un giorno di ferie si chiedono dall'app. Tu li vedi subito.",
      },
      {
        title: "I turni dei colleghi",
        body: "Se lo consenti, ognuno sa con chi è in servizio.",
      },
    ],
    shotAlt: "Una conversazione tra la sede e un dipendente",
  },

  how: {
    eyebrow: "Come funziona",
    title: "Si parte in un pomeriggio.",
    steps: [
      {
        title: "Crea la tua sede",
        body: "Nome e città. Le altre sedi le aggiungi quando servono.",
      },
      {
        title: "Aggiungi il team",
        body: "Inviti via email, o crei tu la scheda.",
      },
      {
        title: "Pianifica la settimana",
        body: "Crei i turni e assegni le persone. Dal telefono o dal browser.",
      },
      {
        title: "Il team conferma",
        body: "Arriva la notifica. Tu vedi la copertura, le ore si contano.",
      },
    ],
  },

  sectors: {
    eyebrow: "Per chi",
    title: "Se il tuo personale lavora su turni, KlokShift fa per te.",
    lead: "Stesso metodo, qualunque settore.",
    items: [
      "Ristoranti e bar",
      "Hotel",
      "Negozi e retail",
      "Imprese di pulizia",
      "Sicurezza e vigilanza",
      "Assistenza e cura",
      "Palestre e centri sportivi",
      "Logistica e magazzini",
      "Eventi",
      "Stabilimenti balneari",
    ],
  },

  platforms: {
    eyebrow: "App e browser",
    title: "Il telefono per il team, il browser per chi pianifica.",
    items: [
      {
        title: "L'app",
        body: "Turni, conferme, ore, documenti e messaggi. Una notifica quando qualcosa cambia.",
      },
      {
        title: "La dashboard",
        body: "Planning trascinabile, duplicazione, stampa ed export. Niente da installare.",
      },
    ],
  },

  plans: {
    eyebrow: "Prezzi",
    title: "Un prezzo per sede. Il team è incluso.",
    lead: "Nessun costo per dipendente: che siate in cinque o in cinquanta, il prezzo è lo stesso.",
    yearly: {
      name: "Annuale",
      price: "29 €",
      period: "al mese",
      billed: "348 € fatturati una volta l'anno",
      badge: "Risparmi 120 €",
    },
    monthly: {
      name: "Mensile",
      price: "39 €",
      period: "al mese",
      billed: "Disdici quando vuoi",
    },
    includedTitle: "Incluso in entrambi",
    included: [
      "Dipendenti illimitati",
      "App per il team, gratuita",
      "Planning, conferme e copertura",
      "Presenze, ore ed export PDF e CSV",
      "Documenti e scadenze",
      "Messaggi e notifiche",
    ],
    extraVenue: "Ogni sede in più: +19 € al mese. Un solo accesso, tutte le sedi sotto controllo.",
    note: "Prezzi IVA esclusa. 30 giorni gratis, senza carta.",
    cta: "Inizia la prova gratuita",
  },

  faq: {
    eyebrow: "Domande",
    title: "Prima di iniziare.",
    items: [
      {
        q: "Serve una carta di credito per provare?",
        a: "No. Hai 30 giorni con tutte le funzioni. Decidi dopo.",
      },
      {
        q: "I dipendenti devono pagare?",
        a: "No. L'app per il team è gratuita e non c'è un limite di persone.",
      },
      {
        q: "E se chiudo per la stagione, o non rinnovo?",
        a: "I dati restano tuoi. La dashboard passa in sola lettura: consulti lo storico e scarichi ore ed export per il consulente. Quando riapri, riattivi e riparti da dove eri.",
      },
      {
        q: "Ho più sedi. Come funziona?",
        a: "Il piano include una sede, ogni sede in più costa 19 € al mese. Tutte stanno sullo stesso account, e chi lavora in due sedi ha un unico conteggio delle ore.",
      },
      {
        q: "Devo installare qualcosa?",
        a: "Il team usa l'app. Tu puoi fare tutto dal browser.",
      },
      {
        q: "Dove finiscono i dati del personale?",
        a: "Su server nell'Unione Europea. Ogni azienda vede solo i propri, e ognuno può chiedere la cancellazione del proprio account.",
      },
      {
        q: "Fa anche le buste paga?",
        a: "No. KlokShift conta le ore e le esporta. Le buste paga restano al tuo consulente.",
      },
    ],
  },

  finalCta: {
    title: "La prossima settimana, pianificata in dieci minuti.",
    lead: "Crea la tua sede e prova KlokShift per 30 giorni.",
    cta: "Prova gratis 30 giorni",
    secondary: "Ho già un account",
    note: "Lavori in un'azienda che usa KlokShift? Scarica l'app e fatti invitare.",
  },

  footer: {
    tagline: "Turni, presenze e ore per chi lavora su turni.",
    // ⚠️ Da confermare: stesso indirizzo va messo in `public/privacy.html`,
    // dove oggi c'è il placeholder `[EMAIL DI CONTATTO]`.
    email: "info@klokshift.com",
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
    lead: "La sede che ti ha invitato usa KlokShift per organizzare i turni. Scarica l'app e trovi i tuoi.",
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
        title: "Trovi la sede e i tuoi turni",
        body: "Nessuna richiesta da accettare: la tua scheda è già pronta.",
      },
    ],
    calloutTitle: "Usa lo stesso indirizzo",
    calloutBody:
      "Con un indirizzo diverso ti registri lo stesso, ma non ti colleghiamo alla scheda che la sede ha già preparato.",
    storesSoon: "In arrivo su App Store e Google Play.",
    iosLabel: "Scarica su App Store",
    androidLabel: "Disponibile su Google Play",
    whatTitle: "Cosa ci trovi",
    whatItems: [
      "I tuoi turni, giorno per giorno, con orari e ruolo.",
      "Le ore che hai fatto, contate senza doverle scrivere a mano.",
      "I messaggi con la sede, per cambi e imprevisti.",
    ],
    homeLabel: "Scopri KlokShift",
  },

  inviteManager: {
    eyebrow: "Invito",
    title: "Ti hanno dato accesso a una sede.",
    lead: "Chi gestisce la sede ti ha aggiunto ai suoi collaboratori: da KlokShift organizzi i turni e segui l'organico.",
    steps: [
      {
        title: "Registrati come sede",
        body: "Dall'app scegli «Gestisco una sede». Dalla dashboard l'account è già quello.",
      },
      {
        title: "Usa l'email dell'invito",
        body: "È quella a cui è arrivato il messaggio che ti ha portato qui.",
      },
      {
        title: "Trovi la sede già pronta",
        body: "Niente da accettare: l'accesso e i permessi li ha già scelti chi ti ha invitato.",
      },
    ],
    calloutTitle: "Registrati come sede, non come professionista",
    calloutBody:
      "Con un account da professionista, o con un indirizzo diverso, entri in KlokShift ma non nella gestione della sede che ti ha invitato.",
    webTitle: "Anche dal computer",
    webBody:
      "La gestione dei turni si fa dall'app o dalla dashboard, con la stessa registrazione.",
    webLabel: "Apri la dashboard",
    whatTitle: "Cosa ci trovi",
    whatItems: [
      "L'agenda dei turni delle sedi su cui ti hanno dato accesso.",
      "L'organico della sede, con ruoli e disponibilità.",
      "Solo quello che il titolare ti ha abilitato: il resto non compare.",
    ],
  },
};
