import { describe, expect, it } from "vitest";

import { summarizeCompanyAbsences } from "@/features/absences/labels";
import { missingCertificatesWarning } from "@/features/absences/summary";

type Row = Parameters<typeof summarizeCompanyAbsences>[0][number];
const row = (over: Partial<Row>): Row => ({
  kind: "ferie", status: "approved", start_date: "2026-10-01", end_date: "2026-10-01", ...over,
});

describe("Riepilogo delle assenze (pagina Assenze, web)", () => {
  it("conta solo le approvate: ferie e malattia in giorni, permessi in numero", () => {
    const s = summarizeCompanyAbsences([
      row({ kind: "ferie", start_date: "2026-10-01", end_date: "2026-10-04" }),
      row({ kind: "ferie", status: "pending", start_date: "2026-10-10", end_date: "2026-10-12" }),
      row({ kind: "permesso" }),
      row({ kind: "permesso", status: "rejected" }),
      row({ kind: "malattia", start_date: "2026-10-05", end_date: "2026-10-06" }),
    ], "2026-10-22");
    expect(s).toMatchObject({ ferieDays: 4, permessi: 1, malattiaDays: 2 });
  });

  it("assenti oggi, estremi compresi", () => {
    const today = "2026-10-22";
    const s = summarizeCompanyAbsences([
      row({ kind: "ferie", start_date: "2026-10-20", end_date: "2026-10-22" }),
      row({ kind: "malattia", start_date: "2026-10-22", end_date: "2026-10-23" }),
      row({ kind: "ferie", start_date: "2026-10-23", end_date: "2026-10-24" }),
      row({ kind: "ferie", status: "pending", start_date: "2026-10-22", end_date: "2026-10-22" }),
    ], today);
    expect(s.absentToday).toHaveLength(2);
  });
});

describe("Avviso dei certificati mancanti (pagina Ore, app e web)", () => {
  it("tace se non manca niente", () => {
    expect(missingCertificatesWarning([])).toBeNull();
    expect(missingCertificatesWarning([{ missing_certificates: 0 }])).toBeNull();
  });

  it("somma le persone e accorda singolare e plurale", () => {
    expect(missingCertificatesWarning([{ missing_certificates: 1 }])).toMatch(/^1 malattia senza certificato/);
    expect(
      missingCertificatesWarning([{ missing_certificates: 1 }, { missing_certificates: 2 }])
    ).toMatch(/^3 malattie senza certificato/);
  });
});
