import type { Conversation, Message } from "./api";

/**
 * Le spunte sotto i propri messaggi, come su WhatsApp. Regola unica per app,
 * dashboard e lista chat.
 *
 * - «Ricevuto» è il segnalibro dell'**altra** persona sulla conversazione
 *   (`user_a_delivered_at` / `user_b_delivered_at`, vedi
 *   `20261118000000_chat_delivery.sql`): un mio messaggio scritto entro il suo
 *   segnalibro è arrivato alla sua app.
 * - «Visualizzato» è `read_at` del messaggio, e vale anche senza segnalibro
 *   (messaggi letti prima che il segnalibro esistesse).
 * - «In invio» non viene dal server: è la bolla provvisoria della mutation.
 */
export type MessageStatus = "sending" | "sent" | "delivered" | "read";

export const MESSAGE_STATUS_LABEL: Record<MessageStatus, string> = {
  sending: "In invio",
  sent: "Inviato",
  delivered: "Ricevuto",
  read: "Visualizzato",
};

/** Il segnalibro dell'altra persona: il mio lato non dice nulla sui miei messaggi. */
export function otherDeliveredAt(
  conversation: Pick<
    Conversation,
    "user_a" | "user_a_delivered_at" | "user_b_delivered_at"
  >,
  userId: string
): string | null {
  return conversation.user_a === userId
    ? conversation.user_b_delivered_at
    : conversation.user_a_delivered_at;
}

export function messageStatus(
  message: Pick<Message, "created_at" | "read_at">,
  otherDelivered: string | null
): Exclude<MessageStatus, "sending"> {
  if (message.read_at != null) return "read";
  // Confronto sugli istanti: Postgres e JS scrivono lo stesso istante in modi diversi.
  if (
    otherDelivered != null &&
    Date.parse(message.created_at) <= Date.parse(otherDelivered)
  ) {
    return "delivered";
  }
  return "sent";
}
