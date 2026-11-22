import { describe, expect, it } from "vitest";
import {
  checkVenues, increaseOptions, needsCustomAgreement, purchaseOptions, scheduledOptions,
  SELF_SERVE_MAX_VENUES, VENUES_AGREEMENT_MESSAGE,
} from "../../../web/src/billing/planOptions";
import { userErrorMessage } from "@/lib/errors";

describe("opzioni di fascia nella pagina Piano", () => {
  it("acquisto: nasconde le fasce più piccole dell'uso", () => {
    expect(purchaseOptions(0)).toEqual(["base", "team", "large"]);
    expect(purchaseOptions(15)).toEqual(["base", "team", "large"]);
    expect(purchaseOptions(16)).toEqual(["team", "large"]);
    expect(purchaseOptions(41)).toEqual(["large"]);
    expect(purchaseOptions(101)).toEqual([]);
  });
  it("aumento: solo le fasce con rango maggiore", () => {
    expect(increaseOptions("base")).toEqual(["team", "large"]);
    expect(increaseOptions("team")).toEqual(["large"]);
    expect(increaseOptions("large")).toEqual([]);
  });
  it("dal prossimo rinnovo: rango minore o uguale", () => {
    expect(scheduledOptions("base")).toEqual(["base"]);
    expect(scheduledOptions("team")).toEqual(["base", "team"]);
    expect(scheduledOptions("large")).toEqual(["base", "team", "large"]);
  });
  it("Grande con 98 persone o più chiede un accordo su misura", () => {
    expect(needsCustomAgreement("large", 97)).toBe(false);
    expect(needsCustomAgreement("large", 98)).toBe(true);
    expect(needsCustomAgreement("team", 99)).toBe(false);
  });
  it("da sé fino a 5 sedi in tutto, oltre un accordo", () => {
    expect(SELF_SERVE_MAX_VENUES).toBe(5);
    expect(checkVenues("1", 1)).toBe("ok");
    expect(checkVenues("5", 2)).toBe("ok");
    expect(checkVenues("6", 2)).toBe("agreement");
    expect(checkVenues("1", 2)).toBe("too_few");
    expect(checkVenues("", 1)).toBe("too_few");
    expect(checkVenues("2.5", 1)).toBe("too_few");
    // Chi ha già più di 5 sedi aperte (una concessione) non le compra da sé.
    expect(checkVenues("6", 6)).toBe("agreement");
    expect(VENUES_AGREEMENT_MESSAGE).toBe("Oltre 5 sedi serve un accordo su misura: scrivi a info@klokshift.com");
  });
  it("il server dice la stessa frase", () => {
    expect(userErrorMessage(new Error("billing_venues_need_agreement"))).toBe(VENUES_AGREEMENT_MESSAGE);
  });
});
