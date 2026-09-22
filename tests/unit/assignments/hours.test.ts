import { describe, expect, it } from "vitest";

import { assignmentHours } from "@/features/assignments/hours";

describe("assignmentHours", () => {
  it("usa la durata pianificata di un turno ordinario", () => {
    expect(
      assignmentHours("confirmed", null, {
        start_time: "18:00",
        end_time: "23:00",
      })
    ).toBe(5);
  });

  it("calcola un turno notturno oltre la mezzanotte", () => {
    expect(
      assignmentHours("assigned", null, {
        start_time: "22:00",
        end_time: "04:00",
      })
    ).toBe(6);
  });

  it("considera autorevole la rettifica manuale", () => {
    expect(
      assignmentHours("confirmed", 3.5, {
        start_time: "18:00",
        end_time: "23:00",
      })
    ).toBe(3.5);
  });

  it.each(["declined", "no_show"] as const)(
    "azzera lo stato %s anche con ore manuali",
    (status) => {
      expect(assignmentHours(status, 7, null)).toBe(0);
    }
  );

  it("non inventa ore senza gli orari del turno", () => {
    expect(assignmentHours("confirmed", null, null)).toBe(0);
  });
});
