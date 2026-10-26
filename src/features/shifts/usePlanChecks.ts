import { useMemo } from "react";
import { absencesOnDates } from "@/features/absences/conflicts";
import { useAbsenceAvailability } from "@/features/absences/hooks";
import { addDaysToDate } from "@/lib/format";
import { useOwnerShiftsRange } from "./hooks";
import { personClashes, type ShiftClash } from "./moveImpact";
import { absenceHitsLabel, clashLabel, type AbsenceHit } from "./repeat";

/**
 * Cosa sapere delle persone prima di metterle in un turno, su tutti i giorni in
 * cui nasce: chi è assente e chi lavora già a quell'ora. Avvisi, mai blocchi.
 *
 * Carica un giorno in più per lato, come `moveImpactWindow`: lì stanno i
 * notturni iniziati il giorno prima e le assenze toccate dopo mezzanotte. Le
 * due query sono anche quelle che lo spostamento passa a `shiftMoveImpact`.
 */
export function usePlanChecks(plan: {
  /** I giorni pianificati, in ordine (vedi `plannedDatesOf`). */
  dates: string[];
  start_time: string;
  end_time: string;
  /** In modifica: il turno stesso non si accavalla con sé. */
  excludeShiftId?: string;
}) {
  const { dates, start_time, end_time, excludeShiftId } = plan;
  const from = dates.length ? addDaysToDate(dates[0], -1) : "";
  const to = dates.length ? addDaysToDate(dates[dates.length - 1], 1) : "";
  const ready = dates.length > 0 && !!start_time && !!end_time;
  const manyDays = dates.length > 1;

  const absences = useAbsenceAvailability(from, to, dates.length > 0);
  const dayShifts = useOwnerShiftsRange(from, to);

  const datesKey = dates.join(",");
  const clashes = useMemo(
    () =>
      ready
        ? personClashes({
            times: datesKey
              .split(",")
              .map((date) => ({ date, start_time, end_time })),
            excludeShiftId,
            dayShifts: dayShifts.data ?? [],
          })
        : new Map<string, ShiftClash[]>(),
    [ready, datesKey, start_time, end_time, excludeShiftId, dayShifts.data]
  );

  /** Le assenze della persona (`person_id`) che toccano i giorni pianificati. */
  function absenceHitsFor(personId: string): AbsenceHit[] {
    if (!ready) return [];
    return absencesOnDates(
      dates,
      { start_time, end_time },
      (absences.data ?? []).filter((a) => a.member_id === personId)
    );
  }

  /** Le righe d'avviso sotto il nome: assenza, poi doppio turno. */
  function notesFor(personId: string): string[] {
    return [
      absenceHitsLabel(absenceHitsFor(personId), manyDays),
      clashLabel(clashes.get(personId) ?? [], manyDays),
    ].filter((n): n is string => !!n);
  }

  return { absences, dayShifts, absenceHitsFor, notesFor };
}
