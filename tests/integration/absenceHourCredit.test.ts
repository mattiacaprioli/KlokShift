import { beforeEach, describe, expect, it, vi } from "vitest";

import { setAbsenceHourCredit, setAbsenceHourCredits } from "@/features/absences/api";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));

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

  it("salva più giorni in fila e si ferma al primo errore", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "invalid_hours" } });
    await expect(
      setAbsenceHourCredits({
        absenceId: "a",
        changes: [
          { date: "2026-10-01", minutes: 480 },
          { date: "2026-10-02", minutes: null },
          { date: "2026-10-03", minutes: 480 },
        ],
      })
    ).rejects.toThrow("invalid_hours");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
  });
});
