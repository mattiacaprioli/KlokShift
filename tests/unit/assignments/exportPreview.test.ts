import { describe, expect, it } from "vitest";
import type { HoursDailyRow } from "@/features/assignments/hoursDaily";
import type { SurchargeRow } from "@/features/assignments/surcharges";
import type { PersonHours } from "@/features/assignments/hoursSummary";
import type { AbsenceSummaryRow } from "@/features/absences/summary";
import type { ExportCodes } from "@/features/assignments/exportCodes";
import { buildDailyTable } from "@/lib/exportBuilders";
import {
  EXPORT_FORMATS,
  PREVIEW_ROWS,
  EXPORT_ISSUE_LINKS,
  buildExportPreview,
  issueLinks,
  moreRowsLabel,
  toFixInSelection,
  unavailableNote,
  type ExportFormat,
} from "@/features/assignments/exportPreview";

/*
 * L'anteprima del pannello «Esporta per il consulente»: totali, cosa resta
 * fuori o va controllato, prime righe del file. Le righe vengono dalla stessa
 * tabella del file, e gli avvisi riusano i testi di sempre.
 */

function row(extra: Partial<HoursDailyRow> = {}): HoursDailyRow {
  return {
    person_id: "p", person_name: "Anna", date: "2026-11-05", kind: "work",
    venue_name: "Centro", title: "Sala", clock_in: "09:00", clock_out: "17:00",
    break_minutes: 30, break_paid: false, hours: 7.5, note: null, ...extra,
  };
}

function person(extra: Partial<PersonHours> = {}): PersonHours {
  return {
    person_id: "p", person_name: "Anna", roles: "Sala", shifts_count: 2,
    hours: 15, planned_hours: 15, to_review_count: 0, proposed_hours: 0, untracked_hours: 0,
    paid_break_hours: 0, unpaid_break_hours: 0, venues: [], ...extra,
  };
}

function absence(extra: Partial<AbsenceSummaryRow> = {}): AbsenceSummaryRow {
  return {
    person_id: "p", person_name: "Anna", ferie_days: 1, permesso_days: 0,
    permesso_hours: 0, malattia_days: 2, ferie_hours: 8, malattia_hours: 16,
    permesso_recognized_hours: 0, conflict_hours: 0, inps_protocols: null, missing_certificates: 1, ...extra,
  };
}

// Un'azienda che usa codici e matricole, ma Anna («p») non ha la matricola.
const codes: ExportCodes = { codes: { company: "AZ" }, matricole: new Map([["x", "0001"]]) };
const surcharges: SurchargeRow[] = [
  {
    person_id: "p", person_name: "Anna", date: "2026-11-05", venue_name: "Centro", title: "Sala",
    clock_in: "09:00", clock_out: "17:00", kind: "night", percentage: 20, hours: 1.5,
  },
];

// 8 righe di lavoro + 1 ferie + 1 malattia, più una «di cui» sulla prima.
const daily: HoursDailyRow[] = [
  ...Array.from({ length: 8 }, (_, i) => row({ date: `2026-11-${String(i + 5).padStart(2, "0")}`, hours: 7.5 })),
  row({ date: "2026-11-20", kind: "ferie", hours: 8, clock_in: null, clock_out: null }),
  row({ date: "2026-11-21", kind: "malattia", hours: 8, clock_in: null, clock_out: null }),
];

const allWarnings = {
  certificates: "1 malattia senza certificato in questo periodo.",
  contract: "1 persona senza ore da contratto: lo straordinario non è calcolato.",
};
const noWarnings = { certificates: null, contract: null };

function preview(format: ExportFormat, extra: Partial<Parameters<typeof buildExportPreview>[0]> = {}) {
  return buildExportPreview({
    format,
    people: [person()],
    absences: [absence()],
    daily,
    codes,
    surcharges,
    toFix: [{ hours: 4 }, { hours: 6 }],
    warnings: allWarnings,
    availability: { monthly: true, absences: true },
    ...extra,
  });
}

const total = (p: ReturnType<typeof preview>, label: string) =>
  p.totals.find((t) => t.label === label)?.value;

describe("anteprima dell'export", () => {
  it("offre i quattro formati nell'ordine e con le etichette del pannello", () => {
    expect(EXPORT_FORMATS.map((f) => f.label)).toEqual([
      "CSV giornaliero",
      "CSV mensile",
      "CSV assenze",
      "PDF da stampare",
    ]);
  });

  it("il giornaliero mostra le prime 5 righe della stessa tabella del file", () => {
    const p = preview("daily");
    const table = buildDailyTable(daily, codes, surcharges);
    expect(PREVIEW_ROWS).toBe(5);
    expect(p.table?.header).toEqual(table.header);
    expect(p.table?.rows).toEqual(table.rows.slice(0, 5));
    expect(p.table?.more).toBe(table.rows.length - 5);
  });

  it("le righe «di cui» contano in Righe nel file", () => {
    expect(total(preview("daily"), "Righe nel file")).toBe("11");
  });

  it("i totali del giornaliero sommano lavoro, ferie e permessi, malattia", () => {
    const p = preview("daily");
    expect(total(p, "Ore lavorate")).toBe("60 h");
    expect(total(p, "Ferie e permessi")).toBe("8 h");
    expect(total(p, "Malattia")).toBe("8 h");
  });

  it("il mensile e il PDF prendono i totali dal riepilogo", () => {
    const monthly = preview("monthly");
    expect(total(monthly, "Ore lavorate")).toBe("15 h");
    expect(total(monthly, "Ferie e permessi")).toBe("8 h");
    expect(total(monthly, "Malattia")).toBe("16 h");
    expect(total(monthly, "Righe nel file")).toBe("1");
    const pdf = preview("pdf");
    expect(total(pdf, "Ore lavorate")).toBe("15 h");
    expect(total(pdf, "Righe nel file")).toBeUndefined();
  });

  it("le assenze contano i giorni", () => {
    const p = preview("absences");
    expect(total(p, "Ferie")).toBe("1 g");
    expect(total(p, "Malattia")).toBe("2 gg");
    expect(total(p, "Righe nel file")).toBe("1");
  });

  it.each<[ExportFormat, string[]]>([
    ["daily", ["to_fix", "codes", "team"]],
    ["monthly", ["to_fix", "codes", "team"]],
    ["absences", ["codes", "absences"]],
    ["pdf", ["to_fix", "absences", "team"]],
  ])("le voci di %s arrivano nell'ordine e solo dove servono", (format, targets) => {
    expect(preview(format).issues.map((i) => i.target)).toEqual(targets);
  });

  it("la voce delle ore da sistemare dice che nel file restano da verificare", () => {
    const issue = preview("daily").issues[0];
    expect(issue.text).toBe("2 turni · 10 h che non contano ancora: nel file restano «Da verificare».");
  });

  it("l'avviso dei codici dei CSV di ore riusa il testo di sempre", () => {
    expect(preview("daily").issues[1].text).toBe(
      "1 persona senza matricola: nel file la colonna resta vuota. Senza codice: Lavoro, Ferie, Malattia, Notturno."
    );
  });

  it("nel CSV assenze l'avviso dei codici parla solo di matricole", () => {
    // Quel file porta la matricola ma nessun codice di causale.
    const issue = preview("absences").issues.find((i) => i.target === "codes");
    expect(issue?.text).toBe("1 persona senza matricola: nel file la colonna resta vuota.");
  });

  it("senza avvisi la lista è vuota", () => {
    const quiet: ExportCodes = { codes: {}, matricole: new Map() };
    expect(preview("daily", { toFix: [], warnings: noWarnings, codes: quiet }).issues).toEqual([]);
  });

  it("le etichette dei collegamenti sono le stesse in app e dashboard", () => {
    expect(EXPORT_ISSUE_LINKS).toEqual({
      to_fix: "Ore da sistemare",
      codes: "Codici per il consulente",
      absences: "Assenze",
      team: "Team",
    });
  });

  it("un collegamento c'è solo per chi può aprire quella pagina", () => {
    expect(issueLinks({ canHours: true, canStaff: false, isOwner: false })).toEqual({
      to_fix: true,
      codes: true,
      absences: false,
      team: false,
    });
    // Le ore da contratto le scrive solo il titolare.
    expect(issueLinks({ canHours: true, canStaff: true, isOwner: false }).team).toBe(false);
    expect(issueLinks({ canHours: true, canStaff: true, isOwner: true })).toEqual({
      to_fix: true,
      codes: true,
      absences: true,
      team: true,
    });
  });

  it("il PDF non ha tabella", () => {
    expect(preview("pdf").table).toBeNull();
  });

  it("un formato non disponibile dice perché e non ha tabella", () => {
    const p = preview("daily", { availability: { monthly: false, absences: true } });
    expect(p.available).toBe(false);
    expect(p.unavailableReason).toBe("Nessuna ora in questo periodo.");
    expect(p.table).toBeNull();
    const a = preview("absences", { availability: { monthly: true, absences: false } });
    expect(a.unavailableReason).toBe("Nessuna assenza in questo periodo.");
  });

  it("senza le ore lette all'apertura giornaliero, mensile e PDF non si scaricano", () => {
    // Pannello aperto mentre le ore arrivavano: niente file mezzo vuoto.
    for (const format of ["daily", "monthly", "pdf"] as const) {
      const p = preview(format, { daily: null });
      expect(p.available).toBe(false);
      expect(p.unavailableReason).toBe("Le ore non erano ancora pronte: chiudi e riapri il pannello.");
      expect(p.table).toBeNull();
    }
    expect(preview("absences", { daily: null }).available).toBe(true);
  });

  it("le ore da sistemare contano solo le persone del file", () => {
    const items = [{ member_id: "p", hours: 4 }, { member_id: "q", hours: 6 }];
    expect(toFixInSelection(items, null)).toEqual(items);
    expect(toFixInSelection(items, ["q"])).toEqual([{ member_id: "q", hours: 6 }]);
  });

  it("il motivo dei file non disponibili si legge in una riga", () => {
    const off = (reason: string) => ({ totals: [], issues: [], table: null, available: false, unavailableReason: reason });
    const on = { totals: [], issues: [], table: null, available: true, unavailableReason: null };
    expect(unavailableNote({ daily: on, monthly: on, absences: on, pdf: on })).toBeNull();
    expect(
      unavailableNote({
        daily: off("Nessuna ora in questo periodo."),
        monthly: off("Nessuna ora in questo periodo."),
        absences: on,
        pdf: off("Nessuna ora in questo periodo."),
      })
    ).toBe("CSV giornaliero, CSV mensile e PDF da stampare: nessuna ora in questo periodo.");
    expect(
      unavailableNote({ daily: on, monthly: on, absences: off("Nessuna assenza in questo periodo."), pdf: on })
    ).toBe("CSV assenze: nessuna assenza in questo periodo.");
  });

  it("moreRowsLabel", () => {
    expect(moreRowsLabel(0)).toBe("");
    expect(moreRowsLabel(1)).toBe("e un'altra riga nel file");
    expect(moreRowsLabel(183)).toBe("e altre 183 righe nel file");
  });
});
