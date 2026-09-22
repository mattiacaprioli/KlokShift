import type { QueryClient } from "@tanstack/react-query";
import { qk } from "@/lib/queryKeys";

/** Visibilità da ricaricare qualunque sia l'esito della sequenza di unassign. */
export function invalidateAfterShiftRemoval(qc: QueryClient) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: qk.assignments.all }),
    qc.invalidateQueries({ queryKey: qk.shifts.all }),
    qc.invalidateQueries({ queryKey: qk.planning.all }),
  ]);
}
