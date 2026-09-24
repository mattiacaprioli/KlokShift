import type { AgendaItem } from "@/features/assignments/agenda";
import { isActiveAssignment } from "@/features/assignments/status";
import {
  addDaysToDate,
  shiftEndsAt,
  todayString,
  toDateString,
  type ShiftTimes,
} from "@/lib/format";
import { effectiveClockTimes } from "./hours";
import { effectiveClockMethod } from "./methods";

export type HomeClockState = "in" | "out";

/**
 * Finestra larga ma finita usata anche dalla RPC: copre il turno notturno e
 * lascia un giorno per rimediare a un'uscita dimenticata senza accettare una
 * timbratura su un turno lontano nel calendario.
 */
export function isClockWindowOpen(
  shift: ShiftTimes,
  today: string = todayString()
): boolean {
  return (
    today >= addDaysToDate(shift.date, -1) &&
    today <=
      addDaysToDate(
        toDateString(
          shiftEndsAt(shift.date, shift.start_time, shift.end_time)
        ),
        1
      )
  );
}

/** Cosa deve mostrare la Home per questa assegnazione, se deve mostrarla. */
export function homeClockState(
  item: AgendaItem,
  today: string = todayString()
): HomeClockState | null {
  if (
    item.shift.status === "cancelled" ||
    !isActiveAssignment(item.status)
  ) {
    return null;
  }

  const windowOpen = isClockWindowOpen(item.shift, today);
  if (item.clock) {
    const times = effectiveClockTimes(item.clock);
    if (times.outAt) return null;
    return windowOpen ? "out" : null;
  }

  const method = effectiveClockMethod(
    item.clock_method,
    item.shift.venue?.clock_method ?? "manual"
  );
  // La RPC tollera il giorno precedente per i casi a cavallo della mezzanotte,
  // ma la Home non deve invitare a timbrare un turno di domani con ore di
  // anticipo. Il dettaglio resta il ripiego esplicito per i casi eccezionali.
  return method === "app" && windowOpen && today >= item.shift.date
    ? "in"
    : null;
}
