import { describe, expect, it } from "vitest";

import {
  clockedHours,
  effectiveClockTimes,
  type ClockRecordWithCorrections,
} from "@/features/clock/hours";

describe("clockedHours", () => {
  it("arrotonda la proposta al quarto d’ora", () => {
    expect(
      clockedHours("2026-09-24T16:04:00Z", "2026-09-24T21:40:00Z")
    ).toBe(5.5);
  });

  it("attraversa la mezzanotte usando gli istanti", () => {
    expect(
      clockedHours("2026-09-24T20:00:00Z", "2026-09-25T02:00:00Z")
    ).toBe(6);
  });
});

describe("effectiveClockTimes", () => {
  it("usa per ogni campo la correzione più recente senza perdere l’originale", () => {
    const record = {
      clock_in_at: "2026-09-24T16:04:00Z",
      clock_out_at: "2026-09-24T23:00:00Z",
      corrections: [
        {
          id: "a",
          created_at: "2026-09-24T23:10:00Z",
          corrected_in_at: "2026-09-24T16:00:00Z",
          corrected_out_at: null,
        },
        {
          id: "b",
          created_at: "2026-09-24T23:20:00Z",
          corrected_in_at: null,
          corrected_out_at: "2026-09-24T22:30:00Z",
        },
      ],
    } as ClockRecordWithCorrections;

    expect(effectiveClockTimes(record)).toEqual({
      inAt: "2026-09-24T16:00:00Z",
      outAt: "2026-09-24T22:30:00Z",
    });
    expect(record.clock_out_at).toBe("2026-09-24T23:00:00Z");
  });
});
