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
 * Il listino definitivo sta sul sito, **mai nell'app** (App Store 3.1.3): con
 * l'annuale si pagano 10 mensilità invece di 12, quindi 2 mesi sono gratuiti.
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
    lead: "Pianifichi, il team conferma dal telefono e le ore dei turni si sommano automaticamente. Addio a fogli Excel e gruppi WhatsApp.",
    ctaPrimary: "Prova gratis 30 giorni",
    ctaSecondary: "Guarda come funziona",
    note: "30 giorni gratis, senza carta. Poi da 29 € al mese o 290 € all'anno, IVA esclusa.",
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
        after: "Turni e presenze sono già raccolti. Esporti PDF o CSV in un clic.",
      },
    ],
  },

  venue: {
    eyebrow: "Funzioni",
    title: "Tutto quello che serve per organizzare il personale. Niente di più.",
    lead: "Inserisci il team una volta. Turni, copertura e ore restano nello stesso posto.",
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
        title: "Presenze e ore, in un solo posto",
        body: "Segni chi c'era e correggi le ore effettive. A fine mese esporti PDF o CSV per il consulente.",
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
    lead: "Il turno arriva sul telefono e si conferma. Dopo il turno, le ore svolte restano aggiornate. L'app per i dipendenti è gratuita.",
    features: [
      {
        title: "Conferma con un tocco",
        body: "Tu assegni, loro rispondono dall'app.",
      },
      {
        title: "Le proprie ore, sempre aggiornate",
        body: "Ogni turno concluso entra nel riepilogo del mese.",
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
        body: "Arriva la notifica. Tu vedi la copertura e, dopo il turno, registri presenze e ore effettive.",
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
    title: "Due piani semplici. Una sede inclusa.",
    lead: "Scegli in base alla dimensione del team. Con l'annuale paghi 10 mesi invece di 12.",
    billing: {
      label: "Periodo di fatturazione",
      monthly: "Mensile",
      annual: "Annuale",
      annualBadge: "2 mesi gratis",
    },
    options: [
      {
        name: "Fino a 30 dipendenti",
        monthly: {
          amount: "29 €",
          period: "al mese",
        },
        annual: {
          amount: "290 €",
          period: "all'anno",
          equivalent: "Equivale a 24,17 € al mese, con fatturazione annuale.",
          saving: "Risparmi 58 € all'anno",
        },
        details: ["1 sede inclusa", "Prezzo IVA esclusa"],
        badge: "Per iniziare",
      },
      {
        name: "Dipendenti illimitati",
        monthly: {
          amount: "49 €",
          period: "al mese",
        },
        annual: {
          amount: "490 €",
          period: "all'anno",
          equivalent: "Equivale a 40,83 € al mese, con fatturazione annuale.",
          saving: "Risparmi 98 € all'anno",
        },
        details: ["1 sede inclusa", "Prezzo IVA esclusa"],
      },
    ],
    includedTitle: "Incluso in entrambi",
    included: [
      "App per il team, gratuita",
      "Planning, conferme e copertura",
      "Presenze, ore ed export PDF e CSV",
      "Documenti e scadenze",
      "Messaggi e notifiche",
    ],
    extraVenue: {
      monthly: "Sede aggiuntiva: 15 € al mese.",
      annual: "Sede aggiuntiva: 150 € all'anno — risparmi 30 €.",
      detail: "Una sede operativa completa, con il proprio planning e organico, nello stesso account.",
    },
    note: "30 giorni gratis, senza carta. Poi scegli la fatturazione mensile o annuale.",
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
        a: "No. L'app per il team è gratuita. Il piano da 29 € include fino a 30 dipendenti; quello da 49 € non prevede limiti.",
      },
      {
        q: "Quanto risparmio con il pagamento annuale?",
        a: "Paghi 10 mesi invece di 12: 290 € all'anno per il piano fino a 30 dipendenti e 490 € per quello senza limiti. Anche una sede aggiuntiva costa 150 € all'anno invece di 180 €.",
      },
      {
        q: "E se chiudo per la stagione, o non rinnovo?",
        a: "I dati restano tuoi. La dashboard passa in sola lettura: consulti lo storico e scarichi ore ed export per il consulente. Quando riapri, riattivi e riparti da dove eri.",
      },
      {
        q: "Ho più sedi. Come funziona?",
        a: "Ogni piano include una sede; ogni sede aggiuntiva costa 15 € al mese oppure 150 € all'anno. Tutte stanno sullo stesso account, e chi lavora in due sedi ha un unico conteggio delle ore.",
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
        a: "No. KlokShift organizza turni, presenze e ore ed esporta i dati per il consulente del lavoro. Non sostituisce il software paghe.",
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
