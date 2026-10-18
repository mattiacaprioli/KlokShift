import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { parseSignature, verifyPaddleSignature } from "../../../supabase/functions/paddle-webhook/logic";
import { edgeRuntime } from "./runtime";

const SECRET = "fixture-paddle-secret";
const sign = (ts: number, body: string, secret = SECRET) =>
  createHmac("sha256", secret).update(`${ts}:${body}`).digest("hex");

const event = {
  event_id: "evt_01test", event_type: "subscription.created",
  occurred_at: "2026-10-18T10:00:00.000Z", data: { id: "sub_01test" },
};

describe("firma Paddle", () => {
  const body = JSON.stringify(event);
  const now = 1_760_781_600;

  it("accetta la firma calcolata sul corpo grezzo", async () => {
    await expect(verifyPaddleSignature(body, `ts=${now};h1=${sign(now, body)}`, SECRET, now)).resolves.toBe(true);
  });

  it("accetta una delle firme durante la rotazione del segreto", async () => {
    const header = `ts=${now};h1=${sign(now, body, "vecchio")};h1=${sign(now, body)}`;
    await expect(verifyPaddleSignature(body, header, SECRET, now)).resolves.toBe(true);
  });

  it.each([
    ["corpo modificato", body.replace("sub_01test", "sub_01other"), `ts=${now};h1=${sign(now, body)}`, now],
    ["segreto sbagliato", body, `ts=${now};h1=${sign(now, body, "altro")}`, now],
    ["firma troppo vecchia", body, `ts=${now - 31};h1=${sign(now - 31, body)}`, now],
    ["firma dal futuro", body, `ts=${now + 31};h1=${sign(now + 31, body)}`, now],
    ["intestazione assente", body, null, now],
    ["senza h1", body, `ts=${now}`, now],
    ["h1 non esadecimale", body, `ts=${now};h1=${"z".repeat(64)}`, now],
    ["ts doppio", body, `ts=${now};ts=${now};h1=${sign(now, body)}`, now],
  ])("rifiuta: %s", async (_name, raw, header, at) => {
    await expect(verifyPaddleSignature(raw, header, SECRET, at)).resolves.toBe(false);
  });

  it("senza segreto non accetta nulla", async () => {
    await expect(verifyPaddleSignature(body, `ts=${now};h1=${sign(now, body, "")}`, "", now)).resolves.toBe(false);
  });

  it("legge ts e tutte le h1", () => {
    expect(parseSignature(`ts=12;h1=${"a".repeat(64)};h1=${"b".repeat(64)}`))
      .toEqual({ ts: 12, h1: ["a".repeat(64), "b".repeat(64)] });
    expect(parseSignature("garbage")).toBeNull();
  });
});

function signedRequest(payload: unknown, ts = Math.floor(Date.now() / 1000), secret = SECRET) {
  const raw = typeof payload === "string" ? payload : JSON.stringify(payload);
  return new Request("https://edge.example.test", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Paddle-Signature": `ts=${ts};h1=${sign(ts, raw, secret)}` },
    body: raw,
  });
}

function webhook(result: { data: unknown; error: unknown }, env: Record<string, string | undefined> = {}) {
  const rpc = vi.fn().mockResolvedValue(result);
  const edge = edgeRuntime("paddle-webhook", {
    "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ rpc }) },
  }, env);
  return { ...edge, rpc };
}

describe("paddle-webhook", () => {
  it("inoltra l'evento verificato con l'ambiente configurato", async () => {
    const edge = webhook({ data: { outcome: "applied" }, error: null });
    const response = await edge.handle(signedRequest(event));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ outcome: "applied" });
    expect(edge.rpc).toHaveBeenCalledWith("billing_apply_event", { p_environment: "sandbox", p_event: event });
  });

  it("firma non valida: 401 e nessuna chiamata al database", async () => {
    const edge = webhook({ data: { outcome: "applied" }, error: null });
    const response = await edge.handle(signedRequest(event, undefined, "altro"));
    expect(response.status).toBe(401);
    expect(edge.rpc).not.toHaveBeenCalled();
  });

  it("senza segreto configurato rifiuta tutto", async () => {
    const edge = webhook({ data: { outcome: "applied" }, error: null }, { PADDLE_WEBHOOK_SECRET: undefined });
    const response = await edge.handle(signedRequest(event));
    expect(response.status).toBe(500);
    expect(edge.rpc).not.toHaveBeenCalled();
  });

  it("un ambiente inventato non passa", async () => {
    const edge = webhook({ data: { outcome: "applied" }, error: null }, { PADDLE_ENVIRONMENT: "production" });
    expect((await edge.handle(signedRequest(event))).status).toBe(500);
    expect(edge.rpc).not.toHaveBeenCalled();
  });

  it("uno scarto risponde 200 (Paddle non ritenta) e resta nei log", async () => {
    const edge = webhook({ data: { outcome: "rejected", error: "unknown_price" }, error: null });
    const response = await edge.handle(signedRequest(event));
    expect(response.status).toBe(200);
    expect(edge.log).toHaveBeenCalledWith("paddle-webhook: evento scartato", "evt_01test", "unknown_price");
  });

  it("errore del database: 500 senza dettagli interni, così Paddle ritenta", async () => {
    const edge = webhook({ data: null, error: { code: "XX000", message: "private database detail" } });
    const response = await edge.handle(signedRequest(event));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("private database detail");
  });

  it("JSON firmato ma non valido: 400", async () => {
    const edge = webhook({ data: { outcome: "applied" }, error: null });
    expect((await edge.handle(signedRequest("{non json"))).status).toBe(400);
    expect(edge.rpc).not.toHaveBeenCalled();
  });

  it("solo POST", async () => {
    const edge = webhook({ data: { outcome: "applied" }, error: null });
    expect((await edge.handle(new Request("https://edge.example.test"))).status).toBe(405);
  });
});
