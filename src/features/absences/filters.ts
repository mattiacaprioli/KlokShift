import type { AbsenceKind, AbsenceWithPerson } from "./api";

/**
 * I filtri della pagina Assenze, condivisi da app e web.
 *
 * A differenza dello storico dei turni qui si filtra **in memoria**: la pagina
 * scarica già tutta la finestra (`COMPANY_ABSENCES_DAYS_BACK`), senza pagine,
 * quindi le righe filtrate sono tutte quelle che ci sono.
 */
export type CompanyAbsenceFilters = {
  /** `workspace_members.id`, come `Absence.member_id`. */
  personId: string | null;
  /** Vuoto = tutti i tipi. */
  kinds: AbsenceKind[];
  /** Le persone in organico in quella sede (anche se poi ne sono uscite). */
  venueId: string | null;
};

export const NO_ABSENCE_FILTERS: CompanyAbsenceFilters = {
  personId: null,
  kinds: [],
  venueId: null,
};

export function activeAbsenceFilterCount(f: CompanyAbsenceFilters): number {
  return (f.personId ? 1 : 0) + (f.kinds.length > 0 ? 1 : 0) + (f.venueId ? 1 : 0);
}

/** Accende o spegne un tipo; tutti accesi equivale a nessun filtro. */
export function toggleAbsenceKind(
  f: CompanyAbsenceFilters,
  kind: AbsenceKind,
  allKinds: number
): CompanyAbsenceFilters {
  const kinds = f.kinds.includes(kind)
    ? f.kinds.filter((k) => k !== kind)
    : [...f.kinds, kind];
  return { ...f, kinds: kinds.length === allKinds ? [] : kinds };
}

/**
 * `venueMemberIds`: le persone della sede scelta, ricavate dall'organico. Se la
 * sede è scelta ma l'organico non è ancora arrivato, meglio una lista vuota per
 * un istante che una lista non filtrata spacciata per filtrata.
 */
export function filterCompanyAbsences<
  T extends Pick<AbsenceWithPerson, "member_id" | "kind">,
>(
  rows: readonly T[],
  f: CompanyAbsenceFilters,
  venueMemberIds: ReadonlySet<string> | null
): T[] {
  return rows.filter(
    (a) =>
      (!f.personId || a.member_id === f.personId) &&
      (f.kinds.length === 0 || f.kinds.includes(a.kind)) &&
      (!f.venueId || (venueMemberIds?.has(a.member_id) ?? false))
  );
}

/**
 * Le persone da scegliere: solo chi ha almeno un'assenza nella finestra, in
 * ordine alfabetico. Un elenco di tutto l'organico porterebbe quasi sempre a
 * una lista vuota.
 */
export function absencePeopleOf(
  rows: readonly Pick<AbsenceWithPerson, "member_id" | "person">[]
): { id: string; name: string }[] {
  const byId = new Map<string, string>();
  for (const a of rows) {
    if (!byId.has(a.member_id)) {
      byId.set(a.member_id, a.person?.full_name ?? "Persona");
    }
  }
  return [...byId]
    .map(([id, name]) => ({ id, name }))
    .sort((x, y) => x.name.localeCompare(y.name, "it"));
}

/** Le persone (member id) con una riga di organico nella sede. */
export function memberIdsInVenue(
  people: readonly { id: string; memberships: readonly { venue_id: string }[] }[],
  venueId: string
): Set<string> {
  return new Set(
    people
      .filter((p) => p.memberships.some((m) => m.venue_id === venueId))
      .map((p) => p.id)
  );
}
