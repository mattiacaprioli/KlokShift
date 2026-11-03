import { describe, expect, it } from "vitest";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";
import { buildDailyCsv, dailyFileName } from "@/lib/exportBuilders";

function row(extra: Partial<HoursDailyRow> = {}): HoursDailyRow {
  return {
    person_id: "p", person_name: "Anna", date: "2026-11-05", kind: "work",
    venue_name: "Centro", title: "Sala", clock_in: "09:00", clock_out: "17:00",
    break_minutes: 30, break_paid: false, hours: 7.5, note: null, ...extra,
  };
}

const lines = (csv: string) => csv.replace(/^﻿/, "").split("\r\n");

describe("buildDailyCsv", () => {
  it("ha BOM e intestazione esatta", () => {
    const csv = buildDailyCsv([]);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines(csv)[0]).toBe(
      "Data;Persona;Sede;Turno;Causale;Entrata;Uscita;Pausa (min);Pausa retribuita;Ore;Note"
    );
  });

  it("due turni lo stesso giorno restano due righe", () => {
    const l = lines(buildDailyCsv([row(), row({ title: "Cena", hours: 3 })]));
    expect(l).toHaveLength(3);
    expect(l[1]).toBe("05/11/2026;Anna;Centro;Sala;Lavoro;09:00;17:00;30;No;7,5;");
  });

  it("to_fix: nota col motivo e ore vuote", () => {
    const l = lines(buildDailyCsv([
      row({ kind: "to_fix", note: "not_clocked", hours: null, clock_in: null, clock_out: null, break_minutes: null, break_paid: null }),
    ]));
    expect(l[1]).toBe("05/11/2026;Anna;Centro;Sala;Da verificare;;;;;;Non ha timbrato");
  });

  it("ferie senza ore: ore vuote", () => {
    const l = lines(buildDailyCsv([
      row({ kind: "ferie", venue_name: null, title: null, clock_in: null, clock_out: null, break_minutes: null, break_paid: null, hours: null }),
    ]));
    expect(l[1]).toBe("05/11/2026;Anna;;;Ferie;;;;;;");
  });

  it("note di conflitto e di permesso a ore", () => {
    const l = lines(buildDailyCsv([
      row({ kind: "ferie", note: "conflict" }),
      row({ kind: "permesso", note: "hourly:15:00-17:00" }),
    ]));
    expect(l[1].endsWith(";Da verificare")).toBe(true);
    expect(l[2].endsWith(";Dalle 15:00 alle 17:00")).toBe(true);
  });

  it("protegge le formule e usa virgola decimale", () => {
    const l = lines(buildDailyCsv([row({ person_name: "=SOMMA(A1)", hours: 7.83 })]));
    expect(l[1]).toContain(";'=SOMMA(A1);");
    expect(l[1]).toContain(";7,83;");
  });
});

describe("dailyFileName", () => {
  it("usa il prefisso ore-giornaliere", () => {
    expect(dailyFileName("Osteria", "Novembre 2026", "csv")).toBe(
      "ore-giornaliere-osteria-novembre-2026.csv"
    );
  });
});
