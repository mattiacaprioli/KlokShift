import { formatDayLabel } from "@/lib/format";
import type { ShiftWithVenue } from "@/features/shifts/types";
import type { AssignmentWithShift } from "./api";

/**
 * Un'assegnazione di cui si sa già che il turno c'è: è il solo caso che
 * l'agenda sa disegnare, e toglie di mezzo il `shift!` da ogni call-site.
 */
export type AgendaItem = AssignmentWithShift & { shift: ShiftWithVenue };

/** Un giorno d'agenda, nella forma che `SectionList` si aspetta. */
export type DaySection<T> = {
  /**
   * "YYYY-MM-DD" — la chiave, non l'etichetta. `null` per una sezione che non
   * è un giorno (lo storico in coda all'agenda della sede): chi sincronizza il
   * calendario con lo scorrimento la salta.
   */
  date: string | null;
  /** "Oggi", "Domani", "gio 12 set". */
  title: string;
  data: T[];
};

export type AgendaSection = DaySection<AgendaItem>;

/** Le assegnazioni con un turno collegato, nell'ordine in cui sono arrivate. */
export function withShift(items: AssignmentWithShift[]): AgendaItem[] {
  return items.filter((a): a is AgendaItem => a.shift != null);
}

/**
 * Raggruppa righe già ordinate per data in sezioni di giorno.
 *
 * Chi chiama passa righe **già ordinate** (`getMyAssignedUpcoming` ordina per
 * `shiftSortKey`, `getMyShifts` per `date, start_time`), quindi qui basta una
 * riduzione sequenziale: giorni in ordine, e turni in ordine dentro il giorno.
 *
 * Un turno notturno (22:00–04:00) sta sotto il giorno in cui **inizia**, che è
 * il giorno in cui ci si presenta alla sede — stessa convenzione di
 * `shiftDurationHours` e `shiftEndsAt`.
 */
export function groupByDay<T>(
  rows: readonly T[],
  dateOf: (row: T) => string,
  now: Date = new Date()
): DaySection<T>[] {
  const sections: DaySection<T>[] = [];
  for (const row of rows) {
    const date = dateOf(row);
    const last = sections[sections.length - 1];
    if (last?.date === date) last.data.push(row);
    else sections.push({ date, title: formatDayLabel(date, now), data: [row] });
  }
  return sections;
}

/** I turni assegnati al professionista, per giorno. */
export function groupAssignmentsByDay(
  items: AgendaItem[],
  now: Date = new Date()
): AgendaSection[] {
  return groupByDay(items, (a) => a.shift.date, now);
}

/** I giorni che hanno almeno un turno: i pallini sotto le celle del calendario. */
export function daysWithShifts(items: AgendaItem[]): Set<string> {
  return new Set(items.map((a) => a.shift.date));
}
