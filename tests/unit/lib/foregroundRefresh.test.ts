import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { refreshOnForeground } from "../../../src/lib/foregroundRefresh";
import { qk } from "../../../src/lib/queryKeys";

describe("ritorno in primo piano (C14)", () => {
  it("rilegge l'accesso dell'azienda e la timbratura senza turno del professionista", () => {
    const qc = new QueryClient();
    const access = qk.workspaceAccess.byWorkspace("ws");
    qc.setQueryData(access, { ok: true });
    qc.setQueryData(qk.clock.myUnplanned, []);

    refreshOnForeground(qc);

    expect(qc.getQueryState(access)?.isInvalidated).toBe(true);
    // Il gestore può chiudere o annullare l'entrata mentre l'app è in secondo
    // piano, e la Home del professionista non è in tempo reale.
    expect(qc.getQueryState(qk.clock.myUnplanned)?.isInvalidated).toBe(true);
  });
});
