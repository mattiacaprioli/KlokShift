import type { Tables } from "@/types/database";
import {
  isShiftOver,
  shiftDurationHours,
  type ShiftTimes,
} from "@/lib/format";
import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";

export type ClockCorrection = Tables<"shift_clock_corrections"> & {
  corrector?: { full_name: string | null } | null;
};
export type ClockRecord = Tables<"shift_clock_records">;
export type ClockRecordWithCorrections = ClockRecord & {
  corrections: ClockCorrection[];
};

/** L'audit è append-only: l'ultima correzione non-null prevale per campo. */
export function effectiveClockTimes(record: ClockRecordWithCorrections) {
  const corrections = [...record.corrections].sort((a, b) =>
    a.created_at === b.created_at
      ? b.id.localeCompare(a.id)
      : b.created_at.localeCompare(a.created_at)
  );
  return {
    inAt:
      corrections.find((c) => c.corrected_in_at != null)?.corrected_in_at ??
      record.clock_in_at,
    outAt:
      corrections.find((c) => c.corrected_out_at != null)?.corrected_out_at ??
      record.clock_out_at,
  };
}

/** Proposta al quarto d'ora, identica al calcolo della RPC di approvazione. */
export function clockedHours(inAt: string, outAt: string): number {
  const hours = (new Date(outAt).getTime() - new Date(inAt).getTime()) / 3_600_000;
  return Math.round(hours * 4) / 4;
}

/**
 * Il consuntivo di un'assegnazione, confrontabile con le ore programmate.
 * `approved` è definitivo; `proposed` viene da una timbratura completa che
 * aspetta ancora la revisione, e non va mai presentato come ore lavorate.
 *
 * Fonte unica per il planning per persona e per lo storico: sullo stesso turno
 * devono dire lo stesso numero.
 */
export type AssignmentActual =
  | { kind: "approved" | "proposed"; hours: number }
  | { kind: "missing_out" }
  | null;

export function assignmentActual(
  shift: ShiftTimes,
  assignment: {
    status: AssignmentStatus;
    worked_hours: number | null;
    clock: ClockRecordWithCorrections | null;
  },
  now: Date = new Date()
): AssignmentActual {
  if (!isActiveAssignment(assignment.status)) return null;
  // `worked_hours` è sempre il dato definitivo: può arrivare dall'approvazione
  // della timbratura oppure dall'inserimento manuale.
  if (assignment.worked_hours != null) {
    return { kind: "approved", hours: assignment.worked_hours };
  }
  if (!assignment.clock) return null;
  const times = effectiveClockTimes(assignment.clock);
  if (times.outAt) {
    return { kind: "proposed", hours: clockedHours(times.inAt, times.outAt) };
  }
  // Prima della fine prevista un'entrata aperta è normale.
  return isShiftOver(shift, now) ? { kind: "missing_out" } : null;
}

/**
 * Timbratura completa, da approvare, con esattamente le ore del turno: è il caso
 * normale, quello che si approva in blocco. La proposta è già al quarto d'ora
 * (`clockedHours`), quindi qualche minuto di anticipo o ritardo resta «in
 * orario»; tutto il resto chiede un'occhiata persona per persona.
 */
export function isRegularPendingClock(
  shift: Pick<ShiftTimes, "start_time" | "end_time">,
  assignment: {
    status: AssignmentStatus;
    attendance_reviewed_at: string | null;
    clock: ClockRecordWithCorrections | null;
  }
): boolean {
  if (!isActiveAssignment(assignment.status)) return false;
  if (!assignment.clock || assignment.attendance_reviewed_at != null) {
    return false;
  }
  const times = effectiveClockTimes(assignment.clock);
  if (!times.outAt) return false;
  return (
    clockedHours(times.inAt, times.outAt) ===
    shiftDurationHours(shift.start_time, shift.end_time)
  );
}

export type HoursDeviation = {
  name: string;
  /** Ore effettive meno ore del turno: `+1` è un'ora in più. */
  delta: number;
  /** Viene da una timbratura non ancora approvata. */
  proposed: boolean;
};

/**
 * Chi, in un turno, si è discostato dall'orario: **per persona**, mai come
 * somma. Una somma direbbe «+1 h» senza dire di chi, e un'ora in più di uno
 * più un'ora in meno di un altro darebbe zero: il turno sembrerebbe a posto
 * proprio quando ci sono due cose da guardare.
 *
 * `measured` conta le persone con un consuntivo: zero vuol dire che non c'è
 * niente da confrontare, non che sono tutti in orario.
 */
export function shiftDeviations(
  shift: ShiftTimes & {
    shift_assignments: (Parameters<typeof assignmentActual>[1] & {
      staff_member: { display_name: string } | null;
    })[];
  },
  now: Date = new Date()
): { measured: number; deviations: HoursDeviation[] } {
  const planned = shiftDurationHours(shift.start_time, shift.end_time);
  let measured = 0;
  const deviations: HoursDeviation[] = [];
  for (const assignment of shift.shift_assignments) {
    const actual = assignmentActual(shift, assignment, now);
    if (!actual || actual.kind === "missing_out") continue;
    measured += 1;
    const delta = actual.hours - planned;
    if (Math.abs(delta) < 0.001) continue;
    deviations.push({
      name: assignment.staff_member?.display_name || "Professionista",
      delta,
      proposed: actual.kind === "proposed",
    });
  }
  return { measured, deviations };
}

export function formatClockTime(value: string): string {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Europe/Rome",
  }).format(new Date(value));
}
