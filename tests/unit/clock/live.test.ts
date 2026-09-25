import { describe, expect, it } from "vitest";

import type { ClockRecordWithCorrections } from "@/features/clock/hours";
import {
  CLOCK_IN_GRACE_MIN,
  liveClockLabel,
  liveClockStatus,
  liveClockStatusIn,
  liveClockSummary,
} from "@/features/clock/live";

// Il pomeriggio del 24/09, 14:00-22:00 nell'ora locale del test.
const SHIFT = {
  venue_id: "venue-1",
  date: "2026-09-24",
  start_time: "14:00:00",
  end_time: "22:00:00",
};
const at = (hhmm: string) => new Date(`2026-09-24T${hhmm}:00`);

function punch(
  inAt: string,
  outAt: string | null = null,
  corrections: Partial<ClockRecordWithCorrections["corrections"][number]>[] = []
): ClockRecordWithCorrections {
  return {
    clock_in_at: inAt,
    clock_out_at: outAt,
    corrections,
  } as unknown as ClockRecordWithCorrections;
}

const confirmed = (clock: ClockRecordWithCorrections | null = null) => ({
  status: "confirmed" as const,
  clock,
});

describe("liveClockStatus", () => {
  it("chi è sul metodo manuale non viene segnalato", () => {
    expect(liveClockStatus(SHIFT, confirmed(), "manual", at("15:00"))).toBeNull();
  });

  it("chi ha rifiutato non lavora", () => {
    expect(
      liveClockStatus(SHIFT, { status: "declined", clock: null }, "app", at("15:00"))
    ).toBeNull();
  });

  it("prima dell'inizio e nella tolleranza è in arrivo", () => {
    const upcoming = { kind: "upcoming", startTime: "14:00:00" };
    expect(liveClockStatus(SHIFT, confirmed(), "app", at("12:00"))).toEqual(upcoming);
    expect(
      liveClockStatus(SHIFT, confirmed(), "app", at(`14:${CLOCK_IN_GRACE_MIN - 1}`))
    ).toEqual(upcoming);
  });

  it("oltre la tolleranza senza entrata è in ritardo", () => {
    expect(
      liveClockStatus(SHIFT, confirmed(), "app", at(`14:${CLOCK_IN_GRACE_MIN}`))
    ).toEqual({ kind: "late" });
  });

  it("con l'entrata è in servizio, anche arrivato in ritardo", () => {
    expect(
      liveClockStatus(
        SHIFT,
        confirmed(punch("2026-09-24T12:30:00Z")),
        "app",
        at("15:00")
      )
    ).toEqual({ kind: "in", since: "2026-09-24T12:30:00Z" });
  });

  it("vale l'orario corretto, non quello originale", () => {
    const clock = punch("2026-09-24T12:30:00Z", null, [
      {
        id: "c1",
        created_at: "2026-09-24T13:00:00Z",
        corrected_in_at: "2026-09-24T12:00:00Z",
        corrected_out_at: null,
      },
    ]);
    expect(liveClockStatus(SHIFT, confirmed(clock), "app", at("15:00"))).toEqual({
      kind: "in",
      since: "2026-09-24T12:00:00Z",
    });
  });

  it("con l'uscita è uscito", () => {
    expect(
      liveClockStatus(
        SHIFT,
        confirmed(punch("2026-09-24T12:00:00Z", "2026-09-24T20:04:00Z")),
        "app",
        at("22:30")
      )
    ).toEqual({ kind: "out", at: "2026-09-24T20:04:00Z" });
  });
});

describe("liveClockStatusIn", () => {
  const venues = [{ id: "venue-1", clock_method: "app" as const }];

  it("l'impostazione della scheda prevale su quella della sede", () => {
    expect(
      liveClockStatusIn(
        venues,
        SHIFT,
        { ...confirmed(), staff_member: { clock_method: "manual" } },
        at("15:00")
      )
    ).toBeNull();
  });

  it("senza impostazione sulla scheda vale la sede", () => {
    expect(
      liveClockStatusIn(
        venues,
        SHIFT,
        { ...confirmed(), staff_member: { clock_method: null } },
        at("15:00")
      )
    ).toEqual({ kind: "late" });
  });

  it("una sede che non si conosce non dice niente", () => {
    expect(
      liveClockStatusIn(
        [],
        SHIFT,
        { ...confirmed(), staff_member: null },
        at("15:00")
      )
    ).toBeNull();
  });
});

describe("liveClockLabel e liveClockSummary", () => {
  it("frasi e toni", () => {
    expect(liveClockLabel({ kind: "upcoming", startTime: "14:00:00" })).toEqual({
      label: "Attacca alle 14:00",
      tone: "muted",
    });
    expect(liveClockLabel({ kind: "late" }).tone).toBe("warning");
  });

  it("riassume in servizio e in ritardo, senza gli zeri", () => {
    expect(
      liveClockSummary([
        { kind: "in", since: "x" },
        { kind: "in", since: "y" },
        { kind: "late" },
        { kind: "out", at: "z" },
        null,
      ])
    ).toBe("2 in servizio · 1 in ritardo");
    expect(liveClockSummary([{ kind: "late" }])).toBe("1 in ritardo");
    expect(liveClockSummary([null, { kind: "upcoming", startTime: "14:00" }])).toBeNull();
  });
});
