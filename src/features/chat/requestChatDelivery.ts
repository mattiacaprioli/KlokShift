import { markChatsDelivered } from "./api";
import { createDeliveryScheduler } from "./delivery";

const scheduler = createDeliveryScheduler(markChatsDelivered, 1500);

/**
 * Segna come ricevuti i messaggi nuovi di tutte le mie conversazioni, a
 * raffiche raggruppate. La chiamano l'avvio con sessione e i messaggi in
 * arrivo (`RealtimeSync`), il ritorno in primo piano (`AppProviders` in app,
 * `visibilitychange` sulla dashboard).
 */
export function requestChatDelivery(): void {
  scheduler.request();
}
