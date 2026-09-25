import { isShiftOver } from "@/lib/format";
import type { ShiftWithAssignees } from "@/features/shifts/types";
import { effectiveClockTimes } from "./hours";

export type ClockAttentionKind = "missing_out" | "to_review";

export type ClockAttentionItem = {
  kind: ClockAttentionKind;
  shift: ShiftWithAssignees;
  assignmentId: string;
  personName: string;
};

/**
 * Eccezioni di timbratura che richiedono un gesto del gestore.
 *
 * Prima della fine prevista un'entrata aperta è normale, quindi non compare.
 * Un turno annullato non produce lavoro amministrativo. Il turno senza alcuna
 * timbratura non è invece classificabile qui: può usare il metodo manuale.
 */
export function clockAttentionForShift(
  shift: ShiftWithAssignees,
  now: Date = new Date()
): ClockAttentionItem[] {
  if (shift.status === "cancelled" || !isShiftOver(shift, now)) return [];

  return shift.shift_assignments.flatMap((assignment) => {
    if (!assignment.clock || assignment.status === "declined") return [];
    const times = effectiveClockTimes(assignment.clock);
    const kind: ClockAttentionKind | null = !times.outAt
      ? "missing_out"
      : assignment.attendance_reviewed_at == null
        ? "to_review"
        : null;
    if (!kind) return [];
    return [
      {
        kind,
        shift,
        assignmentId: assignment.id,
        personName:
          assignment.staff_member?.display_name || "Professionista",
      },
    ];
  });
}

export function clockAttentionItems(
  shifts: ShiftWithAssignees[],
  now: Date = new Date()
): ClockAttentionItem[] {
  return shifts.flatMap((shift) => clockAttentionForShift(shift, now));
}

export function clockAttentionCounts(items: ClockAttentionItem[]) {
  return {
    total: items.length,
    missingOut: items.filter((item) => item.kind === "missing_out").length,
    toReview: items.filter((item) => item.kind === "to_review").length,
  };
}
