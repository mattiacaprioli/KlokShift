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
  { match: ["invalid_avatar_url"], message: "Immagine del profilo non valida. Caricala di nuovo." },
  { match: ["admin_not_allowed"], message: "L'accesso amministrativo non è autorizzato. Accedi con l'account abilitato." },
  { match: ["admin_mfa_required"], message: "Completa la verifica con il secondo fattore per accedere." },
  { match: ["admin_mfa_verification_failed"], message: "Verifica non riuscita. Controlla il codice e riprova." },
  { match: ["admin_response_invalid"], message: "I dati amministrativi non sono verificabili. Riprova l'aggiornamento." },
  { match: ["admin_invalid_filter"], message: "Controlla i filtri di ricerca e riprova." },
  { match: ["admin_not_found"], message: "L'elemento richiesto non è disponibile." },
  { match: ["admin_confirm_name_mismatch"], message: "Il nome scritto non è quello dell'azienda. Ricopialo esattamente." },
  { match: ["document_quota_full"], message: "Lo spazio per i documenti dell'azienda è pieno: elimina quelli che non servono più o scrivi a info@klokshift.com per averne di più. I documenti già caricati restano consultabili." },
  { match: ["admin_workspace_operational"], message: "Questa azienda sta ancora lavorando: i suoi dati non si cancellano." },
  { match: ["admin_archive_not_expired"], message: "L'archivio di questa azienda non è ancora scaduto: i dati non si cancellano." },
  { match: ["admin_subscription_open"], message: "L'abbonamento è ancora aperto su Paddle: disdicilo prima di cancellare i dati." },
  { match: ["admin_data_already_deleted"], message: "I dati di questa azienda sono già stati cancellati. Aggiorna la pagina." },
  { match: ["admin_cleanup_failed"], message: "Non è stato possibile togliere i file adesso: restano in coda, riprova fra poco." },
  { match: ["admin_review_note_required"], message: "Scrivi cosa hai fatto, da 3 a 500 caratteri." },
  { match: ["admin_review_not_open"], message: "Questa voce non chiede più un'azione. Aggiorna la pagina." },
  { match: ["admin_reason_required"], message: "Inserisci un motivo da 1 a 2000 caratteri." },
  { match: ["admin_stale_revision"], message: "I dati sono cambiati. Aggiorna e prepara una nuova conferma." },
  { match: ["admin_revision_required", "admin_invalid_operation"], message: "L'intervento non è valido. Aggiorna e controlla i campi." },
  { match: ["admin_operation_conflict"], message: "Questo identificativo è già usato per un altro intervento. Prepara una nuova conferma." },
  { match: ["admin_future_period_conflict"], message: "Ci sono periodi commerciali futuri da verificare prima di modificare la concessione." },
  { match: ["admin_provider_action_required"], message: "Il contratto pagante richiede una verifica nel provider prima di assegnare la gratuità." },
  { match: ["admin_document_usage_unknown"], message: "Alcune dimensioni dei documenti sono sconosciute. Verifica il consumo prima di concedere la capacità." },
  { match: ["admin_document_capacity"], message: "La quota documenti scelta è inferiore allo spazio già utilizzato." },
  { match: ["invalid_access_capacity"], message: "Scegli capacità valide: almeno una sede e una quota documenti positiva." },
  { match: ["invalid_access_plan"], message: "Scegli un piano valido per la concessione." },
  // Vale sia per l'azienda nuova (prova non avviata) sia per quella in archivio,
  // e la legge anche l'app nativa: niente inviti all'acquisto (App Store 3.1.3).
  { match: ["workspace_read_only"], message: "Il lavoro operativo non è attivo per questa azienda: chi la gestisce può attivarlo. Lo storico resta consultabile." },
  { match: ["workspace_people_capacity"], message: "La capacità di persone dell'azienda è raggiunta. Il lavoro esistente continua." },
  { match: ["workspace_venue_capacity"], message: "La capacità di sedi aperte dell'azienda è raggiunta. Chiudere una sede conserva lo storico." },
  { match: ["attendance_window_closed"], message: "La rettifica non rientra nella finestra per le presenze pregresse. Contatta l'assistenza." },
  { match: ["workspace_access_unavailable"], message: "Lo stato dell'azienda non è disponibile. Aggiorna e riprova." },
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
    match: ["workspace_access_invalid"],
    message: "Non riusciamo a verificare l'accesso di questa azienda. Riprova.",
  },
  {
    match: ["commercial_migration_required"],
    message: "L'accesso di questa azienda deve essere verificato. Contatta l'assistenza.",
  },
  {
    match: ["trial_requires_open_venue"],
    message: "Prepara una sede aperta prima di avviare la prova gratuita.",
  },
  {
    match: ["trial_already_used"],
    message: "Questa azienda ha già utilizzato la prova gratuita.",
  },
  {
    // Solo aziende nuove: dopo un periodo concesso la prova non parte (C18).
    match: ["trial_not_eligible"],
    message: "La prova gratuita è disponibile solo per le nuove aziende.",
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
    // Un altro spostamento della stessa persona è arrivato prima (B11).
    match: ["assignment_changed"],
    message: "Questa assegnazione è appena cambiata: aggiorna la pagina e riprova.",
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
    // Il turno «Fuori turno» descrive lavoro già svolto (C06).
    match: ["unplanned_shift_locked"],
    message:
      "Un turno nato da una timbratura non si sposta né si annulla. Se è sbagliato, annulla la timbratura.",
  },
  {
    match: ["attendance_started"],
    message:
      "Questa persona ha già timbrato: annulla prima la timbratura indicando il motivo.",
  },
  {
    match: ["clock_manual"],
    message: "Per questa sede gli orari vengono registrati da chi gestisce.",
  },
  {
    match: ["clock_method_unavailable"],
    message: "Questo metodo di timbratura non è ancora disponibile.",
  },
  {
    match: ["clock_wrong_day"],
    message: "Questa timbratura appartiene a un altro giorno.",
  },
  {
    match: ["clock_in_required"],
    message: "Prima registra l’entrata.",
  },
  {
    match: ["clock_unplanned_disabled"],
    message: "In questa sede puoi timbrare solo sui turni assegnati.",
  },
  {
    match: ["clock_planned_shift"],
    message: "Hai un turno in corso o in arrivo: timbra quello.",
  },
  {
    match: ["clock_already_open"],
    message: "Hai già un’entrata aperta: registra prima l’uscita.",
  },
  {
    // Chiusa da un altro nel frattempo: il gestore o il professionista (C13).
    match: ["clock_already_closed"],
    message: "L'uscita è già stata registrata. Aggiorna la pagina.",
  },
  {
    match: ["break_not_clocked"],
    message: "In questa sede la pausa non si timbra: vale quella del turno.",
  },
  {
    match: ["clock_break_not_started"],
    message: "Non c’è una pausa da chiudere.",
  },
  {
    // assert_shift_break e correct_clock_break; nei form lo anticipa shiftBreakError.
    match: ["break_too_long"],
    message: "La pausa deve essere più corta del turno.",
  },
  {
    match: ["break_invalid"],
    message: "Durata della pausa non valida.",
  },
  {
    match: ["template_limit"],
    message: "Questa sede ha già 30 modelli. Eliminane uno per salvarne un altro.",
  },
  {
    match: ["template_invalid"],
    message: "Controlla orari e fabbisogno del modello.",
  },
  {
    match: ["break_rule_invalid"],
    message:
      "Regola della pausa non valida: soglia da 1 a 24 ore, pausa da 5 a 240 minuti.",
  },
  {
    match: ["clock_open_too_long"],
    message:
      "L’entrata è aperta da troppe ore: l’uscita la registra chi gestisce.",
  },
  {
    match: ["note_too_long"],
    message: "La nota è troppo lunga: massimo 500 caratteri.",
  },
  {
    match: ["clock_out_required"],
    message: "Manca l’uscita: correggi la timbratura prima di approvare le ore.",
  },
  {
    match: ["reason_required", "clock_correction_required"],
    message: "Indica il motivo della modifica.",
  },
  {
    // Lo usano close_unplanned_clock (tutte e tre le regole) e
    // correct_clock_record (solo «dopo l'entrata»).
    match: ["invalid_clock_interval"],
    message:
      "Orario d'uscita non valido: deve essere dopo l'entrata, non nel futuro e al massimo 24 ore dopo.",
  },
  {
    match: ["clock_status_not_allowed"],
    message: "Non puoi timbrare un turno rifiutato o segnato come assenza.",
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
