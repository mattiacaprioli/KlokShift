import type { PersonMembership } from "@/features/staff/types";
import type { VenueRole } from "./api";

/**
 * La stessa mansione in due sedi ha due id diversi: per suggerirla nella sede
 * nuova si può quindi confrontare solo il nome. La normalizzazione resta
 * volutamente prudente: maiuscole e spazi non cambiano il significato, mentre
 * sinonimi come «Barman» e «Barista» richiedono una scelta umana.
 */
function roleNameKey(name: string): string {
  return name
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("it");
}

/**
 * Ruoli attivi della sede di destinazione che la persona ricopre già in
 * almeno un'altra sede in cui lavora ancora.
 *
 * Se nella destinazione esistono per errore due ruoli con lo stesso nome ne
 * suggeriamo uno solo: assegnarli entrambi creerebbe due mansioni
 * indistinguibili.
 */
export function suggestedRoleIds(
  targetRoles: Pick<VenueRole, "id" | "name">[],
  memberships: Pick<
    PersonMembership,
    "link_status" | "staff_member_roles" | "venue"
  >[]
): string[] {
  const knownNames = new Set<string>();
  for (const membership of memberships) {
    if (membership.link_status === "left" || membership.venue?.closed_at) {
      continue;
    }
    for (const { role } of membership.staff_member_roles) {
      if (role) knownNames.add(roleNameKey(role.name));
    }
  }

  const matchedNames = new Set<string>();
  const ids: string[] = [];
  for (const role of targetRoles) {
    const key = roleNameKey(role.name);
    if (knownNames.has(key) && !matchedNames.has(key)) {
      ids.push(role.id);
      matchedNames.add(key);
    }
  }
  return ids;
}
