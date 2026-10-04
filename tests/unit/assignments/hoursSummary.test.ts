import { describe, expect, it } from "vitest";
import { groupHoursByPerson, type OwnerHoursRow } from "@/features/assignments/hoursSummary";
import { monthlyReportRows } from "@/features/assignments/monthlyReport";
import type { AbsenceSummaryRow } from "@/features/absences/summary";

function row(person_id: string, venue: string, extra: Partial<OwnerHoursRow> = {}): OwnerHoursRow {
  return {
    person_id,
    person_name: "Giulia Rossi",
    venue_id: venue,
    venue_name: venue,
    venue_closed: false,
    roles: null,
    shifts_count: 1,
    planned_hours: 4,
    hours: 4,
    to_review_count: 0,
    proposed_hours: 0,
    untracked_hours: 0,
    ...extra,
  };
}

describe("groupHoursByPerson", () => {
  it("tiene distinti due omonimi anche con righe intercalate (B05)", () => {
    // L'ordine della RPC a parità di totale e di nome: persona A e B alternate.
    const rows = [
      row("a", "Roma", { roles: "Sala" }),
      row("b", "Roma", { roles: "Bar" }),
      row("a", "Torino", { roles: "Cucina" }),
      row("b", "Torino", { roles: "Bar" }),
    ];
    const people = groupHoursByPerson(rows);
    expect(people.map((p) => [p.person_id, p.hours, p.roles, p.venues.length])).toEqual([
      ["a", 8, "Sala, Cucina", 2],
      ["b", 8, "Bar", 2],
    ]);
  });

  it("restituisce un elenco vuoto senza righe", () => {
    expect(groupHoursByPerson([])).toEqual([]);
  });

  it("somma tutti i contatori della stessa persona, ovunque sia nell'elenco", () => {
    const rows = [
      row("a", "Roma", {
        shifts_count: 2, hours: 10, planned_hours: 12, to_review_count: 1, proposed_hours: 3, untracked_hours: 1,
      }),
      row("c", "Roma", { person_name: "Carlo" }),
      row("a", "Milano", {
        shifts_count: 3, hours: 0, planned_hours: 6, to_review_count: 2, proposed_hours: 0.5, untracked_hours: 2,
      }),
    ];
    const [a, c] = groupHoursByPerson(rows);
    expect(a).toMatchObject({
      person_id: "a", shifts_count: 5, hours: 10, planned_hours: 18,
      to_review_count: 3, proposed_hours: 3.5, untracked_hours: 3,
    });
    expect(c).toMatchObject({ person_id: "c", person_name: "Carlo", hours: 4 });
  });

  it("conserva l'ordine di prima apparizione, senza riordinare", () => {
    const rows = [row("z", "Roma"), row("a", "Roma"), row("z", "Milano"), row("m", "Roma")];
    expect(groupHoursByPerson(rows).map((p) => p.person_id)).toEqual(["z", "a", "m"]);
  });

  it("unisce ruoli ripetuti e ignora quelli assenti", () => {
    const rows = [
      row("a", "Roma", { roles: "Sala, Bar" }),
      row("a", "Milano", { roles: null }),
      row("a", "Torino", { roles: "Bar , Sala" }),
    ];
    expect(groupHoursByPerson(rows)[0].roles).toBe("Sala, Bar");
    expect(groupHoursByPerson([row("a", "Roma")])[0].roles).toBeNull();
  });

  it("non modifica le righe ricevute", () => {
    const rows = [row("a", "Roma"), row("b", "Roma"), row("a", "Torino")];
    const before = structuredClone(rows);
    groupHoursByPerson(rows);
    expect(rows).toEqual(before);
  });

  it("dà al consuntivo una sola riga per persona con i suoi crediti", () => {
    const people = groupHoursByPerson([row("a", "Roma"), row("b", "Roma"), row("a", "Torino")]);
    const credit: AbsenceSummaryRow = {
      person_id: "a", person_name: "Giulia Rossi", ferie_days: 1, permesso_days: 0,
      permesso_hours: 0, malattia_days: 0, ferie_hours: 8, malattia_hours: 0,
      permesso_recognized_hours: 0, conflict_hours: 0, inps_protocols: null,
    };
    const report = monthlyReportRows(people, [credit]);
    expect(report.map((r) => [r.person_id, r.worked_hours, r.ferie_hours, r.covered_hours])).toEqual([
      ["a", 8, 8, 16],
      ["b", 4, 0, 4],
    ]);
  });
});
