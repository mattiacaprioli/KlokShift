import { describe, expect, it } from "vitest";
import {
  closureLabel,
  closureRangeText,
  closureWarning,
  closuresOn,
  upcomingClosures,
  type VenueClosure,
} from "@/features/venues/closures";

const c = (id: string, venue_id: string, start_date: string, end_date: string, reason: string | null = null): VenueClosure => ({
  id, venue_id, start_date, end_date, reason, created_by: null, created_at: "2026-10-30T10:00:00Z",
});

const ferragosto = c("a", "V1", "2026-08-15", "2026-08-15", "Ferragosto");
const ferie = c("b", "V1", "2026-08-20", "2026-08-31");
const altra = c("c", "V2", "2026-08-15", "2026-08-15", "Inventario");
const all = [ferie, ferragosto, altra];

describe("giorni di chiusura", () => {
  it("trova la chiusura del giorno, solo nella sua sede", () => {
    expect(closuresOn(all, "V1", "2026-08-15").map((x) => x.id)).toEqual(["a"]);
    expect(closuresOn(all, "V1", "2026-08-25").map((x) => x.id)).toEqual(["b"]);
    expect(closuresOn(all, "V1", "2026-08-16")).toEqual([]);
  });

  it("dice il periodo e l'etichetta in parole", () => {
    expect(closureRangeText(ferragosto)).toBe("15 ago");
    expect(closureRangeText(ferie)).toBe("20 ago – 31 ago");
    expect(closureLabel(ferragosto)).toBe("Chiusa · Ferragosto");
    expect(closureLabel(ferie)).toBe("Chiusa");
  });

  it("avvisa il form del turno senza bloccarlo", () => {
    expect(closureWarning(all, "V1", ["2026-08-15"])).toBe(
      "La sede è chiusa il 15 ago (Ferragosto). Puoi creare il turno lo stesso, se è un'apertura eccezionale."
    );
    expect(closureWarning(all, "V1", ["2026-08-22", "2026-08-21", "2026-09-02"])).toMatch(
      /^La sede è chiusa in 2 dei giorni scelti, dal 21 ago\./
    );
    expect(closureWarning(all, "V1", ["2026-08-16"])).toBeNull();
    expect(closureWarning(all, null, ["2026-08-15"])).toBeNull();
  });

  it("le prossime chiusure, in ordine, senza quelle finite", () => {
    expect(upcomingClosures(all, "V1", "2026-08-16").map((x) => x.id)).toEqual(["b"]);
    expect(upcomingClosures(all, "V1", "2026-08-01").map((x) => x.id)).toEqual(["a", "b"]);
  });
});

describe("chiusure sul calendario", () => {
  it("espande i periodi in giorni, solo per le sedi indicate", async () => {
    const { closedDates } = await import("@/features/venues/closures");
    const days = closedDates([ferie, ferragosto, altra], ["V1"]);
    expect(days.has("2026-08-15")).toBe(true);
    expect(days.has("2026-08-20")).toBe(true);
    expect(days.has("2026-08-31")).toBe(true);
    expect(days.has("2026-09-01")).toBe(false);
    expect(days.size).toBe(13);
  });

  it("con più sedi nomina quella chiusa", async () => {
    const { dayClosureText } = await import("@/features/venues/closures");
    const venues = [{ id: "V1", name: "Milano" }, { id: "V2", name: "Roma" }];
    expect(dayClosureText(all, venues, "2026-08-15")).toBe("Milano chiusa · Ferragosto — Roma chiusa · Inventario");
    expect(dayClosureText(all, [venues[0]], "2026-08-15")).toBe("Chiusa · Ferragosto");
    expect(dayClosureText(all, venues, "2026-08-16")).toBeNull();
  });
});

describe("giorni chiusi nell'agenda", () => {
  it("aggiunge come giorni vuoti solo quelli senza turni, nel tratto mostrato", async () => {
    const { withClosedDays } = await import("@/features/assignments/agenda");
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
