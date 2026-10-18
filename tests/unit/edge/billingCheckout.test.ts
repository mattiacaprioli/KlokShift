import { describe, expect, it, vi } from "vitest";

import { paddleConfig, parsePrepared, parseSelection, prepareError } from "../../../supabase/functions/billing-checkout/logic";
import { edgeRuntime, post } from "./runtime";

const WORKSPACE = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "22222222-2222-4222-8222-222222222222";
const selection = { workspaceId: WORKSPACE, plan: "team", interval: "year", extraVenues: 1 };
const prepared = {
  checkout_id: CHECKOUT,
  items: [{ price_id: "pri_01team", quantity: 1 }, { price_id: "pri_01extra", quantity: 1 }],
};

describe("billing-checkout: regole pure", () => {
  it("accetta solo una scelta completa", () => {
    expect(parseSelection(selection)).toEqual(selection);
    for (const bad of [
      { ...selection, plan: "pro" }, { ...selection, interval: "week" }, { ...selection, extraVenues: -1 },
      { ...selection, extraVenues: 1.5 }, { ...selection, workspaceId: "non-un-uuid" }, null, [],
    ]) expect(parseSelection(bad)).toBeNull();
  });

  it("non mescola chiavi di prova e chiavi vere", () => {
    expect(paddleConfig({ environment: "sandbox", apiKey: "pdl_sdbx_apikey_x", clientToken: "test_x" })?.apiBase)
      .toBe("https://sandbox-api.paddle.com");
    expect(paddleConfig({ environment: "live", apiKey: "pdl_live_apikey_x", clientToken: "live_x" })?.apiBase)
      .toBe("https://api.paddle.com");
    expect(paddleConfig({ environment: "sandbox", apiKey: "pdl_live_apikey_x", clientToken: "test_x" })).toBeNull();
    expect(paddleConfig({ environment: "live", apiKey: "pdl_live_apikey_x", clientToken: "test_x" })).toBeNull();
    expect(paddleConfig({ environment: "production", apiKey: "pdl_live_apikey_x", clientToken: "live_x" })).toBeNull();
  });

  it("traduce i rifiuti del database in stati HTTP", () => {
    expect(prepareError("billing_subscription_exists")).toEqual({ status: 409, code: "billing_subscription_exists" });
    expect(prepareError("not_allowed")).toEqual({ status: 403, code: "not_allowed" });
    expect(prepareError("qualcosa di interno")).toEqual({ status: 500, code: "prepare_failed" });
  });

  it("rifiuta una risposta di preparazione incompleta", () => {
    expect(parsePrepared(prepared)?.checkoutId).toBe(CHECKOUT);
    expect(parsePrepared({ ...prepared, items: [] })).toBeNull();
    expect(parsePrepared({ ...prepared, items: [{ price_id: "x", quantity: 1 }] })).toBeNull();
  });
});

function checkout(options: {
  user?: { id: string; email: string } | null;
  prepare?: { data: unknown; error: unknown };
  paddle?: { ok: boolean; status: number; body: unknown } | "offline";
  env?: Record<string, string | undefined>;
} = {}) {
  const rpc = vi.fn(async (name: string) => name === "billing_prepare_checkout"
    ? options.prepare ?? { data: prepared, error: null }
    : { data: null, error: null });
  const getUser = vi.fn().mockResolvedValue(options.user === null
    ? { data: { user: null }, error: { message: "invalid" } }
    : { data: { user: options.user ?? { id: "user-1", email: "titolare@example.test" } }, error: null });
  const fetch = vi.fn(async () => {
    if (options.paddle === "offline") throw new TypeError("network");
    const paddle = options.paddle ?? { ok: true, status: 201, body: { data: { id: "txn_01abc" } } };
    return { ok: paddle.ok, status: paddle.status, json: async () => paddle.body } as Response;
  });
  const edge = edgeRuntime("billing-checkout", {
    "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ rpc, auth: { getUser } }) },
  }, options.env ?? {}, { fetch });
  const request = (body: unknown = selection) => edge.handle(post(body, { Authorization: "Bearer token" }));
  return { ...edge, rpc, fetch, request };
}

describe("billing-checkout", () => {
  it("prepara, crea la transazione su Paddle e restituisce i dati del checkout", async () => {
    const edge = checkout();
    const response = await edge.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      transactionId: "txn_01abc", environment: "sandbox", clientToken: "test_fixturetoken",
      email: "titolare@example.test",
    });
    expect(edge.rpc).toHaveBeenCalledWith("billing_prepare_checkout", {
      p_environment: "sandbox", p_user: "user-1", p_workspace: WORKSPACE,
      p_plan: "team", p_interval: "year", p_extra_venues: 1,
    });
    const [url, init] = edge.fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox-api.paddle.com/transactions");
    expect(JSON.parse(init.body as string)).toEqual({
      items: prepared.items, collection_mode: "automatic", custom_data: { klokshift_checkout: CHECKOUT },
    });
    expect(edge.rpc).toHaveBeenCalledWith("billing_attach_checkout_transaction", {
      p_checkout: CHECKOUT, p_transaction_id: "txn_01abc",
    });
  });

  it("l'utente viene dal token, non dal corpo", async () => {
    const edge = checkout();
    await edge.request({ ...selection, userId: "altro-utente" });
    expect(edge.rpc).toHaveBeenCalledWith("billing_prepare_checkout", expect.objectContaining({ p_user: "user-1" }));
  });

  it("senza sessione valida non prepara nulla", async () => {
    const edge = checkout({ user: null });
    expect((await edge.request()).status).toBe(401);
    expect(edge.rpc).not.toHaveBeenCalled();
  });

  it("un rifiuto del database arriva al client col suo codice", async () => {
    const edge = checkout({ prepare: { data: null, error: { message: "billing_subscription_exists", code: "23514" } } });
    const response = await edge.request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "billing_subscription_exists" });
    expect(edge.fetch).not.toHaveBeenCalled();
  });

  it("Paddle che rifiuta o non risponde: 502 senza dettagli", async () => {
    for (const paddle of [{ ok: false, status: 400, body: { error: { detail: "dato riservato" } } }, "offline"] as const) {
      const edge = checkout({ paddle });
      const response = await edge.request();
      expect(response.status).toBe(502);
      expect(JSON.stringify(await response.json())).not.toContain("dato riservato");
    }
  });

  it("chiave live con ambiente di prova: non parte nessun addebito", async () => {
    const edge = checkout({ env: { PADDLE_API_KEY: "pdl_live_apikey_x" } });
    expect((await edge.request()).status).toBe(503);
    expect(edge.fetch).not.toHaveBeenCalled();
  });

  it("scelta non valida: 400 prima di toccare il database", async () => {
    const edge = checkout();
    expect((await edge.request({ ...selection, plan: "pro" })).status).toBe(400);
    expect(edge.rpc).not.toHaveBeenCalled();
  });
});
