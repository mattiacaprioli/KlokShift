import { describe, expect, it } from "vitest";
import { accountChanged, classifyAuthEvent } from "@/lib/authEvents";

const A = "user-a";
const B = "user-b";

describe("classifyAuthEvent", () => {
  it("cambio di persona: svuota la cache e ricarica il profilo con lo spinner", () => {
    expect(
      classifyAuthEvent({ event: "SIGNED_IN", previousUserId: A, nextUserId: B, hadInitialSession: true })
    ).toEqual({ clearCache: true, loadProfile: true, silent: false });
  });

  it("logout: svuota la cache", () => {
    expect(
      classifyAuthEvent({ event: "SIGNED_OUT", previousUserId: A, nextUserId: null, hadInitialSession: true })
    ).toEqual({ clearCache: true, loadProfile: true, silent: false });
  });

  it("la stessa persona che si riautentica (verifica della password attuale): rilettura silenziosa", () => {
    expect(
      classifyAuthEvent({ event: "SIGNED_IN", previousUserId: A, nextUserId: A, hadInitialSession: true })
    ).toEqual({ clearCache: false, loadProfile: true, silent: true });
  });

  it("cambio password della stessa persona: rilettura silenziosa", () => {
    expect(
      classifyAuthEvent({ event: "USER_UPDATED", previousUserId: A, nextUserId: A, hadInitialSession: true })
    ).toEqual({ clearCache: false, loadProfile: true, silent: true });
  });

  it.each(["TOKEN_REFRESHED", "MFA_CHALLENGE_VERIFIED"] as const)(
    "%s della stessa persona a bootstrap concluso: solo il token",
    (event) => {
      expect(
        classifyAuthEvent({ event, previousUserId: A, nextUserId: A, hadInitialSession: true })
      ).toEqual({ clearCache: false, loadProfile: false, silent: false });
    }
  );

  it("un TOKEN_REFRESHED come primo evento vale come sessione iniziale", () => {
    expect(
      classifyAuthEvent({ event: "TOKEN_REFRESHED", previousUserId: null, nextUserId: A, hadInitialSession: false })
    ).toEqual({ clearCache: false, loadProfile: true, silent: false });
  });

  it("la sessione iniziale non svuota una cache che non c'è ancora", () => {
    expect(
      classifyAuthEvent({ event: "INITIAL_SESSION", previousUserId: null, nextUserId: A, hadInitialSession: false })
    ).toEqual({ clearCache: false, loadProfile: true, silent: false });
  });
});

describe("accountChanged", () => {
  it("vale solo dopo la prima sessione osservata", () => {
    expect(accountChanged(false, null, A)).toBe(false);
    expect(accountChanged(true, null, A)).toBe(true);
    expect(accountChanged(true, A, A)).toBe(false);
    expect(accountChanged(true, A, null)).toBe(true);
  });
});
