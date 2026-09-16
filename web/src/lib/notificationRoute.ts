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
  // Per i messaggi related_id è la conversazione, non un turno. Stessa cosa per
  // la richiesta di cambio turno: si legge e si decide dalla card nel thread.
  if (type === "new_message" || type === "shift_change_request") {
    return relatedId ? `/chat/${relatedId}` : null;
  }
  // Le assenze hanno due destinatari e due atterraggi: con la conversazione è il
  // titolare (card nel thread), senza è un collaboratore con «Organico», che in
  // quel thread non entra — la home ha il blocco «Richieste».
  if (
    type === "absence_request" ||
    type === "absence_response" ||
    type === "absence_sick"
  ) {
    return relatedId ? `/chat/${relatedId}` : "/";
  }
  // Tutto il resto è legato a un turno. La dashboard non ha una pagina di
  // dettaglio: il turno si apre nel pannello del Planning, che si sposta da solo
  // sulla settimana giusta.
  return relatedId ? `/planning?shift=${relatedId}` : null;
}
