import type { Content } from "./types";
import { EXTRA_VENUE_PRICES, PLAN_PRICES, formatEuro } from "../../../shared/pricing";

/**
 * Importi in prosa, derivati dal listino unico (`shared/pricing.ts`): senza
 * decimali quando sono interi («15 €»). Mai scriverli a mano: cambiato il
 * listino, il testo deve seguirlo da sé.
 */
const euro = (amount: number) => formatEuro(amount).replace(/,00(?=\s€)/u, "");
/** Quanto si risparmia in un anno pagando l'annuale invece di 12 mensilità. */
const annualSaving = (prices: { monthly: number; annual: number }) =>
  prices.monthly * 12 - prices.annual;

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
 * «professionista», «personale»); il luogo resta «sede».
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
    cta: "Prova gratis",
  },

  hero: {
    eyebrow: "Turni e ore del tuo team",
    title: "I turni della settimana in dieci minuti, non in una serata.",
    lead: "Tu pianifichi, il team conferma e timbra dal telefono, le ore si contano da sole.",
    ctaPrimary: "Prova gratis 30 giorni",
    ctaSecondary: "Guarda come funziona",
    note: "In beta · senza carta · nessun rinnovo automatico",
    shotAlt: "L'agenda dei turni della settimana",
  },

  problem: {
    eyebrow: "Prima e dopo",
    title: "Il turno è deciso. Chi lo copre, no.",
    items: [
      {
        title: "Il gruppo su WhatsApp",
        body: "Scrivi il turno e aspetti le risposte.",
        after: "Ognuno conferma con un tocco. Vedi subito chi manca.",
      },
      {
        title: "Il foglio Excel",
        body: "Cambi un turno e rifai tutto.",
        after: "Lo sposti, e chi è coinvolto viene avvisato.",
      },
      {
        title: "Le ore a fine mese",
        body: "Contate a memoria, la sera prima.",
        after: "Il team timbra dall'app. Esporti in un clic.",
      },
    ],
  },

  venue: {
    eyebrow: "Funzioni",
    title: "Turni, presenze e ore. Niente moduli da attivare.",
    features: [
      {
        title: "Il tuo team, su più sedi",
        body: "Una scheda per persona, con ruoli e ore da contratto.",
      },
      {
        title: "Copertura sotto controllo",
        body: "Vedi subito i buchi e chi è in ferie.",
      },
      {
        title: "Planning da scrivania",
        body: "Trascini i turni, duplichi la settimana, stampi.",
      },
      {
        title: "Timbratura dall'app",
        body: "Entrata, uscita e pausa dal telefono.",
      },
      {
        title: "Documenti con le scadenze",
        body: "Sai cosa scade prima che scada.",
      },
      {
        title: "Pronto per il consulente",
        body: "Ore, pause e assenze in PDF o CSV.",
      },
    ],
    shotPlanningAlt: "Il planning settimanale con i turni per persona",
    shotHoursAlt: "Il riepilogo mensile delle ore per persona",
  },

  pro: {
    eyebrow: "Per il tuo team",
    title: "Il team sa quando lavora. Senza chiederlo a te.",
    lead: "L'app per i dipendenti è gratuita.",
    features: [
      {
        title: "Conferma con un tocco",
        body: "Tu assegni, loro rispondono.",
      },
      {
        title: "Timbra dal telefono",
        body: "E le ore del mese si aggiornano da sole.",
      },
      {
        title: "Cambi e assenze in chat",
        body: "Sostituzioni e ferie si chiedono dall'app.",
      },
      {
        title: "I turni dei colleghi",
        body: "Se vuoi, ognuno vede con chi lavora.",
      },
    ],
    shotAlt: "Una conversazione tra la sede e un dipendente",
  },

  how: {
    eyebrow: "Come funziona",
    title: "Si parte in un pomeriggio.",
    steps: [
      {
        title: "Crea la sede e avvia la prova",
        body: "Account, sede e 30 giorni senza carta, in pochi minuti.",
      },
      {
        title: "Aggiungi il team",
        body: "Con l'email di ognuno: chi si registra con quella trova già la sua sede.",
      },
      {
        title: "Pianifica la settimana",
        body: "Dal telefono o dal browser.",
      },
      {
        title: "Il team conferma",
        body: "Ricevono la notifica e rispondono.",
      },
    ],
  },

  sectors: {
    title: "Per chi lavora su turni",
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

  plans: {
    eyebrow: "Listino previsto al lancio",
    title: "Un prezzo per l'azienda, non per ogni dipendente.",
    lead: "Stesse funzioni in entrambi. In beta si prova gratis: gli acquisti non sono ancora attivi.",
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
          equivalent: `Equivale a ${formatEuro(PLAN_PRICES.base.annual / 12)} al mese, con fatturazione annuale.`,
          saving: `Risparmi ${euro(annualSaving(PLAN_PRICES.base))} all'anno`,
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
          equivalent: `Equivale a ${formatEuro(PLAN_PRICES.team.annual / 12)} al mese, con fatturazione annuale.`,
          saving: `Risparmi ${euro(annualSaving(PLAN_PRICES.team))} all'anno`,
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
      monthly: `Sede aggiuntiva: ${euro(EXTRA_VENUE_PRICES.monthly)} al mese.`,
      annual: `Sede aggiuntiva: ${euro(EXTRA_VENUE_PRICES.annual)} all'anno — risparmi ${euro(annualSaving(EXTRA_VENUE_PRICES))}.`,
      detail: "Chi lavora in più sedi conta una volta sola.",
    },
    note: "Nessun addebito automatico alla fine della prova.",
    cta: "Prova gratis 30 giorni",
  },

  faq: {
    eyebrow: "Domande",
    title: "Prima di iniziare.",
    items: [
      {
        q: "Serve una carta per provare?",
        a: "No. Hai 30 giorni gratis con il piano Team e una sede. Alla fine non paghi nulla in automatico.",
      },
      {
        q: "Posso già acquistare un piano?",
        a: "Non ancora: siamo in beta. I prezzi qui sopra sono quelli previsti al lancio.",
      },
      {
        q: "I dipendenti pagano?",
        a: "No, paga solo l'azienda. L'app per il team è gratuita.",
      },
      {
        q: "Ho più sedi. Come funziona?",
        a: `Una sede è inclusa, ogni altra costa ${euro(EXTRA_VENUE_PRICES.monthly)} al mese. Chi lavora in più sedi conta una volta sola.`,
      },
      {
        q: "E se chiudo per la stagione?",
        a: "Nessun addebito a sorpresa, e lo storico resta consultabile ed esportabile per 12 mesi. I dettagli sono nei Termini.",
      },
      {
        q: "Fa le buste paga?",
        a: "No. Prepara turni, timbrature e ore da passare al consulente, che fa paghe e Libro Unico.",
      },
      {
        q: "Dove finiscono i dati?",
        a: "Su server nell'Unione Europea. Ogni azienda vede solo i propri.",
      },
      {
        q: "Come vi contatto?",
        // Stesso recapito del footer e di `src/features/support/supportContent.ts`.
        a: "Scrivi a info@klokshift.com: risponde in italiano chi costruisce KlokShift, di solito entro 2 giorni lavorativi.",
      },
    ],
  },

  finalCta: {
    title: "La prossima settimana, pianificata in dieci minuti.",
    lead: "30 giorni gratis, senza carta. In beta.",
    cta: "Prova gratis 30 giorni",
    secondary: "Ho già un account",
    note: "Lavori in un'azienda che usa KlokShift? Chiedi alla sede di aggiungerti con la tua email, poi scarica l'app e registrati con quella.",
  },

  footer: {
    tagline: "Turni, presenze e ore per chi lavora su turni.",
    // Stesso recapito di `public/privacy.html`, `termini.html` e `rimborsi.html`:
    // se cambia, va cambiato in tutte e quattro.
    email: "info@klokshift.com",
    emailLabel: "Scrivici",
    // Termini, rimborsi e privacy devono restare raggiungibili da qui: Paddle li
    // controlla nella revisione del dominio (plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md, M08).
    links: [
      { href: "./termini.html", label: "Termini e condizioni" },
      { href: "./rimborsi.html", label: "Politica di rimborso" },
      { href: "./privacy.html", label: "Informativa sulla privacy" },
      { href: "./elimina-account.html", label: "Elimina il tuo account" },
    ],
    // La partita IVA va mostrata nella home di chi vende online (art. 35 DPR
    // 633/72): stessi dati di termini.html e privacy.html.
    owner: "Mattia Caprioli · P.IVA 01256680578",
    rights: "Tutti i diritti riservati.",
  },

  invite: {
    eyebrow: "Invito",
    title: "Ti hanno aggiunto a un team.",
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
};
