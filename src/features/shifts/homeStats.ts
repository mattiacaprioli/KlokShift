import { shiftCounts, type CountableShift } from "@/features/assignments/coverage";
import {
  isActiveAssignment,
  type AssignmentStatus,
} from "@/features/assignments/status";
import {
  addDaysToDate,
  isShiftOver,
  MONTH_NAMES,
  shiftDurationHours,
  startOfWeek,
  toDateString,
  todayString,
  type ShiftTimes,
} from "@/lib/format";
import type { Enums } from "@/types/database";

/**
 * I numeri "a colpo d'occhio" della home del titolare, su un periodo scelto.
 *
 * ⚠️ Questo modulo è **l'unica** definizione dei KPI, per la dashboard e per
 * l'app insieme. Fino al 16/09/2026 le due home li ricalcolavano ognuna per
 * conto suo e nessuna dichiarava un periodo: "31 turni in programma" voleva dire
 * *tutti i turni futuri mai creati*, "14 turni svolti" *tutti i passati
 * dall'inizio dei tempi*. Due totali che crescono all'infinito non rispondono a
 * "come sta andando", e non erano nemmeno confrontabili fra loro — il primo
 * escludeva gli annullati, il secondo li contava.
 *
 * L'anno è volutamente fuori: `getOwnerShiftsRange` scarica i turni con
 * fabbisogni e assegnazioni annidate, e dodici mesi su più sedi sono migliaia di
 * righe per stampare quattro interi. Se servirà, la strada è un RPC che aggrega
 * in SQL — non questo modulo.
 */
export type StatsPeriod = "week" | "month";

export const STATS_PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: "week", label: "Settimana" },
  { value: "month", label: "Mese" },
];

export type DateRange = { from: string; to: string };

/**
 * L'intervallo del periodo, estremi inclusi, come date DB (`YYYY-MM-DD`).
 *
 * La settimana è lunedì–domenica (quella italiana, la stessa del Planning): così
 * la home e il turnario parlano dello stesso arco di tempo, e la query del
 * periodo riusa la cache di `useOwnerShiftsRange` già riempita dal Planning.
 */
export function periodRange(
  period: StatsPeriod,
  now: Date = new Date()
): DateRange {
  if (period === "week") {
    const from = startOfWeek(todayString(now));
    return { from, to: addDaysToDate(from, 6) };
  }
  const year = now.getFullYear();
  const month = now.getMonth();
  return {
    from: toDateString(new Date(year, month, 1)),
    // Giorno 0 del mese successivo = ultimo giorno di questo, senza sapere se
    // sono 28, 29, 30 o 31.
    to: toDateString(new Date(year, month + 1, 0)),
  };
}

const MONTH_SHORT = MONTH_NAMES.map((m) => m.slice(0, 3));

/** "Questa settimana · 14–20 set", "Questo mese · settembre". */
export function periodLabel(
  period: StatsPeriod,
  now: Date = new Date()
): string {
  if (period === "month") {
    return `Questo mese · ${MONTH_NAMES[now.getMonth()]}`;
  }
  const { from, to } = periodRange(period, now);
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  const startLabel =
    start.getMonth() === end.getMonth()
      ? String(start.getDate())
      : `${start.getDate()} ${MONTH_SHORT[start.getMonth()]}`;
  return `Questa settimana · ${startLabel}–${end.getDate()} ${MONTH_SHORT[end.getMonth()]}`;
}

/**
 * Un turno visto dalle statistiche: quanto serve a `shiftCounts` più gli orari
 * (per le ore) e lo stato (per scartare gli annullati). `ShiftWithAssignees`,
 * che è ciò che torna `getOwnerShiftsRange`, lo soddisfa senza conversioni.
 */
export type StatsShift = CountableShift &
  ShiftTimes & {
    status: Enums<"shift_status">;
    shift_assignments: { status: AssignmentStatus }[];
  };

export type HomeStats = {
  /** Turni del periodo, annullati esclusi. */
  total: number;
  /** Di quelli, già conclusi (orario di fine passato, non la mezzanotte). */
  done: number;
  /** Di quelli, ancora da fare. */
  upcoming: number;
  /** Turni **non ancora iniziati** a cui manca qualcuno. */
  shortCount: number;
  /** Persone che mancano in tutto, sempre sui soli turni da fare. */
  missingSlots: number;
  /** Ore programmate: durata × persone che ci lavorano davvero. */
  hours: number;
};

/**
 * ⚠️ Copertura e posti mancanti guardano **solo i turni non ancora iniziati**,
 * anche quando il periodo comincia nel passato (una settimana in corso, di
 * mercoledì, è per metà alle spalle). Un turno di lunedì scorso rimasto scoperto
 * non è un compito: non lo si può più coprire, e contarlo trasformerebbe il
 * numero da cosa-da-fare in rimprovero.
 *
 * Le ore invece sommano tutto il periodo: sono il carico di lavoro della
 * settimana, non una cosa da fare. Restano comunque **programmate** — il
 * consuntivo vero sta in `shift_assignments.worked_hours` e lo aggrega la pagina
 * Ore, che è quella che va al commercialista.
 */
export function computeHomeStats(
  shifts: StatsShift[],
  now: Date = new Date()
): HomeStats {
  // Un turno annullato non ha posti da coprire né ore da lavorare.
  const active = shifts.filter((s) => s.status !== "cancelled");
  let done = 0;
  let shortCount = 0;
  let missingSlots = 0;
  let hours = 0;

  for (const shift of active) {
    if (isShiftOver(shift, now)) {
      done += 1;
    } else {
      const { filled, total, short } = shiftCounts(shift);
      if (short) {
        shortCount += 1;
        missingSlots += Math.max(0, total - filled);
      }
    }
    const working = shift.shift_assignments.filter((a) =>
      isActiveAssignment(a.status)
    ).length;
    hours += shiftDurationHours(shift.start_time, shift.end_time) * working;
  }

  return {
    total: active.length,
    done,
    upcoming: active.length - done,
    shortCount,
    missingSlots,
    hours,
  };
}
