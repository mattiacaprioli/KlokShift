import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  moveAssignmentImpact,
  shiftMoveImpact,
  type MoveAssignee,
} from "@/features/shifts/moveImpact";
import type { ShiftWithAssignees } from "@/features/shifts/types";

function assignment(
  id: string,
  personId: string,
  status: MoveAssignee["status"] = "confirmed",
  waiterId: string | null = `user-${personId}`
): ShiftWithAssignees["shift_assignments"][number] {
  return {
    id,
    status,
    role_id: null,
    role: null,
    staff_member: {
      id: `venue-${personId}`,
      display_name: personId,
      person_id: personId,
      waiter_id: waiterId,
    },
  };
}

function shift(
  input: Partial<ShiftWithAssignees> &
    Pick<ShiftWithAssignees, "id" | "date" | "start_time" | "end_time">
): ShiftWithAssignees {
  return {
    created_at: "2026-09-01T00:00:00Z",
    description: null,
    positions_filled: 0,
    positions_total: 1,
    require_confirmation: true,
    status: "open",
    title: input.id,
    venue_id: "venue-1",
    shift_role_requirements: [],
    shift_assignments: [],
    ...input,
  };
}

describe("shiftMoveImpact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00"));
  });

  afterEach(() => vi.useRealTimers());

  it("notifica e riapre soltanto gli assegnati interessati", () => {
    const impact = shiftMoveImpact({
      shiftId: "moving",
      assignees: [
        {
          status: "confirmed",
          personId: "author",
          displayName: "Autore",
          waiterId: "user-author",
        },
        {
          status: "confirmed",
          personId: "bruno",
          displayName: "Bruno",
          waiterId: "user-bruno",
        },
        {
          status: "assigned",
          personId: "no-account",
          displayName: "Senza account",
          waiterId: null,
        },
        {
          status: "declined",
          personId: "declined",
          displayName: "Rifiutato",
          waiterId: "user-declined",
        },
        {
          status: "no_show",
          personId: "no-show",
          displayName: "Assente",
          waiterId: "user-no-show",
        },
      ],
      to: { date: "2026-09-23", start_time: "18:00", end_time: "23:00" },
      myWaiterId: "user-author",
      absences: [],
    });

    expect(impact.notify).toEqual({ assignees: ["Bruno"], total: 1 });
    expect(impact.reopens).toEqual(["Bruno"]);
    expect(impact.absent).toEqual([]);
    expect(impact.overlaps).toEqual([]);
  });

  it("non produce conseguenze per un turno annullato", () => {
    expect(
      shiftMoveImpact({
        shiftId: "cancelled",
        cancelled: true,
        assignees: [
          {
            status: "confirmed",
            personId: "anna",
            displayName: "Anna",
            waiterId: "user-anna",
          },
        ],
        to: { date: "2026-09-23", start_time: "18:00", end_time: "23:00" },
        absences: [],
      })
    ).toEqual({
      notify: { assignees: [], total: 0 },
      reopens: [],
      absent: [],
      overlaps: [],
    });
  });

  it("rileva assenza e sovrapposizione di un turno notturno", () => {
    const impact = shiftMoveImpact({
      shiftId: "moving",
      assignees: [
        {
          status: "confirmed",
          personId: "anna",
          displayName: "Anna",
          waiterId: "user-anna",
        },
      ],
      to: { date: "2026-09-23", start_time: "22:00", end_time: "04:00" },
      absences: [
        {
          member_id: "anna",
          status: "approved",
          start_date: "2026-09-24",
          end_date: "2026-09-24",
          start_time: null,
          end_time: null,
        },
      ],
      dayShifts: [
        shift({
          id: "other",
          title: "Chiusura",
          date: "2026-09-23",
          start_time: "23:30",
          end_time: "01:00",
          shift_assignments: [assignment("a-other", "anna")],
        }),
      ],
    });

    expect(impact.absent).toEqual([{ name: "Anna", status: "approved" }]);
    expect(impact.overlaps).toEqual([
      { name: "Anna", title: "Chiusura", range: "23:30–01:00 +1" },
    ]);
  });

  it("non segnala come sovrapposti due turni adiacenti", () => {
    const impact = shiftMoveImpact({
      shiftId: "moving",
      assignees: [
        {
          status: "confirmed",
          personId: "anna",
          displayName: "Anna",
          waiterId: "user-anna",
        },
      ],
      to: { date: "2026-09-23", start_time: "18:00", end_time: "23:00" },
      absences: [],
      dayShifts: [
        shift({
          id: "adjacent",
          date: "2026-09-23",
          start_time: "23:00",
          end_time: "02:00",
          shift_assignments: [assignment("a-adjacent", "anna")],
        }),
      ],
    });

    expect(impact.overlaps).toEqual([]);
  });
});

describe("moveAssignmentImpact", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00"));
  });

  afterEach(() => vi.useRealTimers());

  it("descrive assenza, turno pieno e partenza lasciata vuota", () => {
    const from = shift({
      id: "from",
      date: "2026-09-23",
      start_time: "18:00",
      end_time: "23:00",
      shift_assignments: [assignment("moving-assignment", "anna")],
    });
    const target = shift({
      id: "target",
      date: "2026-09-24",
      start_time: "18:00",
      end_time: "23:00",
      positions_total: 1,
      shift_assignments: [assignment("already-there", "bruno")],
    });

    const impact = moveAssignmentImpact({
      from,
      assignmentId: "moving-assignment",
      to: { shift: target },
      absences: [
        {
          status: "pending",
          start_date: "2026-09-24",
          end_date: "2026-09-24",
          start_time: null,
          end_time: null,
        },
      ],
    });

    expect(impact.plan).toEqual({
      notifiesFrom: true,
      fromSkip: null,
      notifiesTo: true,
    });
    expect(impact.absence?.status).toBe("pending");
    expect(impact.leavesEmpty).toBe(true);
    expect(impact.targetFull).toBe(true);
  });
});
