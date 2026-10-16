import { describe, expect, it } from "vitest";
import { monthKey, monthLabel, startOfWeek } from "../../../web/src/lib/week";
import { toDateString } from "@/lib/format";

describe("settimana e mese della dashboard", () => {
  it("startOfWeek dà il lunedì a mezzanotte locale, domenica compresa", () => {
    for (const [day, monday] of [
      ["2026-09-21T15:00:00", "2026-09-21"],
      ["2026-09-27T23:59:00", "2026-09-21"],
      ["2026-11-01T10:00:00", "2026-10-26"],
    ] as const) {
      const out = startOfWeek(new Date(day));
      expect(toDateString(out)).toBe(monday);
      expect(out.getHours()).toBe(0);
    }
  });

  it("le chiavi del mese sono quelle condivise con l'app", () => {
    expect(monthKey(new Date("2026-10-01T00:30:00"))).toBe("2026-10");
    expect(monthLabel("2026-09")).toBe("settembre 2026");
  });
});
