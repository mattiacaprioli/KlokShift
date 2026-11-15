import { describe, expect, it } from "vitest";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";
import type { SurchargeRow } from "@/features/assignments/surcharges";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import type { ExportCodes } from "@/features/assignments/exportCodes";
import {
  buildAbsencesCsv,
  buildAbsencesTable,
  buildDailyCsv,
  buildDailyTable,
  buildHoursCsv,
  buildHoursTable,
  tableToCsv,
} from "@/lib/exportBuilders";

/*
 * I CSV della pagina Ore nascono da una tabella (intestazione + righe), che è
 * anche quella che mostra l'anteprima dell'export: le righe in anteprima sono
 * per costruzione quelle del file. Qui si prova che serializzare la tabella dà
 * esattamente il file di sempre (i test dei singoli file fissano il contenuto).
 */

function row(extra: Partial<HoursDailyRow> = {}): HoursDailyRow {
  return {
    person_id: "p", person_name: "Anna", date: "2026-11-05", kind: "work",
    venue_name: "Centro", title: "Sala", clock_in: "09:00", clock_out: "17:00",
    break_minutes: 30, break_paid: false, hours: 7.5, note: null, ...extra,
  };
}

function sur(extra: Partial<SurchargeRow> = {}): SurchargeRow {
  return {
    person_id: "p", person_name: "Anna", date: "2026-11-05", venue_name: "Centro", title: "Sala",
    clock_in: "09:00", clock_out: "17:00", kind: "night", percentage: 20, hours: 1.5, ...extra,
  };
}

function person(extra: Partial<PersonHours> = {}): PersonHours {
  return {
    person_id: "p", person_name: "Anna", roles: "Sala", shifts_count: 1,
    hours: 8, planned_hours: 8, to_review_count: 0, proposed_hours: 0, untracked_hours: 0,
    paid_break_hours: 0, unpaid_break_hours: 0, venues: [], ...extra,
  };
}

function absence(extra: Partial<AbsenceSummaryRow> = {}): AbsenceSummaryRow {
  return {
    person_id: "a", person_name: "Marco", ferie_days: 1, permesso_days: 0,
    permesso_hours: 0, malattia_days: 0, ferie_hours: 8, malattia_hours: 0,
    permesso_recognized_hours: 0, conflict_hours: 0, inps_protocols: null, missing_certificates: 0, ...extra,
  };
}

const codes: ExportCodes = {
  codes: { company: "AZ", work: "01", ferie: "FE", night: "NOT" },
  matricole: new Map([["p", "A12"]]),
};

const daily = [row(), row({ date: "2026-11-06", kind: "ferie", hours: 8 }), row({ date: "2026-11-07", hours: 6 })];

describe("tabelle degli export", () => {
  it("il CSV giornaliero è la sua tabella serializzata", () => {
    for (const c of [undefined, codes]) {
      for (const s of [[], [sur()]]) {
        expect(tableToCsv(buildDailyTable(daily, c, s))).toBe(buildDailyCsv(daily, c, s));
      }
    }
  });

  it("il CSV mensile è la sua tabella serializzata", () => {
    const people = [person(), person({ person_id: "q", person_name: "Luca", hours: 20 })];
    const absences = [absence({ person_id: "p" })];
    for (const c of [undefined, codes]) {
      for (const s of [[], [sur()]]) {
        expect(tableToCsv(buildHoursTable(people, absences, c, s))).toBe(
          buildHoursCsv(people, absences, c, s)
        );
      }
    }
  });

  it("il CSV delle assenze è la sua tabella serializzata", () => {
    const rows = [absence(), absence({ person_id: "b", person_name: "Sara", malattia_days: 2, inps_protocols: "123" })];
    for (const c of [undefined, codes]) {
      expect(tableToCsv(buildAbsencesTable(rows, c))).toBe(buildAbsencesCsv(rows, c));
    }
  });

  it("le righe «di cui» stanno nella tabella dopo la loro riga di lavoro", () => {
    const table = buildDailyTable([row(), row({ date: "2026-11-06" })], undefined, [sur()]);
    expect(table.rows).toHaveLength(3);
    expect(table.rows[0][4]).toBe("Lavoro");
    expect(table.rows[1][4]).toBe("Di cui notturno +20%");
    expect(table.rows[2][0]).toBe("06/11/2026");
  });

  it("le celle della tabella sono quelle del file", () => {
    const table = buildDailyTable([row({ person_name: "=Rossi; Mario" })]);
    expect(table.rows[0][1]).toBe(`"'=Rossi; Mario"`);
  });

  it("l'intestazione è una cella per colonna", () => {
    expect(buildDailyTable(daily).header).toHaveLength(11);
    expect(buildDailyTable(daily, codes).header).toHaveLength(14);
  });
});
