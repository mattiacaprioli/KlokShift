import { describe, expect, it } from "vitest";

import { qk } from "@/lib/queryKeys";
import { createTestQueryClient } from "../helpers/async";

describe("cache sedi per ambito", () => {
  it("ambiti diversi hanno chiavi diverse: A non è A+B", () => {
    expect(qk.venues.mineByIds(["A"])).not.toEqual(qk.venues.mineByIds(["B", "A"]));
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
