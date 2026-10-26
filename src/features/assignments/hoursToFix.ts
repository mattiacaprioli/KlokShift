import { formatDate, formatHours, formatShiftRange } from "@/lib/format";
import type { HourToFix, HourToFixKind } from "./api";

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
