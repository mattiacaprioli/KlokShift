import { describe, expect, it } from "vitest";

import {
  computeWeekLoad,
  type LoadShift,
} from "@/features/assignments/weekLoad";
import type { ClockRecordWithCorrections } from "@/features/clock/hours";

function clock(outAt: string | null): ClockRecordWithCorrections {
  return {
    id: "clock-1",
    assignment_id: "assignment-1",
    shift_id: "shift-1",
    venue_id: "venue-1",
    venue_member_id: "venue-member-1",
    method: "app",
    clock_in_at: "2026-09-24T12:00:00Z",
    clock_out_at: outAt,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_at: "2026-09-24T12:00:00Z",
    corrections: [],
  };
}

function shift(input: {
  id: string;
  date: string;
  workedHours?: number | null;
  clock?: ClockRecordWithCorrections | null;
}): LoadShift {
  return {
    id: input.id,
    venue_id: "venue-1",
    title: "Pomeriggio",
    date: input.date,
    start_time: "14:00:00",
    end_time: "22:00:00",
    status: "open",
    shift_assignments: [
      {
        id: `assignment-${input.id}`,
        status: "confirmed",
        worked_hours: input.workedHours ?? null,
        attendance_reviewed_at:
          input.workedHours == null ? null : "2026-09-24T22:30:00Z",
        clock: input.clock ?? null,
        role: { name: "Cameriere" },
        staff_member: {
          id: "venue-member-1",
          display_name: "Andrea",
          person_id: "person-1",
        },
      },
    ],
  };
}

const roster = [
  {
    person_id: "person-1",
    display_name: "Andrea",
    roles: "Cameriere",
    contract: null,
  },
];

const actualVenueIds = new Set(["venue-1"]);
const now = new Date("2026-09-25T12:00:00+02:00");

describe("computeWeekLoad: confronto programmato/effettivo", () => {
  it("confronta le ore definitive soltanto con i turni a cui appartengono", () => {
    const [andrea] = computeWeekLoad(
      [
        shift({ id: "past", date: "2026-09-24", workedHours: 9 }),
        shift({ id: "future", date: "2026-09-26" }),
      ],
      roster,
      { actualVenueIds, now }
    );

    expect(andrea.hours).toBe(16);
    expect(andrea.approvedHours).toBe(9);
    expect(andrea.approvedPlannedHours).toBe(8);
    expect(andrea.approvedCount).toBe(1);
  });

  it("tiene separate le proposte da approvare dalle ore definitive", () => {
    const [andrea] = computeWeekLoad(
      [
        shift({
          id: "past",
          date: "2026-09-24",
          clock: clock("2026-09-24T20:30:00Z"),
        }),
      ],
      roster,
      { actualVenueIds, now }
    );

    expect(andrea.approvedCount).toBe(0);
    expect(andrea.proposedHours).toBe(8.5);
    expect(andrea.proposedPlannedHours).toBe(8);
    expect(andrea.proposedCount).toBe(1);
    expect(andrea.byDay.get("2026-09-24")?.[0].actual).toEqual({
      kind: "proposed",
      hours: 8.5,
    });
  });

  it("segnala l'uscita mancante senza inventare una durata", () => {
    const [andrea] = computeWeekLoad(
      [shift({ id: "past", date: "2026-09-24", clock: clock(null) })],
      roster,
      { actualVenueIds, now }
    );

    expect(andrea.missingOutCount).toBe(1);
    expect(andrea.proposedHours).toBe(0);
    expect(andrea.byDay.get("2026-09-24")?.[0].actual).toEqual({
      kind: "missing_out",
    });
  });

  it("non espone il consuntivo senza permesso Ore sulla sede", () => {
    const [andrea] = computeWeekLoad(
      [shift({ id: "past", date: "2026-09-24", workedHours: 9 })],
      roster,
      { actualVenueIds: new Set(), now }
    );

    expect(andrea.approvedCount).toBe(0);
    expect(andrea.byDay.get("2026-09-24")?.[0].actual).toBeNull();
  });
});
