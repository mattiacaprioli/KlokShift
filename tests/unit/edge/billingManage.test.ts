import { describe, expect, it, vi } from "vitest";

import {
  buildItems, dbError, lifecycleRequest, paddleConfig, parseRequest, portalLinks, previewSummary, type PreparedChange,
} from "../../../supabase/functions/billing-manage/logic";
import { edgeRuntime, post } from "./runtime";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const known: PreparedChange["knownPrices"] = {
  pri_01base: "base", pri_01team: "team", pri_01extra: "extra_venue", pri_01extraold: "extra_venue",
};
const change = (over: Partial<PreparedChange> = {}): PreparedChange => ({
  subscriptionId: "sub_01x", plan: "team", planPriceId: "pri_01team", extraVenues: 1,
  extraPriceId: "pri_01extra", knownPrices: known, ...over,
});
const item = (id: string, quantity = 1) => ({ price: { id }, quantity, status: "active", recurring: true });

describe("billing-manage: regole pure", () => {
  it("accetta azioni note; il cambio richiede piano e sedi", () => {
    expect(parseRequest({ action: "portal", workspaceId: WORKSPACE })).toEqual({ action: "portal", workspaceId: WORKSPACE });
    expect(parseRequest({ action: "apply_change", workspaceId: WORKSPACE, plan: "team", extraVenues: 1 }))
      .toEqual({ action: "apply_change", workspaceId: WORKSPACE, plan: "team", extraVenues: 1 });
    for (const bad of [
      { action: "delete", workspaceId: WORKSPACE }, { action: "portal", workspaceId: "x" },
      { action: "apply_change", workspaceId: WORKSPACE, plan: "pro", extraVenues: 0 },
      { action: "preview_change", workspaceId: WORKSPACE, plan: "team" },
    ]) expect(parseRequest(bad)).toBeNull();
  });

  it("aumento di piano: nuovo prezzo del piano, sede aggiunta col prezzo proposto", () => {
    expect(buildItems([item("pri_01base")], change()))
      .toEqual([{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extra", quantity: 1 }]);
  });

  it("gli articoli invariati tengono il loro prezzo, anche se il listino è cambiato", () => {
    expect(buildItems([item("pri_01team"), item("pri_01extraold", 1)], change({ extraVenues: 3 })))
      .toEqual([{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extraold", quantity: 3 }]);
  });

  it("si ferma se gli articoli attuali non si riconoscono", () => {
    expect(buildItems([item("pri_01estraneo")], change())).toBeNull();
    expect(buildItems([item("pri_01base"), item("pri_01team")], change())).toBeNull();
    expect(buildItems([], change())).toBeNull();
    expect(buildItems(null, change())).toBeNull();
  });

  it("legge gli importi dell'anteprima in centesimi", () => {
    expect(previewSummary({ data: { currency_code: "EUR",
      immediate_transaction: { details: { totals: { grand_total: "1645", total: "1645" } } },
      recurring_transaction_details: { totals: { total: "7686" } } } }))
      .toEqual({ currency: "EUR", dueNowCents: 1645, renewalCents: 7686 });
    expect(previewSummary({ data: { currency_code: "EUR" } })).toBeNull();
  });

  it("prende i link del portale solo se sono https", () => {
    const data = { data: { urls: { general: { overview: "https://customer-portal.paddle.com/x" },
      subscriptions: [{ id: "sub_01x", update_subscription_payment_method: "https://pm", cancel_subscription: "javascript:alert(1)" }] } } };
    expect(portalLinks(data, "sub_01x")).toEqual({ overview: "https://customer-portal.paddle.com/x", paymentMethod: "https://pm", cancel: null });
    expect(portalLinks({ data: { urls: { general: { overview: "http://x" } } } }, "sub_01x")).toBeNull();
  });

  it("pausa a fine periodo, ripartenza subito con periodo nuovo", () => {
    expect(parseRequest({ action: "pause", workspaceId: WORKSPACE })).toEqual({ action: "pause", workspaceId: WORKSPACE });
    expect(lifecycleRequest("pause", "sub_01x"))
      .toEqual({ path: "/subscriptions/sub_01x/pause", body: { effective_from: "next_billing_period" } });
    expect(lifecycleRequest("resume", "sub_01x")).toEqual({ path: "/subscriptions/sub_01x/resume",
      body: { effective_from: "immediately", on_resume: "start_new_billing_period" } });
    expect(dbError("billing_not_paused")).toEqual({ status: 409, code: "billing_not_paused" });
    expect(lifecycleRequest("cancel", "sub_01x"))
      .toEqual({ path: "/subscriptions/sub_01x/cancel", body: { effective_from: "next_billing_period" } });
  });

  it("traduce i rifiuti del database", () => {
    expect(dbError("billing_downgrade_unsupported")).toEqual({ status: 409, code: "billing_downgrade_unsupported" });
    expect(dbError("billing_no_subscription")).toEqual({ status: 404, code: "billing_no_subscription" });
    expect(dbError("dettaglio interno")).toEqual({ status: 500, code: "manage_failed" });
    expect(paddleConfig({ environment: "sandbox", apiKey: "pdl_live_apikey_x" })).toBeNull();
  });
});

function manage(options: {
  rpc?: Record<string, { data: unknown; error: unknown }>;
  paddle?: (method: string, url: string, body: unknown) => { ok: boolean; status: number; body: unknown };
} = {}) {
  const rpcResults: Record<string, { data: unknown; error: unknown }> = {
    billing_manage_context: { data: { subscription_id: "sub_01x", customer_id: "ctm_01x", scheduled_change: "cancel" }, error: null },
    billing_prepare_lifecycle: { data: { subscription_id: "sub_01x" }, error: null },
    billing_prepare_change: { data: { subscription_id: "sub_01x", plan: "team", plan_price_id: "pri_01team",
      extra_venues: 1, extra_price_id: "pri_01extra", known_prices: known }, error: null },
    ...options.rpc,
  };
  const rpc = vi.fn(async (name: string) => rpcResults[name]);
  const getUser = vi.fn().mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });
  const fetch = vi.fn(async (url: string, init: RequestInit) => {
    const reply = options.paddle?.(init.method as string, url, init.body ? JSON.parse(init.body as string) : undefined) ??
      (url.endsWith("/portal-sessions")
        ? { ok: true, status: 201, body: { data: { urls: { general: { overview: "https://portal" },
            subscriptions: [{ id: "sub_01x", update_subscription_payment_method: "https://pm", cancel_subscription: "https://cancel" }] } } } }
        : init.method === "GET"
          ? { ok: true, status: 200, body: { data: { items: [item("pri_01base")] } } }
          : url.endsWith("/preview")
            ? { ok: true, status: 200, body: { data: { currency_code: "EUR",
                immediate_transaction: { details: { totals: { grand_total: "1645" } } },
                recurring_transaction_details: { totals: { total: "7686" } } } } }
            : { ok: true, status: 200, body: { data: {} } });
    return { ok: reply.ok, status: reply.status, json: async () => reply.body } as Response;
  });
  const edge = edgeRuntime("billing-manage", {
    "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ rpc, auth: { getUser } }) },
  }, {}, { fetch });
  const request = (body: unknown) => edge.handle(post(body, { Authorization: "Bearer token" }));
  return { ...edge, rpc, fetch, request };
}

describe("billing-manage", () => {
  it("portale: link freschi per il titolare, utente dal token", async () => {
    const edge = manage();
    const response = await edge.request({ action: "portal", workspaceId: WORKSPACE, userId: "altro" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ overview: "https://portal", paymentMethod: "https://pm", cancel: "https://cancel" });
    expect(edge.rpc).toHaveBeenCalledWith("billing_manage_context", { p_environment: "sandbox", p_user: "user-1", p_workspace: WORKSPACE });
    expect(edge.fetch.mock.calls[0][0]).toBe("https://sandbox-api.paddle.com/customers/ctm_01x/portal-sessions");
  });

  it("riprendi i rinnovi: toglie la disdetta programmata", async () => {
    const edge = manage();
    expect((await edge.request({ action: "resume_renewals", workspaceId: WORKSPACE })).status).toBe(200);
    const [url, init] = edge.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_01x");
    expect(JSON.parse(init.body as string)).toEqual({ scheduled_change: null });
  });

  it("riprendi senza nulla di programmato: 409 senza chiamare Paddle", async () => {
    const edge = manage({ rpc: { billing_manage_context: { data: { subscription_id: "sub_01x", customer_id: "ctm_01x", scheduled_change: null }, error: null } } });
    expect((await edge.request({ action: "resume_renewals", workspaceId: WORKSPACE })).status).toBe(409);
    expect(edge.fetch).not.toHaveBeenCalled();
  });

  it("anteprima: legge gli articoli da Paddle e restituisce gli importi", async () => {
    const edge = manage();
    const response = await edge.request({ action: "preview_change", workspaceId: WORKSPACE, plan: "team", extraVenues: 1 });
    expect(await response.json()).toEqual({ currency: "EUR", dueNowCents: 1645, renewalCents: 7686 });
    const [url, init] = edge.fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_01x/preview");
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extra", quantity: 1 }],
      proration_billing_mode: "prorated_immediately", on_payment_failure: "prevent_change",
    });
  });

  it("conferma: stesso corpo sull'abbonamento vero", async () => {
    const edge = manage();
    expect((await edge.request({ action: "apply_change", workspaceId: WORKSPACE, plan: "team", extraVenues: 1 })).status).toBe(200);
    expect(edge.fetch.mock.calls[1][0]).toBe("https://sandbox-api.paddle.com/subscriptions/sub_01x");
  });

  it("pausa: verifica nel database, poi Paddle a fine periodo", async () => {
    const edge = manage();
    expect((await edge.request({ action: "pause", workspaceId: WORKSPACE })).status).toBe(200);
    expect(edge.rpc).toHaveBeenCalledWith("billing_prepare_lifecycle",
      { p_environment: "sandbox", p_user: "user-1", p_workspace: WORKSPACE, p_action: "pause" });
    const [url, init] = edge.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_01x/pause");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ effective_from: "next_billing_period" });
  });

  it("ripartenza rifiutata dal database: Paddle non viene toccato", async () => {
    const edge = manage({ rpc: { billing_prepare_lifecycle: { data: null, error: { message: "billing_not_paused" } } } });
    const response = await edge.request({ action: "resume", workspaceId: WORKSPACE });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "billing_not_paused" });
    expect(edge.fetch).not.toHaveBeenCalled();
  });

  it("ripartenza con addebito rifiutato: errore chiaro", async () => {
    const edge = manage({ paddle: () => ({ ok: false, status: 400, body: { error: { code: "subscription_payment_declined" } } }) });
    expect((await edge.request({ action: "resume", workspaceId: WORKSPACE })).status).toBe(402);
  });

  it("riduzione rifiutata dal database: Paddle non viene toccato", async () => {
    const edge = manage({ rpc: { billing_prepare_change: { data: null, error: { message: "billing_downgrade_unsupported" } } } });
    const response = await edge.request({ action: "apply_change", workspaceId: WORKSPACE, plan: "base", extraVenues: 0 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "billing_downgrade_unsupported" });
    expect(edge.fetch).not.toHaveBeenCalled();
  });

  it("addebito della differenza rifiutato: errore chiaro, nessun dettaglio di Paddle", async () => {
    const edge = manage({ paddle: (method, url) => method === "GET"
      ? { ok: true, status: 200, body: { data: { items: [item("pri_01base")] } } }
      : { ok: false, status: 400, body: { error: { code: "subscription_payment_declined", detail: "carta 4242 rifiutata" } } } });
    const response = await edge.request({ action: "apply_change", workspaceId: WORKSPACE, plan: "team", extraVenues: 1 });
    expect(response.status).toBe(402);
    expect(JSON.stringify(await response.json())).not.toContain("4242");
  });
});
