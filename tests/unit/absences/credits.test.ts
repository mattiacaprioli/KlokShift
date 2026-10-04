import { describe, expect, it } from "vitest";

import {
  absenceDates,
  canCreditAbsence,
  creditChanges,
  creditDraftOf,
  creditSummary,
  fillEmptyCredits,
  parseCreditHours,
} from "@/features/absences/credits";

describe("ore riconosciute per giorno", () => {
  it("elenca i giorni dell'assenza, estremi compresi, anche a cavallo di mese", () => {
    expect(absenceDates({ start_date: "2026-09-29", end_date: "2026-10-02" })).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("legge le ore con la virgola, al minuto, fra 0 e 24 escluso lo zero", () => {
    expect(parseCreditHours("")).toBeNull();
    expect(parseCreditHours("  ")).toBeNull();
    expect(parseCreditHours("8")).toBe(480);
    expect(parseCreditHours("7,5")).toBe(450);
    expect(parseCreditHours("7.1")).toBe(426);
    expect(parseCreditHours("0")).toBeUndefined();
    expect(parseCreditHours("25")).toBeUndefined();
    expect(parseCreditHours("7,333")).toBeUndefined();
    expect(parseCreditHours("otto")).toBeUndefined();
  });

  it("riempie solo i giorni vuoti, senza toccare quelli già scritti", () => {
    const draft = { "2026-10-01": "", "2026-10-02": "4", "2026-10-03": "" };
    expect(fillEmptyCredits(draft, "8")).toEqual({
      "2026-10-01": "8",
      "2026-10-02": "4",
      "2026-10-03": "8",
    });
  });

  it("manda solo le differenze; svuotare un giorno toglie il credito", () => {
    const saved = [
      { date: "2026-10-01", minutes: 480, conflict: false },
      { date: "2026-10-02", minutes: 480, conflict: false },
    ];
    const dates = ["2026-10-01", "2026-10-02", "2026-10-03"];
    const draft = creditDraftOf(dates, saved);
    expect(draft).toEqual({ "2026-10-01": "8", "2026-10-02": "8", "2026-10-03": "" });
    expect(creditChanges(draft, saved)).toEqual([]);
    expect(
      creditChanges({ ...draft, "2026-10-02": "", "2026-10-03": "6" }, saved)
    ).toEqual([
      { date: "2026-10-02", minutes: null },
      { date: "2026-10-03", minutes: 360 },
    ]);
    expect(creditChanges({ ...draft, "2026-10-03": "x" }, saved)).toBeNull();
  });

  it("riassume le ore senza inventare i giorni mancanti", () => {
    expect(creditSummary([], 4)).toBe("Ore riconosciute non indicate");
    expect(
      creditSummary(
        [
          { date: "2026-10-01", minutes: 480, conflict: false },
          { date: "2026-10-02", minutes: 480, conflict: true },
        ],
        4
      )
    ).toBe("Ore riconosciute · 16 h su 2 giorni di 4 · 1 da verificare");
    expect(
      creditSummary([{ date: "2026-10-01", minutes: 450, conflict: false }], 1)
    ).toBe("Ore riconosciute · 7,5 h");
  });

  it("un collaboratore non indica le ore delle proprie assenze", () => {
    const a = { status: "approved" as const, start_time: null, member_id: "me" };
    const me = { canHours: true, isOwner: false, myMemberId: "me" };
    expect(canCreditAbsence(a, me)).toBe(false);
    expect(canCreditAbsence(a, { ...me, isOwner: true })).toBe(true);
    expect(canCreditAbsence({ ...a, member_id: "altro" }, me)).toBe(true);
    expect(canCreditAbsence({ ...a, start_time: "09:00" }, { ...me, isOwner: true })).toBe(false);
    expect(canCreditAbsence({ ...a, status: "pending" }, { ...me, isOwner: true })).toBe(false);
  });
});
