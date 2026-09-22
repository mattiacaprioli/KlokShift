import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reassignNotifyPlan } from "@/features/shifts/notify";

describe("reassignNotifyPlan", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00"));
  });

  afterEach(() => vi.useRealTimers());

  it("non notifica la revoca di un incarico rifiutato", () => {
    expect(
      reassignNotifyPlan({
        shiftDate: "2026-09-23",
        shiftCancelled: false,
        from: { status: "declined", waiterId: "user-1" },
        toWaiterId: "user-2",
      })
    ).toEqual({ notifiesFrom: false, fromSkip: "declined", notifiesTo: true });
  });

  it("non promette notifiche a una persona senza account", () => {
    expect(
      reassignNotifyPlan({
        shiftDate: "2026-09-23",
        shiftCancelled: false,
        from: { status: "confirmed", waiterId: null },
        toWaiterId: null,
      })
    ).toEqual({
      notifiesFrom: false,
      fromSkip: "no-account",
      notifiesTo: false,
    });
  });

  it("usa l'orologio fissato per distinguere un turno passato", () => {
    expect(
      reassignNotifyPlan({
        shiftDate: "2026-09-21",
        shiftCancelled: false,
        from: { status: "confirmed", waiterId: "user-1" },
        toWaiterId: "user-1",
      }).fromSkip
    ).toBe("past");
  });
});
