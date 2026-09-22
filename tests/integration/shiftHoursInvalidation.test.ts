import { QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import {
  invalidateShiftViews,
  shiftViewQueryKeys,
} from "@/features/shifts/invalidation";
import { qk } from "@/lib/queryKeys";
import { createTestQueryClient } from "../helpers/async";

const workspaceId = "workspace";
const january = qk.staff.ownerHours(workspaceId, "2026-01");
const february = qk.staff.ownerHours(workspaceId, "2026-02");

function seedHours() {
  const client = createTestQueryClient();
  client.setQueryData(january, 10);
  client.setQueryData(february, 20);
  return client;
}

describe("invalidazione ore dopo modifica turno", () => {
  it("la modifica locale rifà entrambi i mesi e invalida le assegnazioni", async () => {
    const client = seedHours();
    const assignmentKey = qk.assignments.byShift("shift");
    client.setQueryData(assignmentKey, ["assignment"]);
    let januaryHours = 10;
    let februaryHours = 20;
    const januaryQuery = vi.fn(async () => januaryHours);
    const februaryQuery = vi.fn(async () => februaryHours);
    const januaryObserver = new QueryObserver(client, {
      queryKey: january,
      queryFn: januaryQuery,
    });
    const februaryObserver = new QueryObserver(client, {
      queryKey: february,
      queryFn: februaryQuery,
    });
    const unsubscribeJanuary = januaryObserver.subscribe(() => undefined);
    const unsubscribeFebruary = februaryObserver.subscribe(() => undefined);

    await vi.waitFor(() => {
      expect(januaryObserver.getCurrentResult().data).toBe(10);
      expect(februaryObserver.getCurrentResult().data).toBe(20);
    });
    const januaryCalls = januaryQuery.mock.calls.length;
    const februaryCalls = februaryQuery.mock.calls.length;
    januaryHours = 0;
    februaryHours = 30;

    invalidateShiftViews(client, "shift");
    client.invalidateQueries({ queryKey: qk.assignments.all });

    await vi.waitFor(() => {
      expect(januaryObserver.getCurrentResult().data).toBe(0);
      expect(februaryObserver.getCurrentResult().data).toBe(30);
    });
    expect(januaryQuery.mock.calls.length).toBeGreaterThan(januaryCalls);
    expect(februaryQuery.mock.calls.length).toBeGreaterThan(februaryCalls);
    expect(client.getQueryState(assignmentKey)?.isInvalidated).toBe(true);
    unsubscribeJanuary();
    unsubscribeFebruary();
    client.clear();
  });

  it("un evento realtime sul solo turno invalida comunque tutti i mesi", () => {
    const client = seedHours();

    for (const queryKey of shiftViewQueryKeys("shift")) {
      client.invalidateQueries({ queryKey });
    }

    expect(client.getQueryState(january)?.isInvalidated).toBe(true);
    expect(client.getQueryState(february)?.isInvalidated).toBe(true);
    client.clear();
  });
});
