import { describe, expect, it } from "vitest";

import { createAuthRequestGate } from "@/lib/authRequestGate";
import { controlledPromise } from "../helpers/async";

type State = {
  userId: string | null;
  profileId: string | null;
  loading: boolean;
  error: string | null;
};

function state(userId: string | null): State {
  return { userId, profileId: null, loading: true, error: null };
}

describe("coordinamento delle richieste auth", () => {
  it("ignora il profilo A quando B termina prima", async () => {
    const gate = createAuthRequestGate();
    const a = controlledPromise<string>();
    const b = controlledPromise<string>();
    let current = state("A");

    const ticketA = gate.begin("A");
    const resultA = a.promise.then((profileId) => {
      if (gate.isCurrent(ticketA)) current = { ...current, profileId, loading: false };
    });
    current = state("B");
    const ticketB = gate.begin("B");
    const resultB = b.promise.then((profileId) => {
      if (gate.isCurrent(ticketB)) current = { ...current, profileId, loading: false };
    });

    b.resolve("B");
    await resultB;
    a.resolve("A");
    await resultA;

    expect(current).toEqual({
      userId: "B",
      profileId: "B",
      loading: false,
      error: null,
    });
  });

  it("A tardivo non ripristina profilo, loading o errore dopo logout", async () => {
    const gate = createAuthRequestGate();
    const a = controlledPromise<string>();
    let current = state("A");
    const ticket = gate.begin("A");
    const result = a.promise.then((profileId) => {
      if (gate.isCurrent(ticket)) current = { ...current, profileId, loading: false };
    });

    gate.invalidate(null);
    current = { userId: null, profileId: null, loading: false, error: null };
    a.resolve("A");
    await result;

    expect(current).toEqual({
      userId: null,
      profileId: null,
      loading: false,
      error: null,
    });
  });

  it("un errore vecchio non sostituisce lo stato riuscito dell'account nuovo", async () => {
    const gate = createAuthRequestGate();
    const a = controlledPromise<string>();
    const b = controlledPromise<string>();
    let current = state("A");
    const ticketA = gate.begin("A");
    const resultA = a.promise.catch((cause: Error) => {
      if (gate.isCurrent(ticketA)) {
        current = { ...current, loading: false, error: cause.message };
      }
    });

    current = state("B");
    const ticketB = gate.begin("B");
    const resultB = b.promise.then((profileId) => {
      if (gate.isCurrent(ticketB)) current = { ...current, profileId, loading: false };
    });
    b.resolve("B");
    await resultB;
    a.reject(new Error("offline A"));
    await resultA;

    expect(current).toEqual({
      userId: "B",
      profileId: "B",
      loading: false,
      error: null,
    });
  });

  it("un refreshProfile tardivo non sopravvive al logout", async () => {
    const gate = createAuthRequestGate();
    const refresh = controlledPromise<string>();
    let current: State = {
      userId: "A",
      profileId: "A-old",
      loading: false,
      error: null,
    };
    const ticket = gate.begin("A");
    const result = refresh.promise.then((profileId) => {
      if (gate.isCurrent(ticket)) current = { ...current, profileId };
    });

    gate.invalidate(null);
    current = { userId: null, profileId: null, loading: false, error: null };
    refresh.resolve("A-new");
    await result;

    expect(current.profileId).toBeNull();
  });

  it("ignora getSession se nel frattempo è arrivato l'evento iniziale", async () => {
    const gate = createAuthRequestGate();
    const bootstrap = controlledPromise<string>();
    const initialEvent = controlledPromise<string>();
    const snapshot = gate.snapshot();
    let current = state(null);

    const bootstrapResult = bootstrap.promise.then((userId) => {
      if (gate.isSnapshotCurrent(snapshot)) current = state(userId);
    });
    const eventResult = initialEvent.promise.then((userId) => {
      gate.invalidate(userId);
      current = { userId, profileId: userId, loading: false, error: null };
    });

    initialEvent.resolve("B");
    await eventResult;
    bootstrap.resolve("A");
    await bootstrapResult;

    expect(current.userId).toBe("B");
    expect(current.profileId).toBe("B");
  });
});
