import { describe, expect, it } from "vitest";

import {
  NO_ABSENCE_FILTERS,
  absencePeopleOf,
  activeAbsenceFilterCount,
  filterCompanyAbsences,
  memberIdsInVenue,
  toggleAbsenceKind,
} from "@/features/absences/filters";
import { visibleAbsenceNote } from "@/features/absences/labels";

const rows = [
  { id: "1", member_id: "m1", kind: "ferie" as const, person: { id: "m1", full_name: "Zeno", waiter_id: null } },
  { id: "2", member_id: "m2", kind: "malattia" as const, person: { id: "m2", full_name: "Andrea", waiter_id: null } },
  { id: "3", member_id: "m1", kind: "permesso" as const, person: { id: "m1", full_name: "Zeno", waiter_id: null } },
];

describe("filtri della pagina Assenze", () => {
  it("senza filtri restituisce tutto", () => {
    expect(filterCompanyAbsences(rows, NO_ABSENCE_FILTERS, null)).toHaveLength(3);
    expect(activeAbsenceFilterCount(NO_ABSENCE_FILTERS)).toBe(0);
  });

  it("combina persona e tipo", () => {
    const f = { ...NO_ABSENCE_FILTERS, personId: "m1", kinds: ["ferie" as const] };
    expect(filterCompanyAbsences(rows, f, null).map((r) => r.id)).toEqual(["1"]);
    expect(activeAbsenceFilterCount(f)).toBe(2);
  });

  it("tutti i tipi accesi equivale a nessun filtro sul tipo", () => {
    let f = toggleAbsenceKind(NO_ABSENCE_FILTERS, "ferie", 3);
    f = toggleAbsenceKind(f, "permesso", 3);
    expect(f.kinds).toEqual(["ferie", "permesso"]);
    expect(toggleAbsenceKind(f, "malattia", 3).kinds).toEqual([]);
    expect(toggleAbsenceKind(f, "ferie", 3).kinds).toEqual(["permesso"]);
  });

  it("con la sede scelta e l'organico non ancora arrivato non spaccia la lista intera per filtrata", () => {
    const f = { ...NO_ABSENCE_FILTERS, venueId: "v1" };
    expect(filterCompanyAbsences(rows, f, null)).toEqual([]);
    const people = [
      { id: "m1", memberships: [{ venue_id: "v2" }] },
      { id: "m2", memberships: [{ venue_id: "v1" }, { venue_id: "v2" }] },
    ];
    expect(
      filterCompanyAbsences(rows, f, memberIdsInVenue(people, "v1")).map((r) => r.id)
    ).toEqual(["2"]);
  });

  it("propone solo chi ha assenze, una volta sola, in ordine alfabetico", () => {
    expect(absencePeopleOf(rows)).toEqual([
      { id: "m2", name: "Andrea" },
      { id: "m1", name: "Zeno" },
    ]);
  });

  it("non ripete come nota il tipo dell'assenza", () => {
    expect(visibleAbsenceNote({ kind: "ferie", note: " ferie " })).toBeNull();
    expect(visibleAbsenceNote({ kind: "permesso", note: "Visita medica" })).toBe("Visita medica");
    expect(visibleAbsenceNote({ kind: "ferie", note: null })).toBeNull();
  });
});
