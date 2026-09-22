import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  absenceConflicts,
  absenceForShift,
  shiftOverlapsAbsence,
  type AbsenceWindow,
} from "@/features/absences/conflicts";

const fullDay = (
  status: AbsenceWindow["status"],
  start_date = "2026-09-23",
  end_date = start_date
): AbsenceWindow => ({
  status,
  start_date,
  end_date,
  start_time: null,
  end_time: null,
});

describe("conflitti delle assenze", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-22T12:00:00"));
  });

  afterEach(() => vi.useRealTimers());

  it("fa vincere un'assenza approvata su una richiesta pendente", () => {
    const pending = fullDay("pending");
    const approved = fullDay("approved");
    const shift = {
      date: "2026-09-23",
      start_time: "18:00",
      end_time: "23:00",
    };

    expect(absenceForShift(shift, [pending, approved])).toBe(approved);
  });

  it("intercetta un turno notturno che entra nel primo giorno di assenza", () => {
    expect(
      shiftOverlapsAbsence(
        { date: "2026-09-22", start_time: "22:00", end_time: "04:00" },
        fullDay("approved")
      )
    ).toBe(true);
  });

  it("non considera sovrapposti due intervalli soltanto adiacenti", () => {
    expect(
      shiftOverlapsAbsence(
        { date: "2026-09-23", start_time: "18:00", end_time: "23:00" },
        {
          status: "approved",
          start_date: "2026-09-23",
          end_date: "2026-09-23",
          start_time: "16:00",
          end_time: "18:00",
        }
      )
    ).toBe(false);
  });

  it("ignora assenze rifiutate o ritirate", () => {
    const shift = {
      date: "2026-09-23",
      start_time: "18:00",
      end_time: "23:00",
    };
    expect(
      absenceForShift(shift, [fullDay("rejected"), fullDay("withdrawn")])
    ).toBeNull();
  });

  it("esclude dai conflitti i turni già conclusi rispetto all'orologio fissato", () => {
    const past = {
      id: "past",
      date: "2026-09-21",
      start_time: "18:00",
      end_time: "23:00",
    };
    const future = {
      id: "future",
      date: "2026-09-23",
      start_time: "18:00",
      end_time: "23:00",
    };

    expect(
      absenceConflicts(
        [past, future],
        fullDay("approved", "2026-09-21", "2026-09-23")
      ).map((shift) => shift.id)
    ).toEqual(["future"]);
  });
});
