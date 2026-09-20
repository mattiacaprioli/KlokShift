/**
 * Da un errore qualsiasi alla frase da mostrare a chi sta usando l'app.
 *
 * Il data layer fa `throw new Error(error.message)` in 85 punti, e quel
 * messaggio viene da Postgres o da PostgREST: è inglese, parla di constraint e
 * di row-level security, e a volte cita nomi di colonne. Mostrarlo così non
 * spiega niente a chi legge e racconta a chiunque com'è fatto il database.
 *
 * Qui il messaggio grezzo si traduce in una frase che dice **cosa è successo e
 * cosa fare**. Quello che non si riconosce diventa il generico: meglio una
 * frase vaga in italiano che un dettaglio di implementazione in inglese.
 *
 * ⚠️ Alcuni messaggi però sono **nostri e scritti apposta** per essere letti —
 * «Questa persona è già su questo turno», «Il file supera 10 MB». Quelli non
 * vanno generalizzati, e distinguerli dal testo è impossibile: si marcano alla
 * sorgente con `UserFacingError`.
 */

/** Errore il cui `message` è già la frase giusta per l'utente. */
export class UserFacingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UserFacingError";
  }
}

const PATTERNS: { match: string[]; message: string }[] = [
  {
    // Il browser e React Native usano parole diverse per la stessa cosa.
    match: ["failed to fetch", "network request failed", "load failed"],
    message: "Connessione assente. Controlla la rete e riprova.",
  },
  {
    // `guard_finished_shift_times` (20260918170000): prima del generico sui
    // permessi, perché qui c'è una ragione precisa da dire.
    match: ["finished_shift_locked"],
    message:
      "Questo turno è già finito: data e orari li cambia solo chi ha il permesso Ore, e mai chi ci ha lavorato.",
  },
  // ⚠️ I codici delle RPC (`raise exception '<codice>'`) vanno **prima** del
  // generico sui permessi: sono ragioni precise, e «Non hai i permessi» le
  // nasconderebbe. Sono tutti in `supabase/migrations/` (member_rpcs, shift_rpcs,
  // workspace_rpcs); il messaggio arriva così com'è da PostgREST.
  {
    match: ["owner_only"],
    message: "Solo il titolare può farlo.",
  },
  {
    match: ["chat_disabled"],
    message:
      "In questa azienda la chat fra colleghi è disattivata. Puoi comunque scrivere a chi gestisce.",
  },
  {
    match: ["use_transfer_ownership"],
    message: "La titolarità non si modifica da qui: usa «Cedi la titolarità».",
  },
  {
    match: ["owner_cannot_be_removed", "owner_cannot_leave"],
    message:
      "Il titolare non può uscire dall'azienda: prima cedi la titolarità a un'altra persona.",
  },
  {
    match: ["workspace_needs_an_owner"],
    message: "Un'azienda deve avere almeno un titolare.",
  },
  {
    match: ["venue_not_in_workspace"],
    message: "Quella sede non fa parte di questa azienda.",
  },
  {
    match: ["venues_required"],
    message: "Scegli almeno una sede.",
  },
  {
    match: ["email_required"],
    message: "Per invitare un collaboratore serve la sua email.",
  },
  {
    match: ["needs_account"],
    message:
      "Questa persona non ha ancora un account: può ricevere un accesso da collaboratore solo dopo essersi registrata.",
  },
  {
    match: ["email_locked"],
    message: "L'email non si cambia una volta che la persona ha un account.",
  },
  {
    match: ["member_left"],
    message: "Questa persona ha lasciato l'azienda: riaggiungila prima.",
  },
  {
    match: ["role_not_in_venue"],
    message: "Quella mansione non appartiene a questa sede.",
  },
  {
    match: ["not_in_roster"],
    message: "Questa persona non è in organico in questa sede.",
  },
  {
    match: ["already_assigned"],
    message: "Questa persona è già su questo turno.",
  },
  {
    match: ["shift_cancelled"],
    message: "Questo turno è stato annullato.",
  },
  {
    match: ["shift_finished"],
    message: "Questo turno è già finito.",
  },
  {
    match: ["invalid_status"],
    message: "Stato non valido per questa azione.",
  },
  {
    match: ["title_required", "name_required"],
    message: "Manca il nome.",
  },
  {
    match: ["workspace_limit"],
    message: "Hai raggiunto il numero massimo di aziende.",
  },
  {
    match: ["invalid_target"],
    message: "Scegli una persona attiva, già registrata.",
  },
  {
    match: ["row-level security", "permission denied", "insufficient privilege", "not_allowed"],
    message: "Non hai i permessi per farlo.",
  },
  {
    match: ["duplicate key", "unique constraint"],
    message: "Esiste già un elemento con questi dati.",
  },
  {
    match: ["foreign key constraint"],
    message: "Non si può fare: questo dato è collegato ad altro.",
  },
  {
    match: ["check constraint", "invalid input syntax", "violates not-null"],
    message: "Alcuni dati non sono validi. Controllali e riprova.",
  },
  {
    // Colonna o tabella che il client si aspetta e il server non ha: succede
    // quando una migration non è ancora stata applicata, o quando l'app è
    // vecchia. È l'unico caso in cui «riprova» sarebbe un consiglio inutile.
    match: ["does not exist", "schema cache", "could not find the table"],
    message: "L'app non è allineata al server. Aggiornala e riprova.",
  },
  {
    match: ["jwt expired", "invalid token", "not authenticated", "not_authenticated"],
    message: "Sessione scaduta. Accedi di nuovo.",
  },
  {
    match: ["payload too large", "maximum allowed size", "exceeded the maximum"],
    message: "Il file è troppo grande.",
  },
  {
    match: ["mime type", "invalid_mime_type"],
    message: "Tipo di file non supportato.",
  },
];

export const GENERIC_ERROR = "Qualcosa non ha funzionato. Riprova.";

export function userErrorMessage(
  e: unknown,
  fallback: string = GENERIC_ERROR
): string {
  if (e instanceof UserFacingError) return e.message;

  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!raw) return fallback;

  const lower = raw.toLowerCase();
  for (const p of PATTERNS) {
    if (p.match.some((needle) => lower.includes(needle))) return p.message;
  }
  return fallback;
}
