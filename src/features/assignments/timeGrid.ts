import {
  addDaysToDate,
  isOvernightShift,
  shiftDurationHours,
  todayString,
  type ShiftTimes,
} from "@/lib/format";

const DAY_MIN = 24 * 60;

/** L'ora su cui si apre una settimana senza turni e che non è quella in corso. */
const DEFAULT_HOUR = 8;

/**
 * Un pezzo di turno dentro **un** giorno della griglia oraria.
 *
 * Un turno notturno (22:00–04:00) occupa due colonne: fino a mezzanotte nel
 * giorno in cui inizia, e da mezzanotte alla fine nel giorno dopo. `continues`
 * e `continued` dicono quale dei due pezzi è, così il blocco può non ripetere
 * l'ora d'inizio sul pezzo che inizia a mezzanotte solo per via del taglio.
 */
export type GridSegment<T> = {
  item: T;
  /** Il giorno della colonna, "YYYY-MM-DD" — non per forza quello del turno. */
  date: string;
  /** Minuti dalla mezzanotte, 0–1440. */
  startMin: number;
  endMin: number;
  /** Il turno prosegue nel giorno dopo. */
  continues: boolean;
  /** Il pezzo è la coda di un turno iniziato il giorno prima. */
  continued: boolean;
  /** Corsia del blocco quando più turni si sovrappongono nello stesso giorno. */
  lane: number;
  /** Quante corsie divide la colonna il gruppo di sovrapposizioni. */
  lanes: number;
};

function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * I pezzi di turno di ogni giorno in `days`, con le corsie già assegnate.
 *
 * Un notturno iniziato il giorno prima del primo giorno chiesto compare con la
 * sua coda: per questo chi carica i dati deve prendere anche quel giorno.
 */
export function daySegments<T extends { shift: ShiftTimes }>(
  items: readonly T[],
  days: readonly string[]
): Map<string, GridSegment<T>[]> {
  const byDay = new Map<string, GridSegment<T>[]>(days.map((d) => [d, []]));
  const push = (seg: Omit<GridSegment<T>, "lane" | "lanes">) =>
    byDay.get(seg.date)?.push({ ...seg, lane: 0, lanes: 1 });

  for (const item of items) {
    const { date, start_time, end_time } = item.shift;
    const start = toMinutes(start_time);
    const end = toMinutes(end_time);
    if (!isOvernightShift(start_time, end_time)) {
      push({ item, date, startMin: start, endMin: end, continues: false, continued: false });
      continue;
    }
    // 16:00–00:00 finisce esattamente a mezzanotte: niente coda da disegnare.
    push({ item, date, startMin: start, endMin: DAY_MIN, continues: end > 0, continued: false });
    if (end > 0) {
      push({
        item,
        date: addDaysToDate(date, 1),
        startMin: 0,
        endMin: end,
        continues: false,
        continued: true,
      });
    }
  }

  for (const segments of byDay.values()) assignLanes(segments);
  return byDay;
}

/**
 * Affianca i turni che si sovrappongono, come fa qualunque calendario.
 *
 * Si scorre per ora d'inizio: ogni blocco prende la prima corsia già libera, e
 * un gruppo di sovrapposizioni si chiude quando un blocco inizia dopo la fine
 * di tutti quelli aperti. Tutti i blocchi di un gruppo dividono la colonna
 * nello stesso numero di corsie, così restano allineati fra loro.
 */
export function assignLanes<T>(segments: GridSegment<T>[]): void {
  segments.sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let group: GridSegment<T>[] = [];
  let laneEnds: number[] = [];
  let groupEnd = -1;

  const close = () => {
    for (const seg of group) seg.lanes = laneEnds.length;
    group = [];
    laneEnds = [];
  };

  for (const seg of segments) {
    if (seg.startMin >= groupEnd) close();
    let lane = laneEnds.findIndex((end) => end <= seg.startMin);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = seg.endMin;
    seg.lane = lane;
    group.push(seg);
    groupEnd = Math.max(groupEnd, seg.endMin);
  }
  close();
}

/**
 * L'ora su cui aprire la griglia di una settimana: un'ora prima del primo
 * turno, così il blocco non sta incollato al bordo. Senza turni, l'ora
 * corrente se la settimana è quella in corso, altrimenti le 8.
 *
 * Le code dei notturni non contano: partono tutte da mezzanotte e
 * aprirebbero ogni settimana con un notturno sul buio delle 00.
 */
export function initialScrollHour<T>(
  byDay: ReadonlyMap<string, GridSegment<T>[]>,
  days: readonly string[],
  now: Date
): number {
  let first = Infinity;
  for (const day of days) {
    for (const seg of byDay.get(day) ?? []) {
      if (!seg.continued) first = Math.min(first, seg.startMin);
    }
  }
  const hour = Number.isFinite(first)
    ? Math.floor(first / 60)
    : days.includes(todayString(now))
      ? now.getHours()
      : DEFAULT_HOUR;
  return Math.max(0, hour - 1);
}

/** Le ore pianificate dei turni che **iniziano** nei giorni dati. */
export function plannedHours<T extends { shift: ShiftTimes }>(
  items: readonly T[],
  days: readonly string[]
): number {
  return items
    .filter((i) => days.includes(i.shift.date))
    .reduce(
      (sum, i) => sum + shiftDurationHours(i.shift.start_time, i.shift.end_time),
      0
    );
}
