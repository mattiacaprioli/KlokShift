import { describe, expect, it } from "vitest";
import {
  clockMethodChoice,
  clockMethodLabel,
  effectiveClockMethod,
} from "../../../src/features/clock/methods";

describe("effectiveClockMethod", () => {
  it("eredita il metodo della sede senza una scelta personale", () => {
    expect(effectiveClockMethod(null, "app")).toBe("app");
    expect(effectiveClockMethod(null, "manual")).toBe("manual");
  });

  it("dà precedenza alla scelta della persona", () => {
    expect(effectiveClockMethod("manual", "app")).toBe("manual");
    expect(effectiveClockMethod("app", "manual")).toBe("app");
  });
});

describe("clockMethodChoice", () => {
  it("traduce null nella scelta che eredita dalla sede", () => {
    expect(clockMethodChoice(null)).toBe("inherit");
  });

  it("mantiene i metodi disponibili nella prima milestone", () => {
    expect(clockMethodChoice("manual")).toBe("manual");
    expect(clockMethodChoice("app")).toBe("app");
  });
});

describe("clockMethodLabel", () => {
  it("ha un'etichetta per ogni metodo persistibile", () => {
    expect(clockMethodLabel("manual")).toBe("Manuale");
    expect(clockMethodLabel("app")).toBe("App");
    expect(clockMethodLabel("qr")).toBe("QR");
    expect(clockMethodLabel("geolocation")).toBe("Posizione");
  });
});
