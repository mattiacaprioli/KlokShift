import { shiftDurationHours } from "@/lib/format";
import type { Enums } from "@/types/database";

type ShiftSlot = { start_time: string; end_time: string } | null;

/** Un assegnato conta come "svolto" se non è rifiutato né assente. */
export function isWorked(status: Enums<"assignment_status">): boolean {
  return status !== "declined" && status !== "no_show";
}

/**
 * Ore effettive di un assegnato:
 * 0 se rifiutato/assente, altrimenti `worked_hours` (variazione manuale) oppure
 * la durata pianificata del turno. Nessun dato economico: solo ore.
 *
 * Nel database la durata predefinita passa inoltre da
 * `private.effective_assignment_hours`: gli intervalli sovrapposti della stessa
 * persona si contano una volta sola. Una `worked_hours` esplicita resta invece
 * autorevole, come qui.
 */
export function assignmentHours(
  status: Enums<"assignment_status">,
  workedHours: number | null,
  shift: ShiftSlot
): number {
  if (!isWorked(status)) return 0;
  if (workedHours != null) return workedHours;
  if (!shift) return 0;
  return shiftDurationHours(shift.start_time, shift.end_time);
}
