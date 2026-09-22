import { describe, expect, it } from "vitest";

import {
  createSecureStoreAdapter,
  type SecureKeyValueStore,
} from "@/lib/secureStoreAdapter";

class MemoryStore implements SecureKeyValueStore {
  readonly values = new Map<string, string>();
  failSetKey: string | null = null;

  async getItemAsync(key: string) {
    return this.values.get(key) ?? null;
  }

  async setItemAsync(key: string, value: string) {
    if (key === this.failSetKey) throw new Error("storage pieno");
    this.values.set(key, value);
  }

  async deleteItemAsync(key: string) {
    this.values.delete(key);
  }
}

function setup(chunkSizeBytes = 8) {
  const store = new MemoryStore();
  let generation = 0;
  const adapter = createSecureStoreAdapter(store, {
    chunkSizeBytes,
    createGeneration: () => `g${++generation}`,
  });
  return { adapter, store };
}

describe("SecureStoreAdapter", () => {
  it("conserva il roundtrip piccolo → grande → piccolo", async () => {
    const { adapter } = setup();

    await adapter.setItem("session", "piccola");
    await expect(adapter.getItem("session")).resolves.toBe("piccola");

    const large = "sessione-molto-più-grande";
    await adapter.setItem("session", large);
    await expect(adapter.getItem("session")).resolves.toBe(large);

    await adapter.setItem("session", "nuova");
    await expect(adapter.getItem("session")).resolves.toBe("nuova");
  });

  it("sostituisce una generazione grande con un numero diverso di parti", async () => {
    const { adapter, store } = setup(5);

    await adapter.setItem("session", "abcdefghijklmnop");
    await adapter.setItem("session", "abcdefghijk");

    await expect(adapter.getItem("session")).resolves.toBe("abcdefghijk");
    expect([...store.values.keys()].some((key) => key.includes("__v2_g1_"))).toBe(
      false
    );
  });

  it("mantiene leggibile la generazione precedente se una parte fallisce", async () => {
    const { adapter, store } = setup(5);
    await adapter.setItem("session", "valore-precedente");

    store.failSetKey = "session__v2_g2_1";
    await expect(adapter.setItem("session", "valore-nuovo-lungo")).rejects.toThrow(
      "storage pieno"
    );
    await expect(adapter.getItem("session")).resolves.toBe("valore-precedente");
  });

  it("legge i formati legacy diretto e a parti", async () => {
    const { adapter, store } = setup();
    store.values.set("direct", "sessione-legacy");
    store.values.set("chunked__chunks", "2");
    store.values.set("chunked__chunk_0", "sessione-");
    store.values.set("chunked__chunk_1", "legacy");

    await expect(adapter.getItem("direct")).resolves.toBe("sessione-legacy");
    await expect(adapter.getItem("chunked")).resolves.toBe("sessione-legacy");
  });

  it("ripiega sul valore legacy se una generazione pubblicata è incompleta", async () => {
    const { adapter, store } = setup();
    store.values.set("session", "sessione-legacy");
    store.values.set(
      "session__v2_manifest",
      JSON.stringify({ version: 2, generation: "broken", count: 2 })
    );
    store.values.set("session__v2_broken_0", "incompleta");

    await expect(adapter.getItem("session")).resolves.toBe("sessione-legacy");
  });

  it("rimuove manifest, parti correnti e rappresentazioni legacy", async () => {
    const { adapter, store } = setup(5);
    await adapter.setItem("session", "valore-grande");
    // Simula residui del formato precedente ancora presenti sul dispositivo.
    store.values.set("session", "legacy");
    store.values.set("session__chunks", "2");
    store.values.set("session__chunk_0", "leg");
    store.values.set("session__chunk_1", "acy");

    await adapter.removeItem("session");

    await expect(adapter.getItem("session")).resolves.toBeNull();
    expect([...store.values.keys()].filter((key) => key.startsWith("session"))).toEqual(
      []
    );
  });

  it("divide per byte UTF-8 senza spezzare caratteri non ASCII", async () => {
    const { adapter, store } = setup(5);
    const value = "é🙂漢字";

    await adapter.setItem("session", value);

    await expect(adapter.getItem("session")).resolves.toBe(value);
    const parts = [...store.values.entries()].filter(([key]) =>
      key.startsWith("session__v2_g1_")
    );
    expect(parts.length).toBeGreaterThan(1);
    for (const [, part] of parts) {
      expect(new TextEncoder().encode(part).byteLength).toBeLessThanOrEqual(5);
    }
  });

  it("rifiuta conteggi corrotti senza iterare chiavi arbitrarie", async () => {
    const { adapter, store } = setup();
    store.values.set("session__chunks", "999999");

    await expect(adapter.getItem("session")).resolves.toBeNull();
  });
});
