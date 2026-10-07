import type { Content } from "./types";
import { PLAN_PRICES, formatEuro } from "../../../shared/pricing";

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
 *   - recensioni / reputazione / QR → rimossi il 2026-10-04
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
    cta: "Prova la beta",
  },

  hero: {
    eyebrow: "Turni e ore del personale",
    title: "I turni della settimana in dieci minuti, non in una serata.",
    lead: "Pianifichi, il team conferma dal telefono e le ore dei turni si sommano automaticamente. Addio a fogli Excel e gruppi WhatsApp.",
    ctaPrimary: "Prova la beta",
    ctaSecondary: "Guarda come funziona",
    note: "Beta: prova Team di 30 giorni, una sede, senza carta. I pagamenti non sono ancora disponibili.",
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
        title: "Prepara la prima sede",
        body: "Crea l'account, conferma l'email e prepara la sede. Da «Piano e accesso» avvii la prova di 30 giorni.",
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
    eyebrow: "Listino previsto al lancio",
    title: "Due piani semplici. Una sede inclusa.",
    lead: "Stesse funzioni, capacità diversa per l'intera azienda. Con l'annuale paghi 10 mensilità per 12 mesi consecutivi. Durante la beta puoi provare: gli acquisti non sono ancora disponibili.",
    billing: {
      label: "Periodo di fatturazione",
      monthly: "Mensile",
      annual: "Annuale",
      annualBadge: "2 mesi gratis",
    },
    options: [
      {
        name: "Base · fino a 30 persone",
        monthly: {
          amount: formatEuro(PLAN_PRICES.base.monthly),
          period: "al mese",
        },
        annual: {
          amount: formatEuro(PLAN_PRICES.base.annual),
          period: "all'anno",
          equivalent: "Equivale a 24,17 € al mese, con fatturazione annuale.",
          saving: "Risparmi 58 € all'anno",
        },
        details: ["30 persone uniche nell'intera azienda", "1 sede inclusa", "Prezzo IVA esclusa"],
        badge: "Per iniziare",
      },
      {
        name: "Team · senza limite persone",
        monthly: {
          amount: formatEuro(PLAN_PRICES.team.monthly),
          period: "al mese",
        },
        annual: {
          amount: formatEuro(PLAN_PRICES.team.annual),
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
      detail: "Una sede con il proprio planning e organico, nella stessa azienda. Chi lavora in più sedi conta una sola volta nel limite persone.",
    },
    note: "Crea l'account e la prima sede, poi avvia la prova. Nessun addebito automatico alla scadenza.",
    cta: "Prova la beta",
  },

  faq: {
    eyebrow: "Domande",
    title: "Prima di iniziare.",
    items: [
      {
        q: "Serve una carta di credito per provare?",
        a: "No. Ogni nuova azienda ha una prova unica di 30 giorni con il piano Team, tutte le funzioni e una sede. Parte quando il titolare conferma l'avvio da «Piano e accesso», dopo aver preparato la prima sede. Non si rinnova a pagamento.",
      },
      {
        q: "Posso già acquistare un piano?",
        a: "Durante la beta gli acquisti non sono ancora disponibili. Puoi creare l'account, preparare la prima sede e avviare la prova gratuita. Il listino mostra i prezzi previsti al lancio; il piano a pagamento si attiverà solo dopo un acquisto esplicito sul web.",
      },
      {
        q: "I dipendenti devono pagare?",
        a: "No. Il piano è dell'azienda. Al lancio Base prevede fino a 30 persone uniche nell'intera azienda e Team non ha un limite persone; entrambi includono le stesse funzioni. Una persona che lavora in due sedi conta una sola volta.",
      },
      {
        q: "Quanto risparmio con il pagamento annuale?",
        a: "Paghi 10 mesi invece di 12: 290 € all'anno per il piano fino a 30 dipendenti e 490 € per quello senza limiti. Anche una sede aggiuntiva costa 150 € all'anno invece di 180 €.",
      },
      {
        q: "E se chiudo per la stagione, o non rinnovo?",
        a: "Alla fine della prova l'operatività si ferma. Lo storico resta consultabile ed esportabile per 12 mesi dalla fine dell'operatività; per le rettifiche pregresse c'è una finestra separata di 7 giorni. Al lancio pagante la pausa mensile decorrerà dalla fine del periodo pagato. L'annuale copre 12 mesi consecutivi, senza congelamento automatico. Pausa, disdetta e cancellazione dei dati sono operazioni distinte.",
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
    lead: "Prova la beta: prepara la prima sede e avvia 30 giorni con il piano Team. Senza carta e senza rinnovo a pagamento.",
    cta: "Prova la beta",
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
