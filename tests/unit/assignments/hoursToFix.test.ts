import { describe, expect, it } from "vitest";

import {
  hourToFixLabel,
  hourToFixWhen,
  hoursToFixSummary,
} from "@/features/assignments/hoursToFix";

describe("ore da sistemare", () => {
  it("dice il perché, con le ore proposte solo da approvare", () => {
    expect(hourToFixLabel({ kind: "not_clocked", hours: 5 })).toBe("Non ha timbrato");
    expect(hourToFixLabel({ kind: "missing_out", hours: 5 })).toBe("Uscita mancante");
    expect(hourToFixLabel({ kind: "to_approve", hours: 8 })).toMatch(/^Da approvare · 8/);
  });

  it("dice quando, con il notturno che finisce il giorno dopo", () => {
    expect(
      hourToFixWhen({ date: "2026-10-23", start_time: "18:00:00", end_time: "23:00:00" })
    ).toContain("18:00–23:00");
    expect(
      hourToFixWhen({ date: "2026-10-23", start_time: "22:00:00", end_time: "02:00:00" })
    ).toContain("+1");
  });

  it("riassume quanti turni e quante ore non contano ancora", () => {
    expect(hoursToFixSummary([{ hours: 5 }])).toMatch(/^1 turno · 5/);
    expect(hoursToFixSummary([{ hours: 5 }, { hours: 3.5 }])).toMatch(/^2 turni · 8,5/);
  });
});
