import { describe, expect, it } from "vitest";
import {
  EXPIRING_SOON_DAYS,
  documentStatus,
  documentStatusLabel,
} from "@/features/documents/status";

const today = "2026-09-24";

describe("stato di un documento", () => {
  it("senza scadenza, scaduto, in scadenza, valido", () => {
    expect(documentStatus(null, today)).toBe("none");
    expect(documentStatus("2026-09-23", today)).toBe("expired");
    // Scade oggi: è ancora valido oggi, quindi «in scadenza».
    expect(documentStatus("2026-09-24", today)).toBe("expiring");
    expect(documentStatus("2026-10-24", today)).toBe("expiring");
    expect(documentStatus("2026-10-25", today)).toBe("valid");
  });

  it("la soglia è di 30 giorni", () => {
    expect(EXPIRING_SOON_DAYS).toBe(30);
  });

  it("l'etichetta dice la data, al passato solo se scaduto", () => {
    expect(documentStatusLabel(null, today)).toBe("Senza scadenza");
    expect(documentStatusLabel("2026-09-23", today)).toMatch(/^Scaduto il /);
    expect(documentStatusLabel("2026-12-01", today)).toMatch(/^Scade il /);
  });
});
