import { describe, expect, it } from "vitest";

import {
  NEEDS_CHECK_LABEL,
  needsCheck,
  periodFromParams,
  periodToParams,
} from "@/features/assignments/hoursPerson";
import type { ReportPeriod } from "@/features/assignments/reportPeriod";

const now = new Date(2026, 10, 22);

describe("needsCheck", () => {
  it("niente da verificare né senza timbratura: no", () => {
    expect(needsCheck({ conflict_hours: 0, untracked_hours: 0 })).toBe(false);
  });
  it("ore di assenza da verificare: sì", () => {
    expect(needsCheck({ conflict_hours: 2, untracked_hours: 0 })).toBe(true);
  });
  it("ore senza timbratura approvata: sì", () => {
    expect(needsCheck({ conflict_hours: 0, untracked_hours: 1.5 })).toBe(true);
  });
  it("l'etichetta", () => {
    expect(NEEDS_CHECK_LABEL).toBe("Da controllare");
  });
});

describe("periodo nei parametri", () => {
  const month: ReportPeriod = { kind: "month", month: "2026-11" };
  const range: ReportPeriod = { kind: "range", from: "2026-11-01", to: "2026-11-15" };

  it("mese e date diventano parametri", () => {
    expect(periodToParams(month)).toEqual({ mese: "2026-11" });
    expect(periodToParams(range)).toEqual({ dal: "2026-11-01", al: "2026-11-15" });
  });

  it("andata e ritorno", () => {
    expect(periodFromParams(periodToParams(month), now)).toEqual(month);
    expect(periodFromParams(periodToParams(range), now)).toEqual(range);
  });

  it("senza parametri o con parametri sbagliati: il mese in corso", () => {
    const current = { kind: "month", month: "2026-11" };
    expect(periodFromParams({}, now)).toEqual(current);
    expect(periodFromParams({ dal: "2026-11-20", al: "2026-11-01" }, now)).toEqual(current);
    expect(periodFromParams({ mese: "boh" }, now)).toEqual(current);
  });
});
