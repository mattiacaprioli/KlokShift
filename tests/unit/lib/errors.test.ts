import { describe, expect, it } from "vitest";
import { GENERIC_ERROR, userErrorMessage } from "../../../src/lib/errors";

describe("userErrorMessage", () => {
  it("a termini cambiati dice di aggiornare, non di riprovare (accettazione)", () => {
    const message = userErrorMessage(new Error("legal_version_outdated"));
    expect(message).toMatch(/aggiorna l'app/i);
  });

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

  it("dice cosa fare quando la sede ha già troppi modelli di turno", () => {
    const message = userErrorMessage(new Error("template_limit"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/Eliminane uno/);
  });

  it("dice di pubblicare prima una bozza, e che il turno è già pubblicato", () => {
    expect(userErrorMessage(new Error("shift_draft"))).toBe(
      "Questo turno è una bozza: pubblicalo prima, o se è già finito registralo come fatto."
    );
    expect(userErrorMessage(new Error("shift_not_draft"))).toBe(
      "Il turno è già pubblicato."
    );
  });

  it("dice che l'uscita c'è già, nei casi concorrenti (C13)", () => {
    const message = userErrorMessage(new Error("clock_already_closed"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/già stata registrata/);
  });

  it("distingue il limite di persone del piano programmato da quello attuale", () => {
    const message = userErrorMessage(new Error("workspace_people_capacity_scheduled"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/piano più piccolo dal prossimo rinnovo/);
    expect(message).not.toBe(userErrorMessage(new Error("workspace_people_capacity")));
  });

  it("distingue il limite di sedi del piano programmato da quello attuale", () => {
    const message = userErrorMessage(new Error("workspace_venue_capacity_scheduled"));
    expect(message).not.toBe(GENERIC_ERROR);
    expect(message).toMatch(/meno sedi dal prossimo rinnovo/);
    expect(message).not.toBe(userErrorMessage(new Error("workspace_venue_capacity")));
  });

  it("dice perché un cambio programmato non si ritenta (area fondatore)", () => {
    expect(userErrorMessage(new Error("scheduled_change_not_retryable"))).toMatch(/non si può più ritentare/);
    expect(userErrorMessage(new Error("billing_change_pending"))).toMatch(/già un altro cambio aperto/);
  });
});
