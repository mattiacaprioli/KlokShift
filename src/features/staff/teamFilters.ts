import type { OwnerPerson } from "./types";
import { STAFF_SEARCH_FROM } from "./search";

/**
 * I filtri della pagina Team, uguali in app e dashboard (decisione del 30/10).
 *
 * Pochi e solo quando servono: la maggior parte delle sedi ha 5-15 persone, e
 * lì una barra di filtri è rumore. Da `TEAM_FILTERS_FROM` persone compaiono la
 * ricerca (nome o ruolo), i ruoli, la sede (solo con più sedi) e «Non ancora
 * nell'app» — l'unico che porta a fare qualcosa: rimandare l'invito o
 * aggiungere l'email, il punto in cui le aziende si fermano.
 */
export const TEAM_FILTERS_FROM = STAFF_SEARCH_FROM;

export type TeamFilters = {
  query: string;
  venueId: string | null;
  /** Per nome, in minuscolo: due sedi con «Sala» sono due righe diverse. */
  role: string | null;
  notInApp: boolean;
};

export const NO_TEAM_FILTERS: TeamFilters = {
  query: "",
  venueId: null,
  role: null,
  notInApp: false,
};

/** Senza account collegato, o con un invito che aspetta il suo sì. */
export function isNotInApp(person: OwnerPerson): boolean {
  return !person.waiter_id || person.memberships.some((m) => m.link_status === "pending");
}

function roleNames(person: OwnerPerson): string[] {
  return person.memberships.flatMap((m) =>
    m.staff_member_roles.flatMap(({ role }) => (role ? [role.name.toLowerCase()] : []))
  );
}

export function matchesTeamFilters(person: OwnerPerson, f: TeamFilters): boolean {
  if (f.notInApp && !isNotInApp(person)) return false;
  if (f.venueId && !person.memberships.some((m) => m.venue_id === f.venueId)) return false;
  if (f.role && !roleNames(person).includes(f.role)) return false;
  const needle = f.query.trim().toLowerCase();
  if (!needle) return true;
  return (
    person.full_name.toLowerCase().includes(needle) ||
    roleNames(person).some((name) => name.includes(needle))
  );
}

export function teamFiltersActive(f: TeamFilters): boolean {
  return !!f.query.trim() || !!f.venueId || !!f.role || f.notInApp;
}

/** I ruoli che qualcuno ha davvero, una volta per nome, come si scrivono. */
export function teamRoleOptions(people: OwnerPerson[]): { key: string; label: string }[] {
  const byKey = new Map<string, { label: string; order: number }>();
  for (const person of people) {
    for (const m of person.memberships) {
      for (const { role } of m.staff_member_roles) {
        if (!role) continue;
        const key = role.name.toLowerCase();
        const seen = byKey.get(key);
        if (!seen || role.sort_order < seen.order) {
          byKey.set(key, { label: role.name, order: role.sort_order });
        }
      }
    }
  }
  return [...byKey.entries()]
    .sort(([, a], [, b]) => a.order - b.order || a.label.localeCompare(b.label, "it"))
    .map(([key, { label }]) => ({ key, label }));
}

export function notInAppLabel(count: number): string {
  return `Non ancora nell'app (${count})`;
}
