import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { operationResultSchema, operationsSchema, workspaceControlSchema } from "@/features/admin/controls";
import { WorkspaceActions } from "../../web/src/admin/WorkspaceActions";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: read,
  useAdminWrite: () => ({ isPending: false }),
}));

const W = "22222222-2222-4222-8222-222222222222";
const snapshot = {
  classification: "customer", migration_review_required: false, access: null,
  document_known_bytes: 0, document_unknown_sizes: 0, lifetime: null,
  founder_offer: null,
};
const control = {
  generated_at: "2026-11-22T10:00:00+00:00", target_id: W, revision: "a".repeat(32), snapshot,
  founder_seats: { taken: 3, total: 10 },
};

describe("posto fondatori nell'area del fondatore", () => {
  it("legge i posti presi e il posto dell'azienda", () => {
    const parsed = workspaceControlSchema.parse({ ...control, snapshot: { ...snapshot, founder_offer: {
      status: "reserved", source: "founder", reserved_at: "2026-11-22T10:30:00.123456+00:00",
      activated_at: null, ends_at: null, ended_at: null,
    } } });
    expect(parsed.founder_seats).toEqual({ taken: 3, total: 10 });
    expect(parsed.snapshot.founder_offer?.status).toBe("reserved");
  });

  it("la cronologia e l'esito accettano la riserva del posto", () => {
    const op = {
      operation_id: "11111111-1111-4111-8111-111111111111", actor_id: "55555555-5555-4555-8555-555555555555",
      action: "grant_founder_offer", reason: "Primo cliente",
      before_state: { classification: "customer", access: null, lifetime: null, founder_offer: null },
      after_state: { classification: "customer", access: null, lifetime: null,
        founder_offer: { status: "reserved", source: "founder" } },
      applied_at: "2026-11-22T10:00:00+00:00",
    };
    expect(operationsSchema.safeParse({
      items: [op], total: 1, limit: 25, offset: 0, generated_at: "2026-11-22T10:00:00+00:00",
      target_kind: "workspace", target_id: W,
    }).success).toBe(true);
    expect(operationResultSchema.safeParse({
      operation_id: op.operation_id, action: "grant_founder_offer", target_id: W,
      applied_at: op.applied_at, period_id: null,
    }).success).toBe(true);
  });

  it("propone «Riserva posto fondatori» e mostra i posti presi", () => {
    read.mockReturnValue({ isPending: false, isFetching: false, isSuccess: true, data: control });
    const html = renderToStaticMarkup(createElement(MemoryRouter, null,
      createElement(WorkspaceActions, { userId: "founder", workspaceId: W })));
    expect(html).toContain("Riserva posto fondatori");
    expect(html).toContain("3 di 10");
  });
});
