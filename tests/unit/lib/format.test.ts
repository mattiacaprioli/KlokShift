import { describe, expect, it } from "vitest";
import {
  addDaysToDate,
  addMonthsToKey,
  daysInMonth,
  formatBirthday,
  formatBreak,
  formatBreakMinutes,
  formatDayLabel,
  formatHours,
  formatHoursVariance,
  formatMonthKey,
  formatRelativeStart,
  formatShiftRange,
  formatShiftSummary,
  isOvernightShift,
  isShiftOver,
  isValidShiftRange,
  monthKey,
  shiftCountedHours,
  shiftDurationHours,
  shiftEndsAt,
  shiftSlotLabel,
  startOfWeek,
  timeToDate,
  toDateString,
  toTimeString,
  todayString,
} from "@/lib/format";

// ⚠️ La CI gira in UTC: gli istanti si scrivono in ora locale, senza offset,
// perché le funzioni ragionano sull'ora del dispositivo.
const at = (local: string) => new Date(local);

describe("date in formato colonna", () => {
  it("«oggi» è la data locale, non quella UTC, anche subito dopo mezzanotte", () => {
    expect(todayString(at("2026-10-25T00:30:00"))).toBe("2026-10-25");
    expect(todayString(at("2026-10-24T23:59:00"))).toBe("2026-10-24");
  });

  it("aggiunge e toglie giorni attraverso mesi, anni e cambi d'ora", () => {
    expect(addDaysToDate("2026-01-31", 1)).toBe("2026-02-01");
    expect(addDaysToDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysToDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDaysToDate("2028-03-01", -1)).toBe("2028-02-29");
    // Le due notti del cambio d'ora in Italia.
    expect(addDaysToDate("2026-03-28", 1)).toBe("2026-03-29");
    expect(addDaysToDate("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDaysToDate("2026-10-25", 1)).toBe("2026-10-26");
    expect(addDaysToDate("2026-10-26", -1)).toBe("2026-10-25");
  });

  it("la settimana parte di lunedì; la domenica chiude quella iniziata sei giorni prima", () => {
    expect(startOfWeek("2026-09-21")).toBe("2026-09-21"); // lunedì
    expect(startOfWeek("2026-09-24")).toBe("2026-09-21"); // giovedì
    expect(startOfWeek("2026-09-27")).toBe("2026-09-21"); // domenica
    expect(startOfWeek("2026-11-01")).toBe("2026-10-26"); // domenica dopo il cambio d'ora
  });

  it("toDateString usa i campi locali", () => {
    expect(toDateString(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});

describe("orari dei turni", () => {
  it("un turno è notturno quando la fine non è dopo l'inizio", () => {
    expect(isOvernightShift("22:00", "04:00")).toBe(true);
    expect(isOvernightShift("16:00:00", "00:00:00")).toBe(true);
    expect(isOvernightShift("09:00", "17:00")).toBe(false);
  });

  it("solo inizio uguale a fine non è un intervallo valido", () => {
    expect(isValidShiftRange("10:00", "10:00:00")).toBe(false);
    expect(isValidShiftRange("22:00", "04:00")).toBe(true);
  });

  it("calcola la durata anche a cavallo della mezzanotte", () => {
    expect(shiftDurationHours("09:00", "17:30")).toBe(8.5);
    expect(shiftDurationHours("22:00", "04:00")).toBe(6);
    expect(shiftDurationHours("16:00", "00:00")).toBe(8);
  });

  it("il notturno finisce il giorno dopo", () => {
    expect(toDateString(shiftEndsAt("2026-09-24", "22:00", "04:00"))).toBe("2026-09-25");
    expect(toDateString(shiftEndsAt("2026-09-24", "09:00", "17:00"))).toBe("2026-09-24");
  });

  it("un turno è finito all'orario di fine, non a mezzanotte", () => {
    const shift = { date: "2026-09-24", start_time: "22:00", end_time: "02:00" };
    expect(isShiftOver(shift, at("2026-09-25T01:59:00"))).toBe(false);
    expect(isShiftOver(shift, at("2026-09-25T02:00:00"))).toBe(true);
  });

  it("segnala il giorno dopo nell'intervallo", () => {
    expect(formatShiftRange("22:00:00", "04:00:00")).toBe("22:00–04:00 +1");
    expect(formatShiftRange("09:00", "17:00")).toBe("09:00–17:00");
  });

  it("da «HH:MM[:SS]» a un Date di oggi con quell'orario", () => {
    const d = timeToDate("18:45:00");
    expect(toTimeString(d)).toBe("18:45");
    expect(d.getSeconds()).toBe(0);
    expect(toTimeString(timeToDate("07:05"))).toBe("07:05");
  });

  it("dà un nome alla fascia dall'ora d'inizio", () => {
    expect(shiftSlotLabel("05:59")).toBe("Notte");
    expect(shiftSlotLabel("06:00")).toBe("Mattina");
    expect(shiftSlotLabel("12:00")).toBe("Pomeriggio");
    expect(shiftSlotLabel("17:00")).toBe("Sera");
    expect(shiftSlotLabel("22:00")).toBe("Notte");
  });
});

describe("ore in italiano", () => {
  it("fino a due decimali con la virgola, nessuno se intero", () => {
    expect(formatHours(5)).toBe("5 h");
    expect(formatHours(12.5)).toBe("12,5 h");
    // Il quarto d'ora resta tale: 7 h 45 non è «7,8 h».
    expect(formatHours(7.75)).toBe("7,75 h");
    expect(formatHours(0.25)).toBe("0,25 h");
    // Il rumore delle somme in virgola mobile non si vede.
    expect(formatHours(7.999999)).toBe("8 h");
    expect(formatHours(20 / 60)).toBe("0,33 h");
  });

  it("lo scostamento ha il segno, e nessuno scostamento è null", () => {
    expect(formatHoursVariance(1)).toBe("+1 h");
    expect(formatHoursVariance(-0.5)).toBe("-0,5 h");
    expect(formatHoursVariance(0.0001)).toBeNull();
  });
});

describe("tempo relativo all'inizio di un turno", () => {
  const now = at("2026-09-24T18:00:00"); // giovedì

  it("dice «in corso» quando è già iniziato", () => {
    expect(formatRelativeStart("2026-09-24", "17:00", now)).toBe("in corso");
    expect(formatRelativeStart("2026-09-24", "18:00", now)).toBe("in corso");
  });

  it("entro l'ora conta i minuti, entro la giornata le ore", () => {
    expect(formatRelativeStart("2026-09-24", "18:25", now)).toBe("fra 25 min");
    expect(formatRelativeStart("2026-09-24", "19:00", now)).toBe("fra 1 ora");
    expect(formatRelativeStart("2026-09-24", "21:00", now)).toBe("fra 3 ore");
  });

  it("dal giorno dopo nomina il giorno", () => {
    expect(formatRelativeStart("2026-09-25", "10:00", now)).toBe("domani alle 10:00");
    expect(formatRelativeStart("2026-09-27", "19:00:00", now)).toMatch(/^\S+ 27 alle 19:00$/);
  });

  it("«Oggi» e «Domani» si nominano, gli altri giorni si datano", () => {
    expect(formatDayLabel("2026-09-24", now)).toBe("Oggi");
    expect(formatDayLabel("2026-09-25", now)).toBe("Domani");
    expect(formatDayLabel("2026-09-26", now)).not.toMatch(/Oggi|Domani/);
  });
});

describe("compleanno senza anno", () => {
  it("febbraio ha sempre 29 giorni, come il CHECK del database", () => {
    expect(daysInMonth(2)).toBe(29);
    expect(daysInMonth(4)).toBe(30);
    expect(daysInMonth(12)).toBe(31);
  });

  it("formatta solo valori completi e validi", () => {
    expect(formatBirthday(12, 3)).toBe("12 marzo");
    expect(formatBirthday(null, 3)).toBeNull();
    expect(formatBirthday(1, 13)).toBeNull();
  });
});

describe("mesi come chiave «YYYY-MM» (pagine Ore di app e dashboard)", () => {
  it("il mese è quello locale anche il primo del mese subito dopo mezzanotte", () => {
    expect(monthKey(at("2026-10-01T00:30:00"))).toBe("2026-10");
  });

  it("si sposta passando dal giorno 1, attraverso gli anni", () => {
    expect(addMonthsToKey("2026-01", -1)).toBe("2025-12");
    expect(addMonthsToKey("2026-12", 1)).toBe("2027-01");
    expect(addMonthsToKey("2026-03", -1)).toBe("2026-02");
  });

  it("si legge in italiano, minuscolo", () => {
    expect(formatMonthKey("2026-09")).toBe("settembre 2026");
  });
});

describe("pausa del turno", () => {
  const evening = { start_time: "18:00", end_time: "00:00", break_minutes: 30 };

  it("le ore conteggiate tolgono solo la pausa non retribuita", () => {
    expect(shiftCountedHours({ ...evening, break_paid: false })).toBe(5.5);
    expect(shiftCountedHours({ ...evening, break_paid: true })).toBe(6);
    expect(
      shiftCountedHours({ ...evening, break_minutes: 0, break_paid: false })
    ).toBe(6);
  });

  it("minuti leggibili", () => {
    expect(formatBreakMinutes(30)).toBe("30 min");
    expect(formatBreakMinutes(60)).toBe("1 h");
    expect(formatBreakMinutes(75)).toBe("1 h 15 min");
    expect(formatBreak(30)).toBe("Pausa 30 min");
    expect(formatBreak(30, true)).toBe("Pausa 30 min retribuita");
    expect(formatBreak(30, false)).toBe("Pausa 30 min non retribuita");
  });

  it("il riepilogo del form dice la pausa e le ore che contano", () => {
    expect(formatShiftSummary("2026-09-24", "10:00", "16:00")).toBe("Durata 6 h");
    expect(
      formatShiftSummary("2026-09-24", "10:00", "16:00", {
        break_minutes: 30,
        break_paid: false,
      })
    ).toBe("Durata 6 h · pausa 30 min non retribuita · 5,5 h conteggiate");
    expect(
      formatShiftSummary("2026-09-24", "10:00", "16:00", {
        break_minutes: 30,
        break_paid: true,
      })
    ).toBe("Durata 6 h · pausa 30 min retribuita");
    expect(
      formatShiftSummary("2026-09-24", "10:00", "16:00", {
        break_minutes: 0,
        break_paid: false,
      })
    ).toBe("Durata 6 h");
  });
});
