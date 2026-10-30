import { describe, expect, it } from "vitest";
import { withClosedDays } from "@/features/assignments/agenda";
import {
  closedDates,
  closureCovers,
  closureRangeText,
  closureWarning,
  closuresOn,
  dayClosureText,
  restDaysText,
  upcomingClosures,
  type VenueCalendar,
  type VenueClosure,
} from "@/features/venues/closures";

const c = (
  id: string,
  venue_id: string,
  start_date: string,
  end_date: string,
  reason: string | null = null,
  repeat_yearly = false
): VenueClosure => ({
  id, venue_id, start_date, end_date, reason, repeat_yearly, created_by: null,
  created_at: "2026-10-30T10:00:00Z",
});

const ferragosto = c("a", "V1", "2026-08-15", "2026-08-15", "Ferragosto");
const ferie = c("b", "V1", "2026-08-20", "2026-08-31");
const altra = c("c", "V2", "2026-08-15", "2026-08-15", "Inventario");
const natale = c("d", "V1", "2026-12-24", "2027-01-06", "Natale", true);
const estate = c("e", "V2", "2025-08-10", "2025-08-20", null, true);
const cal: VenueCalendar = { closures: [ferie, ferragosto, altra, natale, estate], restDays: { V1: [1] } };

describe("giorni di chiusura", () => {
  it("una tantum: solo il suo intervallo, solo la sua sede", () => {
    expect(closuresOn(cal, "V1", "2026-08-15")).toEqual([{ reason: "Ferragosto", rest: false }]);
    expect(closuresOn(cal, "V1", "2026-08-25")).toEqual([{ reason: null, rest: false }]);
    expect(closuresOn(cal, "V1", "2027-08-15")).toEqual([]);
  });

  it("ogni anno: per giorno e mese, anche a cavallo d'anno", () => {
    expect(closureCovers(estate, "2031-08-15")).toBe(true);
    expect(closureCovers(estate, "2031-08-21")).toBe(false);
    expect(closureCovers(natale, "2030-12-31")).toBe(true);
    expect(closureCovers(natale, "2031-01-03")).toBe(true);
    expect(closureCovers(natale, "2031-01-07")).toBe(false);
    expect(closureCovers(natale, "2030-12-23")).toBe(false);
  });

  it("il riposo settimanale chiude quel giorno ogni settimana", () => {
    // 2026-11-02 è lunedì.
    expect(closuresOn(cal, "V1", "2026-11-02")).toEqual([{ reason: "riposo settimanale", rest: true }]);
    expect(closuresOn(cal, "V1", "2026-11-03")).toEqual([]);
    expect(restDaysText([1, 7])).toBe("Riposo settimanale: lunedì e domenica");
    expect(restDaysText([])).toBeNull();
  });

  it("dice il periodo e l'etichetta in parole", () => {
    expect(closureRangeText(ferragosto)).toBe("15 ago");
    expect(closureRangeText(ferie)).toBe("20 ago – 31 ago");
    expect(closureRangeText(natale)).toBe("24 dic – 6 gen · ogni anno");
    expect(dayClosureText(cal, [{ id: "V1", name: "Milano" }], "2026-08-15")).toBe("Chiusa · Ferragosto");
    expect(dayClosureText(cal, [{ id: "V1", name: "Milano" }], "2026-08-25")).toBe("Chiusa");
    expect(dayClosureText(cal, [{ id: "V1", name: "Milano" }, { id: "V2", name: "Roma" }], "2026-08-15")).toBe(
      "Milano chiusa · Ferragosto — Roma chiusa · Inventario"
    );
  });

  it("avvisa il form del turno senza bloccarlo", () => {
    expect(closureWarning(cal, "V1", ["2026-08-15"])).toBe(
      "La sede è chiusa il 15 ago (Ferragosto). Puoi creare il turno lo stesso, se è un'apertura eccezionale."
    );
    expect(closureWarning(cal, "V1", ["2026-08-22", "2026-08-21"], "spostare")).toMatch(
      /^La sede è chiusa in 2 dei giorni scelti, dal 21 ago\. Puoi spostare/
    );
    expect(closureWarning(cal, "V1", ["2026-08-18"])).toBeNull();
    expect(closureWarning(cal, null, ["2026-08-15"])).toBeNull();
  });

  it("la scheda mostra le annuali sempre e le altre finché non sono passate", () => {
    expect(upcomingClosures(cal.closures, "V1", "2026-08-16").map((x) => x.id)).toEqual(["b", "d"]);
  });

  it("segna i giorni chiusi su un intervallo, per il calendario", () => {
    const days = closedDates(cal, ["V1"], "2026-08-14", "2026-08-21");
    // 15 (Ferragosto), 17 (lunedì), 20 e 21 (ferie).
    expect([...days]).toEqual(["2026-08-15", "2026-08-17", "2026-08-20", "2026-08-21"]);
  });

  it("aggiunge all'agenda i giorni chiusi senza turni, nel tratto mostrato", () => {
    const sections = [
      { date: "2026-08-14", title: "ven 14 ago", data: [1] },
      { date: "2026-08-15", title: "sab 15 ago", data: [2] },
    ];
    const closed = new Set(["2026-08-10", "2026-08-15", "2026-08-16", "2026-12-25"]);
    const out = withClosedDays(sections, closed, "2026-08-12", 30, new Date("2026-08-12T10:00:00"));
    expect(out.map((s) => s.date)).toEqual(["2026-08-14", "2026-08-15", "2026-08-16"]);
    expect(out[2].data).toEqual([]);
  });
});
