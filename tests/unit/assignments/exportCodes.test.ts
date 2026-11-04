import { describe, expect, it } from "vitest";
import { EXPORT_CODE_LABELS, exportCodesWarning, toExportCodes, usedExportKeys } from "@/features/assignments/exportCodes";

describe("codici per il consulente (get_export_codes)", () => {
  it("legge codici e matricole", () => {
    const codes = toExportCodes({
      codes: { company: "AZ1", work: "01", ferie: "FE" },
      matricole: [
        { member_id: "m1", matricola: "A12" },
        { member_id: "m2", matricola: "B7" },
      ],
    });
    expect(codes.codes).toEqual({ company: "AZ1", work: "01", ferie: "FE" });
    expect(codes.matricole.get("m1")).toBe("A12");
    expect(codes.matricole.get("m2")).toBe("B7");
    expect(codes.matricole.size).toBe(2);
  });

  it("senza dati non ha codici né matricole", () => {
    expect(toExportCodes(null)).toEqual({ codes: {}, matricole: new Map() });
    expect(toExportCodes({})).toEqual({ codes: {}, matricole: new Map() });
  });

  it("scarta le chiavi che non conosce", () => {
    expect(toExportCodes({ codes: { work: "01", altro: "X" } }).codes).toEqual({ work: "01" });
  });

  it("chiama i campi come nella pagina Ore", () => {
    expect(EXPORT_CODE_LABELS).toEqual({
      company: "Codice azienda",
      work: "Lavoro",
      ferie: "Ferie",
      permesso: "Permesso",
      malattia: "Malattia",
    });
  });
});

describe("avviso dei codici mancanti", () => {
  const none = { codes: {}, matricole: new Map<string, string>() };

  it("tace se l'azienda non usa matricole né codici", () => {
    expect(exportCodesWarning({ personIds: ["a", "b"], usedKeys: ["work"], codes: none })).toBeNull();
  });

  it("conta chi è senza matricola quando l'azienda le usa", () => {
    const codes = { codes: {}, matricole: new Map([["a", "A1"]]) };
    expect(exportCodesWarning({ personIds: ["a", "b", "c"], usedKeys: ["work"], codes })).toBe(
      "2 persone senza matricola: nel file la colonna resta vuota."
    );
    expect(exportCodesWarning({ personIds: ["a", "b"], usedKeys: [], codes })).toBe(
      "1 persona senza matricola: nel file la colonna resta vuota."
    );
  });

  it("dice le causali usate senza codice, compreso quello dell'azienda", () => {
    const codes = { codes: { work: "01" }, matricole: new Map([["a", "A1"]]) };
    expect(exportCodesWarning({ personIds: ["a"], usedKeys: ["work", "malattia"], codes })).toBe(
      "Senza codice: Codice azienda, Malattia."
    );
  });

  it("unisce le due frasi", () => {
    const codes = { codes: { company: "AZ" }, matricole: new Map<string, string>() };
    expect(exportCodesWarning({ personIds: ["a"], usedKeys: ["ferie"], codes })).toBe(
      "1 persona senza matricola: nel file la colonna resta vuota. Senza codice: Ferie."
    );
  });

  it("niente da dire quando c'è tutto", () => {
    const codes = { codes: { company: "AZ", work: "01" }, matricole: new Map([["a", "A1"]]) };
    expect(exportCodesWarning({ personIds: ["a"], usedKeys: ["work"], codes })).toBeNull();
  });
});

describe("causali usate nel periodo", () => {
  const base = {
    person_id: "p", person_name: "Anna", roles: null, shifts_count: 0, worked_hours: 0,
    ferie_hours: 0, malattia_hours: 0, permesso_hours: 0, justified_hours: 0, covered_hours: 0,
    conflict_hours: 0, to_review_count: 0, untracked_hours: 0, paid_break_hours: 0, unpaid_break_hours: 0,
  };
  const absence = {
    person_id: "p", person_name: "Anna", ferie_days: 0, permesso_days: 0, permesso_hours: 0,
    malattia_days: 0, ferie_hours: 0, malattia_hours: 0, permesso_recognized_hours: 0,
    conflict_hours: 0, inps_protocols: null, missing_certificates: 0,
  };

  it("lavoro se ci sono turni, e ogni assenza che compare", () => {
    expect(usedExportKeys([{ ...base, shifts_count: 2, worked_hours: 8 }], [
      { ...absence, malattia_days: 1 },
      { ...absence, permesso_hours: 2 },
    ])).toEqual(["work", "permesso", "malattia"]);
  });

  it("niente se il periodo è vuoto", () => {
    expect(usedExportKeys([base], [absence])).toEqual([]);
  });
});
