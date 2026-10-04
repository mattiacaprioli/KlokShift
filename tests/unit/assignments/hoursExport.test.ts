import { describe, expect, it } from "vitest";
import { exportAvailability } from "@/features/assignments/monthlyReport";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import { buildAbsencesCsv, buildHoursCsv, buildHoursHtml } from "@/lib/exportBuilders";

function person(extra: Partial<PersonHours> = {}): PersonHours {
  return {
    person_id: "p", person_name: "Anna", roles: "Sala", shifts_count: 1,
    hours: 8, planned_hours: 8, to_review_count: 0, proposed_hours: 0, untracked_hours: 0,
    venues: [], ...extra,
  };
}

function absence(extra: Partial<AbsenceSummaryRow> = {}): AbsenceSummaryRow {
  return {
    person_id: "a", person_name: "Marco", ferie_days: 1, permesso_days: 0,
    permesso_hours: 0, malattia_days: 0, ferie_hours: 8, malattia_hours: 0,
    permesso_recognized_hours: 0, conflict_hours: 0, inps_protocols: null, ...extra,
  };
}

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("disponibilità degli export del mese (B06)", () => {
  const ready = { hoursReady: true, absencesReady: true, reportRows: 2, absenceRows: 1 };

  it("non esporta il mensile con le ore ancora in arrivo o in errore", () => {
    expect(exportAvailability({ ...ready, hoursReady: false })).toEqual({ monthly: false, absences: true });
  });

  it("non esporta nulla con le assenze ancora in arrivo o in errore", () => {
    expect(exportAvailability({ ...ready, absencesReady: false })).toEqual({ monthly: false, absences: false });
  });

  it("esporta il mensile con le sole assenze se le ore sono caricate e vuote", () => {
    expect(exportAvailability({ ...ready, reportRows: 1 })).toEqual({ monthly: true, absences: true });
  });

  it("non esporta un mese vuoto", () => {
    expect(exportAvailability({ ...ready, reportRows: 0, absenceRows: 0 })).toEqual({
      monthly: false,
      absences: false,
    });
  });
});

describe("anomalie nel PDF (B06)", () => {
  it("segnala le timbrature da verificare come il CSV, senza contarle nel lavorato", () => {
    const pending = person({ hours: 0, shifts_count: 1, to_review_count: 2, proposed_hours: 8 });
    const html = buildHoursHtml("Osteria", "ottobre 2026", [pending], 0);
    expect(html).toContain("2 turni da verificare");
    expect(html).not.toMatch(/<td class="n">—<\/td><\/tr><\/tbody>/);
    expect(lines(buildHoursCsv([pending]))[1].split(";")).toEqual([
      "Anna", "Sala", "1", "0", "0", "0", "0", "0", "0", "0", "0", "Da verificare",
    ]);
  });

  it("usa il singolare per un turno solo e unisce le altre anomalie", () => {
    const html = buildHoursHtml("Osteria", "ottobre 2026", [person({ to_review_count: 1, untracked_hours: 2 })], 8);
    expect(html).toContain("2 h senza timbratura · 1 turno da verificare");
  });
});

describe("celle CSV (B06)", () => {
  it("neutralizza le formule nelle celle di testo e lascia i numeri numerici", () => {
    const people = ["=1+1", "+39 333", "-2", "@SUM(A1)", "\tTab", "\rCR"].map((name, i) =>
      person({ person_id: String(i), person_name: name, roles: "=HYPERLINK(\"x\")", hours: 12.5 })
    );
    const csv = buildHoursCsv(people);
    const cells = lines(csv).slice(1).map((l) => l.split(";").slice(0, 4));
    expect(cells[0]).toEqual(["'=1+1", `"'=HYPERLINK(""x"")"`, "1", "12,5"]);
    expect(cells[1][0]).toBe("'+39 333");
    expect(cells[2][0]).toBe("'-2");
    expect(cells[3][0]).toBe("'@SUM(A1)");
    expect(cells[4][0]).toBe("'\tTab");
    expect(csv).toContain(`"'\rCR"`);
  });

  it("quota virgolette, punto e virgola e a capo, e conserva gli accenti", () => {
    const csv = buildHoursCsv([
      person({ person_name: 'Niccolò "Nico" Rè', roles: "Sala; Bar\nCucina", hours: 7.25 }),
    ]);
    expect(csv).toContain('\r\n"Niccolò ""Nico"" Rè";');
    expect(csv).toContain('"Sala; Bar\nCucina"');
    expect(csv).toContain(";7,3;");
  });

  it("applica la stessa regola al CSV delle assenze", () => {
    const csv = buildAbsencesCsv([absence({ person_name: "=cmd", inps_protocols: "-123; 456" })]);
    expect(lines(csv)[1]).toBe(`'=cmd;1;0;0;0;"'-123; 456"`);
  });
});
