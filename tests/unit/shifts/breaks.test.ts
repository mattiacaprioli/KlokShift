import { describe, expect, it } from "vitest";

import {
  shiftBreakError,
  suggestedBreakMinutes,
} from "@/features/shifts/breaks";

describe("suggestedBreakMinutes", () => {
  const rule = { break_rule_after_minutes: 360, break_rule_minutes: 30 };

  it("propone la pausa solo oltre la soglia", () => {
    expect(suggestedBreakMinutes(rule, "10:00", "16:00")).toBe(0);
    expect(suggestedBreakMinutes(rule, "10:00", "16:01")).toBe(30);
    expect(suggestedBreakMinutes(rule, "20:00", "03:00")).toBe(30);
  });

  it("senza regola nessuna proposta", () => {
    expect(
      suggestedBreakMinutes(
        { break_rule_after_minutes: null, break_rule_minutes: null },
        "08:00",
        "20:00"
      )
    ).toBe(0);
    expect(suggestedBreakMinutes(null, "08:00", "20:00")).toBe(0);
  });
});

describe("shiftBreakError", () => {
  it("accetta zero e le pause più corte del turno", () => {
    expect(shiftBreakError("18:00", "00:00", 0)).toBeNull();
    expect(shiftBreakError("18:00", "00:00", 30)).toBeNull();
  });

  it("rifiuta la pausa che copre il turno o fuori misura", () => {
    expect(shiftBreakError("18:00", "19:00", 60)).toBe(
      "La pausa deve essere più corta del turno."
    );
    expect(shiftBreakError("08:00", "20:00", 300)).toBe(
      "La pausa va da 0 a 240 minuti."
    );
    expect(shiftBreakError("08:00", "20:00", -5)).toBe(
      "La pausa va da 0 a 240 minuti."
    );
  });
});
