import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../../../src/features/assignments/agenda";
import {
  blocksPlannedClockIn,
  blocksUnplannedClock,
  canStartUnplannedClock,
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
        note: null,
        role_id: null,
        shift_id: "shift",
        venue_id: "venue",
        venue_member_id: "venue-member",
        void_reason: null,
        voided_at: null,
        voided_by: null,
        corrections: [],
        breaks: [],
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

describe("blocksUnplannedClock", () => {
  // Istanti in ora locale senza offset: la CI gira in UTC.
  const at = (time: string) => new Date(`2026-09-24T${time}:00`);

  it("blocca dall'ora prima dell'inizio fino alla fine del turno", () => {
    expect(blocksUnplannedClock(item(), at("16:59"))).toBe(false);
    expect(blocksUnplannedClock(item(), at("17:00"))).toBe(true);
    expect(blocksUnplannedClock(item(), at("22:59"))).toBe(true);
    expect(blocksUnplannedClock(item(), at("23:00"))).toBe(false);
  });

  it("non blocca un turno annullato, rifiutato o già timbrato", () => {
    expect(
      blocksUnplannedClock(item({ shiftStatus: "cancelled" }), at("19:00"))
    ).toBe(false);
    expect(
      blocksUnplannedClock(item({ assignmentStatus: "declined" }), at("19:00"))
    ).toBe(false);
    expect(
      blocksUnplannedClock(
        item({ inAt: "2026-09-24T16:00:00Z", outAt: "2026-09-24T17:00:00Z" }),
        at("19:00")
      )
    ).toBe(false);
  });
});

describe("blocksPlannedClockIn", () => {
  const now = new Date("2026-09-24T18:00:00Z");
  const entry = (clockInAt: string | null) => ({
    open: clockInAt
      ? { recordId: "record", clockInAt, roleId: null, note: null }
      : null,
  });

  it("blocca l'entrata pianificata con un fuori turno aperto, in qualunque sede", () => {
    expect(
      blocksPlannedClockIn([entry(null), entry("2026-09-24T14:00:00Z")], now)
    ).toBe(true);
  });

  it("non blocca senza entrate aperte", () => {
    expect(blocksPlannedClockIn([], now)).toBe(false);
    expect(blocksPlannedClockIn([entry(null)], now)).toBe(false);
  });

  it("come la RPC, un'entrata aperta da 24 ore o più non blocca più", () => {
    expect(blocksPlannedClockIn([entry("2026-09-23T18:00:01Z")], now)).toBe(
      true
    );
    expect(blocksPlannedClockIn([entry("2026-09-23T18:00:00Z")], now)).toBe(
      false
    );
  });
});

describe("canStartUnplannedClock (C14)", () => {
  const at = new Date("2026-09-24T19:00:00");
  const onCard = (venueMemberId: string) =>
    ({ ...item(), venue_member_id: venueMemberId }) as AgendaItem;

  it("non propone l'entrata finché i turni assegnati non sono arrivati", () => {
    expect(canStartUnplannedClock(undefined, "vm", at)).toBe(false);
  });

  it("la propone senza turni da timbrare, anche se un'altra scheda ne ha uno", () => {
    expect(canStartUnplannedClock([], "vm", at)).toBe(true);
    expect(canStartUnplannedClock([onCard("other")], "vm", at)).toBe(true);
  });

  it("non la propone con un turno pianificato in corso sulla stessa scheda", () => {
    expect(canStartUnplannedClock([onCard("vm")], "vm", at)).toBe(false);
  });
});
