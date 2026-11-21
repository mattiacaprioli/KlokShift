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
    title: "I turni della settimana in dieci minuti, non in una serata.",
    lead: "Tu pianifichi, il team conferma e timbra dal telefono, le ore si contano da sole.",
    ctaPrimary: "Prova gratis 30 giorni",
    ctaSecondary: "Guarda come funziona",
    note: "In beta. Senza carta, e nessun rinnovo automatico alla fine della prova.",
    boardLabel: "La settimana dei turni di cinque persone, che si riempie e viene confermata",
    toast: "Sara ha confermato venerdì",
  },

  story: {
    title: "Una settimana, dall'inizio alla fine.",
    steps: [
      {
        before: "Prima: il turno scritto nel gruppo, sperando che lo leggano.",
        title: "Prepari in bozza, poi pubblichi.",
        body: "Il team non vede niente finché non sei pronto. Quando pubblichi arriva una notifica a testa.",
      },
      {
        before: "Prima: «hai visto il messaggio?»",
        title: "Il team conferma con un tocco.",
        body: "Dall'app per i dipendenti, gratuita. Vedi subito chi ha risposto e chi manca.",
      },
      {
        before: "Prima: le ore contate a memoria a fine mese.",
        title: "Si timbra dal telefono.",
        body: "Entrata, uscita e pausa. Le ore del mese si sommano da sole.",
      },
      {
        before: "Prima: il foglio da ricopiare per il consulente.",
        title: "Tutto pronto per il consulente.",
        body: "Ore, pause e assenze in PDF o CSV, pronti da mandare.",
      },
    ],
  },

  rest: {
    title: "E poi, tutto il resto.",
    items: [
      {
        title: "Più sedi, una persona sola",
        body: "Chi lavora in due sedi ha una scheda sola, e conta una volta.",
      },
      {
        title: "Ferie, permessi e malattia",
        body: "Si chiedono dall'app, li approvi tu, e la settimana te li mostra.",
      },
      {
        title: "Cambio turno",
        body: "Chi non può chiede il cambio, tu approvi.",
      },
      {
        title: "Documenti con le scadenze",
        body: "Contratti e attestati, e vedi cosa sta per scadere.",
      },
      {
        title: "Giorni di chiusura",
        body: "Ferragosto, ferie della sede, chiuso il lunedì: tutto sul calendario.",
      },
      {
        title: "Il team entra con la sua email",
        body: "Aggiungi l'indirizzo: chi si registra con quello trova già la sua sede.",
      },
      {
        title: "Modelli di turno",
        body: "Salvi un turno tipo e lo riusi in un tocco.",
      },
      {
        title: "I turni dei colleghi",
        body: "Se vuoi, ognuno vede con chi lavora.",
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
    title: "Un prezzo per l'azienda, non per ogni dipendente.",
    lead: "Listino previsto al lancio, stesse funzioni in entrambi. In beta si prova gratis: gli acquisti non sono ancora attivi.",
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
      "Turni, conferme e copertura",
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
        a: "Database e documenti su server nell'Unione Europea, e ogni azienda vede solo i propri. Notifiche ed email passano anche da fornitori fuori dall'UE: l'elenco è in «Sicurezza e GDPR», in fondo alla pagina.",
      },
      {
        q: "Come vi contatto?",
        // Stesso recapito del footer e di `src/features/support/supportContent.ts`.
        a: "Scrivi a info@klokshift.com: risponde in italiano chi costruisce KlokShift, di solito entro 2 giorni lavorativi.",
      },
    ],
  },

  finalCta: {
    boardLabel: "La stessa settimana, con tutti i turni confermati e il sabato coperto",
    title: "La prossima settimana, pianificata in dieci minuti.",
    lead: "30 giorni gratis, senza carta. In beta.",
    cta: "Prova gratis 30 giorni",
    secondary: "Ho già un account",
    note: "Lavori in un'azienda che usa KlokShift? Chiedi alla sede di aggiungerti con la tua email, poi scarica l'app e registrati con quella.",
  },

  footer: {
    tagline: "Turni, presenze e ore per chi lavora su turni.",
    productLabel: "Prodotto",
    contactLabel: "Contatti",
    legalLabel: "Note legali",
    // Stesso recapito di `public/privacy.html`, `termini.html` e `rimborsi.html`:
    // se cambia, va cambiato in tutte e quattro.
    email: "info@klokshift.com",
    emailLabel: "Scrivici",
    // Termini, rimborsi e privacy devono restare raggiungibili da qui: Paddle li
    // controlla nella revisione del dominio (plans/MONETIZATION-AND-FOUNDER-DASHBOARD.md, M08).
    links: [
      { href: "./termini.html", label: "Termini" },
      { href: "./rimborsi.html", label: "Rimborsi" },
      { href: "./privacy.html", label: "Privacy" },
      // Una voce sola per l'area dati, come fanno i concorrenti: da lì si
      // arriva ad accordo sul trattamento, sub-responsabili e dati del team.
      { href: "./sicurezza.html", label: "Sicurezza e GDPR" },
      { href: "./elimina-account.html", label: "Elimina account" },
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

  emailConfirmed: {
    eyebrow: "Account",
    ok: {
      title: "Email confermata.",
      body: "Il tuo account è attivo. Torna nell'app: entri da solo, senza riscrivere email e password.",
    },
    expired: {
      title: "Questo link non vale più.",
      body: "Forse l'hai già aperto, e allora l'account è attivo: torna nell'app e accedi. Altrimenti è scaduto: dall'app puoi farti rimandare l'email.",
    },
    error: {
      title: "Non siamo riusciti a confermare l'email.",
      body: "Torna nell'app e prova ad accedere. Se ti dice che l'email non è confermata, fatti rimandare il link.",
    },
    openApp: "Apri l'app",
    otherDevice:
      "Hai aperto l'email dal computer? Va bene lo stesso: l'account è confermato, apri l'app sul telefono.",
  },
};
