import { describe, expect, it } from "vitest";
import { monthlyReportRows } from "@/features/assignments/monthlyReport";
import { buildHoursCsv } from "@/lib/exportBuilders";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";

const worker: PersonHours = {
  person_id: "worker", person_name: "Anna", roles: "Sala", shifts_count: 1,
  hours: 8, planned_hours: 8, to_review_count: 0, proposed_hours: 0, untracked_hours: 0, venues: [],
};
const sick: AbsenceSummaryRow = {
  person_id: "sick", person_name: "Marco", ferie_days: 0, permesso_days: 0,
  permesso_hours: 0, malattia_days: 1, ferie_hours: 0, malattia_hours: 8,
  permesso_recognized_hours: 0, conflict_hours: 0, inps_protocols: null,
};

describe("consuntivo mensile", () => {
  it("esporta lavoro e malattia su colonne separate, anche senza turni", () => {
    const rows = monthlyReportRows([worker], [sick]);
    expect(rows.map((r) => [r.worked_hours, r.justified_hours, r.covered_hours]))
      .toEqual([[8, 0, 8], [0, 8, 8]]);
    const csv = buildHoursCsv([worker], [sick]).replace(/^\uFEFF/, "").split("\r\n");
    expect(csv[0]).toContain("MAL/Malattia - ore riconosciute");
    expect(csv[0]).toContain("Totale ore coperte");
    expect(csv[0]).not.toContain("retribuibile");
    expect(csv[1].split(";").slice(3, 10)).toEqual(["8", "0", "0", "0", "0", "8", "0"]);
    expect(csv[2].split(";").slice(3, 10)).toEqual(["0", "0", "8", "0", "8", "8", "0"]);
  });

  it("esclude i crediti in conflitto dal totale e li segnala", () => {
    const rows = monthlyReportRows([worker], [{ ...sick, person_id: "worker", malattia_hours: 0, conflict_hours: 8 }]);
    expect(rows[0].covered_hours).toBe(8);
    expect(rows[0].conflict_hours).toBe(8);
    expect(buildHoursCsv([worker], [{ ...sick, person_id: "worker", malattia_hours: 0, conflict_hours: 8 }]))
      .toContain("8;0;Da verificare");
  });
});
