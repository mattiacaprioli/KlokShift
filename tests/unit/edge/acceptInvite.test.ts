import { describe, expect, it, vi } from "vitest";
import { edgeRuntime, post } from "./runtime";

function fixture() {
  const invite = { email: "persona@example.test", display_name: " Ada\r\nRossi ", workspace_name: "Azienda" };
  const rpc = vi.fn().mockImplementation(async (name) => name === "peek_invite" ?
    { data: [invite], error: null } : { data: null, error: null });
  const createUser = vi.fn().mockResolvedValue({ data: { user: { id: "new-user" } }, error: null });
  const edge = edgeRuntime("accept-invite", {
    "npm:@supabase/supabase-js@2": { createClient: () => ({ rpc, auth: { admin: { createUser } } }) },
  });
  const request = (input: Record<string, unknown> = {}) => edge.handle(post({
    op: "accept", token: "fixture-token-secret", password: "Password1", fullName: "Ada Rossi", ...input,
  }));
  return { ...edge, rpc, createUser, invite, request };
}

describe("accept-invite: input ed esito", () => {
  it.each([
    ["Aa1" + "a".repeat(69), true],
    ["Aa1" + "a".repeat(70), false],
    ["Aa1" + "é".repeat(34) + "a", true],
    ["Aa1" + "é".repeat(35), false],
  ])("la password %s rispetta il limite in byte: %s", async (password, valid) => {
    const f = fixture();
    const response = await f.request({ password });
    expect(response.status).toBe(valid ? 200 : 400);
    expect(f.createUser).toHaveBeenCalledTimes(valid ? 1 : 0);
    if (!valid) expect(await response.json()).toEqual({ error: "weak_password" });
  });

  it("normalizza e tronca il nome a 100 caratteri senza spezzare Unicode", async () => {
    const f = fixture();
    await f.request({ fullName: `  Ada\r\nRossi\x7f ${"🙂".repeat(120)} ` });
    const name = f.createUser.mock.calls[0][0].user_metadata.full_name;
    expect(name).not.toMatch(/[\u0000-\u001f\u007f]/);
    expect(Array.from(name)).toHaveLength(100);
    expect(name).toBe(Array.from(`Ada Rossi  ${"🙂".repeat(120)}`).slice(0, 100).join(""));
  });

  it("normalizza anche il nome della scheda usato come ripiego", async () => {
    const f = fixture();
    await f.request({ fullName: " \r\n " });
    expect(f.createUser.mock.calls[0][0].user_metadata.full_name).toBe("Ada Rossi");
  });

  it("un errore di creazione non ritorna dettagli del provider", async () => {
    const f = fixture();
    f.createUser.mockResolvedValue({ data: null, error: { code: "unexpected_failure", message: "private provider detail" } });
    const response = await f.request();
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "create_failed" });
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["peek_invite"]);
    expect(f.log).toHaveBeenCalled();
  });

  it("consume_invite fallito lascia ok con activationPending e registra solo il codice", async () => {
    const f = fixture();
    f.rpc.mockImplementation(async (name, args) => name === "peek_invite" ?
      { data: [f.invite], error: null } : { data: null, error: {
        code: "P0001", message: `failed with ${args.p_hash} fixture-token-secret`,
      } });
    const response = await f.request();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, email: f.invite.email, activationPending: true });
    expect(f.log).toHaveBeenCalledWith("consume_invite_failed", "P0001");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain("fixture-token-secret");
    expect(JSON.stringify(f.log.mock.calls)).not.toContain(f.rpc.mock.calls[1][1].p_hash);
  });

  it("una failure di rete nel consume non perde l'account già creato", async () => {
    const f = fixture();
    f.rpc.mockImplementation(async (name, args) => {
      if (name === "peek_invite") return { data: [f.invite], error: null };
      throw new Error(`Failed to fetch with ${args.p_hash} fixture-token-secret`);
    });
    const response = await f.request();
    expect(await response.json()).toEqual({ ok: true, email: f.invite.email, activationPending: true });
    const logged = JSON.stringify(f.log.mock.calls);
    expect(logged).not.toContain("fixture-token-secret");
    expect(logged).not.toContain(f.rpc.mock.calls[1][1].p_hash);
  });

  it("consume riuscito mantiene la risposta del client", async () => {
    const f = fixture();
    const response = await f.request();
    expect(await response.json()).toEqual({ ok: true, email: f.invite.email });
    expect(f.rpc).toHaveBeenLastCalledWith("consume_invite", {
      p_hash: expect.any(String), p_user: "new-user",
    });
    expect(f.log).not.toHaveBeenCalled();
  });

  it("email già registrata conserva il codice gestito dalla pagina", async () => {
    const f = fixture();
    f.createUser.mockResolvedValue({ data: null, error: { message: "User already registered" } });
    const response = await f.request();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "email_taken" });
  });
});
