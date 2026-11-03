import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";

const getOwnerHoursDaily = vi.fn();
// Solo l'API che serve: hooks.ts importa moduli nativi che vitest non legge.
vi.mock("@/features/assignments/api", () => ({
  getOwnerHoursDaily: (...a: unknown[]) => getOwnerHoursDaily(...a),
}));
vi.mock("@/features/venues/OwnerVenues", () => ({}));
vi.mock("@/features/shifts/invalidation", () => ({}));

import { fetchOwnerHoursDaily } from "@/features/assignments/hooks";

const r = (person_id: string): HoursDailyRow => ({
  person_id, person_name: person_id, date: "2026-11-05", kind: "work",
  venue_name: null, title: null, clock_in: null, clock_out: null,
  break_minutes: null, break_paid: null, hours: 1, note: null,
});

describe("fetchOwnerHoursDaily", () => {
  it("ignora la cache fresca (staleTime 0) e filtra per persone", async () => {
    // Staletime globale lungo: senza staleTime: 0 la seconda chiamata userebbe la cache.
    const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 120000 } } });
    const period = { mode: "month", month: "2026-11" } as never;
    getOwnerHoursDaily.mockResolvedValueOnce([r("a"), r("b")]);
    expect(await fetchOwnerHoursDaily(qc, "w", period, ["a"])).toEqual([r("a")]);
    getOwnerHoursDaily.mockResolvedValueOnce([r("a"), r("b")]);
    expect(await fetchOwnerHoursDaily(qc, "w", period, null)).toHaveLength(2);
    expect(getOwnerHoursDaily).toHaveBeenCalledTimes(2);
  });
});
