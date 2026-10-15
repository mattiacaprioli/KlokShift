import { describe, expect, it } from "vitest";
import { confirmationFailure } from "../../web/src/admin/confirmation";
import { userErrorMessage } from "@/lib/errors";

describe("Conferme del fondatore: recupero dopo un errore", () => {
  it.each(["admin_stale_revision", "admin_operation_conflict"])(
    "%s richiede un riepilogo nuovo invece di ripetere il comando",
    (message) => {
      const failure = confirmationFailure(new Error(message));
      expect(failure.retry).toBe(false);
      expect(userErrorMessage(failure.error)).toBe("Aggiorna e prepara una nuova conferma.");
    }
  );
  it.each(["Failed to fetch", "Network request failed", "Load failed", "network error"])(
    "%s permette di ripetere lo stesso comando idempotente",
    (message) => {
      const error = new Error(message);
      expect(confirmationFailure(error)).toEqual({ retry: true, error });
    }
  );
  it.each(["admin_not_allowed", "invalid_access_capacity", "admin_response_invalid"])(
    "%s non offre un retry della conferma",
    (message) => expect(confirmationFailure(new Error(message)).retry).toBe(false)
  );
});
