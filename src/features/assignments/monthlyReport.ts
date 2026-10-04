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
  total_retribuibile: number;
  conflict_hours: number;
  to_review_count: number;
  untracked_hours: number;
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
    return reportRow(p.person_id, p.person_name, p.roles, p.shifts_count, p.hours, p.to_review_count, p.untracked_hours, a);
  });
  for (const a of byId.values()) {
    rows.push(reportRow(a.person_id, a.person_name, null, 0, 0, 0, 0, a));
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
  a?: AbsenceSummaryRow
): MonthlyReportRow {
  const ferie_hours = a?.ferie_hours ?? 0;
  const malattia_hours = a?.malattia_hours ?? 0;
  const permesso_hours = a?.permesso_recognized_hours ?? 0;
  const justified_hours = ferie_hours + malattia_hours + permesso_hours;
  return {
    person_id, person_name, roles, shifts_count, worked_hours,
    ferie_hours, malattia_hours, permesso_hours, justified_hours,
    total_retribuibile: worked_hours + justified_hours,
    conflict_hours: a?.conflict_hours ?? 0,
    to_review_count,
    untracked_hours,
  };
}
