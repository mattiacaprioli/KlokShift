import {
  addMonthsToKey,
  formatDate,
  formatHours,
  formatShiftRange,
  monthKey,
  todayString,
} from "@/lib/format";
import type { HourToFix, HourToFixKind } from "./api";
import type { ReportPeriod } from "./reportPeriod";

/**
 * «Ore da sistemare» nella pagina Ore: i turni conclusi le cui ore non contano
 * ancora (`get_hours_to_fix`). Le frasi stanno qui perché app e dashboard
 * devono dire la stessa cosa. Nessun import di React Native.
 */

export const HOURS_TO_FIX_TITLE = "Ore da sistemare";
export const HOURS_TO_FIX_HINT =
  "Turni finiti le cui ore non contano ancora. Aprili per inserire gli orari, l'uscita o per approvarli.";

const KIND_LABEL: Record<HourToFixKind, string> = {
  not_clocked: "Non ha timbrato",
  missing_out: "Uscita mancante",
  to_approve: "Da approvare",
  clock_overlap: "Ha già timbrato in quelle ore",
};

/** Il perché, accanto al nome: «Non ha timbrato», «Da approvare · 8 h». */
export function hourToFixLabel(item: Pick<HourToFix, "kind" | "hours">): string {
  return item.kind === "to_approve"
    ? `${KIND_LABEL.to_approve} · ${formatHours(item.hours)}`
    : KIND_LABEL[item.kind];
}

/** «ven 23 ott · 18:00–23:00». */
export function hourToFixWhen(
  item: Pick<HourToFix, "date" | "start_time" | "end_time">
): string {
  return `${formatDate(item.date)} · ${formatShiftRange(item.start_time, item.end_time)}`;
}

/** «3 turni · 14 h che non contano ancora». */
export function hoursToFixSummary(items: Pick<HourToFix, "hours">[]): string {
  const n = items.length;
  const hours = items.reduce((sum, item) => sum + Number(item.hours), 0);
  return `${n} ${n === 1 ? "turno" : "turni"} · ${formatHours(hours)} che non contano ancora`;
}

/**
 * Il periodo che guarda la Home: dal primo del mese scorso a oggi. Nei primi
 * giorni del mese è proprio il mese scorso a dover essere chiuso per le buste
 * paga, e la sola pagina Ore aprirebbe sul mese nuovo, vuoto.
 */
export function homeHoursToFixPeriod(now: Date = new Date()): ReportPeriod {
  return {
    kind: "range",
    from: `${addMonthsToKey(monthKey(now), -1)}-01`,
    to: todayString(now),
  };
}

/** Il mese su cui aprire la pagina Ore: quello del turno più vecchio da sistemare. */
export function hoursToFixFirstMonth(items: Pick<HourToFix, "date">[]): string | null {
  if (items.length === 0) return null;
  return items.reduce((min, item) => (item.date < min ? item.date : min), items[0].date).slice(0, 7);
}
