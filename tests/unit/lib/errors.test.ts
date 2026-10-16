import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, userErrorMessage } from "../../../src/lib/errors";

describe("userErrorMessage", () => {
  it("traduce il blocco dei turni nati da una timbratura (C06)", () => {
    const message = userErrorMessage(new Error("unplanned_shift_locked"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/annulla la timbratura/);
  });

  it("dice tutte le regole dell'uscita, non solo la prima (C12)", () => {
    const message = userErrorMessage(new Error("invalid_clock_interval"));
    expect(message).toMatch(/dopo l'entrata/);
    expect(message).toMatch(/non nel futuro/);
    expect(message).toMatch(/24 ore/);
  });

  it("dice perché la prova non parte per un'azienda non nuova (C18)", () => {
    const message = userErrorMessage(new Error("trial_not_eligible"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/solo per le nuove aziende/);
  });

  it("dice che l'uscita c'è già, nei casi concorrenti (C13)", () => {
    const message = userErrorMessage(new Error("clock_already_closed"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/già stata registrata/);
  });
});
