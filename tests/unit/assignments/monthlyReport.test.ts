import { describe, expect, it } from "vitest";
import {
  breakSummaryText,
  monthlyReportRows,
} from "@/features/assignments/monthlyReport";
import { buildHoursCsv } from "@/lib/exportBuilders";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";

const worker: PersonHours = {
  person_id: "worker", person_name: "Anna", roles: "Sala", shifts_count: 1,
  hours: 8, planned_hours: 8, to_review_count: 0, proposed_hours: 0, untracked_hours: 0,
  paid_break_hours: 0, unpaid_break_hours: 0, venues: [],
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
    // Dopo le ore lavorate, le due colonne di pausa; poi gli eventi.
    expect(csv[1].split(";").slice(3, 12)).toEqual(["8", "0", "0", "0", "0", "0", "0", "8", "0"]);
    expect(csv[2].split(";").slice(3, 12)).toEqual(["0", "0", "0", "0", "8", "0", "8", "8", "0"]);
  });

  it("la pausa sta in due colonne a parte, senza toccare i totali", () => {
    const withBreaks = { ...worker, hours: 7.5, paid_break_hours: 1, unpaid_break_hours: 0.5 };
    const [row] = monthlyReportRows([withBreaks], []);
    expect([row.worked_hours, row.covered_hours]).toEqual([7.5, 7.5]);
    const csv = buildHoursCsv([withBreaks]).replace(/^\uFEFF/, "").split("\r\n");
    expect(csv[0]).toContain(
      "Ore lavorate effettive;Di cui pausa retribuita;Pausa non retribuita esclusa"
    );
    expect(csv[1].split(";").slice(3, 6)).toEqual(["7,5", "1", "0,5"]);
    const h = (n: number) => `${n} h`;
    expect(breakSummaryText(row, h)).toBe(
      "di cui pausa retribuita 1 h · pausa non retribuita esclusa 0.5 h"
    );
    expect(breakSummaryText({ paid_break_hours: 0, unpaid_break_hours: 0 }, h)).toBeNull();
  });

  it("esclude i crediti in conflitto dal totale e li segnala", () => {
    const rows = monthlyReportRows([worker], [{ ...sick, person_id: "worker", malattia_hours: 0, conflict_hours: 8 }]);
    expect(rows[0].covered_hours).toBe(8);
    expect(rows[0].conflict_hours).toBe(8);
    expect(buildHoursCsv([worker], [{ ...sick, person_id: "worker", malattia_hours: 0, conflict_hours: 8 }]))
      .toContain("8;0;Da verificare");
  });
});
