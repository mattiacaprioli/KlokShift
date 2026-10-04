import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

import { setAbsenceHourCredit } from "@/features/absences/api";

describe("credito ore di un'assenza", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("toglie il credito omettendo i minuti (default null della RPC)", async () => {
    await setAbsenceHourCredit({ absenceId: "a", date: "2026-10-04", minutes: null });
    expect(mocks.rpc).toHaveBeenCalledWith("set_absence_hour_credit", {
      p_absence: "a",
      p_date: "2026-10-04",
    });
  });

  it("passa i minuti quando ci sono, anche se il valore è basso", async () => {
    await setAbsenceHourCredit({ absenceId: "a", date: "2026-10-04", minutes: 30 });
    expect(mocks.rpc).toHaveBeenCalledWith("set_absence_hour_credit", {
      p_absence: "a",
      p_date: "2026-10-04",
      p_minutes: 30,
    });
  });
});
