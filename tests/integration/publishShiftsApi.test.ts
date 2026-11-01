import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  confirmMyAssignments,
  createInternalShifts,
  getMyAssignedUpcoming,
  getMyAssignmentsInRange,
  getMyDeclinedUpcoming,
  getOwnerTodayAssignments,
  getPublishPreview,
  publishShifts,
  recordDraftAsDone,
  type InternalShiftPlan,
} from "@/features/assignments/api";
import { getOwnerDrafts } from "@/features/shifts/api";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

/** Un query builder che registra le chiamate e si risolve come una promise. */
function builder(result: { data: unknown; error: unknown }) {
  const calls: [string, unknown[]][] = [];
  const proxy: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "then") {
          return (res: (v: unknown) => unknown) => res(result);
        }
        return (...args: unknown[]) => {
          calls.push([prop, args]);
          return proxy;
        };
      },
    }
  );
  return { proxy, calls };
}

const plan: InternalShiftPlan = {
  venue_id: "venue-1",
  title: "Sera",
  description: null,
  date: "2026-12-01",
  start_time: "18:00",
  end_time: "23:00",
  require_confirmation: true,
  break_minutes: 0,
  roleTargets: [],
  staff: [],
};

describe("createInternalShifts", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("manda draft: true in ogni piano quando si chiede una bozza", async () => {
    mocks.rpc.mockResolvedValue({ data: ["s1", "s2"], error: null });
    await createInternalShifts([plan, { ...plan, date: "2026-12-02" }], {
      draft: true,
    });
    const plans = mocks.rpc.mock.calls[0][1].p_plans as Record<string, unknown>[];
    expect(plans).toHaveLength(2);
    for (const p of plans) expect(p.draft).toBe(true);
  });

  it("senza opzione non manda la chiave: le app già installate restano com'erano", async () => {
    mocks.rpc.mockResolvedValue({ data: ["s1"], error: null });
    await createInternalShifts([plan]);
    const plans = mocks.rpc.mock.calls[0][1].p_plans as Record<string, unknown>[];
    expect("draft" in plans[0]).toBe(false);
  });
});

describe("RPC di pubblicazione", () => {
  beforeEach(() => mocks.rpc.mockReset());

  it("getPublishPreview passa sedi e periodo", async () => {
    const preview = {
      shift_ids: ["s1"],
      shifts: 1,
      people: 2,
      outside: 0,
      expired: 0,
    };
    mocks.rpc.mockResolvedValue({ data: preview, error: null });
    await expect(
      getPublishPreview(["v1", "v2"], "2026-12-01", "2026-12-31")
    ).resolves.toEqual(preview);
    expect(mocks.rpc).toHaveBeenCalledWith("get_publish_preview", {
      p_venues: ["v1", "v2"],
      p_from: "2026-12-01",
      p_to: "2026-12-31",
    });
  });

  it("publishShifts passa turni e scelta di avvisare", async () => {
    mocks.rpc.mockResolvedValue({
      data: { published: 2, notified: 3 },
      error: null,
    });
    await expect(publishShifts(["s1", "s2"], true)).resolves.toEqual({
      published: 2,
      notified: 3,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("publish_shifts", {
      p_shifts: ["s1", "s2"],
      p_notify: true,
    });
  });

  it("confirmMyAssignments passa le assegnazioni e ritorna il conteggio", async () => {
    mocks.rpc.mockResolvedValue({ data: 2, error: null });
    await expect(confirmMyAssignments(["a1", "a2"])).resolves.toBe(2);
    expect(mocks.rpc).toHaveBeenCalledWith("confirm_my_assignments", {
      p_assignments: ["a1", "a2"],
    });
  });

  it("recordDraftAsDone passa il turno", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await recordDraftAsDone("s1");
    expect(mocks.rpc).toHaveBeenCalledWith("record_draft_as_done", {
      p_shift: "s1",
    });
  });

  it("fanno risalire l'errore del database", async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "shift_not_draft" },
    });
    await expect(publishShifts(["s1"], false)).rejects.toThrow("shift_not_draft");
    await expect(recordDraftAsDone("s1")).rejects.toThrow("shift_not_draft");
    await expect(confirmMyAssignments(["a"])).rejects.toThrow("shift_not_draft");
    await expect(getPublishPreview(["v"], "a", "b")).rejects.toThrow(
      "shift_not_draft"
    );
  });
});

describe("le letture «mie» escludono le bozze", () => {
  beforeEach(() => mocks.from.mockReset());

  const filtered = (calls: [string, unknown[]][]) =>
    calls.some(
      ([m, a]) =>
        m === "not" &&
        a[0] === "shift.published_at" &&
        a[1] === "is" &&
        a[2] === null
    );

  it.each([
    ["getMyAssignedUpcoming", () => getMyAssignedUpcoming("u1")],
    ["getMyDeclinedUpcoming", () => getMyDeclinedUpcoming("u1")],
    [
      "getMyAssignmentsInRange",
      () => getMyAssignmentsInRange("u1", "2026-12-01", "2026-12-07"),
    ],
    ["getOwnerTodayAssignments", () => getOwnerTodayAssignments(["v1"])],
  ])("%s", async (_name, run) => {
    const b = builder({ data: [], error: null });
    mocks.from.mockReturnValue(b.proxy);
    await run();
    expect(filtered(b.calls)).toBe(true);
  });
});

describe("getOwnerDrafts", () => {
  beforeEach(() => mocks.from.mockReset());

  it("legge le bozze non annullate delle sedi indicate", async () => {
    const rows = [
      { id: "s1", venue_id: "v1", date: "2026-12-01", start_time: "18:00", end_time: "23:00" },
    ];
    const b = builder({ data: rows, error: null });
    mocks.from.mockReturnValue(b.proxy);
    await expect(getOwnerDrafts(["v1"])).resolves.toEqual(rows);
    expect(mocks.from).toHaveBeenCalledWith("shifts");
    expect(b.calls).toContainEqual(["is", ["published_at", null]]);
    expect(b.calls).toContainEqual(["neq", ["status", "cancelled"]]);
    expect(b.calls).toContainEqual(["in", ["venue_id", ["v1"]]]);
  });

  it("senza sedi non interroga il database", async () => {
    await expect(getOwnerDrafts([])).resolves.toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
