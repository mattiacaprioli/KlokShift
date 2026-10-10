import type { AgendaItem } from "@/features/assignments/agenda";
import { isActiveAssignment } from "@/features/assignments/status";
import {
  addDaysToDate,
  shiftEndsAt,
  shiftStartsAt,
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

/** Da quanto prima dell'inizio un turno pianificato «si timbra quello». */
export const UNPLANNED_BLOCK_BEFORE_MIN = 60;

/**
 * Questo turno pianificato impedisce adesso un'entrata senza turno sulla
 * stessa scheda? Gemello **manuale** del controllo `clock_planned_shift` in
 * `clock_punch_unplanned` (20261010000000): dall'ora prima dell'inizio alla
 * fine, se non è annullato, rifiutato o già timbrato. Se cambia lì, cambia qui.
 */
export function blocksUnplannedClock(
  item: AgendaItem,
  now: Date = new Date()
): boolean {
  if (item.shift.status === "cancelled" || !isActiveAssignment(item.status)) {
    return false;
  }
  if (item.clock) return false;
  const from =
    shiftStartsAt(item.shift.date, item.shift.start_time).getTime() -
    UNPLANNED_BLOCK_BEFORE_MIN * 60_000;
  const to = shiftEndsAt(
    item.shift.date,
    item.shift.start_time,
    item.shift.end_time
  ).getTime();
  return now.getTime() >= from && now.getTime() < to;
}
