import { describe, expect, it } from "vitest";
import { unplannedOutAt } from "@/features/clock/unplanned";

// Istanti in ora locale senza offset: la CI gira in UTC (vedi tests-timezone-ci).
const at = (h: number, m: number, day = 10) => new Date(2026, 9, day, h, m);

describe("uscita di una timbratura senza turno", () => {
  it("resta nello stesso giorno quando viene dopo l'entrata", () => {
    const out = unplannedOutAt(at(9, 12).toISOString(), at(17, 30, 1));
    expect(out.getTime()).toBe(at(17, 30).getTime());
  });

  it("passa al giorno dopo quando l'ora scelta è prima dell'entrata", () => {
    const out = unplannedOutAt(at(22, 0).toISOString(), at(2, 15, 1));
    expect(out.getTime()).toBe(at(2, 15, 11).getTime());
  });

  it("la stessa ora dell'entrata vale ventiquattro ore dopo, mai zero", () => {
    const out = unplannedOutAt(at(9, 0).toISOString(), at(9, 0, 1));
    expect(out.getTime()).toBe(at(9, 0, 11).getTime());
  });
});
