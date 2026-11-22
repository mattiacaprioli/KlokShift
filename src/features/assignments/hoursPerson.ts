import { monthKey } from "@/lib/format";
import type { MonthlyReportRow } from "./monthlyReport";
import {
  monthFromParam,
  validateRange,
  type ReportPeriod,
} from "./reportPeriod";

/**
 * La pagina Ore sul telefono: una riga corta per persona, il dettaglio nella
 * pagina della persona (spec 2026-11-22-ore-mobile-leggibile-design.md).
 * Nessun import nativo.
 */

/** Il solo segnale sulla riga: le frasi intere stanno nella pagina della persona. */
export const NEEDS_CHECK_LABEL = "Da controllare";

/**
 * Una riga va controllata quando il suo totale è più basso di quello che ci si
 * aspetta: ore di assenza in conflitto col lavoro, o ore senza timbratura
 * approvata, entrambe escluse.
 */
export function needsCheck(
  row: Pick<MonthlyReportRow, "conflict_hours" | "untracked_hours">
): boolean {
  return row.conflict_hours > 0 || row.untracked_hours > 0;
}

/** Il periodo nei parametri della rotta della persona. */
export function periodToParams(
  p: ReportPeriod
): { mese: string } | { dal: string; al: string } {
  return p.kind === "month" ? { mese: p.month } : { dal: p.from, al: p.to };
}

/** Il contrario: parametri mancanti o sbagliati portano al mese in corso. */
export function periodFromParams(
  params: { mese?: string; dal?: string; al?: string },
  now: Date = new Date()
): ReportPeriod {
  const month = monthFromParam(params.mese, now);
  if (month) return { kind: "month", month };
  if (params.dal && params.al && validateRange(params.dal, params.al) === null) {
    return { kind: "range", from: params.dal, to: params.al };
  }
  return { kind: "month", month: monthKey(now) };
}
