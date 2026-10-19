import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BillingAdjustments } from "../../web/src/admin/BillingAdjustments";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: read, useAdminWrite: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));
vi.mock("@/features/admin/billing", () => ({ listBillingAdjustments: vi.fn(), resolveBillingAdjustment: vi.fn() }));

const at = "2026-10-19T17:30:02+00:00";
const base = {
  environment: "sandbox", adjustment_id: "adj_01x", workspace_id: "11111111-1111-4111-8111-111111111111",
  workspace_name: "Hotel Tesoro", subscription_id: "sub_01x", subscription_status: "active",
  transaction_id: "txn_01x", transaction_origin: "subscription_recurring", action: "refund",
  adjustment_type: "partial", status: "approved", total_cents: 9638, currency: "EUR",
  covered_starts_at: at, covered_ends_at: at, effect: "access_cut", access_cut_at: at,
  created_at: at, last_event_at: at, reviewed_at: null, review_note: null, attention: "cancel_on_paddle",
};
function render(items: unknown[], workspaceId?: string) {
  read.mockReturnValue({ isPending: false, isFetching: false, isError: false,
    data: { generated_at: at, open_total: items.filter((i) => (i as { attention: unknown }).attention).length,
      total: items.length, limit: 25, offset: 0, items } });
  return renderToStaticMarkup(createElement(MemoryRouter, null,
    createElement(BillingAdjustments, { userId: "founder", workspaceId })));
}

describe("Pagamenti da verificare (area fondatore)", () => {
  beforeEach(() => read.mockReset());
  it("rimborso totale con abbonamento aperto: chiede la disdetta su Paddle e una nota", () => {
    const html = render([base]);
    expect(html).toContain("Pagamenti da verificare");
    expect(html).toContain("1 da verificare");
    expect(html).toContain("Hotel Tesoro");
    expect(html).toContain("Rimborso 96,38");
    expect(html).toContain("Disdicilo");
    expect(html).toContain("Segna come verificato");
  });
  it("voce già verificata: mostra la nota, nessun modulo", () => {
    const html = render([{ ...base, attention: null, reviewed_at: at, review_note: "Disdetto a mano" }], base.workspace_id);
    expect(html).toContain("Rimborsi e contestazioni");
    expect(html).toContain("Disdetto a mano");
    expect(html).not.toContain("Segna come verificato");
    expect(html).not.toContain("Hotel Tesoro</a>");
  });
  it("niente da verificare", () => {
    expect(render([])).toContain("Niente da verificare");
  });
});
