import { describe, expect, it, vi } from "vitest";
import { edgeRuntime, post } from "./runtime";

it("push nasconde l'errore interno della query dei token", async () => {
  const error = { code: "XX000", message: "private database detail" };
  const query = { select: () => ({ eq: async () => ({ data: null, error }) }) };
  class Expo {}
  const edge = edgeRuntime("push", {
    "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ from: vi.fn(() => query) }) },
    "npm:expo-server-sdk@7.2.0": { Expo },
  });
  const response = await edge.handle(post({ user_id: "user" }, { "x-push-secret": "fixture-push-secret" }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "push_tokens_failed" });
  expect(edge.log).toHaveBeenCalled();
});

type Message = { to: string; title: string; body: string; data: Record<string, unknown> };
type Ticket = { status: "ok"; id: string } | { status: "error"; message?: string; details?: { error: string } };

function deliveryFixture(tokens = ["ExpoPushToken[one]"]) {
  const tokenQuery = { select: () => ({ eq: async () => ({ data: tokens.map((token) => ({ token })), error: null }) }) };
  const cleanup = vi.fn().mockResolvedValue({ data: [], error: null });
  const inTokens = vi.fn(() => ({ select: cleanup }));
  const remove = vi.fn(() => ({ in: inTokens }));
  const send = vi.fn<(messages: Message[]) => Promise<Ticket[]>>().mockResolvedValue([]);
  class Expo {
    static isExpoPushToken(token: string) { return token.startsWith("ExpoPushToken["); }
    chunkPushNotifications(messages: Message[]) {
      return Array.from({ length: Math.ceil(messages.length / 2) }, (_, i) => messages.slice(i * 2, i * 2 + 2));
    }
    sendPushNotificationsAsync = send;
  }
  const edge = edgeRuntime("push", {
    "npm:@supabase/supabase-js@2.117.0": { createClient: () => ({ from: () => ({ ...tokenQuery, delete: remove }) }) },
    "npm:expo-server-sdk@7.2.0": { Expo },
  });
  const request = () => edge.handle(post({ user_id: "user", title: "Titolo riservato", body: "Testo riservato",
    notification_id: "notification", type: "shift_assigned", related_id: "shift",
  }, { "x-push-secret": "fixture-push-secret" }));
  return { ...edge, request, send, remove, inTokens, cleanup };
}

describe("push: esito effettivo dei ticket e pulizia token", () => {
  it("conta solo i ticket ok di tutti i chunk e registra gli errori senza dati personali", async () => {
    const tokens = ["ExpoPushToken[one]", "ExpoPushToken[dead]", "non valido", "ExpoPushToken[large]", "ExpoPushToken[two]"];
    const f = deliveryFixture(tokens);
    f.send.mockResolvedValueOnce([
      { status: "ok", id: "ticket-one" },
      { status: "error", message: `Recipient ${tokens[1]} rejected`, details: { error: "DeviceNotRegistered" } },
    ]).mockResolvedValueOnce([
      { status: "error", message: "Testo riservato", details: { error: "MessageTooBig" } },
      { status: "ok", id: "ticket-two" },
    ]);
    f.cleanup.mockResolvedValue({ data: [{ token: tokens[1] }], error: null });
    expect(await (await f.request()).json()).toEqual({ sent: 2, removed: 1 });
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.send.mock.calls.flatMap(([messages]) => messages.map((message) => message.to))).toEqual(tokens.filter((token) => token !== "non valido"));
    expect(f.inTokens).toHaveBeenCalledWith("token", [tokens[1]]);
    expect(f.log).toHaveBeenCalledWith("expo_push_ticket_failed", "DeviceNotRegistered");
    expect(f.log).toHaveBeenCalledWith("expo_push_ticket_failed", "MessageTooBig");
    expect(JSON.stringify(f.log.mock.calls)).not.toMatch(/ExpoPushToken|Testo riservato/);
  });

  it("un chunk fallito non conta come inviato e non ferma il chunk successivo", async () => {
    const f = deliveryFixture(["ExpoPushToken[one]", "ExpoPushToken[two]", "ExpoPushToken[three]"]);
    f.send.mockRejectedValueOnce(new Error("Network failed with ExpoPushToken[one]"))
      .mockResolvedValueOnce([{ status: "ok", id: "ticket-three" }]);
    expect(await (await f.request()).json()).toEqual({ sent: 1, removed: 0 });
    expect(f.send).toHaveBeenCalledTimes(2);
    expect(f.remove).not.toHaveBeenCalled();
    expect(f.log).toHaveBeenCalledWith("expo_push_send_failed");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("ExpoPushToken[one]");
  });

  it("una delete rifiutata viene registrata e non dichiara token rimossi", async () => {
    const f = deliveryFixture();
    f.send.mockResolvedValue([{ status: "error", details: { error: "DeviceNotRegistered" } }]);
    f.cleanup.mockResolvedValue({ data: null, error: { code: "XX000", message: "private database detail" } });
    expect(await (await f.request()).json()).toEqual({ sent: 0, removed: 0 });
    expect(f.log).toHaveBeenCalledWith("push_token_cleanup_failed", "XX000");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("private database detail");
  });

  it("la pulizia concorrente già completata non dichiara una seconda rimozione", async () => {
    const f = deliveryFixture();
    f.send.mockResolvedValue([{ status: "error", details: { error: "DeviceNotRegistered" } }]);
    expect(await (await f.request()).json()).toEqual({ sent: 0, removed: 0 });
    expect(f.cleanup).toHaveBeenCalledWith("token");
  });

  it("una failure di rete durante la pulizia conserva il conteggio degli invii riusciti", async () => {
    const f = deliveryFixture(["ExpoPushToken[one]", "ExpoPushToken[dead]"]);
    f.send.mockResolvedValue([{ status: "ok", id: "ticket-one" },
      { status: "error", details: { error: "DeviceNotRegistered" } }]);
    f.cleanup.mockRejectedValue(new Error("private network detail"));
    expect(await (await f.request()).json()).toEqual({ sent: 1, removed: 0 });
    expect(f.log).toHaveBeenCalledWith("push_token_cleanup_failed");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("private network detail");
  });

  it("senza token validi non contatta Expo né esegue la pulizia", async () => {
    const f = deliveryFixture(["non valido"]);
    expect(await (await f.request()).json()).toEqual({ sent: 0 });
    expect(f.send).not.toHaveBeenCalled();
    expect(f.remove).not.toHaveBeenCalled();
  });
});
