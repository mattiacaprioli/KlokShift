import { describe, expect, it } from "vitest";

import {
  clockAttentionByShift,
  clockAttentionCounts,
  clockAttentionForShift,
  clockAttentionItems,
  clockAttentionLabel,
  clockAttentionSummary,
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
    break_clocked: true,
    note: null,
    role_id: null,
    clock_in_at: "2026-09-25T12:00:00Z",
    clock_out_at: outAt,
    voided_at: null,
    voided_by: null,
    void_reason: null,
    created_at: "2026-09-25T12:00:00Z",
    corrections: [],
    breaks: [],
  };
}

function shift(input?: {
  outAt?: string | null;
  reviewedAt?: string | null;
  date?: string;
  status?: ShiftWithAssignees["status"];
  /** Nessuna timbratura. */
  noClock?: boolean;
  assignmentStatus?: ShiftWithAssignees["shift_assignments"][number]["status"];
  hoursSource?: string | null;
  memberMethod?: "manual" | "app" | null;
  publishedAt?: string | null;
}): ShiftWithAssignees {
  return {
    id: "shift-1",
    created_at: "2026-09-01T00:00:00Z",
    date: input?.date ?? "2026-09-25",
    start_time: "14:00:00",
    end_time: "15:00:00",
    break_minutes: 0,
    break_paid: false,
    published_at:
      input && "publishedAt" in input ? (input.publishedAt ?? null) : "2026-09-01T00:00:00Z",
    published_by: null,
    recorded_at: null,
    recorded_by: null,
    title: "Pomeriggio",
    description: null,
    venue_id: "venue-1",
    status: input?.status ?? "open",
    positions_filled: 1,
    positions_total: 1,
    require_confirmation: false,
    unplanned: false,
    shift_role_requirements: [],
    shift_assignments: [
      {
        id: "assignment-1",
        status: input?.assignmentStatus ?? "confirmed",
        worked_hours: null,
        hours_source: input?.hoursSource ?? null,
        role_id: null,
        role: null,
        attendance_reviewed_at: input?.reviewedAt ?? null,
        clock: input?.noClock ? null : clock(input?.outAt ?? null),
        staff_member: {
          id: "member-1",
          display_name: "Andrea",
          person_id: "person-1",
          waiter_id: "user-1",
          clock_method: input?.memberMethod ?? null,
        },
      },
    ],
  };
}

// Ora locale, senza offset: l'orario del turno (14:00-15:00) `isShiftOver` lo
// legge nel fuso della macchina, e un "+02:00" qui passava solo in Italia (la
// CI gira in UTC, dove alle 16:00 italiane il turno non era ancora finito).
const afterShift = new Date("2026-09-25T16:00:00");

const APP = [{ id: "venue-1", clock_method: "app" as const }];
const MANUAL = [{ id: "venue-1", clock_method: "manual" as const }];

describe("clockAttentionForShift", () => {
  it("segnala un'uscita mancante soltanto dopo la fine del turno", () => {
    expect(clockAttentionForShift(shift(), APP, afterShift)[0]?.kind).toBe(
      "missing_out"
    );
    expect(
      clockAttentionForShift(shift(), APP, new Date("2026-09-25T14:30:00"))
    ).toEqual([]);
  });

  it("distingue le ore complete ancora da approvare", () => {
    const item = clockAttentionForShift(
      shift({ outAt: "2026-09-25T13:00:00Z" }),
      APP,
      afterShift
    )[0];
    expect(item).toMatchObject({ kind: "to_review", personName: "Andrea" });
  });

  it("ignora timbrature approvate, turni annullati e bozze", () => {
    expect(
      clockAttentionForShift(
        shift({
          outAt: "2026-09-25T13:00:00Z",
          reviewedAt: "2026-09-25T14:00:00Z",
        }),
        APP,
        afterShift
      )
    ).toEqual([]);
    expect(
      clockAttentionForShift(shift({ status: "cancelled" }), APP, afterShift)
    ).toEqual([]);
    expect(
      clockAttentionForShift(
        shift({ noClock: true, publishedAt: null }),
        APP,
        afterShift
      )
    ).toEqual([]);
  });

  it("chi doveva timbrare e non l'ha fatto: «non ha timbrato», a turno finito", () => {
    const noClock = shift({ noClock: true });
    expect(clockAttentionForShift(noClock, APP, afterShift)[0]?.kind).toBe(
      "not_clocked"
    );
    expect(
      clockAttentionForShift(noClock, APP, new Date("2026-09-25T14:30:00"))
    ).toEqual([]);
  });

  it("senza timbratura dovuta non c'è niente da dire", () => {
    // La sede non timbra, o la persona ne è esentata.
    expect(clockAttentionForShift(shift({ noClock: true }), MANUAL, afterShift)).toEqual([]);
    expect(
      clockAttentionForShift(
        shift({ noClock: true, memberMethod: "manual" }),
        APP,
        afterShift
      )
    ).toEqual([]);
    // Turno registrato a mano: le ore contano senza timbratura.
    expect(
      clockAttentionForShift(
        shift({ noClock: true, hoursSource: "manual_auto" }),
        APP,
        afterShift
      )
    ).toEqual([]);
    // La sede non si conosce: meglio tacere che inventare un ritardo.
    expect(clockAttentionForShift(shift({ noClock: true }), [], afterShift)).toEqual([]);
  });

  it("l'eccezione della persona vale anche al contrario", () => {
    expect(
      clockAttentionForShift(
        shift({ noClock: true, memberMethod: "app" }),
        MANUAL,
        afterShift
      )[0]?.kind
    ).toBe("not_clocked");
  });

  it("chi è segnato assente o ha rifiutato non va sistemato", () => {
    for (const assignmentStatus of ["no_show", "declined"] as const) {
      expect(
        clockAttentionForShift(
          shift({ noClock: true, assignmentStatus }),
          APP,
          afterShift
        )
      ).toEqual([]);
    }
  });

  it("riassume le categorie nel periodo", () => {
    const complete = shift({ outAt: "2026-09-25T13:00:00Z" });
    complete.id = "shift-2";
    const missing = shift({ noClock: true });
    missing.id = "shift-3";
    const items = clockAttentionItems([shift(), complete, missing], APP, afterShift);
    expect(clockAttentionCounts(items)).toEqual({
      total: 3,
      notClocked: 1,
      missingOut: 1,
      toReview: 1,
    });
    expect(clockAttentionSummary(items)).toBe(
      "1 non ha timbrato · 1 uscita mancante · 1 da approvare"
    );
  });
});

describe("clockAttentionLabel", () => {
  it("su una card con più persone vince la più grave", () => {
    expect(clockAttentionLabel(["to_review", "not_clocked"])).toBe("Non ha timbrato");
    expect(clockAttentionLabel(["to_review", "missing_out"])).toBe("Uscita mancante");
    expect(clockAttentionLabel(["to_review"])).toBe("Ore da approvare");
    expect(clockAttentionLabel([])).toBeNull();
  });
});

describe("clockAttentionByShift", () => {
  it("dice sulla card il perché e chi: l'organico di Andrea", () => {
    const items = clockAttentionItems([shift({ noClock: true })], APP, afterShift);
    const byShift = clockAttentionByShift(items);
    expect(byShift.get("shift-1")?.label).toBe("Non ha timbrato");
    expect([...(byShift.get("shift-1")?.memberIds ?? [])]).toEqual(["member-1"]);
    expect(clockAttentionByShift([]).size).toBe(0);
  });
});
