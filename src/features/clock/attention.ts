import type { Enums } from "@/types/database";
import { isShiftOver } from "@/lib/format";
import { isActiveAssignment } from "@/features/assignments/status";
import { isDraft } from "@/features/shifts/drafts";
import type { ShiftWithAssignees } from "@/features/shifts/types";
import { effectiveClockTimes, hoursAreClocked } from "./hours";
import { effectiveClockMethod } from "./methods";

export type ClockAttentionKind = "not_clocked" | "missing_out" | "to_review";

export type ClockAttentionItem = {
  kind: ClockAttentionKind;
  shift: ShiftWithAssignees;
  assignmentId: string;
  personName: string;
};

/** Il metodo della sede: senza, chi non ha timbrato non si distingue da chi non deve. */
export type ClockAttentionVenue = { id: string; clock_method: Enums<"clock_method"> };

/** Le stesse parole di «Ore da sistemare» (`hoursToFix.ts`). */
export const CLOCK_ATTENTION_LABEL: Record<ClockAttentionKind, string> = {
  not_clocked: "Non ha timbrato",
  missing_out: "Uscita mancante",
  to_review: "Ore da approvare",
};

/** Dalla più grave: chi non ha timbrato non ha nemmeno un orario da correggere. */
const BY_URGENCY: ClockAttentionKind[] = ["not_clocked", "missing_out", "to_review"];

/** L'etichetta di una card con più persone: vince la più grave. */
export function clockAttentionLabel(kinds: readonly ClockAttentionKind[]): string | null {
  const kind = BY_URGENCY.find((k) => kinds.includes(k));
  return kind ? CLOCK_ATTENTION_LABEL[kind] : null;
}

/**
 * Eccezioni di timbratura che richiedono un gesto del gestore.
 *
 * Prima della fine prevista un'entrata aperta è normale, quindi non compare.
 * Un turno annullato o una bozza non producono lavoro amministrativo. Chi non
 * ha nessuna timbratura compare solo se doveva timbrare (`hoursAreClocked`, col
 * metodo della persona o della sede): è il `not_clocked` di
 * `get_hours_to_fix`, e senza orari quelle ore non contano.
 */
export function clockAttentionForShift(
  shift: ShiftWithAssignees,
  venues: readonly ClockAttentionVenue[],
  now: Date = new Date()
): ClockAttentionItem[] {
  if (shift.status === "cancelled" || isDraft(shift) || !isShiftOver(shift, now)) {
    return [];
  }
  const venueMethod = venues.find((v) => v.id === shift.venue_id)?.clock_method;

  return shift.shift_assignments.flatMap((assignment) => {
    let kind: ClockAttentionKind | null = null;
    if (assignment.clock) {
      if (assignment.status === "declined") return [];
      kind = !effectiveClockTimes(assignment.clock).outAt
        ? "missing_out"
        : assignment.attendance_reviewed_at == null
          ? "to_review"
          : null;
    } else if (
      venueMethod &&
      isActiveAssignment(assignment.status) &&
      hoursAreClocked(
        assignment,
        effectiveClockMethod(assignment.staff_member?.clock_method ?? null, venueMethod)
      )
    ) {
      kind = "not_clocked";
    }
    if (!kind) return [];
    return [
      {
        kind,
        shift,
        assignmentId: assignment.id,
        personName: assignment.staff_member?.display_name || "Persona",
      },
    ];
  });
}

export function clockAttentionItems(
  shifts: ShiftWithAssignees[],
  venues: readonly ClockAttentionVenue[],
  now: Date = new Date()
): ClockAttentionItem[] {
  return shifts.flatMap((shift) => clockAttentionForShift(shift, venues, now));
}

export function clockAttentionCounts(items: ClockAttentionItem[]) {
  return {
    total: items.length,
    notClocked: items.filter((item) => item.kind === "not_clocked").length,
    missingOut: items.filter((item) => item.kind === "missing_out").length,
    toReview: items.filter((item) => item.kind === "to_review").length,
  };
}

/** «1 non ha timbrato · 2 uscite mancanti · 1 da approvare», zeri omessi. */
export function clockAttentionSummary(items: ClockAttentionItem[]): string {
  const counts = clockAttentionCounts(items);
  return [
    counts.notClocked > 0
      ? `${counts.notClocked} ${counts.notClocked === 1 ? "non ha timbrato" : "non hanno timbrato"}`
      : null,
    counts.missingOut > 0
      ? `${counts.missingOut} ${counts.missingOut === 1 ? "uscita mancante" : "uscite mancanti"}`
      : null,
    counts.toReview > 0 ? `${counts.toReview} da approvare` : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Cosa dice la card di un turno: il perché più grave e chi va sistemato. */
export type ShiftClockAttention = {
  label: string;
  /** Le righe di organico (`venue_members.id`) di chi va sistemato. */
  memberIds: ReadonlySet<string>;
};

/** Le eccezioni raccolte per turno, per le card dell'agenda. */
export function clockAttentionByShift(
  items: ClockAttentionItem[]
): Map<string, ShiftClockAttention> {
  const grouped = new Map<string, ClockAttentionItem[]>();
  for (const item of items) {
    const list = grouped.get(item.shift.id);
    if (list) list.push(item);
    else grouped.set(item.shift.id, [item]);
  }
  return new Map(
    [...grouped].map(([shiftId, list]) => {
      const memberIds = new Set<string>();
      for (const item of list) {
        const memberId = item.shift.shift_assignments.find(
          (a) => a.id === item.assignmentId
        )?.staff_member?.id;
        if (memberId) memberIds.add(memberId);
      }
      return [
        shiftId,
        { label: clockAttentionLabel(list.map((i) => i.kind)) as string, memberIds },
      ];
    })
  );
}
