import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../../../src/features/assignments/agenda";
import {
  homeClockState,
  isClockWindowOpen,
} from "../../../src/features/clock/availability";

function item(
  options: {
    date?: string;
    assignmentStatus?: AgendaItem["status"];
    shiftStatus?: AgendaItem["shift"]["status"];
    memberMethod?: AgendaItem["clock_method"];
    venueMethod?: NonNullable<AgendaItem["shift"]["venue"]>["clock_method"];
    inAt?: string;
    outAt?: string;
  } = {}
): AgendaItem {
  const clock = options.inAt
    ? ({
        id: "clock",
        assignment_id: "assignment",
        clock_in_at: options.inAt,
        clock_out_at: options.outAt ?? null,
        created_at: options.inAt,
        method: "app",
        shift_id: "shift",
        venue_id: "venue",
        venue_member_id: "venue-member",
        void_reason: null,
        voided_at: null,
        voided_by: null,
        corrections: [],
      } as AgendaItem["clock"])
    : null;

  return {
    id: "assignment",
    status: options.assignmentStatus ?? "confirmed",
    clock_method: options.memberMethod ?? null,
    clock,
    shift: {
      id: "shift",
      title: "Cena",
      date: options.date ?? "2026-09-24",
      start_time: "18:00:00",
      end_time: "23:00:00",
      status: options.shiftStatus ?? "published",
      venue: {
        clock_method: options.venueMethod ?? "manual",
      },
    },
  } as AgendaItem;
}

describe("isClockWindowOpen", () => {
  it("copre il giorno del turno e il giorno successivo", () => {
    const shift = item().shift;
    expect(isClockWindowOpen(shift, "2026-09-24")).toBe(true);
    expect(isClockWindowOpen(shift, "2026-09-25")).toBe(true);
    expect(isClockWindowOpen(shift, "2026-09-26")).toBe(false);
  });
});

describe("homeClockState", () => {
  it("propone l'entrata solo per il metodo app e dal giorno del turno", () => {
    expect(homeClockState(item({ venueMethod: "app" }), "2026-09-24")).toBe(
      "in"
    );
    expect(homeClockState(item({ venueMethod: "manual" }), "2026-09-24")).toBe(
      null
    );
    expect(
      homeClockState(
        item({ date: "2026-09-25", venueMethod: "app" }),
        "2026-09-24"
      )
    ).toBe(null);
  });

  it("rispetta l'override personale rispetto alla sede", () => {
    expect(
      homeClockState(
        item({ memberMethod: "app", venueMethod: "manual" }),
        "2026-09-24"
      )
    ).toBe("in");
    expect(
      homeClockState(
        item({ memberMethod: "manual", venueMethod: "app" }),
        "2026-09-24"
      )
    ).toBe(null);
  });

  it("mostra l'uscita aperta e sparisce dopo la timbratura completa", () => {
    const inAt = "2026-09-24T16:00:00.000Z";
    expect(homeClockState(item({ inAt }), "2026-09-24")).toBe("out");
    expect(
      homeClockState(
        item({ inAt, outAt: "2026-09-24T21:00:00.000Z" }),
        "2026-09-24"
      )
    ).toBe(null);
  });

  it("non mostra turni rifiutati o annullati", () => {
    expect(
      homeClockState(
        item({ assignmentStatus: "declined", venueMethod: "app" }),
        "2026-09-24"
      )
    ).toBe(null);
    expect(
      homeClockState(
        item({ shiftStatus: "cancelled", venueMethod: "app" }),
        "2026-09-24"
      )
    ).toBe(null);
  });
});
