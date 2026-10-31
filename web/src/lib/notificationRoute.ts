import type { Enums } from "@/types/database";

/**
 * Rotta web da aprire per una notifica.
 *
 * Rispecchia il ramo `manager` di `src/features/notifications/routing.ts`, che
 * non si può riusare qui: restituisce Href di Expo Router (`/(manager)/shift/…`)
 * che non esistono in questa SPA. Le regole di *cosa* aprire sono le stesse —
 * se cambiano lì, vanno cambiate anche qui.
 *
 * `null` = niente da aprire.
 */
export function webRouteForNotification(
  type: Enums<"notification_type">,
  relatedId: string | null
): string | null {
  if (type === "staff_response") return "/staff";
  // Promemoria dell'archivio (related_id = azienda): scadenza, export e riattivazione.
  if (type === "archive_reminder") return "/piano";
  // Promemoria del cambio di piano al rinnovo (related_id = azienda).
  if (type === "billing_change_reminder") return "/piano";
  // Allarme al fondatore (related_id = azienda): la scheda dell'azienda
  // nell'area fondatore, lo stesso link dell'email (`formatAlert`). Nell'app
  // non si apre nulla: l'area fondatore è solo qui.
  if (type === "billing_admin_alert") {
    return relatedId ? `/amministrazione/aziende/${relatedId}` : "/amministrazione";
  }
  // Per i messaggi related_id è la conversazione, non un turno. Stessa cosa per
  // la richiesta di cambio turno: si legge e si decide dalla card nel thread.
  if (type === "new_message" || type === "shift_change_request") {
    return relatedId ? `/chat/${relatedId}` : null;
  }
  // Le assenze si decidono dalla pagina Assenze, per tutti. Fino al 31/10 il
  // titolare atterrava sulla card in chat, e le notifiche vecchie portano
  // ancora la conversazione: si ignora.
  if (
    type === "absence_request" ||
    type === "absence_response" ||
    type === "absence_sick"
  ) {
    return "/assenze";
  }
  // Tutto il resto è legato a un turno. La dashboard non ha una pagina di
  // dettaglio: il turno si apre nel pannello del Planning, che si sposta da solo
  // sulla settimana giusta.
  return relatedId ? `/planning?shift=${relatedId}` : null;
}
