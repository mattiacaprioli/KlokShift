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
