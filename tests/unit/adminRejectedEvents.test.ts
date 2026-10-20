import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { RejectedEvents } from "../../web/src/admin/RejectedEvents";

const { read } = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/features/admin/hooks", () => ({
  useAdminRead: read, useAdminWrite: () => ({ isPending: false, error: null, mutate: vi.fn() }),
}));
vi.mock("@/features/admin/billing", () => ({ listRejectedBillingEvents: vi.fn(), resolveBillingEvent: vi.fn() }));

const at = "2026-10-18T12:02:09+00:00";
function render(items: unknown[]) {
  read.mockReturnValue({ isPending: false, isFetching: false, isError: false,
    data: { generated_at: at, open_total: items.length, total: items.length, limit: 25, offset: 0, items } });
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(RejectedEvents, { userId: "founder" })));
}

describe("Avvisi Paddle scartati (area fondatore)", () => {
  it("motivo in italiano, azienda e nota per chiudere", () => {
    const html = render([{ environment: "sandbox", event_id: "evt_01x", event_type: "subscription.created",
      error: "duplicate_subscription", occurred_at: at, received_at: at, paddle_id: "sub_01x",
      workspace_id: "11111111-1111-4111-8111-111111111111", workspace_name: "Hotel Tesoro", reviewed_at: null, review_note: null }]);
    expect(html).toContain("1 da verificare");
    expect(html).toContain("Hotel Tesoro");
    expect(html).toContain("Secondo abbonamento aperto per la stessa azienda");
    expect(html).toContain("Segna come verificato");
  });
  it("azienda sconosciuta e motivo non previsto", () => {
    const html = render([{ environment: "live", event_id: "evt_01y", event_type: "subscription.updated",
      error: "nuovo_codice", occurred_at: at, received_at: at, paddle_id: null, workspace_id: null, workspace_name: null,
      reviewed_at: null, review_note: null }]);
    expect(html).toContain("Azienda non riconosciuta");
    expect(html).toContain("Scartato (nuovo_codice).");
  });
  it("nessun avviso scartato", () => {
    expect(render([])).toContain("tutto quello che Paddle ha mandato è stato applicato");
  });
});
