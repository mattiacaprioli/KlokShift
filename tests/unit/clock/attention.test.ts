import { describe, expect, it } from "vitest";

import {
  clockAttentionCounts,
  clockAttentionForShift,
  clockAttentionItems,
} from "@/features/clock/attention";
import type { ClockRecordWithCorrections } from "@/features/clock/hours";
import type { ShiftWithAssignees } from "@/features/shifts/types";

function clock(outAt: string | null): ClockRecordWithCorrections {
  return {
    id: "clock-1",
    assignment_id: "assignment-1",
    shift_id: "shift-1",
    venue_id: "venue-1",
    venue_member_id: "member-1",
    method: "app",
    clock_in_at: "2026-09-25T12:00:00Z",
    clock_out_at: outAt,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_at: "2026-09-25T12:00:00Z",
    corrections: [],
  };
}

function shift(input?: {
  outAt?: string | null;
  reviewedAt?: string | null;
  date?: string;
  status?: ShiftWithAssignees["status"];
}): ShiftWithAssignees {
  return {
    id: "shift-1",
    created_at: "2026-09-01T00:00:00Z",
    date: input?.date ?? "2026-09-25",
    start_time: "14:00:00",
    end_time: "15:00:00",
    title: "Pomeriggio",
    description: null,
    venue_id: "venue-1",
    status: input?.status ?? "open",
    positions_filled: 1,
    positions_total: 1,
    require_confirmation: false,
    shift_role_requirements: [],
    shift_assignments: [
      {
        id: "assignment-1",
        status: "confirmed",
        worked_hours: null,
        role_id: null,
        role: null,
        attendance_reviewed_at: input?.reviewedAt ?? null,
        clock: clock(input?.outAt ?? null),
        staff_member: {
          id: "member-1",
          display_name: "Andrea",
          person_id: "person-1",
          waiter_id: "user-1",
        },
      },
    ],
  };
}

const afterShift = new Date("2026-09-25T16:00:00+02:00");

describe("clockAttentionForShift", () => {
  it("segnala un'uscita mancante soltanto dopo la fine del turno", () => {
    expect(clockAttentionForShift(shift(), afterShift)[0]?.kind).toBe(
      "missing_out"
    );
    expect(
      clockAttentionForShift(
        shift(),
        new Date("2026-09-25T14:30:00+02:00")
      )
    ).toEqual([]);
  });

  it("distingue le ore complete ancora da approvare", () => {
    const item = clockAttentionForShift(
      shift({ outAt: "2026-09-25T13:00:00Z" }),
      afterShift
    )[0];
    expect(item).toMatchObject({ kind: "to_review", personName: "Andrea" });
  });

  it("ignora timbrature approvate e turni annullati", () => {
    expect(
      clockAttentionForShift(
        shift({
          outAt: "2026-09-25T13:00:00Z",
          reviewedAt: "2026-09-25T14:00:00Z",
        }),
        afterShift
      )
    ).toEqual([]);
    expect(
      clockAttentionForShift(shift({ status: "cancelled" }), afterShift)
    ).toEqual([]);
  });

  it("riassume le due categorie nel periodo", () => {
    const complete = shift({ outAt: "2026-09-25T13:00:00Z" });
    complete.id = "shift-2";
    const items = clockAttentionItems([shift(), complete], afterShift);
    expect(clockAttentionCounts(items)).toEqual({
      total: 2,
      missingOut: 1,
      toReview: 1,
    });
  });
});
