// ⚠️ MANUTENZIONE — LEGGERE PRIMA DI TOCCARE LE FEATURE CITATE
// Sono i testi di «Aiuto e supporto», in app (dipendente e gestore) e sulla
// dashboard. Le risposte descrivono l'app com'è oggi nel codice: se cambi
// l'aggancio degli inviti (`link_member_invites`), le notifiche push, la
// richiesta di sostituzione, la timbratura, il team o l'export delle ore,
// AGGIORNA queste righe, altrimenti l'aiuto spiega un'app che non esiste più.
//
// ⚠️ Le voci per l'app nativa non nominano prezzi, acquisti o checkout: l'app
// non vende niente (vedi AGENTS.md, «Monetizzazione»). Il piano sta solo nelle
// voci `web`.
//
// Solo dati, nessun import di React Native: la dashboard web lo riusa così com'è.

/**
 * L'indirizzo dell'assistenza (casella attiva dal 18/10). Con `null` la sezione
 * «Contattaci» direbbe che il recapito arriva a breve e non mostrerebbe il
 * pulsante: un `mailto:` senza destinatario non deve partire. Lo stesso
 * indirizzo sta in `web-site/public/privacy.html`, `termini.html`,
 * `rimborsi.html` e in `web-site/src/content/it.ts` (footer e FAQ).
 */
export const SUPPORT_EMAIL: string | null = "info@klokshift.com";

/**
 * Tempi di risposta come in docs/MONETIZATION.md §7: un obiettivo di prima
 * risposta, non un tempo garantito di soluzione.
 */
export const SUPPORT_RESPONSE_NOTE =
  "Rispondiamo in italiano dal lunedì al venerdì, di solito entro 2 giorni lavorativi.";

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
    a: "La sede ti trova grazie alla tua email. Registrati con la stessa email che le hai dato e conferma il link che ti arriva: sede e turni compaiono da soli. Hai usato un'altra email? Chiedi alla sede di correggerla sulla tua scheda.",
    audience: ["waiter"],
  },
  {
    q: "Non ricevo le notifiche",
    a: "Controlla due cose: in Impostazioni › Notifiche che la voce sia accesa, e nelle impostazioni del telefono che KlokShift possa mandarti notifiche. Le trovi comunque tutte nella campanella dell'app.",
    audience: ["waiter", "manager"],
  },
  {
    q: "Non posso coprire un turno: cosa faccio?",
    a: "Turno ancora da confermare: rispondi «Non posso», oppure «Ci sono, ma a un altro orario». Turno già confermato: aprilo e premi «Chiedi un cambio». La sede riceve la richiesta in chat e ti risponde lì. Per ferie, permessi e malattia c'è la guida qui sopra.",
    audience: ["waiter"],
  },
  {
    q: "Come timbro entrata e uscita?",
    a: "Da un'ora prima del turno trovi «Timbra entrata» nella Home; a fine turno lo stesso pulsante diventa «Timbra uscita». Se lo dimentichi ti arriva un promemoria. Se la sede te lo permette, puoi timbrare anche senza un turno: nasce un turno «Fuori turno» che la sede deve approvare. Non vedi nessun pulsante? La tua sede non usa la timbratura: le ore le segna lei.",
    audience: ["waiter"],
  },
  {
    q: "Perché non posso aggiungere persone o creare turni?",
    a: "Prima bisogna avviare la prova gratuita di 30 giorni. Fino ad allora puoi sistemare la sede, ma persone, ruoli e turni restano chiusi. La avvia il titolare con «Avvia la prova», dalla Home (o sulla dashboard dalla checklist): non serve la carta.",
    audience: ["manager", "web"],
  },
  {
    q: "Perché non vedo Team, Ore o altre pagine?",
    a: "Se sei un collaboratore, vedi solo quello che il titolare ti ha permesso. I tuoi permessi li trovi in Impostazioni › «I tuoi permessi» (sulla dashboard: Impostazioni › I tuoi permessi). Se te ne serve un altro, chiedilo al titolare.",
    audience: ["manager", "web"],
  },
  {
    q: "Come passo dalla gestione ai miei turni?",
    a: "Se gestisci e lavori anche nei turni, nel Menu trovi «Passa ai tuoi turni»; dall'altra parte, nel Profilo, «Passa alla gestione». L'app si ricorda l'ultima scelta.",
    audience: ["manager", "waiter"],
  },
  {
    q: "Come aggiungo una persona al team?",
    a: "Da Team › «Aggiungi al team» (sulla dashboard: Team › «+ Aggiungi»). Scrivi nome ed email. Se ha già KlokShift trova l'invito nell'app; altrimenti riceve un'email, si registra con quell'indirizzo e vede subito i suoi turni.",
    audience: ["manager", "web"],
  },
  {
    q: "Come sposto un turno o una persona?",
    a: "Tutto il turno: cambiane la data, e si spostano tutte le persone. Una persona sola: sulla dashboard, nei turni, vista per persona, trascinala su un altro turno. Prima di salvare vedi chi verrà avvisato.",
    audience: ["manager", "web"],
  },
  {
    q: "Come preparo le ore per il consulente?",
    a: "Nella pagina Ore scegli il mese e scarica il PDF o il CSV; le assenze hanno un CSV a parte. KlokShift conta le ore: importi e buste paga li fa il consulente.",
    audience: ["manager", "web"],
  },
  {
    q: "Dove gestisco il piano dell'azienda?",
    a: "Il titolare trova stato, prova e limiti del piano in «Piano e accesso», nel menu della dashboard.",
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

/**
 * Cosa vede l'assistenza, detto a tutti. Allineato all'area del fondatore
 * (`docs/FOUNDER-DASHBOARD.md`): dati amministrativi sì, dati di lavoro no.
 */
export const SUPPORT_DATA_NOTE =
  "L'assistenza KlokShift vede solo i dati amministrativi dell'account e dell'azienda (nomi, email, sedi): non legge turni, ore, chat o documenti.";

/** Il rimando alla sede, per chi non è il titolare: lui la sede la gestisce. */
export function supportScopeNote({ isOwner }: { isOwner: boolean }): string {
  return isOwner
    ? SUPPORT_DATA_NOTE
    : `Per turni, ore e assenze scrivi alla tua sede dalla chat. ${SUPPORT_DATA_NOTE}`;
}

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
