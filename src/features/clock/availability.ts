import type { AgendaItem } from "@/features/assignments/agenda";
import { isActiveAssignment } from "@/features/assignments/status";
import {
  addDaysToDate,
  formatTime,
  shiftEndsAt,
  shiftStartsAt,
  todayString,
  toDateString,
  toTimeString,
  type ShiftTimes,
} from "@/lib/format";
import type { Enums } from "@/types/database";
import type { MyUnplannedClock } from "./api";
import { effectiveClockTimes, type ClockRecordWithCorrections } from "./hours";
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

/** Da quanto prima dell'inizio l'app propone l'entrata di un turno. */
export const CLOCK_IN_OPENS_BEFORE_MIN = 60;

/** Quando l'app comincia a proporre l'entrata di questo turno. */
export function clockInOpensAt(shift: ShiftTimes): Date {
  return new Date(
    shiftStartsAt(shift.date, shift.start_time).getTime() -
      CLOCK_IN_OPENS_BEFORE_MIN * 60_000
  );
}

/** «18:00»: l'ora da cui si potrà timbrare l'entrata. */
export function clockInOpensLabel(shift: ShiftTimes): string {
  return toTimeString(clockInOpensAt(shift));
}

export type ClockInPhase = "early" | "open" | "over";

/**
 * A che punto è l'entrata di un turno: troppo presto, da timbrare, o turno
 * finito. Si misura sull'ora, non sul giorno: un turno delle 19 alle 8 del
 * mattino è ancora `early`, e un'entrata alle 8 farebbe partire le ore da lì.
 *
 * Il server accetta una finestra più larga (dal giorno prima al giorno dopo la
 * fine, `clock_punch`), che resta la rete per i notturni: è l'app a non
 * proporre l'entrata fuori da queste ore. Dopo la fine un'entrata non ha senso:
 * gli orari li inserisce chi gestisce le ore.
 */
export function clockInPhase(
  shift: ShiftTimes,
  now: Date = new Date()
): ClockInPhase {
  if (now < clockInOpensAt(shift)) return "early";
  if (now >= shiftEndsAt(shift.date, shift.start_time, shift.end_time)) {
    return "over";
  }
  return "open";
}

/** Cosa deve mostrare la Home per questa assegnazione, se deve mostrarla. */
export function homeClockState(
  item: AgendaItem,
  now: Date = new Date()
): HomeClockState | null {
  if (
    item.shift.status === "cancelled" ||
    !isActiveAssignment(item.status)
  ) {
    return null;
  }

  if (item.clock) {
    const times = effectiveClockTimes(item.clock);
    if (times.outAt) return null;
    return isClockWindowOpen(item.shift, todayString(now)) ? "out" : null;
  }

  const method = effectiveClockMethod(
    item.clock_method,
    item.shift.venue?.clock_method ?? "manual"
  );
  return method === "app" && clockInPhase(item.shift, now) === "open"
    ? "in"
    : null;
}

/**
 * La sezione Timbratura di un turno **senza timbratura**: il pulsante
 * d'entrata, oppure la frase che dice perché non c'è. Dopo la fine non si dice
 * più «sarà disponibile»: le ore di chi non ha timbrato le inserisce la sede.
 */
export type ClockInNote = { kind: "button" } | { kind: "note"; text: string };

export function clockInNote(
  shift: ShiftTimes,
  method: Enums<"clock_method">,
  now: Date = new Date()
): ClockInNote {
  if (method === "manual") {
    return {
      kind: "note",
      text: "Per questa sede gli orari li registra chi gestisce.",
    };
  }
  if (method !== "app") {
    return {
      kind: "note",
      text: "Questo metodo di timbratura sarà disponibile in una prossima versione.",
    };
  }
  switch (clockInPhase(shift, now)) {
    case "open":
      return { kind: "button" };
    case "early":
      return {
        kind: "note",
        text: `Potrai timbrare l'entrata dalle ${clockInOpensLabel(shift)}.`,
      };
    case "over":
      return {
        kind: "note",
        text: "Non hai timbrato: la sede deve inserire gli orari. Scrivile se serve.",
      };
  }
}

/**
 * La riga sotto lo stato di un turno finito. Chi è ancora in servizio oltre
 * l'orario non legge «Turno concluso»: deve timbrare l'uscita. Le ore «le
 * registra la sede» solo dove non si timbra: con la timbratura le ha già
 * registrate lui, o la sezione sotto dice cosa manca.
 */
export function shiftOverNote(
  shift: ShiftTimes,
  method: Enums<"clock_method">,
  clock: ClockRecordWithCorrections | null,
  now: Date = new Date()
): string {
  if (
    clock &&
    !effectiveClockTimes(clock).outAt &&
    isClockWindowOpen(shift, todayString(now))
  ) {
    return "L'orario del turno è finito: timbra l'uscita quando smetti.";
  }
  if (!clock && method === "manual") {
    return "Turno concluso. Le ore le registra la sede.";
  }
  return "Turno concluso.";
}

/** Oltre questo scarto dall'orario del turno, la conferma lo dice. */
export const PUNCH_DRIFT_WARN_MIN = 15;

/**
 * La frase della conferma di entrata, uscita o pausa: l'ora che si sta per
 * registrare e, se è lontana dall'orario del turno, cosa comporta — le ore
 * partono, o si fermano, da quel momento. Senza turno (fuori turno, pausa) solo
 * l'ora.
 */
export function punchConfirmMessage(
  action: "in" | "out" | "break",
  shift: ShiftTimes | null,
  now: Date = new Date()
): string {
  const time = toTimeString(now);
  const warnMs = PUNCH_DRIFT_WARN_MIN * 60_000;
  if (shift && action === "in") {
    const starts = shiftStartsAt(shift.date, shift.start_time);
    if (starts.getTime() - now.getTime() > warnMs) {
      return `Il turno inizia alle ${formatTime(shift.start_time)}: le ore partono da adesso (${time}).`;
    }
  }
  if (shift && action === "out") {
    const ends = shiftEndsAt(shift.date, shift.start_time, shift.end_time);
    if (ends.getTime() - now.getTime() > warnMs) {
      return `Il turno finisce alle ${formatTime(shift.end_time)}: le ore si fermano adesso (${time}).`;
    }
  }
  return `Registriamo l'ora di adesso: ${time}.`;
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
