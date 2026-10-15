import { expect, it, vi } from "vitest";
import { edgeRuntime, post } from "./runtime";

it("push nasconde l'errore interno della query dei token", async () => {
  const error = { code: "XX000", message: "private database detail" };
  const query = { select: () => ({ eq: async () => ({ data: null, error }) }) };
  class Expo {}
  const edge = edgeRuntime("push", {
    "npm:@supabase/supabase-js@2": { createClient: () => ({ from: vi.fn(() => query) }) },
    "npm:expo-server-sdk": { Expo },
  });
  const response = await edge.handle(post({ user_id: "user" }, { "x-push-secret": "fixture-push-secret" }));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "push_tokens_failed" });
  expect(edge.log).toHaveBeenCalled();
});
