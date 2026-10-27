import { describe, expect, it } from "vitest";

import {
  classifyDuplicate,
  duplicateDateMap,
  duplicateSkippedPastText,
  weekDateMap,
  weekRangeLabel,
  type DuplicateSource,
} from "@/features/shifts/duplicate";

const shift = (
  id: string,
  date: string,
  extra: Partial<DuplicateSource> = {}
): DuplicateSource => ({
  id,
  title: id,
  date,
  start_time: "18:00:00",
  end_time: "23:00:00",
  status: "open",
  ...extra,
});

describe("duplica settimana", () => {
  // Istanti in ora locale senza offset: la CI gira in UTC.
  const now = new Date("2026-10-27T12:00:00");

  it("sposta tutto di sette giorni per settimana", () => {
    expect(weekDateMap([shift("a", "2026-10-26"), shift("b", "2026-10-26")], 2)).toEqual({
      "2026-10-26": "2026-11-09",
    });
  });

  it("una data senza posto resta fuori dalla mappa", () => {
    expect(
      duplicateDateMap([shift("a", "2026-10-30")], () => null)
    ).toEqual({});
  });

  it("copia i turni validi e dice cosa resta fuori", () => {
    const shifts = [
      shift("sera", "2026-10-28", {
        shift_assignments: [{ status: "confirmed" }, { status: "declined" }],
      }),
      shift("pranzo", "2026-10-28", { start_time: "12:00:00", end_time: "15:00:00" }),
      shift("annullato", "2026-10-29", { status: "cancelled" }),
      shift("fuori", "2026-10-29", { unplanned: true }),
      shift("senza posto", "2026-10-31"),
    ];
    const map = { "2026-10-28": "2026-11-04", "2026-10-29": "2026-11-05" };
    const out = classifyDuplicate(shifts, map, now);
    expect(out.copyable.map((s) => s.id)).toEqual(["pranzo", "sera"]);
    expect(out.skippedCancelled).toBe(1);
    expect(out.skippedUnplanned).toBe(1);
    expect(out.skippedNoSlot).toBe(1);
    expect(out.notifications).toBe(1);
  });

  it("il passato non si pianifica: chi cadrebbe in un giorno finito resta fuori", () => {
    const out = classifyDuplicate(
      [shift("ieri", "2026-10-19"), shift("oggi a pranzo", "2026-10-20", { start_time: "09:00:00", end_time: "11:00:00" })],
      { "2026-10-19": "2026-10-26", "2026-10-20": "2026-10-27" },
      now
    );
    expect(out.copyable).toEqual([]);
    expect(out.skippedPast).toBe(2);
    expect(duplicateSkippedPastText(2)).toMatch(/^2 turni restano fuori: cadrebbero/);
  });

  it("dice la settimana dal lunedì alla domenica", () => {
    expect(weekRangeLabel("2026-10-26")).toBe("26 ott – 1 nov");
  });
});
