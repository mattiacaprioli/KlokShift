import { describe, expect, it } from "vitest";
import type { AgendaItem } from "../../../src/features/assignments/agenda";
import {
  blocksPlannedClockIn,
  blocksUnplannedClock,
  canStartUnplannedClock,
  clockInOpensLabel,
  clockInPhase,
  hasOpenPlannedClock,
  homeClockState,
  isClockWindowOpen,
  punchConfirmMessage,
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
        break_clocked: true,
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

describe("clockInPhase", () => {
  // Istanti in ora locale senza offset: la CI gira in UTC.
  const at = (local: string) => new Date(local);
  const shift = item().shift; // 24/09 18:00–23:00

  it("si apre un'ora prima dell'inizio e si chiude alla fine", () => {
    expect(clockInPhase(shift, at("2026-09-24T08:00:00"))).toBe("early");
    expect(clockInPhase(shift, at("2026-09-24T16:59:00"))).toBe("early");
    expect(clockInPhase(shift, at("2026-09-24T17:00:00"))).toBe("open");
    expect(clockInPhase(shift, at("2026-09-24T22:59:00"))).toBe("open");
    expect(clockInPhase(shift, at("2026-09-24T23:00:00"))).toBe("over");
    expect(clockInOpensLabel(shift)).toBe("17:00");
  });

  it("segue il notturno oltre la mezzanotte", () => {
    const night = { date: "2026-09-24", start_time: "22:00:00", end_time: "04:00:00" };
    expect(clockInPhase(night, at("2026-09-24T20:30:00"))).toBe("early");
    expect(clockInPhase(night, at("2026-09-25T02:00:00"))).toBe("open");
    expect(clockInPhase(night, at("2026-09-25T04:00:00"))).toBe("over");
  });
});

describe("homeClockState", () => {
  const at = (time: string, date = "2026-09-24") => new Date(`${date}T${time}:00`);

  it("propone l'entrata solo per il metodo app, da un'ora prima alla fine", () => {
    expect(homeClockState(item({ venueMethod: "app" }), at("17:30"))).toBe("in");
    expect(homeClockState(item({ venueMethod: "manual" }), at("17:30"))).toBe(null);
    // La mattina del turno serale: troppo presto, resta il prossimo turno.
    expect(homeClockState(item({ venueMethod: "app" }), at("08:00"))).toBe(null);
    // Turno finito senza entrata: gli orari li inserisce la sede.
    expect(homeClockState(item({ venueMethod: "app" }), at("23:30"))).toBe(null);
    expect(
      homeClockState(item({ date: "2026-09-25", venueMethod: "app" }), at("17:30"))
    ).toBe(null);
  });

  it("rispetta l'override personale rispetto alla sede", () => {
    expect(
      homeClockState(item({ memberMethod: "app", venueMethod: "manual" }), at("17:30"))
    ).toBe("in");
    expect(
      homeClockState(item({ memberMethod: "manual", venueMethod: "app" }), at("17:30"))
    ).toBe(null);
  });

  it("mostra l'uscita aperta, anche oltre la fine, e sparisce dopo la timbratura completa", () => {
    const inAt = "2026-09-24T16:00:00.000Z";
    expect(homeClockState(item({ inAt }), at("19:00"))).toBe("out");
    expect(homeClockState(item({ inAt }), at("09:00", "2026-09-25"))).toBe("out");
    expect(
      homeClockState(item({ inAt, outAt: "2026-09-24T21:00:00.000Z" }), at("19:00"))
    ).toBe(null);
  });

  it("non mostra turni rifiutati o annullati", () => {
    expect(
      homeClockState(item({ assignmentStatus: "declined", venueMethod: "app" }), at("17:30"))
    ).toBe(null);
    expect(
      homeClockState(item({ shiftStatus: "cancelled", venueMethod: "app" }), at("17:30"))
    ).toBe(null);
  });
});

describe("punchConfirmMessage", () => {
  const shift = item().shift; // 24/09 18:00–23:00
  const at = (time: string) => new Date(`2026-09-24T${time}:00`);

  it("dice l'ora che si registra", () => {
    expect(punchConfirmMessage("in", shift, at("17:50"))).toBe(
      "Registriamo l'ora di adesso: 17:50."
    );
    expect(punchConfirmMessage("out", shift, at("22:50"))).toBe(
      "Registriamo l'ora di adesso: 22:50."
    );
    expect(punchConfirmMessage("break", null, at("20:00"))).toBe(
      "Registriamo l'ora di adesso: 20:00."
    );
  });

  it("avvisa quando l'entrata è lontana dall'inizio", () => {
    expect(punchConfirmMessage("in", shift, at("17:20"))).toBe(
      "Il turno inizia alle 18:00: le ore partono da adesso (17:20)."
    );
  });

  it("avvisa quando l'uscita è lontana dalla fine", () => {
    expect(punchConfirmMessage("out", shift, at("21:00"))).toBe(
      "Il turno finisce alle 23:00: le ore si fermano adesso (21:00)."
    );
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
      ? { recordId: "record", clockInAt, roleId: null, note: null, breakClocked: true }
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
  // Istanti costruiti in ora locale: la CI gira in UTC.
  const iso = (local: string) => new Date(local).toISOString();
  const clocked = (inAt: string, outAt?: string) =>
    ({ ...item({ inAt: iso(inAt), outAt: outAt && iso(outAt) }), venue_member_id: "other" }) as AgendaItem;

  it("non la propone in servizio su un turno, nemmeno di un'altra sede (clock_already_open)", () => {
    const open = clocked("2026-09-24T18:30:00");
    expect(hasOpenPlannedClock([open], at)).toBe(true);
    expect(canStartUnplannedClock([open], "vm", at)).toBe(false);
  });

  it("la ripropone dopo l'uscita, e ignora un'entrata aperta da più di 24 ore", () => {
    const closed = clocked("2026-09-24T12:00:00", "2026-09-24T16:00:00");
    const forgotten = clocked("2026-09-23T18:00:00");
    expect(hasOpenPlannedClock([closed, forgotten], at)).toBe(false);
    expect(canStartUnplannedClock([closed, forgotten], "vm", at)).toBe(true);
  });
});
