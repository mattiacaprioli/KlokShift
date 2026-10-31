import { describe, expect, it, vi } from "vitest";

import {
  buildItems, buildScheduledItems, dbError, lifecycleRequest, paddleConfig, parseRequest, portalLinks, previewSummary, type PreparedChange, type PreparedScheduledChange,
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

const scheduled = (over: Partial<PreparedScheduledChange> = {}): PreparedScheduledChange => ({
  ...change({ plan: "base", planPriceId: "pri_01base", extraVenues: 1 }),
  effectiveAt: "2026-11-20T10:00:00Z", currentInterval: "month", interval: "month", ...over,
});

describe("billing-manage: regole pure", () => {
  it("accetta i cambi programmati; rifiuta ciclo o sedi non validi", () => {
    for (const action of ["preview_scheduled_change", "schedule_change"] as const) {
      const expected = action === "schedule_change" ? { expectedRenewalCents: 3500 } : {};
      expect(parseRequest({ action, workspaceId: WORKSPACE, plan: "base", interval: "year", extraVenues: 0, ...expected }))
        .toEqual({ action, workspaceId: WORKSPACE, plan: "base", interval: "year", extraVenues: 0, ...expected });
      for (const bad of [{ interval: "week" }, { interval: undefined }, { extraVenues: -1 }, { plan: "pro" }]) {
        expect(parseRequest({ action, workspaceId: WORKSPACE, plan: "base", interval: "month", extraVenues: 0, ...expected, ...bad })).toBeNull();
      }
    }
    for (const bad of [undefined, -1, 1.5, "3500"]) {
      expect(parseRequest({ action: "schedule_change", workspaceId: WORKSPACE, plan: "base", interval: "month",
        extraVenues: 0, expectedRenewalCents: bad })).toBeNull();
    }
    expect(parseRequest({ action: "cancel_scheduled_change", workspaceId: WORKSPACE }))
      .toEqual({ action: "cancel_scheduled_change", workspaceId: WORKSPACE });
  });

  it("cambio programmato, stesso ciclo: tiene il prezzo sede invariato", () => {
    expect(buildScheduledItems([item("pri_01team"), item("pri_01extraold", 2)], scheduled()))
      .toEqual([{ price_id: "pri_01base", quantity: 1 }, { price_id: "pri_01extraold", quantity: 1 }]);
  });

  it("cambio programmato, ciclo diverso: tutti i prezzi d'arrivo", () => {
    expect(buildScheduledItems([item("pri_01team"), item("pri_01extraold", 2)],
      scheduled({ plan: "team", planPriceId: "pri_01team", interval: "year", extraVenues: 2, extraPriceId: "pri_01extra" })))
      .toEqual([{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extra", quantity: 2 }]);
  });

  it("cambio programmato: da 2 sedi in più a 0 resta solo il piano", () => {
    expect(buildScheduledItems([item("pri_01team"), item("pri_01extra", 2)], scheduled({ extraVenues: 0, extraPriceId: null })))
      .toEqual([{ price_id: "pri_01base", quantity: 1 }]);
  });

  it("cambio programmato: articolo sconosciuto, nessun articolo", () => {
    expect(buildScheduledItems([item("pri_01estraneo")], scheduled())).toBeNull();
    expect(buildScheduledItems([item("pri_01estraneo")], scheduled({ interval: "year" }))).toBeNull();
    expect(buildScheduledItems(null, scheduled())).toBeNull();
  });

  it("i rifiuti del cambio programmato sono 409", () => {
    for (const code of ["billing_change_pending", "billing_scheduled_not_reduction", "billing_too_close_to_renewal",
      "billing_scheduled_people", "billing_scheduled_venues", "billing_change_already_sent",
      "billing_nothing_scheduled"]) {
      expect(dbError(`ERROR: ${code}`)).toEqual({ status: 409, code });
    }
    // Il cambio di ciclo è automatico: il vecchio rifiuto non esiste più.
    expect(dbError("ERROR: billing_interval_change_unavailable")).toEqual({ status: 500, code: "manage_failed" });
  });

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
    billing_prepare_scheduled_change: { data: { subscription_id: "sub_01x", effective_at: "2026-11-20T10:00:00Z",
      current_plan: "team", current_interval: "month", plan: "base", billing_interval: "month", plan_price_id: "pri_01base",
      extra_venues: 1, extra_price_id: "pri_01extra", known_prices: known }, error: null },
    billing_record_scheduled_change: { data: "id-1", error: null },
    billing_cancel_scheduled_change: { data: null, error: null },
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

  const scheduledPaddle = (nextBilledAt: string, dueNow = "0") => (method: string, url: string) => method === "GET"
    ? { ok: true, status: 200, body: { data: { next_billed_at: nextBilledAt, items: [item("pri_01team"), item("pri_01extraold")] } } }
    : { ok: true, status: 200, body: { data: { currency_code: "EUR",
        immediate_transaction: { details: { totals: { grand_total: dueNow } } },
        recurring_transaction_details: { totals: { total: "3500" } } } } };
  const sel = { workspaceId: WORKSPACE, plan: "base", interval: "month", extraVenues: 1, expectedRenewalCents: 3500 };

  it("anteprima del cambio programmato: do_not_bill e importo del rinnovo", async () => {
    const edge = manage({ paddle: scheduledPaddle("2026-11-20T10:01:00Z") });
    const response = await edge.request({ action: "preview_scheduled_change", ...sel });
    expect(await response.json()).toEqual({ currency: "EUR", renewalCents: 3500, effectiveAt: "2026-11-20T10:00:00Z" });
    const [url, init] = edge.fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.paddle.com/subscriptions/sub_01x/preview");
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ price_id: "pri_01base", quantity: 1 }, { price_id: "pri_01extraold", quantity: 1 }],
      proration_billing_mode: "do_not_bill", on_payment_failure: "prevent_change",
    });
    expect(edge.rpc).not.toHaveBeenCalledWith("billing_record_scheduled_change", expect.anything());
  });

  it("programma il cambio: registra articoli attuali e d'arrivo", async () => {
    const edge = manage({ paddle: scheduledPaddle("2026-11-20T10:00:00Z") });
    const response = await edge.request({ action: "schedule_change", ...sel });
    expect(await response.json()).toEqual({ ok: true });
    expect(edge.rpc).toHaveBeenCalledWith("billing_record_scheduled_change", {
      p_environment: "sandbox", p_user: "user-1", p_workspace: WORKSPACE, p_plan: "base", p_interval: "month",
      p_extra_venues: 1,
      p_from_items: [{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extraold", quantity: 1 }],
      p_target_items: [{ price_id: "pri_01base", quantity: 1 }, { price_id: "pri_01extraold", quantity: 1 }],
      p_renewal_cents: 3500, p_currency: "EUR",
    });
  });

  it("rinnovo diverso da quello del database: billing_unavailable, niente registrazione", async () => {
    const edge = manage({ paddle: scheduledPaddle("2026-11-21T10:00:00Z") });
    const response = await edge.request({ action: "schedule_change", ...sel });
    expect(response.status).toBe(502);
    expect(edge.rpc).not.toHaveBeenCalledWith("billing_record_scheduled_change", expect.anything());
  });

  it("importo del rinnovo diverso da quello mostrato: 409, niente registrazione", async () => {
    const edge = manage({ paddle: scheduledPaddle("2026-11-20T10:00:00Z") });
    const response = await edge.request({ action: "schedule_change", ...sel, expectedRenewalCents: 3400 });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "billing_amount_changed" });
    expect(edge.rpc).not.toHaveBeenCalledWith("billing_record_scheduled_change", expect.anything());
  });

  it("anteprima con importo da pagare ora: billing_unavailable", async () => {
    const edge = manage({ paddle: scheduledPaddle("2026-11-20T10:00:00Z", "500") });
    expect((await edge.request({ action: "schedule_change", ...sel })).status).toBe(502);
  });

  it("annulla il cambio programmato: solo la RPC", async () => {
    const edge = manage();
    expect(await (await edge.request({ action: "cancel_scheduled_change", workspaceId: WORKSPACE })).json()).toEqual({ ok: true });
    expect(edge.rpc).toHaveBeenCalledWith("billing_cancel_scheduled_change",
      { p_environment: "sandbox", p_user: "user-1", p_workspace: WORKSPACE });
    expect(edge.fetch).not.toHaveBeenCalled();
  });

  it("cambio programmato rifiutato dal database: 409 senza Paddle", async () => {
    const edge = manage({ rpc: { billing_prepare_scheduled_change: { data: null, error: { message: "billing_scheduled_people" } } } });
    const response = await edge.request({ action: "schedule_change", ...sel });
    expect(response.status).toBe(409);
    expect(edge.fetch).not.toHaveBeenCalled();
  });
});
