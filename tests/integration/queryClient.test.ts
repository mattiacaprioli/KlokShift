import { describe, expect, it, vi } from "vitest";

import {
  controlledPromise,
  createTestQueryClient,
} from "../helpers/async";

describe("utility asincrone dei test", () => {
  it("permette di risolvere B prima di A con cache isolate", async () => {
    const client = createTestQueryClient();
    const a = controlledPromise<string>();
    const b = controlledPromise<string>();

    const resultA = client.fetchQuery({
      queryKey: ["request", "a"],
      queryFn: () => a.promise,
    });
    const resultB = client.fetchQuery({
      queryKey: ["request", "b"],
      queryFn: () => b.promise,
    });

    b.resolve("B");
    await expect(resultB).resolves.toBe("B");
    a.resolve("A");
    await expect(resultA).resolves.toBe("A");
    expect(client.getQueryData(["request", "a"])).toBe("A");
    expect(client.getQueryData(["request", "b"])).toBe("B");

    client.clear();
  });

  it("disabilita i retry per rendere deterministiche le regressioni", async () => {
    const client = createTestQueryClient();
    const queryFn = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(
      client.fetchQuery({ queryKey: ["failure"], queryFn })
    ).rejects.toThrow("offline");
    expect(queryFn).toHaveBeenCalledTimes(1);

    client.clear();
  });
});
