import { MutationObserver, QueryClient, QueryObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useSetAssignmentPresence } from "@/features/assignments/hooks";
import {
  useApproveClockRecords,
  useCorrectClockRecord,
  useVoidClockRecord,
} from "@/features/clock/hooks";
import { workEventQueryKeys } from "@/features/shifts/invalidation";
import { qk } from "@/lib/queryKeys";
import { createTestQueryClient } from "../helpers/async";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  client: null as QueryClient | null,
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: mocks.rpc } }));
// Importato dagli hook delle assegnazioni ma non usato da quelli provati qui;
// trascinerebbe React Native nel runner.
vi.mock("@/features/venues/OwnerVenues", () => ({ useOwnerVenues: () => ({}) }));

// Gli hook veri, senza React: `useMutation` restituisce le sue opzioni, che il
// test fa girare in un MutationObserver sulla cache del test.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQueryClient: () => mocks.client,
    useMutation: (options: unknown) => options,
  };
});

const workspace = "workspace";
const hoursKey = qk.staff.ownerHours(workspace, "2026-10");
const summaryKey = qk.absences.summary(workspace, "2026-10");
const creditsKey = qk.absences.credits("absence");
const personKey = qk.assignments.personWorked("person", 6);
const consuntivo = [hoursKey, summaryKey, creditsKey, personKey];

function seed() {
  const client = createTestQueryClient();
  for (const key of consuntivo) client.setQueryData(key, "cache");
  mocks.client = client;
  return client;
}

function invalidated(client: QueryClient) {
  return consuntivo.map((key) => client.getQueryState(key)?.isInvalidated ?? false);
}

async function run<TVars>(client: QueryClient, options: unknown, vars: TVars) {
  const observer = new MutationObserver(client, options as never);
  await observer.mutate(vars as never).catch(() => undefined);
}

describe("ore e crediti di assenza convergono (B04)", () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
  });

  it.each([
    ["ore rettificate", { worked_hours: 5 }],
    ["ore tolte", { worked_hours: null }],
    ["persona mancata", { status: "no_show" as const }],
  ])("la presenza (%s) rilegge ore e crediti dello stesso consuntivo", async (_label, fields) => {
    const client = seed();
    let credit = 8;
    let hours = 0;
    const creditQuery = vi.fn(async () => credit);
    const hoursQuery = vi.fn(async () => hours);
    const credits = new QueryObserver(client, { queryKey: creditsKey, queryFn: creditQuery });
    const summary = new QueryObserver(client, { queryKey: hoursKey, queryFn: hoursQuery });
    const stop = [credits.subscribe(() => undefined), summary.subscribe(() => undefined)];
    await vi.waitFor(() => {
      expect(credits.getCurrentResult().data).toBe(8);
      expect(summary.getCurrentResult().data).toBe(0);
    });

    // Il server ora vede lavoro in quel giorno: il credito va in conflitto.
    credit = 0;
    hours = 5;
    await run(client, useSetAssignmentPresence("shift"), { id: "assignment", ...fields });

    expect(mocks.rpc).toHaveBeenCalledWith("record_attendance", expect.anything());
    await vi.waitFor(() => {
      expect(credits.getCurrentResult().data).toBe(0);
      expect(summary.getCurrentResult().data).toBe(5);
    });
    // Le due osservate sono già state rilette; le altre restano da rileggere.
    expect(client.getQueryState(summaryKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(personKey)?.isInvalidated).toBe(true);
    for (const unsubscribe of stop) unsubscribe();
    client.clear();
  });

  it("una presenza rifiutata dal server lascia la cache com'è", async () => {
    const client = seed();
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "not_allowed" } });
    await run(client, useSetAssignmentPresence("shift"), { id: "assignment", worked_hours: 5 });
    expect(invalidated(client)).toEqual([false, false, false, false]);
    client.clear();
  });

  it("l'approvazione multiple riuscita a metà aggiorna comunque ore e crediti", async () => {
    const client = seed();
    mocks.rpc
      .mockResolvedValueOnce({ data: {}, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "clock_out_required" } });
    await run(client, useApproveClockRecords(), ["approved", "refused"]);
    expect(mocks.rpc).toHaveBeenCalledTimes(2);
    expect(invalidated(client)).toEqual([true, true, true, true]);
    client.clear();
  });

  it("correzione e annullamento della timbratura aggiornano ore e crediti", async () => {
    for (const [useHook, vars] of [
      [useCorrectClockRecord, { recordId: "r", inAt: "a", outAt: "b", reason: "x" }],
      [useVoidClockRecord, { assignmentId: "assignment", reason: "x" }],
    ] as const) {
      const client = seed();
      await run(client, useHook(), vars);
      expect(invalidated(client)).toEqual([true, true, true, true]);
      client.clear();
    }
  });

  it.each([
    ["presenza o timbratura con turno", { id: "row", shift_id: "shift" }],
    ["cancellazione (solo id)", { id: "row" }],
  ])("l'evento realtime (%s) aggiorna ore e crediti", (_label, row) => {
    const client = seed();
    for (const queryKey of workEventQueryKeys(row)) {
      client.invalidateQueries({ queryKey });
    }
    expect(invalidated(client)).toEqual([true, true, true, true]);
    client.clear();
  });
});
