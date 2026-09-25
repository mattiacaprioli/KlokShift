import type { Enums } from "@/types/database";
import { formatTime, shiftStartsAt, type ShiftTimes } from "@/lib/format";
import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import {
  effectiveClockTimes,
  formatClockTime,
  type ClockRecordWithCorrections,
} from "./hours";
import { effectiveClockMethod } from "./methods";

/**
 * Minuti di tolleranza dopo l'inizio prima di dire «in ritardo»: chi sta
 * entrando non va segnalato. Fissa per ora; 7shifts la fa configurare per sede.
 */
export const CLOCK_IN_GRACE_MIN = 15;

/**
 * Lo stato di una persona **durante** la giornata, per chi gestisce: gli stessi
 * stati delle viste «chi sta lavorando» dei concorrenti, senza la pausa, che
 * KlokShift non traccia. Il consuntivo a turno finito resta `assignmentActual`.
 */
export type LiveClockStatus =
  | { kind: "upcoming"; startTime: string }
  | { kind: "late" }
  | { kind: "in"; since: string }
  | { kind: "out"; at: string };

/**
 * `null` quando non c'è niente da dire: chi è sul metodo manuale non timbra, e
 * segnalarlo «in ritardo» sarebbe falso; chi ha rifiutato non lavora.
 */
export function liveClockStatus(
  shift: ShiftTimes,
  assignment: {
    status: AssignmentStatus;
    clock: ClockRecordWithCorrections | null;
  },
  method: Enums<"clock_method">,
  now: Date = new Date()
): LiveClockStatus | null {
  if (method === "manual" || !isActiveAssignment(assignment.status)) {
    return null;
  }
  if (assignment.clock) {
    const times = effectiveClockTimes(assignment.clock);
    return times.outAt
      ? { kind: "out", at: times.outAt }
      : { kind: "in", since: times.inAt };
  }
  const lateFrom =
    shiftStartsAt(shift.date, shift.start_time).getTime() +
    CLOCK_IN_GRACE_MIN * 60_000;
  return now.getTime() >= lateFrom
    ? { kind: "late" }
    : { kind: "upcoming", startTime: shift.start_time };
}

export type LiveClockTone = "muted" | "warning" | "success" | "neutral";

/** La frase e il tono: la stessa sulla dashboard e nell'app. */
export function liveClockLabel(status: LiveClockStatus): {
  label: string;
  tone: LiveClockTone;
} {
  switch (status.kind) {
    case "upcoming":
      return { label: `Attacca alle ${formatTime(status.startTime)}`, tone: "muted" };
    case "late":
      return { label: "In ritardo · non ha timbrato", tone: "warning" };
    case "in":
      return {
        label: `In servizio dalle ${formatClockTime(status.since)}`,
        tone: "success",
      };
    case "out":
      return { label: `Uscita alle ${formatClockTime(status.at)}`, tone: "neutral" };
  }
}

/** Il riepilogo del titolo: «2 in servizio · 1 in ritardo», zeri omessi. */
export function liveClockSummary(
  statuses: (LiveClockStatus | null)[]
): string | null {
  const count = (kind: LiveClockStatus["kind"]) =>
    statuses.filter((s) => s?.kind === kind).length;
  const parts = [
    [count("in"), "in servizio"],
    [count("late"), "in ritardo"],
  ] as const;
  const text = parts
    .filter(([n]) => n > 0)
    .map(([n, label]) => `${n} ${label}`)
    .join(" · ");
  return text || null;
}

/**
 * Come `liveClockStatus`, ricavando il metodo effettivo: quello della scheda,
 * altrimenti quello della sede. Una sede che non si conosce non dice niente.
 */
export function liveClockStatusIn(
  venues: readonly { id: string; clock_method: Enums<"clock_method"> }[],
  shift: ShiftTimes & { venue_id: string },
  assignment: {
    status: AssignmentStatus;
    clock: ClockRecordWithCorrections | null;
    staff_member: { clock_method: Enums<"clock_method"> | null } | null;
  },
  now: Date = new Date()
): LiveClockStatus | null {
  const venue = venues.find((v) => v.id === shift.venue_id);
  if (!venue) return null;
  const method = effectiveClockMethod(
    assignment.staff_member?.clock_method ?? null,
    venue.clock_method
  );
  return liveClockStatus(shift, assignment, method, now);
}
