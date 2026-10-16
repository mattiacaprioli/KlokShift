import type { PersonHours } from "./hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";

export type MonthlyReportRow = {
  person_id: string;
  person_name: string;
  roles: string | null;
  shifts_count: number;
  worked_hours: number;
  ferie_hours: number;
  malattia_hours: number;
  permesso_hours: number;
  justified_hours: number;
  /** Ore lavorate più ore di assenza riconosciute; non è un importo di busta paga. */
  covered_hours: number;
  conflict_hours: number;
  to_review_count: number;
  untracked_hours: number;
  /** Già dentro `worked_hours`: si dice a parte, non si somma. */
  paid_break_hours: number;
  /** Già fuori da `worked_hours`: si dice a parte, non si somma. */
  unpaid_break_hours: number;
};

/** Un'unica composizione per dashboard, CSV e PDF; include chi ha solo assenze. */
export function monthlyReportRows(
  people: PersonHours[],
  absences: AbsenceSummaryRow[]
): MonthlyReportRow[] {
  const byId = new Map(absences.map((a) => [a.person_id, a]));
  const rows = people.map((p) => {
    const a = byId.get(p.person_id);
    byId.delete(p.person_id);
    return reportRow(p.person_id, p.person_name, p.roles, p.shifts_count, p.hours, p.to_review_count, p.untracked_hours, p.paid_break_hours, p.unpaid_break_hours, a);
  });
  for (const a of byId.values()) {
    rows.push(reportRow(a.person_id, a.person_name, null, 0, 0, 0, 0, 0, 0, a));
  }
  return rows;
}

function reportRow(
  person_id: string,
  person_name: string,
  roles: string | null,
  shifts_count: number,
  worked_hours: number,
  to_review_count: number,
  untracked_hours: number,
  paid_break_hours: number,
  unpaid_break_hours: number,
  a?: AbsenceSummaryRow
): MonthlyReportRow {
  const ferie_hours = a?.ferie_hours ?? 0;
  const malattia_hours = a?.malattia_hours ?? 0;
  const permesso_hours = a?.permesso_recognized_hours ?? 0;
  const justified_hours = ferie_hours + malattia_hours + permesso_hours;
  return {
    person_id, person_name, roles, shifts_count, worked_hours,
    ferie_hours, malattia_hours, permesso_hours, justified_hours,
    covered_hours: worked_hours + justified_hours,
    conflict_hours: a?.conflict_hours ?? 0,
    to_review_count,
    untracked_hours,
    paid_break_hours,
    unpaid_break_hours,
  };
}

/**
 * La pausa accanto alle ore lavorate, nelle pagine Ore: «di cui pausa
 * retribuita 1 h · pausa non retribuita esclusa 0,5 h». `null` senza pause.
 * `formatHours` arriva da fuori perché questo modulo resta senza dipendenze.
 */
export function breakSummaryText(
  row: Pick<MonthlyReportRow, "paid_break_hours" | "unpaid_break_hours">,
  formatHours: (hours: number) => string
): string | null {
  const parts = [
    row.paid_break_hours > 0
      ? `di cui pausa retribuita ${formatHours(row.paid_break_hours)}`
      : null,
    row.unpaid_break_hours > 0
      ? `pausa non retribuita esclusa ${formatHours(row.unpaid_break_hours)}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Quando si possono esportare i documenti del mese: dashboard e app usano la
 * stessa regola. Il mensile compone ore e assenze, quindi aspetta **entrambe**:
 * con le sole assenze arrivate uscirebbe un file valido con il lavoro a zero.
 * Il CSV delle assenze dipende solo dalle assenze.
 */
export function exportAvailability(input: {
  hoursReady: boolean;
  absencesReady: boolean;
  reportRows: number;
  absenceRows: number;
}): { monthly: boolean; absences: boolean } {
  return {
    monthly: input.hoursReady && input.absencesReady && input.reportRows > 0,
    absences: input.absencesReady && input.absenceRows > 0,
  };
}
