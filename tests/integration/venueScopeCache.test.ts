import { describe, expect, it } from "vitest";

import { qk } from "@/lib/queryKeys";
import { controlledPromise, createTestQueryClient } from "../helpers/async";

describe("cache sedi per ambito", () => {
  it("usa una cache nuova quando il contesto passa da A ad A+B", async () => {
    const client = createTestQueryClient();
    const expanded = controlledPromise<string[]>();
    const keyA = qk.venues.mineByIds(["A"]);
    const keyAB = qk.venues.mineByIds(["B", "A"]);

    await client.fetchQuery({ queryKey: keyA, queryFn: async () => ["A"] });
    const resultAB = client.fetchQuery({
      queryKey: keyAB,
      queryFn: () => expanded.promise,
    });

    expect(client.getQueryData(keyA)).toEqual(["A"]);
    expect(client.getQueryData(keyAB)).toBeUndefined();
    expanded.resolve(["A", "B"]);
    await expect(resultAB).resolves.toEqual(["A", "B"]);
    client.clear();
  });

  it("canonicalizza ordine e duplicati degli id", () => {
    expect(qk.venues.mineByIds(["B", "A", "A"])).toEqual(
      qk.venues.mineByIds(["A", "B"])
    );
  });

  it("separa chiusura ultima sede, riapertura e riduzione ambito", async () => {
    const client = createTestQueryClient();
    const keyAB = qk.venues.mineByIds(["A", "B"]);
    const keyB = qk.venues.mineByIds(["B"]);
    const keyEmpty = qk.venues.mineByIds([]);

    client.setQueryData(keyAB, ["A", "B"]);
    client.setQueryData(keyB, ["B"]);
    client.setQueryData(keyEmpty, []);

    expect(client.getQueryData(keyB)).toEqual(["B"]);
    expect(client.getQueryData(keyEmpty)).toEqual([]);
    expect(client.getQueryData(keyEmpty)).not.toBe(client.getQueryData(keyAB));

    await client.invalidateQueries({ queryKey: qk.venues.mine });
    expect(client.getQueryState(keyAB)?.isInvalidated).toBe(true);
    await expect(
      client.fetchQuery({
        queryKey: qk.venues.mineByIds(["A"]),
        queryFn: async () => ["A-riaperta"],
      })
    ).resolves.toEqual(["A-riaperta"]);

    client.clear();
    expect(client.getQueryData(keyAB)).toBeUndefined();
  });

  it("mantiene mine come prefisso per le invalidazioni esistenti", () => {
    expect(qk.venues.mineByIds(["A"]).slice(0, 2)).toEqual(qk.venues.mine);
  });
});
