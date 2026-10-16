import { describe, expect, it } from "vitest";
import {
  computeCoverage,
  shiftCounts,
  shiftTone,
  type CountableShift,
} from "@/features/assignments/coverage";

const req = (role_id: string, count: number) => ({ role_id, role: role_id, count });

describe("copertura per ruolo", () => {
  it("conta solo gli assegnati attivi nel ruolo dell'assegnazione", () => {
    const coverage = computeCoverage(
      [req("sala", 2), req("bar", 1)],
      [
        { status: "confirmed", role_id: "sala" },
        { status: "declined", role_id: "sala" },
        { status: "no_show", role_id: "bar" },
        { status: "assigned", role_id: "bar" },
      ]
    );
    expect(coverage.rows).toEqual([
      { role: "sala", required: 2, covered: 1 },
      { role: "bar", required: 1, covered: 1 },
    ]);
    expect(coverage).toMatchObject({ required: 3, covered: 2, missing: 1 });
  });

  it("l'eccedenza su un ruolo non copre gli altri", () => {
    const coverage = computeCoverage(
      [req("sala", 1), req("bar", 1)],
      [
        { status: "confirmed", role_id: "sala" },
        { status: "confirmed", role_id: "sala" },
      ]
    );
    expect(coverage).toMatchObject({ required: 2, covered: 1, missing: 1 });
  });
});

const shift = (over: Partial<CountableShift> = {}): CountableShift => ({
  positions_filled: 0,
  positions_total: 0,
  shift_role_requirements: [],
  shift_assignments: [],
  ...over,
});

describe("numeri e colore di un turno", () => {
  it("con il fabbisogno per ruolo valgono i ruoli, non i posti", () => {
    const s = shift({
      positions_filled: 3,
      positions_total: 3,
      shift_role_requirements: [{ role_id: "sala", count: 2, role: { name: "Sala" } }],
      shift_assignments: [{ status: "confirmed", role_id: "sala" }],
    });
    expect(shiftCounts(s)).toEqual({ filled: 1, total: 2, short: true });
  });

  it("senza fabbisogno valgono i posti tenuti dai trigger", () => {
    expect(shiftCounts(shift({ positions_filled: 2, positions_total: 2 }))).toEqual({
      filled: 2,
      total: 2,
      short: false,
    });
  });

  it("annullato o chiuso è spento anche se scoperto", () => {
    const short = shift({ positions_filled: 0, positions_total: 2 });
    expect(shiftTone({ ...short, status: "open" })).toBe("short");
    expect(shiftTone({ ...short, status: "cancelled" })).toBe("off");
    expect(shiftTone({ ...short, status: "closed" })).toBe("off");
    expect(shiftTone({ ...shift({ positions_filled: 2, positions_total: 2 }), status: "open" })).toBe("covered");
  });
});
