import { describe, expect, it } from "vitest";

import {
  actualChipText,
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

// Il pomeriggio del 24/09, 14:00-22:00. Gli istanti di confronto sono in ora
// locale, senza offset: l'orario del turno si legge nel fuso della macchina, e
// un istante in UTC cadrebbe altrove a seconda di dove girano i test.
const AFTERNOON = {
  date: "2026-09-24",
  start_time: "14:00:00",
  end_time: "22:00:00",
};
const DURING = new Date("2026-09-24T18:00:00");
const AFTER = new Date("2026-09-25T08:00:00");

function punch(outAt: string | null): ClockRecordWithCorrections {
  return {
    clock_in_at: "2026-09-24T12:00:00Z",
    clock_out_at: outAt,
    corrections: [],
  } as unknown as ClockRecordWithCorrections;
}

describe("assignmentActual", () => {
  // Gemello del riepilogo mensile (get_workspace_hours_summary): definitive solo
  // le ore Manuali e quelle di una timbratura approvata e chiusa (B08).
  const base = {
    status: "confirmed" as const,
    worked_hours: null as number | null,
    hours_source: null as string | null,
    attendance_reviewed_at: null as string | null,
    clock: null as ClockRecordWithCorrections | null,
  };

  it.each([
    ["Manuale rettificato", { worked_hours: 7, hours_source: "manual" }, { kind: "approved", hours: 7 }],
    ["Manuale rettificato a zero", { worked_hours: 0, hours_source: "manual" }, { kind: "approved", hours: 0 }],
    ["timbratura approvata", {
      worked_hours: 9, hours_source: "clock", attendance_reviewed_at: "2026-09-24T22:30:00Z",
      clock: punch("2026-09-24T21:00:00Z"),
    }, { kind: "approved", hours: 9 }],
    ["ore scritte su metodo App senza timbratura", { worked_hours: 6 }, { kind: "untracked", hours: 6 }],
    ["ore scritte su turno App congelato", { worked_hours: 6, hours_source: "clock_expected" }, { kind: "untracked", hours: 6 }],
    ["ore scritte con timbratura da approvare", {
      worked_hours: 7, clock: punch("2026-09-24T22:00:00Z"),
    }, { kind: "proposed", hours: 10 }],
    ["timbratura approvata ma senza uscita", {
      worked_hours: 4, hours_source: "clock", attendance_reviewed_at: "2026-09-24T22:30:00Z",
      clock: punch(null),
    }, { kind: "missing_out" }],
    ["Manuale automatico concluso: il programmato è già il numero", { hours_source: "manual_auto" }, null],
    ["App senza timbratura", { hours_source: "clock_expected" }, null],
  ] as const)("%s", (_label, fields, expected) => {
    expect(assignmentActual(AFTERNOON, { ...base, ...fields }, AFTER)).toEqual(expected);
  });

  it("una timbratura completa è solo una proposta", () => {
    expect(
      assignmentActual(
        AFTERNOON,
        {
          status: "assigned",
          worked_hours: null,
          hours_source: null,
          attendance_reviewed_at: null,
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
      hours_source: null,
      attendance_reviewed_at: null,
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
        {
          status: "declined",
          worked_hours: 8,
          hours_source: "manual",
          attendance_reviewed_at: null,
          clock: null,
        },
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
      hours_source?: string | null;
      clock?: ClockRecordWithCorrections | null;
    }
  ) => ({
    status: "confirmed" as const,
    worked_hours: fields.worked_hours ?? null,
    // Le ore scritte nei test di scostamento sono Manuali, salvo dove indicato.
    hours_source:
      fields.hours_source !== undefined
        ? fields.hours_source
        : fields.worked_hours != null
          ? "manual"
          : null,
    attendance_reviewed_at: null,
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
      deviations: [{ name: "Andrea", delta: 1, kind: "proposed" }],
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
      { name: "Andrea", delta: 1, kind: "approved" },
      { name: "Giulia", delta: -1, kind: "approved" },
    ]);
  });

  it("le ore senza timbratura sono uno scostamento da verificare, non definitivo", () => {
    expect(
      shiftDeviations(
        {
          ...AFTERNOON,
          shift_assignments: [person("Marco", { worked_hours: 6, hours_source: null })],
        },
        AFTER
      )
    ).toEqual({ measured: 1, deviations: [{ name: "Marco", delta: -2, kind: "untracked" }] });
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

describe("actualChipText", () => {
  it.each([
    [{ kind: "approved", hours: 9 }, "Effettive 9 h · +1 h"],
    [{ kind: "proposed", hours: 8 }, "Proposte 8 h · da verificare"],
    [{ kind: "untracked", hours: 6 }, "Senza timbratura 6 h · -2 h · da verificare"],
    [{ kind: "missing_out" }, "Uscita mancante"],
  ] as const)("%o", (actual, text) => {
    expect(actualChipText(actual, 8)).toBe(text);
  });
});
