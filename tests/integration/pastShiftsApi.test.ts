import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  select: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

import {
  getOwnerPastShiftsCount,
  getOwnerPastShiftsPage,
} from "@/features/shifts/api";
import type { PastShiftsFilters } from "@/features/shifts/pastFilters";

const filters: PastShiftsFilters = {
  venueIds: ["venue-1"],
  from: "2026-09-01",
  to: "2026-09-23",
  status: "done",
  role: { name: "Barman", ids: ["role-1", "role-2"] },
  person: { id: "member-1", name: "Andrea" },
  q: " Gala_% ",
};

const row = {
  id: "shift-1",
  venue_id: "venue-1",
  title: "Gala",
  description: null,
  date: "2026-09-23",
  start_time: "09:00:00",
  end_time: "13:00:00",
  status: "open",
  require_confirmation: false,
  positions_total: 1,
  positions_filled: 0,
  created_at: "2026-09-01T00:00:00Z",
  shift_role_requirements: [],
  shift_assignments: [],
};

describe("API storico turni", () => {
  beforeEach(() => {
    mocks.select.mockResolvedValue({ data: [row], error: null });
    mocks.rpc.mockImplementation((name: string) => {
      if (name === "get_owner_past_shifts_page") {
        return { select: mocks.select };
      }
      return Promise.resolve({ data: 1, error: null });
    });
  });

  it("manda filtri e cursore alla pagina server senza rifiltrare il risultato", async () => {
    const page = await getOwnerPastShiftsPage(
      ["venue-1", "venue-2"],
      { date: "2026-09-20", start_time: "09:00:00", id: "cursor" },
      filters
    );

    expect(mocks.rpc).toHaveBeenCalledWith("get_owner_past_shifts_page", {
      p_venue_ids: ["venue-1"],
      p_from: "2026-09-01",
      p_to: "2026-09-23",
      p_status: "done",
      p_role_ids: ["role-1", "role-2"],
      p_member_ids: ["member-1"],
      p_query: "Gala",
      p_limit: 20,
      p_before_date: "2026-09-20",
      p_before_start: "09:00:00",
      p_before_id: "cursor",
    });
    expect(page.rows).toEqual([row]);
    expect(page.nextCursor).toBeNull();
  });

  it("usa per il conteggio lo stesso scope e gli stessi filtri", async () => {
    await expect(
      getOwnerPastShiftsCount(["venue-1", "venue-2"], filters)
    ).resolves.toBe(1);

    expect(mocks.rpc).toHaveBeenCalledWith("get_owner_past_shifts_count", {
      p_venue_ids: ["venue-1"],
      p_from: "2026-09-01",
      p_to: "2026-09-23",
      p_status: "done",
      p_role_ids: ["role-1", "role-2"],
      p_member_ids: ["member-1"],
      p_query: "Gala",
    });
  });
});
