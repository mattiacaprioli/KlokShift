import type { AssignmentStatus } from "./status";

/**
 * «Aggiungi chi ha lavorato», nelle presenze di un turno finito: il sostituto
 * che nessuno aveva segnato (`add_shift_worker`). Le frasi e la scelta di chi
 * offrire stanno qui perché app e dashboard devono dire e fare la stessa cosa.
 * Nessun import di React Native.
 */

export const ADD_WORKER_LABEL = "Aggiungi chi ha lavorato";
export const ADD_WORKER_HINT =
  "Per chi ha lavorato a questo turno senza esserci segnato, per esempio un sostituto. Le ore del turno contano subito e non parte nessuna notifica. Se ha sostituito qualcuno, segna quella persona come assente.";

/**
 * Chi si può aggiungere: nel team e attivo, non già sul turno (chi c'è,
 * anche segnato assente, si gestisce con Presente/Assente; chi aveva rifiutato
 * sì, torna presente) e — per un collaboratore — non sé stesso: le proprie ore
 * le segna solo il titolare.
 */
export function shiftWorkerCandidates<
  M extends { id: string; link_status: string; waiter_id: string | null },
>(
  staff: M[],
  assignments: { venue_member_id: string; status: AssignmentStatus }[],
  isLockedSelf: (waiterId: string | null) => boolean
): M[] {
  const onShift = new Set(
    assignments.filter((a) => a.status !== "declined").map((a) => a.venue_member_id)
  );
  return staff.filter(
    (m) => m.link_status === "active" && !onShift.has(m.id) && !isLockedSelf(m.waiter_id)
  );
}
