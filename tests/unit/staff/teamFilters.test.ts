import { describe, expect, it } from "vitest";
import {
  NO_TEAM_FILTERS,
  isNotInApp,
  matchesTeamFilters,
  teamFiltersActive,
  teamRoleOptions,
} from "@/features/staff/teamFilters";
import type { OwnerPerson } from "@/features/staff/types";

const role = (name: string, sort_order = 0) => ({ role: { id: name, name, sort_order } });

function person(
  name: string,
  over: { waiter_id?: string | null; venues?: string[]; roles?: ReturnType<typeof role>[]; pending?: boolean } = {}
): OwnerPerson {
  const venues = over.venues ?? ["V1"];
  return {
    id: name, workspace_id: "W", full_name: name, phone: null, note: null, email: null,
    waiter_id: over.waiter_id === undefined ? `u-${name}` : over.waiter_id,
    authority: "none", status: "active", contract_hours: null, contract_period: null,
    invited_at: null, invite_count: 0, invite_conflict_at: null, created_at: "2026-10-01",
    waiter: null,
    memberships: venues.map((venue_id) => ({
      id: `${name}-${venue_id}`, venue_id, link_status: over.pending ? "pending" : "active",
      employment_type: "fisso", clock_method: null, venue: null,
      staff_member_roles: over.roles ?? [],
    })),
  } as OwnerPerson;
}

const marco = person("Marco Rossi", { roles: [role("Sala", 1)] });
const giulia = person("Giulia Bianchi", { roles: [role("Bar", 2)], venues: ["V2"] });
const luca = person("Luca Verdi", { waiter_id: null, roles: [role("Cucina", 3)] });
const anna = person("Anna Neri", { pending: true, roles: [role("sala", 1)] });

describe("filtri del team", () => {
  it("senza filtri passano tutti", () => {
    expect([marco, giulia, luca, anna].every((p) => matchesTeamFilters(p, NO_TEAM_FILTERS))).toBe(true);
    expect(teamFiltersActive(NO_TEAM_FILTERS)).toBe(false);
  });

  it("la ricerca trova per nome o per ruolo", () => {
    const by = (query: string) =>
      [marco, giulia, luca, anna].filter((p) => matchesTeamFilters(p, { ...NO_TEAM_FILTERS, query })).map((p) => p.id);
    expect(by("ross")).toEqual(["Marco Rossi"]);
    expect(by("BAR")).toEqual(["Giulia Bianchi"]);
    expect(by("  ")).toHaveLength(4);
  });

  it("non ancora nell'app: senza account o con l'invito da accettare", () => {
    expect(isNotInApp(luca)).toBe(true);
    expect(isNotInApp(anna)).toBe(true);
    expect(isNotInApp(marco)).toBe(false);
  });

  it("sede e ruolo si combinano; il ruolo vale per nome fra le sedi", () => {
    const f = { ...NO_TEAM_FILTERS, venueId: "V1", role: "sala" };
    expect([marco, giulia, luca, anna].filter((p) => matchesTeamFilters(p, f)).map((p) => p.id)).toEqual([
      "Marco Rossi",
      "Anna Neri",
    ]);
  });

  it("i ruoli da proporre sono quelli che qualcuno ha, una volta sola", () => {
    expect(teamRoleOptions([marco, giulia, luca, anna])).toEqual([
      { key: "sala", label: "Sala" },
      { key: "bar", label: "Bar" },
      { key: "cucina", label: "Cucina" },
    ]);
  });
});
