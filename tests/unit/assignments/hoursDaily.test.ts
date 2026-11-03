import { describe, expect, it } from "vitest";

import { toHoursDailyRows, type DbDailyRow } from "@/features/assignments/hoursDaily";

const base: DbDailyRow = {
  member_id: "m1",
  member_name: "Anna Rossi",
  date: "2026-11-03",
  kind: "work",
  venue_name: "Sede Centro",
  title: "Sala",
  clock_in: "2026-11-03T08:00:00Z",
  clock_out: "2026-11-03T16:00:00Z",
  break_minutes: 30,
  break_paid: false,
  hours: "7.83",
  note: null,
};

describe("toHoursDailyRows", () => {
  it("converte le ore numeric da stringa a numero", () => {
    expect(toHoursDailyRows([base])[0].hours).toBe(7.83);
  });

  it("lascia null le ore mancanti", () => {
    expect(toHoursDailyRows([{ ...base, kind: "to_fix", hours: null }])[0].hours).toBeNull();
  });

  it("rinomina member_id e member_name in person_id e person_name", () => {
    const [row] = toHoursDailyRows([base]);
    expect(row.person_id).toBe("m1");
    expect(row.person_name).toBe("Anna Rossi");
    expect(row).not.toHaveProperty("member_id");
    expect(row).not.toHaveProperty("member_name");
  });

  it("accetta ore già numeriche e conserva i campi nulli", () => {
    const [row] = toHoursDailyRows([
      { ...base, hours: 4, venue_name: null, title: null, clock_in: null, clock_out: null, break_minutes: null, break_paid: null },
    ]);
    expect(row.hours).toBe(4);
    expect(row.venue_name).toBeNull();
    expect(row.break_paid).toBeNull();
  });
});
