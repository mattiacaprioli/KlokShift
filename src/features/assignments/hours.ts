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
 * ⚠️ È il gemello client della formula che sta in SQL — la stessa
 * `coalesce(worked_hours, shift_duration_hours(...))` usata ora da **tre** RPC
 * (`get_owner_hours_summary`, `get_person_performance`,
 * `get_person_worked_shifts`). Se cambia la definizione di "ora lavorata", vanno
 * cambiate insieme, o il dettaglio di un turno e il riepilogo del mese diranno
 * due numeri diversi sullo stesso lavoro.
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
