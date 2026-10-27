import { formatTime } from "@/lib/format";
import type { ChangeRequest } from "./api";

/** Il nome del gesto, uguale sul pulsante e sulla finestra che apre. */
export const REQUEST_CHANGE_LABEL = "Chiedi un cambio";

/**
 * La terza risposta a un turno da confermare: ci sono, ma su un altro orario.
 * Manda la richiesta d'orario e conferma la presenza.
 */
export const HOURS_WITH_CONFIRM_LABEL = "Ci sono, ma a un altro orario";

/**
 * La riga del dettaglio turno mentre la propria richiesta aspetta la sede.
 * Dice cosa si è chiesto: una sostituzione e un orario diverso sono due
 * richieste diverse (`change_request_kind`), e chiamarle tutte «sostituzione»
 * diceva il falso a chi voleva solo uscire un'ora prima.
 */
export function myPendingRequestText(
  request: Pick<ChangeRequest, "kind" | "proposed_start_time" | "proposed_end_time">
): string {
  if (
    request.kind === "hours" &&
    request.proposed_start_time &&
    request.proposed_end_time
  ) {
    return `Hai chiesto di lavorare dalle ${formatTime(
      request.proposed_start_time
    )} alle ${formatTime(
      request.proposed_end_time
    )}: aspetta la risposta della sede.`;
  }
  if (request.kind === "hours") {
    return "Hai chiesto un orario diverso: aspetta la risposta della sede.";
  }
  return "Hai chiesto una sostituzione: aspetta la risposta della sede.";
}
