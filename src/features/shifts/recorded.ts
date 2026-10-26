import { isShiftOver, type ShiftTimes } from "@/lib/format";

/**
 * Turno già fatto: un turno che si è svolto ma non era in agenda, registrato a
 * posteriori da chi ha «Ore» (`record_past_shift`). Le frasi stanno qui perché
 * app e dashboard devono dire la stessa cosa. Nessun import di React Native:
 * la dashboard web riusa questo file.
 */

/** L'etichetta sul turno: si vede che non è stato pianificato. */
export const RECORDED_LABEL = "Inserito a mano";

/** Titolo del form e del comando che lo apre. */
export const RECORD_TITLE = "Turno già fatto";
export const RECORD_ACTION = "Registra un turno già fatto";

export const RECORD_INTRO =
  "Per un turno che si è svolto ma non era in agenda. Le persone risultano presenti e le ore contano subito: se serve, le correggi poi dal turno.";

/** Il «+» di un giorno passato, per chi non ha «Ore». */
export const RECORD_NEEDS_HOURS =
  "Un giorno passato non si pianifica: per registrare un turno già fatto serve il permesso Ore.";

export const RECORD_NOT_FINISHED =
  "Questo turno non è ancora finito: pianificalo come nuovo turno.";

export const RECORD_NOTIFY_LABEL = "Avvisa le persone";
export const RECORD_NOTIFY_HINT =
  "Ricevono «Turno registrato». Di norma non serve: non c'è niente da confermare.";

export const RECORD_NOTE_PLACEHOLDER = "Es. turno non segnato in agenda";

/**
 * Nel form del nuovo turno, quando l'orario scelto è già passato: il passato
 * non si pianifica (`create_shifts` lo rifiuta), si registra.
 */
export const PLAN_ENDED =
  "Questo orario è già passato: un turno già fatto non si pianifica, si registra.";

/** Lo stesso, quando a essere passato è uno dei giorni da ripetere. */
export function planEndedExtra(days: string): string {
  return `${days}: a quest'ora è già passato. Toglilo dai giorni da ripetere.`;
}

/** I giorni pianificati in cui, con questi orari, il turno è già finito. */
export function endedDates(
  dates: string[],
  start_time: string,
  end_time: string,
  now: Date = new Date()
): string[] {
  return dates.filter((date) => isShiftOver({ date, start_time, end_time }, now));
}

/** Il turno è stato registrato a posteriori? */
export function isRecordedShift(shift: { recorded_at?: string | null }): boolean {
  return !!shift.recorded_at;
}

/**
 * Si può registrare come già fatto? Solo se è finito: il database rifiuta il
 * resto (`shift_not_finished`), e il form lo dice prima, sotto gli orari.
 */
export function canRecordShift(times: ShiftTimes, now: Date = new Date()): boolean {
  return isShiftOver(times, now);
}
