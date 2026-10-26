import { beforeEach, describe, expect, it, vi } from "vitest";

import { recordPastShift } from "@/features/assignments/api";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

const input = {
  venue_id: "venue-1",
  title: "Sera",
  date: "2026-10-23",
  start_time: "18:00",
  end_time: "23:00",
  break_minutes: 30,
  note: null,
  staff: [{ venue_member_id: "vm-1", role_id: null }],
  notify: false,
};

describe("recordPastShift", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("passa il turno a record_past_shift, nota vuota se manca", async () => {
    mocks.rpc.mockResolvedValue({ data: "shift-1", error: null });

    await expect(recordPastShift(input)).resolves.toBe("shift-1");
    expect(mocks.rpc).toHaveBeenCalledWith("record_past_shift", {
      p_venue: "venue-1",
      p_date: "2026-10-23",
      p_start: "18:00",
      p_end: "23:00",
      p_break_minutes: 30,
      p_title: "Sera",
      p_note: "",
      p_staff: [{ venue_member_id: "vm-1", role_id: null }],
      p_notify: false,
    });
  });

  it("fa risalire l'errore del database", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "shift_not_finished" } });

    await expect(recordPastShift(input)).rejects.toThrow("shift_not_finished");
  });
});
