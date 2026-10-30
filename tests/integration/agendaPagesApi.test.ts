import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as [string, unknown[]][] }));

vi.mock("@/lib/supabase", () => {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "in", "gte", "lt", "order"]) {
    chain[m] = (...args: unknown[]) => {
      mocks.calls.push([m, args]);
      return chain;
    };
  }
  chain.limit = (...args: unknown[]) => {
    mocks.calls.push(["limit", args]);
    return Promise.resolve({ data: mocks.rows, error: null });
  };
  return { supabase: { from: () => chain } };
});

import { AGENDA_PAGE_DAYS, getOwnerShiftsPage } from "@/features/shifts/api";

const row = (id: string, date: string) => ({
  id, venue_id: "v1", title: "Turno", description: null, date,
  start_time: "09:00:00", end_time: "17:00:00", status: "open",
  require_confirmation: false, positions_total: 1, positions_filled: 1,
  created_at: "2026-10-01T00:00:00Z", shift_role_requirements: [], shift_assignments: [],
});

describe("agenda a pagine", () => {
  beforeEach(() => {
    mocks.rows = [];
    mocks.calls = [];
  });

  it("chiede quattro settimane, con un tetto di righe", async () => {
    mocks.rows = [row("a", "2026-11-01")];
    const page = await getOwnerShiftsPage(["v1"], "2026-11-01");
    expect(page.next).toBe("2026-11-29");
    expect(AGENDA_PAGE_DAYS).toBe(28);
    expect(mocks.calls).toContainEqual(["gte", ["date", "2026-11-01"]]);
    expect(mocks.calls).toContainEqual(["lt", ["date", "2026-11-29"]]);
    expect(mocks.calls.find(([m]) => m === "limit")?.[1][0]).toBeLessThan(1000);
  });

  it("al tetto non perde turni: tiene i giorni interi e riparte dall'ultimo", async () => {
    const limit = 800;
    mocks.rows = [
      ...Array.from({ length: limit - 2 }, (_, i) => row(`x${i}`, "2026-11-02")),
      row("y1", "2026-11-03"),
      row("y2", "2026-11-03"),
    ];
    const page = await getOwnerShiftsPage(["v1"], "2026-11-01");
    expect(page.next).toBe("2026-11-03");
    expect(page.shifts.every((s) => s.date === "2026-11-02")).toBe(true);
    expect(page.shifts).toHaveLength(limit - 2);
  });
});
