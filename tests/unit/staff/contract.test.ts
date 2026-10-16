import { describe, expect, it } from "vitest";
import {
  contractChanged,
  contractHoursInput,
  formatContract,
  loadTone,
  parseContractHours,
  personContract,
  targetExplainer,
  weeklyTarget,
} from "@/features/staff/contract";

describe("contratto della persona", () => {
  it("esiste solo con ore e periodo validi", () => {
    expect(personContract({ contract_hours: 40, contract_period: "week" })).toEqual({ hours: 40, period: "week" });
    expect(personContract({ contract_hours: 40, contract_period: null })).toBeNull();
    expect(personContract({ contract_hours: null, contract_period: "week" })).toBeNull();
    expect(personContract({ contract_hours: 40, contract_period: "year" })).toBeNull();
  });

  it("si scrive con il periodo", () => {
    expect(formatContract({ hours: 40, period: "week" })).toBe("40 h a settimana");
    expect(formatContract({ hours: 6.5, period: "day" })).toBe("6,5 h al giorno");
  });
});

describe("target settimanale", () => {
  it("settimanale così com'è, mensile sulle settimane di un mese medio", () => {
    expect(weeklyTarget({ hours: 40, period: "week" }, 0)).toBe(40);
    expect(weeklyTarget({ hours: 173, period: "month" }, 0)).toBeCloseTo(39.92, 2);
  });

  it("giornaliero per i giorni programmati, e nessun target senza giorni", () => {
    expect(weeklyTarget({ hours: 8, period: "day" }, 5)).toBe(40);
    expect(weeklyTarget({ hours: 8, period: "day" }, 0)).toBeNull();
    expect(weeklyTarget(null, 5)).toBeNull();
  });

  it("colora con mezz'ora di tolleranza, e mai senza contratto", () => {
    expect(loadTone(39.5, 40)).toBe("on");
    expect(loadTone(40.5, 40)).toBe("on");
    expect(loadTone(39.4, 40)).toBe("under");
    expect(loadTone(40.6, 40)).toBe("over");
    expect(loadTone(60, null)).toBe("none");
  });

  it("spiega il target solo quando non è quello scritto", () => {
    expect(targetExplainer({ hours: 40, period: "week" }, 40)).toBeNull();
    expect(targetExplainer({ hours: 173, period: "month" }, 173 / (52 / 12))).toBe(
      "173 h al mese ≈ 39,9 h a settimana"
    );
    expect(targetExplainer({ hours: 8, period: "day" }, null)).toBeNull();
  });
});

describe("modulo del contratto (app e dashboard)", () => {
  it("accetta la virgola e il punto, e il campo vuoto vuol dire nessun contratto", () => {
    expect(parseContractHours(" 37,5 ")).toEqual({ hours: 37.5, invalid: false });
    expect(parseContractHours("40.5")).toEqual({ hours: 40.5, invalid: false });
    expect(parseContractHours("   ")).toEqual({ hours: null, invalid: false });
  });

  it("rifiuta zero, negativi, oltre 400 e testo", () => {
    for (const input of ["0", "-5", "400,5", "abc", "1,5,5"]) {
      expect(parseContractHours(input).invalid).toBe(true);
    }
    expect(parseContractHours("400").invalid).toBe(false);
  });

  it("il valore iniziale usa la virgola", () => {
    expect(contractHoursInput({ hours: 37.5, period: "week" })).toBe("37,5");
    expect(contractHoursInput(null)).toBe("");
  });

  it("senza ore cambiare solo il periodo non è una modifica", () => {
    const current = { hours: 40, period: "week" as const };
    expect(contractChanged(current, 40, "week")).toBe(false);
    expect(contractChanged(current, 40, "month")).toBe(true);
    expect(contractChanged(current, 38, "week")).toBe(true);
    expect(contractChanged(current, null, "week")).toBe(true);
    expect(contractChanged(null, null, "month")).toBe(false);
  });
});
