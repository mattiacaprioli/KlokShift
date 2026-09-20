import type { Href } from "expo-router";
import type { Enums } from "@/types/database";
import type { ViewMode } from "@/features/team/viewModeStorage";

/** La vista con cui si sta usando l'app: decide anche dove atterra una notifica. */
type Role = ViewMode;
type NotificationType = Enums<"notification_type">;

/**
 * Rotta da aprire per una notifica, in base alla vista attiva e al tipo. Fonte unica usata
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
    // Niente da accettare: la scheda che la sede aveva preparato è già sua. Il
    // `related_id` è una `venue_members`, quindi il ramo finale la scambierebbe
    // per un turno e aprirebbe una schermata vuota.
    if (type === "staff_linked") return "/(waiter)/(tabs)";
    // Per i messaggi related_id è la conversazione, non un turno. Vale anche per
    // l'esito di un cambio turno: la card con la risposta vive nel thread, ed è
    // lì che ha senso atterrare — il turno, se approvato, non è più suo.
    //
    // Anche l'esito di ferie e permessi: la card è nel thread col titolare.
    if (
      type === "new_message" ||
      type === "shift_change_response" ||
      type === "absence_response"
    ) {
      return relatedId ? `/(waiter)/chat/${relatedId}` : null;
    }
    // Il professionista non riceve mai le altre due (sono per la sede), ma la
    // funzione è totale sui tipi: meglio dirlo che lasciarlo al ramo finale.
    if (
      type === "shift_change_request" ||
      type === "shift_declined" ||
      type === "absence_request" ||
      type === "absence_sick"
    )
      return null;
    // shift_unassigned: togliendo l'assegnazione gli si toglie anche la lettura
    // del turno (is_my_assigned_shift), quindi non c'è nulla da aprire.
    if (
      type === "shift_cancelled" ||
      type === "staff_removed" ||
      type === "shift_unassigned"
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
  // Le assenze hanno **due** destinatari con due atterraggi diversi
  // (`absence_response` qui è l'annullamento di un'assenza già approvata).
  // Con la conversazione è il titolare: la card sta nel suo thread. Senza, è un
  // collaboratore con «Organico» — quel thread è la coppia (professionista,
  // titolare) e la RLS non glielo apre, quindi la sua copia arriva senza
  // `related_id` e lo porta alla pagina Assenze, dove quelle assenze si
  // decidono.
  if (
    type === "absence_request" ||
    type === "absence_response" ||
    type === "absence_sick"
  ) {
    return relatedId ? `/(manager)/chat/${relatedId}` : "/(manager)/assenze";
  }
  return relatedId ? `/(manager)/shift/${relatedId}` : null;
}
