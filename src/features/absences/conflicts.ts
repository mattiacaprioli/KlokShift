import { addDaysToDate, isShiftOver, shiftEndsAt, type ShiftTimes } from "@/lib/format";
import type { Absence } from "./api";

/**
 * Il minimo di un'assenza per collocarla nel tempo. Basta questo anche a chi
 * non può leggerne il tipo (`get_absence_availability`).
 */
export type AbsenceWindow = Pick<
  Absence,
  "start_date" | "end_date" | "start_time" | "end_time"
> & { status: Absence["status"] };

function at(date: string, time: string): Date {
  return new Date(`${date}T${time.slice(0, 5)}:00`);
}

/**
 * L'intervallo in cui la persona non c'è: giorni interi da mezzanotte a
 * mezzanotte, oppure l'orario del permesso.
 */
function absenceInterval(a: AbsenceWindow): [Date, Date] {
  if (a.start_time && a.end_time) {
    return [at(a.start_date, a.start_time), at(a.start_date, a.end_time)];
  }
  return [
    at(a.start_date, "00:00"),
    at(addDaysToDate(a.end_date, 1), "00:00"),
  ];
}

/**
 * Il turno cade (anche in parte) nell'assenza?
 *
 * Si confrontano gli istanti e non le date, per due casi che con le date
 * sbaglierebbero: il turno notturno che comincia il giorno prima delle ferie e
 * finisce dentro (`shiftEndsAt`), e il permesso a ore che non tocca il turno
 * della sera.
 */
export function shiftOverlapsAbsence(
  shift: ShiftTimes,
  absence: AbsenceWindow
): boolean {
  const [aStart, aEnd] = absenceInterval(absence);
  const sStart = at(shift.date, shift.start_time);
  const sEnd = shiftEndsAt(shift.date, shift.start_time, shift.end_time);
  return sStart < aEnd && aStart < sEnd;
}

/**
 * I turni in conflitto con l'assenza: quelli che si sovrappongono e non sono
 * già finiti. Un turno concluso non si toglie a nessuno — ha già le sue ore.
 */
export function absenceConflicts<T extends ShiftTimes>(
  shifts: T[],
  absence: AbsenceWindow,
  now: Date = new Date()
): T[] {
  return shifts.filter(
    (s) => !isShiftOver(s, now) && shiftOverlapsAbsence(s, absence)
  );
}

/**
 * La prima assenza attiva che tocca il turno, o `null`. Un'approvata vince su
 * una in sospeso: è quella che dice davvero «non c'è».
 */
export function absenceForShift<A extends AbsenceWindow>(
  shift: ShiftTimes,
  absences: A[]
): A | null {
  const hits = absences.filter(
    (a) =>
      (a.status === "approved" || a.status === "pending") &&
      shiftOverlapsAbsence(shift, a)
  );
  return hits.find((a) => a.status === "approved") ?? hits[0] ?? null;
}

/**
 * La prima assenza attiva che tocca un giorno di calendario, per le celle del
 * planning. Anche qui un'approvata vince su una in sospeso.
 */
export function absenceOnDay<A extends AbsenceWindow>(
  day: string,
  absences: A[]
): A | null {
  const hits = absences.filter(
    (a) =>
      (a.status === "approved" || a.status === "pending") &&
      a.start_date <= day &&
      a.end_date >= day
  );
  return hits.find((a) => a.status === "approved") ?? hits[0] ?? null;
}
