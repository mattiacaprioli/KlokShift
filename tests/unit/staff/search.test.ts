import { describe, expect, it } from "vitest";

import { matchesStaffSearch } from "@/features/staff/search";

const anna = {
  display_name: "Anna Rossi",
  staff_member_roles: [
    { role: { id: "r1", name: "Barista", sort_order: 1 } },
    { role: null },
  ],
};

describe("matchesStaffSearch", () => {
  it("una ricerca vuota trova tutti", () => {
    expect(matchesStaffSearch(anna, "")).toBe(true);
    expect(matchesStaffSearch(anna, "   ")).toBe(true);
  });

  it("cerca nel nome e nei ruoli, senza badare alle maiuscole", () => {
    expect(matchesStaffSearch(anna, "ross")).toBe(true);
    expect(matchesStaffSearch(anna, " BAR ")).toBe(true);
    expect(matchesStaffSearch(anna, "cucina")).toBe(false);
  });
});
