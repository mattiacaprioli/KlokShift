import { describe, expect, it } from "vitest";
import {
  computeHomeStats,
  periodLabel,
  periodRange,
  shiftPeriod,
  type StatsShift,
} from "@/features/shifts/homeStats";

// Istanti in ora locale, senza offset: la CI gira in UTC.
const now = new Date("2026-09-24T18:00:00"); // giovedì

describe("periodo delle statistiche", () => {
  it("la settimana è lunedì–domenica, il mese dal primo all'ultimo giorno", () => {
    expect(periodRange("week", now)).toEqual({ from: "2026-09-21", to: "2026-09-27" });
    expect(periodRange("month", now)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(periodRange("month", new Date("2028-02-10T12:00:00"))).toEqual({
      from: "2028-02-01",
      to: "2028-02-29",
    });
  });

  it("scorrere di un mese parte dal giorno 1: il 31 marzo meno uno è febbraio", () => {
    const back = shiftPeriod("month", -1, new Date("2026-03-31T12:00:00"));
    expect(periodRange("month", back)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    const nextWeek = shiftPeriod("week", 1, now);
    expect(periodRange("week", nextWeek).from).toBe("2026-09-28");
  });

  it("etichette della settimana, anche a cavallo di due mesi", () => {
    expect(periodLabel("week", now)).toBe("Questa settimana · 21–27 set");
    expect(periodLabel("week", shiftPeriod("week", -1, now), -1)).toBe("Settimana scorsa · 14–20 set");
    expect(periodLabel("week", new Date("2026-09-30T12:00:00"), -3)).toBe("28 set–4 ott");
  });

  it("etichette del mese: l'anno compare solo se non è quello corrente", () => {
    const year = new Date().getFullYear();
    expect(periodLabel("month", new Date(year, 8, 15))).toBe("Questo mese · settembre");
    expect(periodLabel("month", new Date(year - 1, 6, 10), -3)).toBe(`Luglio ${year - 1}`);
  });
});

const stats = (over: Partial<StatsShift>): StatsShift => ({
  date: "2026-09-24",
  start_time: "10:00",
  end_time: "14:00",
  status: "open",
  positions_filled: 0,
  positions_total: 0,
  shift_role_requirements: [],
  shift_assignments: [],
  ...over,
});

describe("KPI della home", () => {
  it("scarta gli annullati, separa fatti e da fare, conta le ore di chi lavora", () => {
    const result = computeHomeStats(
      [
        // Finito alle 14: fatto, scoperto ma non più un compito.
        stats({ positions_total: 2, positions_filled: 1, shift_assignments: [
          { status: "confirmed", role_id: null }, { status: "declined", role_id: null },
        ] }),
        // Stasera, manca una persona.
        stats({ start_time: "19:00", end_time: "23:00", positions_total: 2, positions_filled: 1,
          shift_assignments: [{ status: "assigned", role_id: null }] }),
        // Annullato: non conta niente.
        stats({ status: "cancelled", positions_total: 5, shift_assignments: [
          { status: "confirmed", role_id: null },
        ] }),
      ],
      now
    );
    expect(result).toEqual({
      total: 2,
      done: 1,
      upcoming: 1,
      shortCount: 1,
      missingSlots: 1,
      hours: 8,
    });
  });

  it("un notturno iniziato ieri non è ancora fatto finché non finisce", () => {
    const result = computeHomeStats(
      [stats({ date: "2026-09-23", start_time: "22:00", end_time: "04:00" })],
      new Date("2026-09-24T03:00:00")
    );
    expect(result.done).toBe(0);
    expect(result.upcoming).toBe(1);
  });
});
