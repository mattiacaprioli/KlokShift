import type { Href } from "expo-router";
import type { Enums } from "@/types/database";

type Role = Enums<"user_role">;
type NotificationType = Enums<"notification_type">;

/**
 * Rotta da aprire per una notifica, in base al ruolo e al tipo. Fonte unica usata
 * sia dagli screen Notifiche (`onOpen`) sia dal tap sulle push (`PushRegistrar`).
 * `null` = niente da aprire (es. turno annullato: la RLS lo nasconde già al
 * cameriere; rimozione dallo staff: non c'è più una risorsa da mostrare).
 */
export function routeForNotification(
  role: Role,
  type: NotificationType,
  relatedId: string | null
): Href | null {
  if (role === "waiter") {
    if (type === "staff_invite") return "/(waiter)/inviti";
    // Niente da accettare: la scheda che il locale aveva preparato è già sua. Il
    // `related_id` è una `staff_members`, quindi il ramo finale la scambierebbe
    // per un turno e aprirebbe una schermata vuota.
    if (type === "staff_linked") return "/(waiter)/(tabs)";
    // Per i messaggi related_id è la conversazione, non un turno. Vale anche per
    // l'esito di un cambio turno: la card con la risposta vive nel thread, ed è
    // lì che ha senso atterrare — il turno, se approvato, non è più suo.
    if (type === "new_message" || type === "shift_change_response") {
      return relatedId ? `/(waiter)/chat/${relatedId}` : null;
    }
    // Il professionista non riceve mai le altre due (sono per il locale), ma la
    // funzione è totale sui tipi: meglio dirlo che lasciarlo al ramo finale.
    if (type === "shift_change_request" || type === "shift_declined") return null;
    // shift_unassigned: la delete dell'assegnazione gli toglie anche la lettura
    // del turno (is_my_assigned_shift), quindi non c'è nulla da aprire.
    //
    // I tre `application_*` sono notifiche storiche: il marketplace non esiste
    // più, e il dettaglio turno ora parla solo di assegnazioni — aprirlo direbbe
    // "turno riservato allo staff" su una candidatura di mesi fa. Restano
    // leggibili in lista, ma non portano da nessuna parte.
    if (
      type === "shift_cancelled" ||
      type === "staff_removed" ||
      type === "shift_unassigned" ||
      type === "application_received" ||
      type === "application_accepted" ||
      type === "application_rejected"
    )
      return null;
    return relatedId ? `/(waiter)/shift/${relatedId}` : null;
  }

  // manager
  if (type === "staff_response") return "/(manager)/(tabs)/staff";
  // Chi è appena entrato in un'azienda atterra sulla sua home: il `related_id` è
  // una sede, non un turno, e il ramo finale lo aprirebbe come tale.
  if (type === "team_linked") return "/(manager)/(tabs)";
  if (type === "team_joined") return "/(manager)/team";
  // Revoca: non c'è più niente da aprire. Stessa scelta di `staff_removed`.
  if (type === "team_removed") return null;
  // `shift_change_request` porta la conversazione, non il turno: la richiesta si
  // legge e si decide dalla card nel thread.
  if (type === "new_message" || type === "shift_change_request") {
    return relatedId ? `/(manager)/chat/${relatedId}` : null;
  }
  return relatedId ? `/(manager)/shift/${relatedId}` : null;
}
