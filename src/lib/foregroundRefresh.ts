import type { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";

/**
 * Cosa rileggere quando l'app torna in primo piano (`AppProviders`): i dati che
 * altri possono cambiare mentre l'app è in secondo piano e che nessun canale
 * realtime aggiorna.
 *
 * `clock.myUnplanned`: la Home del dipendente non è in tempo reale, e chi
 * gestisce può chiudere o annullare la sua entrata senza turno nel frattempo.
 * Invalidare non costa a chi non la usa: si rilegge solo una query montata.
 */
export function refreshOnForeground(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: qk.workspaceAccess.all });
  void qc.invalidateQueries({ queryKey: qk.clock.myUnplanned });
}
