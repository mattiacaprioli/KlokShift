import { describe, expect, it } from "vitest";

import {
  canRecordShift,
  endedDates,
  isRecordedShift,
  planEndedExtra,
} from "@/features/shifts/recorded";

describe("turno già fatto", () => {
  // Istanti in ora locale senza offset: la CI gira in UTC.
  const now = new Date("2026-10-26T18:00:00");

  it("si registra solo un turno già finito", () => {
    expect(
      canRecordShift({ date: "2026-10-23", start_time: "18:00", end_time: "23:00" }, now)
    ).toBe(true);
    expect(
      canRecordShift({ date: "2026-10-26", start_time: "12:00", end_time: "15:00" }, now)
    ).toBe(true);
    // Oggi, ancora in corso: si pianifica.
    expect(
      canRecordShift({ date: "2026-10-26", start_time: "16:00", end_time: "23:00" }, now)
    ).toBe(false);
  });

  it("un notturno di ieri che finisce dopo adesso non è ancora finito", () => {
    expect(
      canRecordShift({ date: "2026-10-26", start_time: "22:00", end_time: "02:00" }, now)
    ).toBe(false);
    expect(
      canRecordShift({ date: "2026-10-25", start_time: "22:00", end_time: "02:00" }, now)
    ).toBe(true);
  });

  it("si riconosce dal momento della registrazione", () => {
    expect(isRecordedShift({ recorded_at: "2026-10-26T17:00:00Z" })).toBe(true);
    expect(isRecordedShift({ recorded_at: null })).toBe(false);
    expect(isRecordedShift({})).toBe(false);
  });

  it("nel form del nuovo turno trova i giorni in cui l'orario è già passato", () => {
    expect(
      endedDates(["2026-10-26", "2026-10-27"], "12:00", "15:00", now)
    ).toEqual(["2026-10-26"]);
    expect(endedDates(["2026-10-26"], "19:00", "23:00", now)).toEqual([]);
    expect(planEndedExtra("lun 26")).toBe(
      "lun 26: a quest'ora è già passato. Toglilo dai giorni da ripetere."
    );
  });
});
