import { describe, expect, it } from "vitest";

import type { AssignmentStatus } from "@/features/assignments/status";
import {
  hoursAreClocked,
  presenceToVerify,
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

describe("presenceToVerify", () => {
  const withStatus = (status: AssignmentStatus, withClock = false) => ({
    status,
    clock: withClock ? clock : null,
  });

  it("doveva timbrare e non l'ha fatto: da verificare, non «Presente»", () => {
    expect(presenceToVerify(withStatus("confirmed"), true)).toBe(true);
    expect(presenceToVerify(withStatus("assigned"), true)).toBe(true);
  });

  it("con una timbratura la presenza è un fatto", () => {
    expect(presenceToVerify(withStatus("confirmed", true), true)).toBe(false);
  });

  it("senza timbratura richiesta vale il «Presente» di sempre", () => {
    expect(presenceToVerify(withStatus("confirmed"), false)).toBe(false);
  });

  it("chi è già segnato assente o ha rifiutato non è da verificare", () => {
    expect(presenceToVerify(withStatus("no_show"), true)).toBe(false);
    expect(presenceToVerify(withStatus("declined"), true)).toBe(false);
  });
});
