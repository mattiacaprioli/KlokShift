import { describe, expect, it } from "vitest";

import {
  hoursAreClocked,
  type ClockRecordWithCorrections,
} from "@/features/clock/hours";

const clock = { id: "record-1" } as ClockRecordWithCorrections;
const row = (
  hours_source: string | null,
  worked_hours: number | null = null,
  withClock = false
) => ({ hours_source, worked_hours, clock: withClock ? clock : null });

describe("hoursAreClocked", () => {
  it("con una timbratura le ore passano sempre da lei", () => {
    expect(hoursAreClocked(row(null, null, true), "manual")).toBe(true);
  });

  it("la fonte congelata sulla riga vince sul metodo attuale", () => {
    expect(hoursAreClocked(row("manual", 8), "app")).toBe(false);
    expect(hoursAreClocked(row("manual_auto"), "app")).toBe(false);
    expect(hoursAreClocked(row("clock_expected"), "manual")).toBe(true);
    expect(hoursAreClocked(row("clock", 8), "manual")).toBe(true);
  });

  it("ore scritte senza fonte vengono da un metodo con timbratura (B02)", () => {
    expect(hoursAreClocked(row(null, 8.5), "manual")).toBe(true);
  });

  it("riga non ancora toccata: vale il metodo attuale", () => {
    expect(hoursAreClocked(row(null), "app")).toBe(true);
    expect(hoursAreClocked(row(null), "qr")).toBe(true);
    expect(hoursAreClocked(row(null), "manual")).toBe(false);
  });
});
