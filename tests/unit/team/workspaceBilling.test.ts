import { describe, expect, it } from "vitest";
import { hasOpenSubscription, parseWorkspaceBilling } from "@/features/workspace/billing";

const active = {
  status: "active", plan: "team", billing_interval: "month", extra_venues: 1,
  current_period_ends_at: "2026-11-18T10:00:00+00:00", scheduled_change: null,
  past_due_since: null, canceled_at: null, paused_at: null,
};
const pending = {
  plan: "base", billing_interval: "year", extra_venues: 0,
  effective_at: "2026-11-18T10:00:00+00:00", renewal_cents: 35380, currency: "EUR",
  status: "pending", cancel_until: "2026-11-17T10:00:00+00:00",
};

describe("riassunto dell'abbonamento", () => {
  it("nessun abbonamento mai avuto", () => {
    expect(parseWorkspaceBilling(null)).toBeNull();
    expect(hasOpenSubscription(null)).toBe(false);
  });

  it("legge un abbonamento attivo con disdetta programmata", () => {
    const billing = parseWorkspaceBilling({ ...active,
      scheduled_change: { action: "cancel", effective_at: "2026-11-18T10:00:00+00:00" } });
    expect(billing?.scheduled_change?.action).toBe("cancel");
    expect(hasOpenSubscription(billing)).toBe(true);
  });

  it("in pausa: aperto, con la data di inizio e senza fine periodo", () => {
    const billing = parseWorkspaceBilling({ ...active, status: "paused", current_period_ends_at: null,
      paused_at: "2026-11-18T10:00:00+00:00" });
    expect(billing?.paused_at).toBe("2026-11-18T10:00:00+00:00");
    expect(hasOpenSubscription(billing)).toBe(true);
  });

  it("una disdetta conclusa non blocca un nuovo acquisto", () => {
    const billing = parseWorkspaceBilling({ ...active, status: "canceled", current_period_ends_at: null,
      canceled_at: "2026-11-18T10:00:00+00:00" });
    expect(hasOpenSubscription(billing)).toBe(false);
  });

  it("senza cambio programmato al rinnovo: null", () => {
    expect(parseWorkspaceBilling({ ...active, pending_change: null })?.pending_change).toBeNull();
    expect(parseWorkspaceBilling(active)?.pending_change).toBeNull();
  });

  it("legge il cambio programmato al rinnovo", () => {
    const billing = parseWorkspaceBilling({ ...active, pending_change: pending });
    expect(billing?.pending_change).toEqual(pending);
  });

  it.each([
    ["stato sconosciuto", { ...active, status: "trialing" }],
    ["piano inventato", { ...active, plan: "pro" }],
    ["attivo senza fine periodo", { ...active, current_period_ends_at: null }],
    ["sedi negative", { ...active, extra_venues: -1 }],
    ["data non valida", { ...active, past_due_since: "ieri" }],
    ["azione sconosciuta", { ...active, scheduled_change: { action: "upgrade", effective_at: "2026-11-18T10:00:00Z" } }],
    ["cambio in uno stato non aperto", { ...active, pending_change: { ...pending, status: "confirmed" } }],
    ["cambio senza termine per annullare", { ...active, pending_change: { ...pending, cancel_until: null } }],
    ["cambio con importo negativo", { ...active, pending_change: { ...pending, renewal_cents: -1 } }],
    ["cambio con piano inventato", { ...active, pending_change: { ...pending, plan: "pro" } }],
    ["cambio con valuta non valida", { ...active, pending_change: { ...pending, currency: "euro" } }],
  ])("rifiuta: %s", (_name, payload) => {
    expect(() => parseWorkspaceBilling(payload)).toThrow("workspace_billing_invalid");
  });
});
