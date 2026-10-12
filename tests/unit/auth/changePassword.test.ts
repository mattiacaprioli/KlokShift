import { describe, expect, it, vi } from "vitest";
import {
  authErrorMessage,
  runChangePassword,
  type ChangePasswordAuth,
} from "@/features/auth/changePassword";

type Failure = { message: string; code?: string };

/** Un client auth finto: ogni passo risponde come GoTrue, o lancia. */
function fakeAuth(options: {
  signIn?: Failure;
  update?: Failure;
  signOut?: Failure | "throws";
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
  const auth = { signInWithPassword, updateUser, signOut } as unknown as ChangePasswordAuth;
  return { auth, signInWithPassword, updateUser, signOut };
}

const run = (auth: ChangePasswordAuth) =>
  runChangePassword(auth, "ow@t.test", "Vecchia123", "Nuova1234");

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
