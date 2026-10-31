import { describe, expect, it } from "vitest";

import { LEGAL_COPY, legalBody, legalWaiting } from "@/features/legal/copy";

describe("testi dell'accettazione", () => {
  it("la casella dice cosa si accetta e per conto di chi", () => {
    expect(LEGAL_COPY.checkbox).toContain("accordo sul trattamento dei dati");
    expect(LEGAL_COPY.checkbox).toContain("per conto dell'azienda");
  });

  it("al titolare dice che basta la sua accettazione", () => {
    expect(legalBody("Bar Centrale")).toContain("Bar Centrale");
    expect(legalBody("Bar Centrale")).toContain("Basta quella di un titolare");
  });

  it("al collaboratore dice che il team continua a lavorare", () => {
    expect(legalWaiting("Hotel Lago")).toContain("Hotel Lago");
    expect(legalWaiting("Hotel Lago")).toContain("i turni e le timbrature del team continuano");
  });

  it("dal blocco si può sempre uscire o eliminare l'account", () => {
    expect(LEGAL_COPY.signOut).toBe("Esci");
    expect(LEGAL_COPY.deleteAccount).toContain("account");
  });
});
