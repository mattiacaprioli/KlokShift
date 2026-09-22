import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc },
}));

import {
  RemoveFromShiftsError,
  removeFromShifts,
} from "@/features/absences/api";
import { invalidateAfterShiftRemoval } from "@/features/absences/removal";
import { qk } from "@/lib/queryKeys";
import { controlledPromise, createTestQueryClient } from "../helpers/async";

describe("rimozione dai turni per assenza", () => {
  beforeEach(() => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("ferma la sequenza e dichiara riusciti, incerto e non tentati", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { message: "not_allowed" },
      });

    let caught: unknown;
    try {
      await removeFromShifts(["first", "second", "third"]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(RemoveFromShiftsError);
    const error = caught as RemoveFromShiftsError;
    expect(error.removedAssignmentIds).toEqual(["first"]);
    expect(error.uncertainAssignmentId).toBe("second");
    expect(error.notAttemptedAssignmentIds).toEqual(["third"]);
    expect(error.message).toContain("1 turno è stato liberato");
    expect(error.message).toContain("Non sappiamo se il turno");
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).not.toHaveBeenCalledWith("unassign", {
      p_assignment: "third",
    });
  });

  it("un timeout resta incerto perché può arrivare dopo il commit", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: null,
      error: { message: "Network request failed" },
    });

    await expect(removeFromShifts(["possibly-committed", "untouched"]))
      .rejects.toMatchObject({
        removedAssignmentIds: [],
        uncertainAssignmentId: "possibly-committed",
        notAttemptedAssignmentIds: ["untouched"],
        message: expect.stringContaining(
          "0 turni risultano confermati come liberati"
        ),
      });
  });

  it("restituisce tutte le rimozioni confermate quando completa", async () => {
    await expect(removeFromShifts(["first", "second"])).resolves.toEqual({
      removedAssignmentIds: ["first", "second"],
    });
  });

  it("invalida sempre conflitti, turni e planning dopo l'esito", async () => {
    const client = createTestQueryClient();
    const assignmentKey = qk.assignments.personRange(
      "person",
      "2026-09-01",
      "2026-09-03"
    );
    const shiftKey = qk.shifts.range(
      "venues",
      "2026-09-01",
      "2026-09-07"
    );
    const planningKey = qk.planning.range("2026-09-01", "2026-09-07");
    client.setQueryData(assignmentKey, ["assignment"]);
    client.setQueryData(shiftKey, ["shift"]);
    client.setQueryData(planningKey, ["planning"]);
    const refreshed = controlledPromise<string[]>();
    const queryFn = vi.fn(() => refreshed.promise);
    const observer = new QueryObserver(client, {
      queryKey: assignmentKey,
      queryFn,
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    let settled = false;
    const invalidation = invalidateAfterShiftRemoval(client).then(() => {
      settled = true;
    });
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    expect(settled).toBe(false);
    refreshed.resolve(["fresh assignment"]);
    await invalidation;

    expect(client.getQueryData(assignmentKey)).toEqual(["fresh assignment"]);
    expect(client.getQueryState(shiftKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(planningKey)?.isInvalidated).toBe(true);
    unsubscribe();
    client.clear();
  });
});
