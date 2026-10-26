import type { StaffRoleRef } from "./types";

/**
 * Da quante persone in su l'elenco «Chi lavora» del form del turno mostra la
 * ricerca. Sotto si legge a colpo d'occhio, e un campo in più è solo rumore.
 */
export const STAFF_SEARCH_FROM = 8;

/**
 * La persona corrisponde alla ricerca? Per nome o per ruolo: «bar» trova i
 * baristi, ed è spesso così che si cerca chi chiamare. Condivisa da app e
 * dashboard; una ricerca vuota trova tutti.
 */
export function matchesStaffSearch(
  member: {
    display_name: string;
    staff_member_roles: { role: StaffRoleRef | null }[];
  },
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  if (member.display_name.toLowerCase().includes(needle)) return true;
  return member.staff_member_roles.some((r) =>
    r.role?.name.toLowerCase().includes(needle)
  );
}
