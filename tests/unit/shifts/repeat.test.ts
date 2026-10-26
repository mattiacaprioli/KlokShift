import { describe, expect, it } from "vitest";

import type { AbsenceWindow } from "@/features/absences/conflicts";
import {
  absenceHitsLabel,
  clashLabel,
  plannedDatesOf,
  skippedDaysOf,
  skippedNote,
  staffForDate,
  weekOf,
  type AbsenceHit,
} from "@/features/shifts/repeat";

const absence = (
  status: AbsenceWindow["status"],
  start_time: string | null = null,
  end_time: string | null = null
): AbsenceWindow => ({
  status,
  start_date: "2026-10-28",
  end_date: "2026-10-28",
  start_time,
  end_time,
});

describe("ripetizione del turno", () => {
  it("weekOf dà i sette giorni da lunedì a domenica", () => {
    expect(weekOf("2026-10-29")).toEqual([
      "2026-10-26",
      "2026-10-27",
      "2026-10-28",
      "2026-10-29",
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
    ]);
    // La domenica appartiene alla settimana che finisce lì.
    expect(weekOf("2026-11-01")[0]).toBe("2026-10-26");
  });

  it("plannedDatesOf ordina e non ripete la data principale", () => {
    expect(
      plannedDatesOf("2026-10-28", ["2026-10-30", "2026-10-28", "2026-10-26"])
    ).toEqual(["2026-10-26", "2026-10-28", "2026-10-30"]);
  });

  it("lascia fuori solo chi ha un'assenza approvata, se non forzato", () => {
    const hits: Record<string, AbsenceHit[]> = {
      anna: [
        { date: "2026-10-28", absence: absence("approved") },
        { date: "2026-10-30", absence: absence("pending") },
      ],
      bruno: [{ date: "2026-10-30", absence: absence("pending") }],
    };
    const skipped = skippedDaysOf(
      [{ id: "anna" }, { id: "bruno" }, { id: "carla" }],
      (m) => hits[m.id] ?? []
    );
    expect([...skipped]).toEqual([["anna", ["2026-10-28"]]]);

    const staff = [
      { venue_member_id: "anna", role_id: null },
      { venue_member_id: "bruno", role_id: null },
    ];
    expect(
      staffForDate(staff, "2026-10-28", skipped, new Set()).map(
        (p) => p.venue_member_id
      )
    ).toEqual(["bruno"]);
    expect(
      staffForDate(staff, "2026-10-28", skipped, new Set(["anna"])).length
    ).toBe(2);
    expect(staffForDate(staff, "2026-10-30", skipped, new Set()).length).toBe(2);
  });

  it("dice chi resta fuori e come cambiarlo", () => {
    expect(skippedNote("Anna", ["2026-10-29"], false)).toEqual({
      text: "Anna resta fuori gio 29: non è disponibile.",
      action: "Metti in turno comunque",
    });
    expect(skippedNote("Anna", ["2026-10-29"], true).action).toBe(
      "Lascia fuori"
    );
  });
});

describe("etichette d'avviso", () => {
  it("assenze: su un giorno l'etichetta, su più giorni anche quali", () => {
    expect(absenceHitsLabel([], false)).toBeNull();
    expect(
      absenceHitsLabel(
        [{ date: "2026-10-28", absence: absence("approved") }],
        false
      )
    ).toBe("Non disponibile");
    expect(
      absenceHitsLabel(
        [
          { date: "2026-10-29", absence: absence("approved") },
          { date: "2026-10-30", absence: absence("approved") },
          { date: "2026-10-28", absence: absence("pending") },
        ],
        true
      )
    ).toBe("Non disponibile gio 29, ven 30 · Assenza richiesta mer 28");
  });

  it("doppio turno: orario e titolo, oppure i giorni", () => {
    expect(clashLabel([], false)).toBeNull();
    expect(
      clashLabel(
        [{ date: "2026-10-28", title: "Sera", range: "18:00–23:00" }],
        false
      )
    ).toBe("Già in turno 18:00–23:00 · Sera");
    expect(
      clashLabel(
        [
          { date: "2026-10-29", title: "Sera", range: "18:00–23:00" },
          { date: "2026-10-31", title: "Sera", range: "18:00–23:00" },
        ],
        true
      )
    ).toBe("Già in turno gio 29, sab 31");
  });
});
