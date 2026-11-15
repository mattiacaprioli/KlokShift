import { describe, expect, it } from "vitest";
import {
  WEEK_DAYS,
  WEEK_PEOPLE,
  WEEK_SHIFTS,
  confirmedWeek,
  draftWeek,
} from "../../../web-site/src/mock/week";

/*
 * La settimana finta del sito vetrina: la stessa in apertura, nella storia e in
 * chiusura. Deve sembrare un'azienda qualunque a turni, non solo un ristorante.
 */
describe("settimana del sito vetrina", () => {
  it("ha sette giorni e cinque persone", () => {
    expect(WEEK_DAYS).toHaveLength(7);
    expect(WEEK_PEOPLE).toHaveLength(5);
  });

  it("usa ruoli misti, non solo ristorazione", () => {
    const roles = new Set(WEEK_SHIFTS.map((s) => s.role));
    expect(roles.size).toBeGreaterThanOrEqual(5);
    for (const role of ["Magazzino", "Cassa", "Pulizie"]) {
      expect(roles.has(role)).toBe(true);
    }
  });

  it("ha un solo turno da coprire e uno solo da confermare", () => {
    const open = WEEK_SHIFTS.filter((s) => s.state === "open");
    const pending = WEEK_SHIFTS.filter((s) => s.state === "pending");
    expect(open).toHaveLength(1);
    expect(pending).toHaveLength(1);
    expect(open[0]).toMatchObject({ person: -1, day: 5 });
  });

  it("confirmedWeek conferma tutto e copre il buco", () => {
    const week = confirmedWeek(WEEK_SHIFTS);
    expect(week).toHaveLength(WEEK_SHIFTS.length);
    expect(week.every((s) => s.state === "confirmed")).toBe(true);
    expect(week.some((s) => s.person === -1)).toBe(false);
  });

  it("draftWeek mette tutto in bozza senza toccare orari", () => {
    const week = draftWeek(WEEK_SHIFTS);
    expect(week.every((s) => s.state === "draft")).toBe(true);
    expect(week.map((s) => s.time)).toEqual(WEEK_SHIFTS.map((s) => s.time));
  });

  it("nessun turno doppio nella stessa cella", () => {
    const cells = WEEK_SHIFTS.map((s) => `${s.person}:${s.day}`);
    expect(new Set(cells).size).toBe(cells.length);
    const filled = confirmedWeek(WEEK_SHIFTS).map((s) => `${s.person}:${s.day}`);
    expect(new Set(filled).size).toBe(filled.length);
  });
});
