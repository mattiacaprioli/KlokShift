import { describe, expect, it } from "vitest";
import {
  filterByPeople,
  monthAsRange,
  peopleInReport,
  periodBounds,
  periodKey,
  periodLabel,
  pruneSelection,
  selectedNames,
  selectionLabel,
  togglePerson,
  validateRange,
} from "@/features/assignments/reportPeriod";

describe("estremi del periodo per le RPC", () => {
  it("il mese va dal primo al primo del mese dopo, anche a dicembre", () => {
    expect(periodBounds({ kind: "month", month: "2026-10" })).toEqual({ start: "2026-10-01", end: "2026-11-01" });
    expect(periodBounds({ kind: "month", month: "2026-12" })).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("l'intervallo include l'ultimo giorno scelto (fine esclusa = giorno dopo)", () => {
    expect(periodBounds({ kind: "range", from: "2026-10-01", to: "2026-10-15" })).toEqual({ start: "2026-10-01", end: "2026-10-16" });
    expect(periodBounds({ kind: "range", from: "2026-12-28", to: "2026-12-31" })).toEqual({ start: "2026-12-28", end: "2027-01-01" });
  });

  it("un mese e l'intervallo che lo copre hanno la stessa chiave di cache", () => {
    expect(periodKey({ kind: "month", month: "2026-10" })).toBe(
      periodKey({ kind: "range", ...monthAsRange("2026-10") })
    );
    expect(monthAsRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
  });
});

describe("etichetta del periodo", () => {
  it("dice il mese o l'intervallo per intero", () => {
    expect(periodLabel({ kind: "month", month: "2026-10" })).toBe("Ottobre 2026");
    expect(periodLabel({ kind: "range", from: "2026-10-01", to: "2026-10-15" })).toBe("1–15 ottobre 2026");
    expect(periodLabel({ kind: "range", from: "2026-09-28", to: "2026-10-03" })).toBe("28 settembre – 3 ottobre 2026");
    expect(periodLabel({ kind: "range", from: "2025-12-28", to: "2026-01-03" })).toBe("28 dicembre 2025 – 3 gennaio 2026");
    expect(periodLabel({ kind: "range", from: "2026-10-15", to: "2026-10-15" })).toBe("15 ottobre 2026");
  });
});

describe("validazione dell'intervallo", () => {
  it("rifiuta date mancanti, invertite o oltre un anno", () => {
    expect(validateRange("", "2026-10-15")).not.toBeNull();
    expect(validateRange("2026-10-16", "2026-10-15")).not.toBeNull();
    expect(validateRange("2026-01-01", "2027-01-02")).toBe("Scegli al massimo un anno.");
  });

  it("accetta un giorno solo e un anno intero", () => {
    expect(validateRange("2026-10-15", "2026-10-15")).toBeNull();
    expect(validateRange("2026-01-01", "2027-01-01")).toBeNull();
  });
});

describe("scelta delle persone", () => {
  const hours = [
    { person_id: "b", person_name: "Bruno", venue: "Roma" },
    { person_id: "a", person_name: "Anna", venue: "Roma" },
    { person_id: "a", person_name: "Anna", venue: "Milano" },
  ];
  const absences = [{ person_id: "c", person_name: "Carla" }];
  const options = peopleInReport(hours, absences);

  it("elenca una volta chi ha ore o assenze nel periodo, per nome", () => {
    expect(options).toEqual([
      { id: "a", name: "Anna" },
      { id: "b", name: "Bruno" },
      { id: "c", name: "Carla" },
    ]);
  });

  it("filtra tutte le righe della persona, di ogni sede; null = tutte", () => {
    expect(filterByPeople(hours, ["a"])).toHaveLength(2);
    expect(filterByPeople(hours, null)).toHaveLength(3);
  });

  it("toglie dalla selezione chi nel periodo non c'è, e torna a tutte se resta vuota", () => {
    expect(pruneSelection(["a", "z"], options)).toEqual(["a"]);
    expect(pruneSelection(["z"], options)).toBeNull();
    expect(pruneSelection(null, options)).toBeNull();
  });

  it("accende e spegne; tutte accese o nessuna equivale a tutte", () => {
    expect(togglePerson(null, "a", 3)).toEqual(["a"]);
    expect(togglePerson(["a"], "b", 3)).toEqual(["a", "b"]);
    expect(togglePerson(["a", "b"], "c", 3)).toBeNull();
    expect(togglePerson(["a"], "a", 3)).toBeNull();
  });

  it("nomi ed etichetta della selezione", () => {
    expect(selectedNames(["c", "a"], options)).toEqual(["Anna", "Carla"]);
    expect(selectionLabel([])).toBe("Tutte");
    expect(selectionLabel(["Anna"])).toBe("Anna");
    expect(selectionLabel(["Anna", "Carla"])).toBe("2 persone");
  });
});
