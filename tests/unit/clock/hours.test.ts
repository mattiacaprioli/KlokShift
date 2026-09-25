import { describe, expect, it } from "vitest";

import {
  assignmentActual,
  clockedHours,
  effectiveClockTimes,
  isRegularPendingClock,
  shiftDeviations,
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

// Il pomeriggio del 24/09, 14:00-22:00 a Roma (UTC+2).
const AFTERNOON = {
  date: "2026-09-24",
  start_time: "14:00:00",
  end_time: "22:00:00",
};
const DURING = new Date("2026-09-24T18:00:00Z");
const AFTER = new Date("2026-09-25T08:00:00Z");

function punch(outAt: string | null): ClockRecordWithCorrections {
  return {
    clock_in_at: "2026-09-24T12:00:00Z",
    clock_out_at: outAt,
    corrections: [],
  } as unknown as ClockRecordWithCorrections;
}

describe("assignmentActual", () => {
  it("le ore scritte sono definitive, anche con una timbratura diversa", () => {
    expect(
      assignmentActual(
        AFTERNOON,
        {
          status: "confirmed",
          worked_hours: 7,
          clock: punch("2026-09-24T22:00:00Z"),
        },
        AFTER
      )
    ).toEqual({ kind: "approved", hours: 7 });
  });

  it("una timbratura completa è solo una proposta", () => {
    expect(
      assignmentActual(
        AFTERNOON,
        {
          status: "assigned",
          worked_hours: null,
          clock: punch("2026-09-24T21:00:00Z"),
        },
        AFTER
      )
    ).toEqual({ kind: "proposed", hours: 9 });
  });

  it("l'uscita manca solo a turno finito", () => {
    const assignment = {
      status: "confirmed" as const,
      worked_hours: null,
      clock: punch(null),
    };
    expect(assignmentActual(AFTERNOON, assignment, DURING)).toBeNull();
    expect(assignmentActual(AFTERNOON, assignment, AFTER)).toEqual({
      kind: "missing_out",
    });
  });

  it("chi non viene non ha consuntivo", () => {
    expect(
      assignmentActual(
        AFTERNOON,
        { status: "declined", worked_hours: 8, clock: null },
        AFTER
      )
    ).toBeNull();
  });
});

describe("shiftDeviations", () => {
  const person = (
    name: string,
    fields: {
      worked_hours?: number | null;
      clock?: ClockRecordWithCorrections | null;
    }
  ) => ({
    status: "confirmed" as const,
    worked_hours: fields.worked_hours ?? null,
    clock: fields.clock ?? null,
    staff_member: { display_name: name },
  });

  it("nomina solo chi si discosta, per persona", () => {
    expect(
      shiftDeviations(
        {
          ...AFTERNOON,
          shift_assignments: [
            person("Marco", { clock: punch("2026-09-24T20:00:00Z") }),
            person("Andrea", { clock: punch("2026-09-24T21:00:00Z") }),
          ],
        },
        AFTER
      )
    ).toEqual({
      measured: 2,
      deviations: [{ name: "Andrea", delta: 1, proposed: true }],
    });
  });

  it("un'ora in più e una in meno non si compensano", () => {
    const { deviations } = shiftDeviations(
      {
        ...AFTERNOON,
        shift_assignments: [
          person("Andrea", { worked_hours: 9 }),
          person("Giulia", { worked_hours: 7 }),
        ],
      },
      AFTER
    );
    expect(deviations).toEqual([
      { name: "Andrea", delta: 1, proposed: false },
      { name: "Giulia", delta: -1, proposed: false },
    ]);
  });

  it("senza consuntivo non c'è niente da confrontare", () => {
    expect(
      shiftDeviations(
        {
          ...AFTERNOON,
          shift_assignments: [
            person("Marco", { clock: punch(null) }),
            person("Andrea", {}),
          ],
        },
        AFTER
      )
    ).toEqual({ measured: 0, deviations: [] });
  });
});

describe("isRegularPendingClock", () => {
  const pending = (outAt: string | null, reviewedAt: string | null = null) => ({
    status: "confirmed" as const,
    attendance_reviewed_at: reviewedAt,
    clock: punch(outAt),
  });

  it("in orario al quarto d'ora: qualche minuto non conta", () => {
    expect(
      isRegularPendingClock(AFTERNOON, pending("2026-09-24T20:07:00Z"))
    ).toBe(true);
  });

  it("chi si discosta resta fuori dal blocco", () => {
    expect(
      isRegularPendingClock(AFTERNOON, pending("2026-09-24T21:00:00Z"))
    ).toBe(false);
  });

  it("niente blocco senza uscita o se è già approvata", () => {
    expect(isRegularPendingClock(AFTERNOON, pending(null))).toBe(false);
    expect(
      isRegularPendingClock(
        AFTERNOON,
        pending("2026-09-24T20:00:00Z", "2026-09-25T08:00:00Z")
      )
    ).toBe(false);
  });
});
