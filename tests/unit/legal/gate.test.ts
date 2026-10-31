import { describe, expect, it } from "vitest";

import { legalGate, resolveLegalGate, type PendingLegal } from "@/features/legal/gate";

const owner: PendingLegal = { workspaceId: "w1", workspaceName: "Bar Centrale", canAccept: true };
const collaborator: PendingLegal = { workspaceId: "w2", workspaceName: "Hotel Lago", canAccept: false };

describe("legalGate", () => {
  it("non blocca chi non ha aziende da accettare", () => {
    expect(legalGate([], "w1")).toEqual({ blocked: false, toAccept: [], waiting: [] });
  });

  it("il titolare dell'azienda in uso la può accettare", () => {
    expect(legalGate([owner, collaborator], "w1")).toEqual({
      blocked: true,
      toAccept: [owner],
      waiting: [],
    });
  });

  it("blocca anche chi deve solo aspettare", () => {
    expect(legalGate([collaborator], "w2").blocked).toBe(true);
  });
});

describe("legalGate sull'azienda in uso", () => {
  it("blocca solo per l'azienda che la vista di gestione sta mostrando", () => {
    expect(legalGate([owner, collaborator], "w2")).toEqual({
      blocked: true,
      toAccept: [],
      waiting: [collaborator],
    });
    expect(legalGate([collaborator], "w1").blocked).toBe(false);
  });

  it("senza un'azienda in uso non blocca", () => {
    expect(legalGate([owner], undefined).blocked).toBe(false);
  });
});

describe("resolveLegalGate", () => {
  it("con un dato già letto decide su quello anche se il refetch è fallito", () => {
    expect(resolveLegalGate({ data: [], isError: true }, "w1")).toEqual({
      status: "ready",
      gate: { blocked: false, toAccept: [], waiting: [] },
    });
  });

  it("senza dato aspetta o mostra l'errore, senza sbloccare", () => {
    expect(resolveLegalGate({ data: undefined, isError: false }, "w1")).toEqual({ status: "loading" });
    expect(resolveLegalGate({ data: undefined, isError: true }, "w1")).toEqual({ status: "error" });
  });
});
