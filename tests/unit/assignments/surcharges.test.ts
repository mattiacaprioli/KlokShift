import { describe, expect, it } from "vitest";
import {
  isQuarterTime,
  parsePatron,
  rulesChangeNote,
  missingContractWarning,
  rulesForMonth,
  surchargeSummary,
  parseSurchargePct,
  surchargeColumns,
  surchargeLabel,
  surchargeTotals,
  toSurchargeRules,
  toSurcharges,
  type SurchargeRow,
} from "@/features/assignments/surcharges";

const row = (over: Partial<SurchargeRow> = {}): SurchargeRow => ({
  person_id: "p",
  person_name: "Anna",
  date: "2026-10-11",
  venue_name: "Centro",
  title: "Sera",
  clock_in: "18:00",
  clock_out: "02:00",
  kind: "night",
  percentage: 20,
  hours: 1.88,
  ...over,
});

describe("etichette delle maggiorazioni", () => {
  it("dicono voce e percentuale", () => {
    expect(surchargeLabel("night", 20)).toBe("Di cui notturno +20%");
    expect(surchargeLabel("sunday", 30)).toBe("Di cui domenica +30%");
    expect(surchargeLabel("holiday", 50)).toBe("Di cui festivi +50%");
    expect(surchargeLabel("overtime", 12.5)).toBe("Di cui straordinario +12,5%");
  });
});

describe("colonne e totali", () => {
  it("una colonna per voce e percentuale, in ordine di voce", () => {
    const rows = [
      row({ kind: "night", percentage: 25 }),
      row({ kind: "sunday", percentage: 30 }),
      row({ kind: "night", percentage: 20 }),
      row({ kind: "night", percentage: 25, person_id: "q" }),
    ];
    expect(surchargeColumns(rows)).toEqual([
      { kind: "night", percentage: 20 },
      { kind: "night", percentage: 25 },
      { kind: "sunday", percentage: 30 },
    ]);
  });

  it("somma per voce e percentuale, anche per una persona", () => {
    const rows = [
      row({ hours: 1.5 }),
      row({ hours: 2.25, date: "2026-10-12" }),
      row({ kind: "sunday", percentage: 30, hours: 5.62 }),
      row({ person_id: "q", hours: 3 }),
    ];
    const all = surchargeTotals(rows);
    expect(all.get("night:20")).toBe(6.75);
    expect(all.get("sunday:30")).toBe(5.62);
    expect(surchargeTotals(rows, "p").get("night:20")).toBe(3.75);
  });
});

describe("risposta della RPC", () => {
  it("separa chi non ha contratto e scarta le voci sconosciute", () => {
    const out = toSurcharges([
      { member_id: "p", member_name: "Anna", date: "2026-10-11", venue_name: "Centro", title: "Sera",
        clock_in: "18:00", clock_out: "02:00", kind: "night", percentage: 20, hours: 1.88 },
      { member_id: "q", member_name: "Bea", date: null, venue_name: null, title: null,
        clock_in: null, clock_out: null, kind: "no_contract", percentage: null, hours: null },
      { member_id: "p", member_name: "Anna", date: "2026-10-11", venue_name: null, title: null,
        clock_in: null, clock_out: null, kind: "boh", percentage: 1, hours: 1 },
    ]);
    expect(out.rows).toEqual([row()]);
    expect([...out.noContract]).toEqual(["q"]);
  });

  it("legge le regole e i patroni", () => {
    const rules = toSurchargeRules({
      versions: [{ valid_from: "2026-11-01", night_pct: 20, night_start: "22:00", night_end: "06:00",
        sunday_pct: null, holiday_pct: 50, overtime_pct: null }],
      patrons: [{ venue_id: "v1", day: 4, month: 10 }],
    });
    expect(rules.versions[0]).toEqual({ valid_from: "2026-11-01", night_pct: 20, night_start: "22:00",
      night_end: "06:00", sunday_pct: null, holiday_pct: 50, overtime_pct: null });
    expect(rules.patrons).toEqual([{ venue_id: "v1", day: 4, month: 10 }]);
    expect(toSurchargeRules(null)).toEqual({ versions: [], patrons: [] });
  });
});

describe("avviso dello straordinario", () => {
  it("conta solo le persone del periodo", () => {
    expect(missingContractWarning(new Set(["a", "b"]), ["a", "b", "c"])).toBe(
      "2 persone senza ore da contratto: lo straordinario non è calcolato."
    );
    expect(missingContractWarning(new Set(["a", "z"]), ["a", "c"])).toBe(
      "1 persona senza ore da contratto: lo straordinario non è calcolato."
    );
    expect(missingContractWarning(new Set(), ["a"])).toBeNull();
  });
});

describe("campo della percentuale", () => {
  it("accetta numeri fra 0 e 300 con al più un decimale", () => {
    expect(parseSurchargePct("20")).toEqual({ pct: 20, invalid: false });
    expect(parseSurchargePct(" 12,5 ")).toEqual({ pct: 12.5, invalid: false });
    expect(parseSurchargePct("")).toEqual({ pct: null, invalid: false });
    for (const bad of ["0", "301", "12,25", "abc", "-5"]) {
      expect(parseSurchargePct(bad).invalid).toBe(true);
    }
  });
});

describe("aiuti per le schermate", () => {
  it("le righe «di cui» con ore, di tutti o di una persona", () => {
    const rows = [row({ hours: 1 }), row({ kind: "sunday", percentage: 30, hours: 2 }), row({ person_id: "q", hours: 4 })];
    expect(surchargeSummary(rows)).toEqual([
      { label: "Di cui notturno +20%", hours: 5 },
      { label: "Di cui domenica +30%", hours: 2 },
    ]);
    expect(surchargeSummary(rows, "q")).toEqual([{ label: "Di cui notturno +20%", hours: 4 }]);
  });

  it("le regole valide per un mese, vuote prima della prima versione", () => {
    const versions = [
      { valid_from: "2026-09-01", night_pct: 20, night_start: "22:00", night_end: "06:00",
        sunday_pct: null, holiday_pct: null, overtime_pct: null },
      { valid_from: "2026-11-01", night_pct: 25, night_start: "23:00", night_end: "05:00",
        sunday_pct: 30, holiday_pct: null, overtime_pct: null },
    ];
    expect(rulesForMonth(versions, "2026-10").night_pct).toBe(20);
    expect(rulesForMonth(versions, "2026-12").night_start).toBe("23:00");
    expect(rulesForMonth(versions, "2026-08")).toEqual({ night_pct: null, night_start: "22:00",
      night_end: "06:00", sunday_pct: null, holiday_pct: null, overtime_pct: null });
  });

  it("orari della fascia al quarto d'ora", () => {
    expect(isQuarterTime("22:00")).toBe(true);
    expect(isQuarterTime("06:45")).toBe(true);
    expect(isQuarterTime("22:10")).toBe(false);
    expect(isQuarterTime("24:00")).toBe(false);
    expect(isQuarterTime("7:00")).toBe(false);
  });
});

describe("cosa cambia salvando le regole di un mese", () => {
  const v = (valid_from: string) => ({ valid_from, night_pct: 20, night_start: "22:00", night_end: "06:00",
    sunday_pct: null, holiday_pct: null, overtime_pct: null });

  it("un mese passato senza versioni dopo: cambiano tutti i mesi da lì", () => {
    expect(rulesChangeNote([v("2026-09-01")], "2026-10", "2026-11")).toBe(
      "I file dei mesi da ottobre 2026 in poi cambiano."
    );
  });

  it("con una versione dopo, cambiano solo i mesi fino a lei", () => {
    expect(rulesChangeNote([v("2026-10-01"), v("2026-11-01")], "2026-10", "2026-11")).toBe(
      "Cambia solo il file di ottobre 2026: da novembre 2026 valgono le regole salvate per novembre 2026."
    );
    expect(rulesChangeNote([v("2026-12-01")], "2026-09", "2026-11")).toBe(
      "Cambiano solo i file da settembre 2026 a novembre 2026: da dicembre 2026 valgono le regole salvate per dicembre 2026."
    );
  });

  it("il mese corrente senza versioni dopo: niente da dire", () => {
    expect(rulesChangeNote([v("2026-09-01")], "2026-11", "2026-11")).toBeNull();
  });
});

describe("patrono e mesi futuri", () => {
  it("il patrono è giorno e mese insieme, o niente", () => {
    expect(parsePatron("4", "10")).toEqual({ day: 4, month: 10 });
    expect(parsePatron(" ", "")).toEqual({ day: null, month: null });
    expect(parsePatron("29", "2")).toEqual({ day: 29, month: 2 });
    for (const [d, m] of [["4a", ""], ["4", ""], ["", "10"], ["3.5", "10"], ["31", "2"], ["0", "1"], ["1", "13"]]) {
      expect(parsePatron(d, m)).toBe("invalid");
    }
  });

  it("un mese futuro dice da quando valgono", () => {
    const v = { valid_from: "2027-03-01", night_pct: 20, night_start: "22:00", night_end: "06:00",
      sunday_pct: null, holiday_pct: null, overtime_pct: null };
    expect(rulesChangeNote([], "2027-01", "2026-11")).toBe(
      "Valgono da gennaio 2027: fino ad allora restano le regole di prima."
    );
    expect(rulesChangeNote([v], "2027-01", "2026-11")).toBe(
      "Valgono da gennaio 2027 a febbraio 2027: da marzo 2027 valgono le regole salvate per marzo 2027."
    );
  });
});
