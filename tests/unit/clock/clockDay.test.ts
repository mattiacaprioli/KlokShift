import { describe, expect, it } from "vitest";

import { clockOutDayNote, clockRangeError, withDay } from "@/features/clock/hours";

describe("clockOutDayNote", () => {
  it("stesso giorno (ora italiana): niente", () => {
    expect(clockOutDayNote("2026-11-20T08:11:15Z", "2026-11-20T17:00:00Z")).toBeNull();
  });
  it("uscita il giorno dopo: la data dell'uscita", () => {
    expect(clockOutDayNote("2026-11-20T08:11:15Z", "2026-11-21T17:00:00Z")).toBe("21/11");
  });
  it("il giorno si legge in ora italiana, non UTC", () => {
    // 23:30 UTC del 20 è già il 21 a Roma; l'entrata è il 21 anche lei.
    expect(clockOutDayNote("2026-11-20T23:30:00Z", "2026-11-21T08:00:00Z")).toBeNull();
  });
});

describe("withDay", () => {
  // Orari locali senza offset: la CI gira in UTC (memoria tests-timezone-ci).
  const at = (d: string, t: string) => new Date(`${d}T${t}:00`);

  it("cambia il giorno e tiene l'ora", () => {
    // Il caso di Andrea: uscita del 21 alle 18, riportata al 20.
    expect(withDay(at("2026-11-21", "18:00"), at("2026-11-20", "07:30"))).toEqual(
      at("2026-11-20", "18:00")
    );
  });

  it("anche a cavallo di un mese", () => {
    expect(withDay(at("2026-10-31", "23:15"), at("2026-11-01", "00:00"))).toEqual(
      at("2026-11-01", "23:15")
    );
  });
});

describe("clockRangeError", () => {
  const at = (d: string, t: string) => new Date(`${d}T${t}:00`);

  it("uscita dopo l'entrata, sotto le 24 ore: va bene", () => {
    expect(clockRangeError(at("2026-11-20", "22:00"), at("2026-11-21", "02:00"))).toBeNull();
  });
  it("uscita prima dell'entrata", () => {
    expect(clockRangeError(at("2026-11-20", "09:00"), at("2026-11-20", "08:00"))).toBe(
      "L’uscita deve essere dopo l’entrata."
    );
  });
  it("24 ore o più: si controllano i giorni", () => {
    expect(clockRangeError(at("2026-11-20", "09:11"), at("2026-11-21", "18:00"))).toBe(
      "Più di 24 ore: controlla i giorni."
    );
  });
});
