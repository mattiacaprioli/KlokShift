import { describe, expect, it, vi } from "vitest";
import {
  authErrorMessage,
  CODE_INVALID_MESSAGE,
  CODE_REQUIRED_MESSAGE,
  FACTORS_UNAVAILABLE_MESSAGE,
  hasVerifiedTotp,
  runChangePassword,
  type ChangePasswordAuth,
} from "@/features/auth/changePassword";

type Failure = { message: string; code?: string };

/** Un client auth finto: ogni passo risponde come GoTrue, o lancia. */
function fakeAuth(options: {
  signIn?: Failure;
  update?: Failure;
  signOut?: Failure | "throws";
  /** Un'app di autenticazione verificata sull'account. */
  totp?: boolean;
  factorsError?: Failure;
  verify?: Failure;
} = {}) {
  const signInWithPassword = vi.fn(async () => ({
    data: {},
    error: options.signIn ?? null,
  }));
  const updateUser = vi.fn(async () => ({ data: {}, error: options.update ?? null }));
  const signOut = vi.fn(async () => {
    if (options.signOut === "throws") throw new Error("Network request failed");
    return { error: options.signOut ?? null };
  });
  const factor = { id: "factor-1", factor_type: "totp", status: "verified" };
  const listFactors = vi.fn(async () =>
    options.factorsError
      ? { data: null, error: options.factorsError }
      : { data: { all: options.totp ? [factor] : [], totp: options.totp ? [factor] : [], phone: [] }, error: null }
  );
  const challengeAndVerify = vi.fn(async () => ({ data: {}, error: options.verify ?? null }));
  const auth = {
    signInWithPassword, updateUser, signOut, mfa: { listFactors, challengeAndVerify },
  } as unknown as ChangePasswordAuth;
  return { auth, signInWithPassword, updateUser, signOut, listFactors, challengeAndVerify };
}

const run = (auth: ChangePasswordAuth, code?: string) =>
  runChangePassword(auth, "ow@t.test", "Vecchia123", "Nuova1234", code);

describe("cambio password", () => {
  it("con la password attuale sbagliata non cambia niente", async () => {
    const f = fakeAuth({ signIn: { message: "Invalid login credentials", code: "invalid_credentials" } });
    expect(await run(f.auth)).toEqual({ error: "La password attuale non è corretta." });
    expect(f.updateUser).not.toHaveBeenCalled();
    expect(f.signOut).not.toHaveBeenCalled();
  });

  it("traduce il rifiuto di una password debole dal codice", async () => {
    const f = fakeAuth({ update: { message: "Password is known to be weak and easy to guess", code: "weak_password" } });
    expect(await run(f.auth)).toEqual({
      error: "Password troppo debole o già comparsa in una violazione: scegline un'altra.",
    });
    expect(f.signOut).not.toHaveBeenCalled();
  });

  it("se le altre sessioni non si chiudono lo dice, senza negare il cambio", async () => {
    const f = fakeAuth({ signOut: { message: "Internal Server Error" } });
    const result = await run(f.auth);
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/non siamo riusciti a disconnettere gli altri dispositivi/);
    expect(f.signOut).toHaveBeenCalledWith({ scope: "others" });
  });

  it("anche quando la disconnessione lancia un errore di rete", async () => {
    const f = fakeAuth({ signOut: "throws" });
    const result = await run(f.auth);
    expect(result.error).toBeNull();
    expect(result.warning).toMatch(/non siamo riusciti a disconnettere gli altri dispositivi/);
  });

  it("caso felice: nessun errore e nessun avviso", async () => {
    const f = fakeAuth();
    expect(await run(f.auth)).toEqual({ error: null });
    expect(f.signInWithPassword).toHaveBeenCalledWith({ email: "ow@t.test", password: "Vecchia123" });
    expect(f.updateUser).toHaveBeenCalledWith({ password: "Nuova1234" });
  });
});

describe("cambio password con il secondo fattore (D5)", () => {
  it("senza app di autenticazione non chiede codici", async () => {
    const f = fakeAuth();
    expect(await run(f.auth)).toEqual({ error: null });
    expect(f.challengeAndVerify).not.toHaveBeenCalled();
  });

  it("con l'app verificata e senza codice non cambia la password", async () => {
    const f = fakeAuth({ totp: true });
    expect(await run(f.auth)).toEqual({ error: CODE_REQUIRED_MESSAGE, codeRequired: true });
    expect(f.updateUser).not.toHaveBeenCalled();
    expect(f.signOut).not.toHaveBeenCalled();
  });

  it("un codice malformato non arriva nemmeno a GoTrue", async () => {
    const f = fakeAuth({ totp: true });
    expect(await run(f.auth, "12ab")).toEqual({ error: CODE_INVALID_MESSAGE, codeRequired: true });
    expect(f.challengeAndVerify).not.toHaveBeenCalled();
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("un codice rifiutato non cambia la password", async () => {
    const f = fakeAuth({ totp: true, verify: { message: "Invalid TOTP code entered", code: "mfa_verification_failed" } });
    expect(await run(f.auth, "123456")).toEqual({ error: CODE_INVALID_MESSAGE, codeRequired: true });
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("con il codice giusto verifica il fattore, poi cambia la password", async () => {
    const f = fakeAuth({ totp: true });
    expect(await run(f.auth, " 123 456 ")).toEqual({ error: null });
    expect(f.challengeAndVerify).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
    expect(f.challengeAndVerify.mock.invocationCallOrder[0])
      .toBeLessThan(f.updateUser.mock.invocationCallOrder[0]);
  });

  it("se i fattori non si leggono si ferma: il dato mancante non sblocca", async () => {
    const f = fakeAuth({ factorsError: { message: "Failed to fetch" } });
    expect(await run(f.auth)).toEqual({ error: FACTORS_UNAVAILABLE_MESSAGE });
    expect(f.updateUser).not.toHaveBeenCalled();
  });

  it("legge il secondo fattore dalla sessione solo se verificato", () => {
    expect(hasVerifiedTotp(null)).toBe(false);
    expect(hasVerifiedTotp({ factors: [] })).toBe(false);
    const factor = (status: "verified" | "unverified") =>
      ({ id: "f", factor_type: "totp", status, created_at: "", updated_at: "" }) as never;
    expect(hasVerifiedTotp({ factors: [factor("unverified")] })).toBe(false);
    expect(hasVerifiedTotp({ factors: [factor("verified")] })).toBe(true);
  });
});

describe("errori di GoTrue in italiano", () => {
  it("riconosce i codici prima del testo", () => {
    expect(authErrorMessage("New password should be different from the old password.", "same_password"))
      .toBe("La nuova password deve essere diversa dalla precedente.");
    expect(authErrorMessage("AAL2 session is required to update email or password", "insufficient_aal"))
      .toBe("Per cambiare password serve il codice di verifica. Esci, accedi di nuovo con il codice e riprova.");
    expect(authErrorMessage("Reauthentication required", "reauthentication_needed"))
      .toBe("Per cambiare password serve il codice di verifica. Esci, accedi di nuovo con il codice e riprova.");
  });

  it("la lunghezza minima è quella della policy: 8 caratteri", () => {
    expect(authErrorMessage("Password should be at least 8 characters."))
      .toBe("La password deve avere almeno 8 caratteri.");
  });

  it("senza codice resta il confronto sul testo", () => {
    expect(authErrorMessage("Invalid login credentials")).toBe("Email o password non corretti.");
    expect(authErrorMessage("qualcosa di nuovo")).toBe("Si è verificato un errore. Riprova.");
  });
});
