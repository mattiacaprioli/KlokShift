// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LE FEATURE CITATE
// Sono i testi di «Aiuto e supporto», in app (professionista e gestore) e sulla
// dashboard. Le risposte descrivono l'app com'è oggi nel codice: se cambi
// l'aggancio degli inviti (`link_member_invites`), le notifiche push, la
// richiesta di sostituzione, la timbratura, l'organico o l'export delle ore,
// AGGIORNA queste righe, altrimenti l'aiuto spiega un'app che non esiste più.
//
// ⚠️ Le voci per l'app nativa non nominano prezzi, acquisti o checkout: l'app
// non vende niente (vedi AGENTS.md, «Monetizzazione»). Il piano sta solo nelle
// voci `web`.
//
// Solo dati, nessun import di React Native: la dashboard web lo riusa così com'è.

/**
 * ⚠️ DA IMPOSTARE: l'indirizzo dell'assistenza, quando la casella esiste.
 * Finché è `null` la sezione «Contattaci» dice che il recapito arriva a breve e
 * non mostra il pulsante: un `mailto:` senza destinatario non deve partire.
 * Lo stesso indirizzo va anche in `web-site/public/privacy.html` (§10) e in
 * `web-site/src/content/it.ts` (footer).
 */
export const SUPPORT_EMAIL: string | null = null;

/** Dove legge la risposta: l'app di chi lavora, l'app di chi gestisce, la dashboard. */
export type SupportAudience = "waiter" | "manager" | "web";

export type SupportFaq = {
  q: string;
  a: string;
  audience: readonly SupportAudience[];
  /** Solo per il titolare: chi non lo è non può fare quello che spiega. */
  ownerOnly?: boolean;
};

export const SUPPORT_FAQ: readonly SupportFaq[] = [
  {
    q: "Non vedo la mia sede o i miei turni",
    a: "La sede ti collega alla tua scheda tramite l'indirizzo email che le hai dato. Registrati con quello stesso indirizzo e conferma l'email dal link che ti arriva: il collegamento parte da solo. Se hai usato un'altra email, chiedi alla sede di correggerla sulla tua scheda.",
    audience: ["waiter"],
  },
  {
    q: "Non ricevo le notifiche",
    a: "Controlla in Impostazioni › Notifiche che la categoria sia accesa, poi nelle impostazioni del telefono che KlokShift possa mandare notifiche. Le notifiche restano comunque nella campanella dell'app.",
    audience: ["waiter", "manager"],
  },
  {
    q: "Non posso coprire un turno: cosa faccio?",
    a: "Apri il turno e premi «Chiedi sostituzione». La richiesta arriva al titolare in chat e la sua risposta arriva a te. Per ferie, permessi e malattia c'è la guida qui sopra.",
    audience: ["waiter"],
  },
  {
    q: "Come timbro entrata e uscita?",
    a: "Se la tua sede usa la timbratura dall'app, quando è ora del turno trovi «Timbra entrata» nella Home; a fine turno lo stesso pulsante diventa «Timbra uscita». Se non lo vedi, la sede registra le ore senza timbratura.",
    audience: ["waiter"],
  },
  {
    q: "Come aggiungo una persona all'organico?",
    a: "Da Staff › «Aggiungi allo staff» (sulla dashboard: Staff › «+ Aggiungi»). Scrivi nome ed email: se ha già KlokShift riceve un invito nell'app, altrimenti un'email per registrarsi con quell'indirizzo, e la sua scheda si collega da sola.",
    audience: ["manager", "web"],
  },
  {
    q: "Come sposto un turno o una persona?",
    a: "Per spostare tutto il turno cambiane la data: si muove l'intera squadra. Per spostare una sola persona, sulla dashboard trascinala su un altro turno dal planning per persona. Prima di salvare vedi chi verrà avvisato e cosa cambia.",
    audience: ["manager", "web"],
  },
  {
    q: "Come preparo le ore per il consulente?",
    a: "Dalla pagina Ore scegli il mese ed esporta il PDF o il CSV mensile; le assenze hanno un CSV separato. KlokShift prepara le quantità: importi e buste paga restano al consulente.",
    audience: ["manager", "web"],
  },
  {
    q: "Dove gestisco il piano dell'azienda?",
    a: "Il titolare trova stato, prova e capacità del piano in «Piano e accesso», nel menu della dashboard.",
    audience: ["web"],
    ownerOnly: true,
  },
];

/** Le domande per un pubblico, nell'ordine in cui sono scritte. */
export function faqFor(
  audience: SupportAudience,
  { isOwner = false }: { isOwner?: boolean } = {}
): SupportFaq[] {
  return SUPPORT_FAQ.filter(
    (item) => item.audience.includes(audience) && (isOwner || !item.ownerOnly)
  );
}

/** Detto una volta, vale per tutti: l'assistenza non vede i dati dell'azienda. */
export const SUPPORT_SCOPE_NOTE =
  "Per turni, ore e assenze scrivi alla tua sede dalla chat: l'assistenza KlokShift non vede i dati della tua azienda.";

export const SUPPORT_PENDING_NOTE =
  "Il recapito dell'assistenza sarà disponibile a breve.";

export type SupportMailContext = {
  /** Da dove scrive: «App iOS 1.2.0», «Dashboard web». */
  surface: string;
  workspace?: { id: string; name?: string | null } | null;
};

/**
 * Il `mailto:` di «Scrivici», con il contesto già scritto in fondo: chi
 * risponde sa da dove arriva la domanda senza doverlo chiedere.
 */
export function supportMailto(email: string, context: SupportMailContext): string {
  const lines = ["", "", "—", context.surface];
  if (context.workspace) {
    const name = context.workspace.name?.trim();
    lines.push(
      `Azienda: ${name ? `${name} (${context.workspace.id})` : context.workspace.id}`
    );
  }
  const subject = encodeURIComponent("Assistenza KlokShift");
  const body = encodeURIComponent(lines.join("\n"));
  return `mailto:${email}?subject=${subject}&body=${body}`;
}
