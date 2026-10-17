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
import type { MyUnplannedClock } from "./api";
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

/** Per quanto un'entrata ancora aperta blocca un'altra entrata. */
export const UNPLANNED_OPEN_BLOCK_HOURS = 24;

/**
 * C'è un turno pianificato timbrato in entrata e non ancora in uscita? Gemello
 * **manuale** del controllo `clock_already_open` in `clock_punch_unplanned`
 * (20261010000000): un'entrata aperta da meno di 24 ore, in qualunque sede o
 * azienda, impedisce l'entrata senza turno. Il server misura le 24 ore
 * sull'entrata timbrata e guarda l'uscita corretta: qui lo stesso.
 */
export function hasOpenPlannedClock(
  items: readonly AgendaItem[],
  now: Date = new Date()
): boolean {
  const since = now.getTime() - UNPLANNED_OPEN_BLOCK_HOURS * 3_600_000;
  return items.some(
    (item) =>
      item.clock != null &&
      effectiveClockTimes(item.clock).outAt == null &&
      new Date(item.clock.clock_in_at).getTime() > since
  );
}

/**
 * Si può proporre adesso l'entrata senza turno su questa scheda? `items`
 * `undefined` = i turni assegnati non sono ancora arrivati (caricamento o
 * errore): una lista che manca non vuol dire «nessun turno da timbrare», e il
 * dato mancante non sblocca.
 *
 * No se si è già in servizio su un turno (di qualunque sede), no se un turno
 * della stessa scheda si timbra adesso: le due regole della RPC.
 */
export function canStartUnplannedClock(
  items: readonly AgendaItem[] | undefined,
  venueMemberId: string,
  now: Date = new Date()
): boolean {
  if (!items) return false;
  if (hasOpenPlannedClock(items, now)) return false;
  return !items.some(
    (item) =>
      item.venue_member_id === venueMemberId && blocksUnplannedClock(item, now)
  );
}

/**
 * Un'entrata senza turno ancora aperta impedisce adesso di timbrare l'entrata
 * di un turno pianificato? Gemello **manuale** del controllo
 * `clock_already_open` in `clock_punch` (20261012000300): entrata aperta da
 * meno di 24 ore, in qualunque sede o azienda. Se cambia lì, cambia qui.
 *
 * Il server guarda tutte le entrate dell'account; qui ci sono quelle che
 * `get_my_unplanned_clock` restituisce (sedi aperte, aziende leggibili). Per il
 * resto risponde la RPC, con il suo messaggio.
 */
export function blocksPlannedClockIn(
  unplanned: Pick<MyUnplannedClock, "open">[],
  now: Date = new Date()
): boolean {
  const since = now.getTime() - UNPLANNED_OPEN_BLOCK_HOURS * 3_600_000;
  return unplanned.some(
    (entry) =>
      entry.open != null && new Date(entry.open.clockInAt).getTime() > since
  );
}
