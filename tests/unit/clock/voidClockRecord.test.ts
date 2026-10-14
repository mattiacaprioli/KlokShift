import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { qk } from "../../../src/lib/queryKeys";

const { voidClockRecord } = vi.hoisted(() => ({ voidClockRecord: vi.fn() }));
vi.mock("@/features/clock/api", () => ({
  approveClockRecord: vi.fn(),
  closeUnplannedClock: vi.fn(),
  correctClockRecord: vi.fn(),
  getMyUnplannedClock: vi.fn(),
  getOpenUnplannedClocks: vi.fn(),
  punchClock: vi.fn(),
  punchUnplannedClock: vi.fn(),
  setMemberClockUnplanned: vi.fn(),
  setVenueClockMethod: vi.fn(),
  setMemberClockMethod: vi.fn(),
  voidClockRecord,
  voidUnplannedClock: vi.fn(),
}));

import { useVoidClockRecord } from "../../../src/features/clock/hooks";

/** Il hook senza DOM: basta un render per avere la mutation. */
function voidMutation(qc: QueryClient) {
  let mutation: ReturnType<typeof useVoidClockRecord> | undefined;
  function Probe() {
    mutation = useVoidClockRecord();
    return null;
  }
  renderToStaticMarkup(
    createElement(QueryClientProvider, { client: qc }, createElement(Probe))
  );
  return mutation!;
}

describe("annullare una timbratura (C14)", () => {
  it("rilegge il dettaglio del turno: per un fuori turno il turno non esiste più", async () => {
    voidClockRecord.mockResolvedValue({ id: "record", shift_id: "shift" });
    const qc = new QueryClient();
    qc.setQueryData(qk.shifts.detail("shift"), { id: "shift", unplanned: true });

    await voidMutation(qc).mutateAsync({ assignmentId: "assignment", reason: "errore" });

    expect(voidClockRecord).toHaveBeenCalledWith("assignment", "errore");
    expect(qc.getQueryState(qk.shifts.detail("shift"))?.isInvalidated).toBe(true);
  });
});
